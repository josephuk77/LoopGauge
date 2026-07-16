#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LoopGaugeApp } from "../app.js";
import { estimateSavingsFromPrices } from "../optimization/estimate.js";
import { OptimizationJobManager } from "../optimization/job-manager.js";
import { analyzeProject } from "../project/analyzer.js";
import { generateProviderArtifacts } from "../project/artifacts.js";

const configInput = { configPath: z.string().default("loop.yaml") };
const jobInput = {
  configPath: z.string().default("loop.yaml"),
  jobId: z.string().min(1),
};

export function createLoopGaugeMcpServer(): McpServer {
const manager = new OptimizationJobManager();
const server = new McpServer({ name: "loopgauge", version: "0.1.0" });

server.registerTool(
  "analyze_project",
  {
    title: "Analyze a project for LoopGauge",
    description: "Detect project checks and show the exact user-allowed provider/model scope.",
    inputSchema: configInput,
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  async ({ configPath }) =>
    withApp(configPath, async (app) => ({
      analysis: await analyzeProject(app.config),
      generatedArtifacts: await generateProviderArtifacts(app.config, app.store.stateDirectory),
    })),
);

server.registerTool(
  "estimate_savings",
  {
    title: "Estimate potential savings",
    description: "Return a price-based preflight range without claiming measured quality parity.",
    inputSchema: configInput,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ configPath }) => withApp(configPath, async (app) => estimateSavingsFromPrices(app.config)),
);

server.registerTool(
  "optimize_harness",
  {
    title: "Start harness optimization",
    description: "Start an asynchronous, budget-bounded optimization job in isolated Git worktrees.",
    inputSchema: configInput,
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  async ({ configPath }) => result({ jobId: await manager.start(configPath), status: "queued" }),
);

server.registerTool(
  "get_optimization_status",
  {
    title: "Get optimization status",
    description: "Read persisted progress for an optimization job.",
    inputSchema: jobInput,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ configPath, jobId }) => result((await manager.status(configPath, jobId)) ?? { found: false }),
);

server.registerTool(
  "cancel_optimization",
  {
    title: "Cancel optimization",
    description: "Request cancellation of an active optimization job.",
    inputSchema: { jobId: z.string().min(1) },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  async ({ jobId }) => result({ jobId, cancellationRequested: manager.cancel(jobId) }),
);

server.registerTool(
  "resume_optimization",
  {
    title: "Resume optimization",
    description: "Resume a persisted job, reusing completed runs and the same budget accounting.",
    inputSchema: jobInput,
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  async ({ configPath, jobId }) => result({ jobId: await manager.start(configPath, jobId), status: "queued" }),
);

server.registerTool(
  "run_optimized_task",
  {
    title: "Run an optimized task",
    description: "Execute the selected eligible policy in an isolated worktree and return its patch and measured cost.",
    inputSchema: {
      ...jobInput,
      prompt: z.string().min(1),
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  async ({ configPath, jobId, prompt }) =>
    withApp(configPath, async (app) => {
      const report = app.store.getReport(jobId);
      if (!report) throw new Error(`Report not found: ${jobId}`);
      return app.engine.runSelectedTask(report, prompt);
    }),
);

server.registerTool(
  "compare_results",
  {
    title: "Compare optimized results",
    description: "Return quality, similarity, difference, success, and cost scores for every candidate.",
    inputSchema: jobInput,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ configPath, jobId }) =>
    withApp(configPath, async (app) => {
      const report = app.store.getReport(jobId);
      if (!report) throw new Error(`Report not found: ${jobId}`);
      return {
        baselineQuality: report.baselineQuality,
        selected: report.selected,
        candidates: report.candidates,
      };
    }),
);

server.registerTool(
  "get_cost_report",
  {
    title: "Get cost report",
    description: "Return measured and amortized savings, break-even, price snapshot time, and evidence-backed improvements.",
    inputSchema: jobInput,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ configPath, jobId }) =>
    withApp(configPath, async (app) => {
      const report = app.store.getReport(jobId);
      if (!report) throw new Error(`Report not found: ${jobId}`);
      return report;
    }),
);

return server;
}

async function withApp<T>(configPath: string, action: (app: LoopGaugeApp) => Promise<T>) {
  const app = await LoopGaugeApp.create(configPath);
  try {
    return result(await action(app));
  } finally {
    app.close();
  }
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const transport = new StdioServerTransport();
  await createLoopGaugeMcpServer().connect(transport);
}
