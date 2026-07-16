import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  EvaluatedRun,
  OptimizationJobRecord,
  OptimizationJobStatus,
  OptimizationReport,
} from "../core/types.js";

interface JobRow {
  id: string;
  status: string;
  project_root: string;
  config_path: string;
  current_step: string | null;
  spent_usd: number;
  created_at: string;
  updated_at: string;
  error: string | null;
}

interface JsonRow {
  payload: string;
}

export class LoopGaugeStore {
  private readonly db: DatabaseSync;
  readonly stateDirectory: string;

  private constructor(stateDirectory: string, db: DatabaseSync) {
    this.stateDirectory = stateDirectory;
    this.db = db;
  }

  static async open(projectRoot: string): Promise<LoopGaugeStore> {
    const stateDirectory = resolve(projectRoot, ".loopgauge");
    await mkdir(join(stateDirectory, "events"), { recursive: true });
    const db = new DatabaseSync(join(stateDirectory, "loopgauge.db"));
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const store = new LoopGaugeStore(stateDirectory, db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  saveJob(job: OptimizationJobRecord): void {
    this.db
      .prepare(`
        INSERT INTO jobs (id, status, project_root, config_path, current_step, spent_usd, created_at, updated_at, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_step = excluded.current_step,
          spent_usd = excluded.spent_usd,
          updated_at = excluded.updated_at,
          error = excluded.error
      `)
      .run(
        job.id,
        job.status,
        job.projectRoot,
        job.configPath,
        job.currentStep ?? null,
        job.spentUsd,
        job.createdAt,
        job.updatedAt,
        job.error ?? null,
      );
  }

  getJob(id: string): OptimizationJobRecord | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? mapJob(row) : undefined;
  }

  listJobs(status?: OptimizationJobStatus): OptimizationJobRecord[] {
    const rows = (status
      ? this.db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC").all(status)
      : this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all()) as unknown as JobRow[];
    return rows.map(mapJob);
  }

  saveRun(run: EvaluatedRun): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO runs (id, job_id, task_id, role, provider, model, variant, cost_usd, quality, success, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.jobId,
        run.taskId,
        run.role,
        run.provider,
        run.model,
        run.variant,
        run.cost.totalUsd,
        run.quality.total,
        run.result.success && run.validation.mandatoryPassed ? 1 : 0,
        JSON.stringify(run),
        run.createdAt,
      );
  }

  listRuns(jobId: string): EvaluatedRun[] {
    const rows = this.db
      .prepare("SELECT payload FROM runs WHERE job_id = ? ORDER BY created_at")
      .all(jobId) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.payload) as EvaluatedRun);
  }

  saveReport(report: OptimizationReport): void {
    this.db
      .prepare(`
        INSERT INTO reports (job_id, payload, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at
      `)
      .run(report.jobId, JSON.stringify(report), new Date().toISOString());
  }

  getReport(jobId: string): OptimizationReport | undefined {
    const row = this.db.prepare("SELECT payload FROM reports WHERE job_id = ?").get(jobId) as
      | JsonRow
      | undefined;
    return row ? (JSON.parse(row.payload) as OptimizationReport) : undefined;
  }

  async appendEvent(jobId: string, event: unknown): Promise<void> {
    const path = join(this.stateDirectory, "events", `${safeName(jobId)}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(sanitizeTrace(event))}\n`, "utf8");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        project_root TEXT NOT NULL,
        config_path TEXT NOT NULL,
        current_step TEXT,
        spent_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        variant TEXT NOT NULL,
        cost_usd REAL NOT NULL,
        quality REAL NOT NULL,
        success INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
      CREATE INDEX IF NOT EXISTS runs_job_id_idx ON runs(job_id);
      CREATE TABLE IF NOT EXISTS reports (
        job_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
    `);
  }
}

export function sanitizeTrace(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}/g, "[REDACTED_API_KEY]");
  }
  if (Array.isArray(value)) return value.map(sanitizeTrace);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  if (input.type === "thinking" || input.type === "redacted_thinking" || input.type === "reasoning") {
    return { type: input.type, redacted: true };
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (/(?:api.?key|authorization|credential|secret|signature|thinking|reasoning)$/i.test(key)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = sanitizeTrace(item);
    }
  }
  return output;
}

function mapJob(row: JobRow): OptimizationJobRecord {
  return {
    id: row.id,
    status: row.status as OptimizationJobStatus,
    projectRoot: row.project_root,
    configPath: row.config_path,
    ...(row.current_step ? { currentStep: row.current_step } : {}),
    spentUsd: row.spent_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.error ? { error: row.error } : {}),
  };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
