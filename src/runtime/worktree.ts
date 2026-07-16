import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runShellCommand } from "./process.js";

export interface Worktree {
  path: string;
  branch: string;
  dispose(): Promise<void>;
}

export class WorktreeManager {
  private readonly root: string;

  constructor(private readonly projectRoot: string, _stateDirectory: string) {
    const projectKey = Buffer.from(resolve(projectRoot)).toString("base64url").slice(0, 40);
    this.root = join(tmpdir(), "loopgauge-worktrees", projectKey);
  }

  async assertReady(): Promise<void> {
    const inside = await runShellCommand("git rev-parse --is-inside-work-tree", {
      cwd: this.projectRoot,
      timeoutMs: 10_000,
    });
    if (inside.exitCode !== 0 || !inside.stdout.includes("true")) {
      throw new Error("Optimization requires a Git repository");
    }
    const head = await runShellCommand("git rev-parse --verify HEAD", {
      cwd: this.projectRoot,
      timeoutMs: 10_000,
    });
    if (head.exitCode !== 0) throw new Error("Optimization requires at least one Git commit");
    const status = await runShellCommand("git status --porcelain", {
      cwd: this.projectRoot,
      timeoutMs: 10_000,
    });
    const relevantChanges = status.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.slice(3).replace(/\\/g, "/").startsWith(".loopgauge/"));
    if (relevantChanges.length > 0) {
      throw new Error("Optimization requires a clean project worktree to ensure reproducible baselines");
    }
  }

  async create(jobId: string, label: string): Promise<Worktree> {
    await mkdir(this.root, { recursive: true });
    const slug = `${safeName(jobId)}-${safeName(label)}-${crypto.randomUUID().slice(0, 8)}`;
    const path = resolve(this.root, slug);
    const branch = `loopgauge/${slug}`;
    const result = await runShellCommand(
      `git worktree add --detach "${path}" HEAD`,
      { cwd: this.projectRoot, timeoutMs: 60_000 },
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr || result.stdout}`);
    }
    return {
      path,
      branch,
      dispose: async () => {
        await runShellCommand(`git worktree remove --force "${path}"`, {
          cwd: this.projectRoot,
          timeoutMs: 60_000,
        });
        await rm(path, { recursive: true, force: true });
      },
    };
  }

  async diff(worktreePath: string): Promise<string> {
    const tracked = await runShellCommand("git diff --binary --no-ext-diff HEAD", {
      cwd: worktreePath,
      timeoutMs: 30_000,
    });
    const untracked = await runShellCommand("git ls-files --others --exclude-standard", {
      cwd: worktreePath,
      timeoutMs: 30_000,
    });
    let patch = tracked.stdout;
    for (const file of untracked.stdout.split(/\r?\n/).filter(Boolean)) {
      const added = await runShellCommand(`git diff --no-index -- /dev/null "${file}"`, {
        cwd: worktreePath,
        timeoutMs: 30_000,
      });
      patch += added.stdout;
    }
    return patch;
  }
}

function safeName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50);
  return cleaned || basename(value) || "run";
}
