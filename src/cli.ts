#!/usr/bin/env node
import { resolve } from "node:path";
import { LoopGaugeApp } from "./app.js";
import { initializeConfig } from "./config/init.js";
import type { ProviderId } from "./core/types.js";
import { createDemoReport, formatDemoReport } from "./demo.js";
import { estimateSavingsFromPrices } from "./optimization/estimate.js";
import { analyzeProject } from "./project/analyzer.js";
import { generateProviderArtifacts } from "./project/artifacts.js";
import { formatReport } from "./report/format.js";

interface ParsedArgs {
  command?: string;
  flags: Map<string, string | boolean>;
  positionals: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configPath = stringFlag(args, "config") ?? "loop.yaml";
  switch (args.command) {
    case "demo": {
      const report = createDemoReport();
      booleanFlag(args, "json") ? print(report) : console.log(formatDemoReport(report));
      return;
    }
    case "init":
      await initCommand(args);
      return;
    case "analyze":
      await withApp(configPath, async (app) => {
        const analysis = await analyzeProject(app.config);
        const estimate = estimateSavingsFromPrices(app.config);
        const artifacts = await generateProviderArtifacts(app.config, app.store.stateDirectory);
        print({ analysis, estimate, generatedArtifacts: artifacts });
      });
      return;
    case "optimize":
      await withApp(configPath, async (app) => {
        const resumeJobId = stringFlag(args, "resume");
        const report = await app.engine.optimize({
          configPath,
          ...(resumeJobId ? { jobId: resumeJobId } : {}),
          onProgress: (job) => {
            if (!booleanFlag(args, "json")) process.stderr.write(`\r${job.currentStep ?? job.status} | $${job.spentUsd.toFixed(4)}   `);
          },
        });
        if (!booleanFlag(args, "json")) process.stderr.write("\n");
        booleanFlag(args, "json") ? print(report) : console.log(formatReport(report));
        if (report.status !== "completed") process.exitCode = 1;
      });
      return;
    case "run":
      await withApp(configPath, async (app) => {
        const jobId = requiredFlag(args, "job");
        const prompt = stringFlag(args, "prompt") ?? args.positionals.join(" ");
        if (!prompt) throw new Error("run requires --prompt <task>");
        const report = app.store.getReport(jobId);
        if (!report) throw new Error(`Report not found: ${jobId}`);
        print(await app.engine.runSelectedTask(report, prompt));
      });
      return;
    case "compare":
      await withApp(configPath, async (app) => {
        const report = requireReport(app, requiredFlag(args, "job"));
        print({
          baselineQuality: report.baselineQuality,
          selected: report.selected,
          candidates: report.candidates,
        });
      });
      return;
    case "report":
      await withApp(configPath, async (app) => {
        const requested = stringFlag(args, "job");
        const jobId = requested ?? app.store.listJobs()[0]?.id;
        if (!jobId) throw new Error("No optimization jobs found");
        const report = requireReport(app, jobId);
        booleanFlag(args, "json") ? print(report) : console.log(formatReport(report));
      });
      return;
    case "help":
    case undefined:
      console.log(helpText());
      return;
    default:
      throw new Error(`Unknown command: ${args.command}\n\n${helpText()}`);
  }
}

async function initCommand(args: ParsedArgs): Promise<void> {
  const rawProvider = requiredFlag(args, "provider");
  const provider = parseProvider(rawProvider);
  const path = await initializeConfig({
    projectName: stringFlag(args, "name") ?? "LoopGauge project",
    provider,
    currentModel: requiredFlag(args, "model"),
    path: stringFlag(args, "config") ?? "loop.yaml",
    force: booleanFlag(args, "force"),
  });
  console.log(`Created ${path}`);
  console.log("Edit project commands and representative tasks, then run analyze.");
  console.log("LoopGauge will discover cheaper models from the selected provider automatically.");
}

function parseProvider(value: string): ProviderId {
  if (value !== "openai" && value !== "anthropic") {
    throw new Error("--provider must be openai or anthropic");
  }
  return value;
}

function parseArgs(values: string[]): ParsedArgs {
  const [command, ...rest] = values;
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index];
    if (!value) continue;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split("=", 2);
    if (!rawName) continue;
    if (inline !== undefined) {
      flags.set(rawName, inline);
    } else {
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        flags.set(rawName, next);
        index++;
      } else {
        flags.set(rawName, true);
      }
    }
  }
  return { ...(command ? { command } : {}), flags, positionals };
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function requiredFlag(args: ParsedArgs, name: string): string {
  const value = stringFlag(args, name);
  if (!value) throw new Error(`Missing required flag: --${name}`);
  return value;
}

function requireReport(app: LoopGaugeApp, jobId: string) {
  const report = app.store.getReport(jobId);
  if (!report) throw new Error(`Report not found: ${jobId}`);
  return report;
}

async function withApp(configPath: string, action: (app: LoopGaugeApp) => Promise<void>): Promise<void> {
  const app = await LoopGaugeApp.create(resolve(configPath));
  try {
    await action(app);
  } finally {
    app.close();
  }
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function helpText(): string {
  return `LoopGauge - cost-first, provider-neutral agent loop optimization\n\nCommands:\n  demo [--json]  # API-free synthetic replay\n  init --provider openai|anthropic --model CURRENT_MODEL [--name NAME] [--config PATH]\n  analyze [--config PATH]\n  optimize [--config PATH] [--resume JOB_ID] [--json]\n  run --job JOB_ID --prompt TASK [--config PATH]\n  compare --job JOB_ID [--config PATH]\n  report [--job JOB_ID] [--config PATH] [--json]\n\nCredentials are read from OPENAI_API_KEY/CODEX_API_KEY and ANTHROPIC_API_KEY.\nThe user chooses the current model; cheaper models are discovered only within that provider.`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
