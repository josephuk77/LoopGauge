import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "../src/core/types.js";
import { OptimizationEngine } from "../src/optimization/optimizer.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { runShellCommand } from "../src/runtime/process.js";
import { LoopGaugeStore } from "../src/storage/store.js";
import { makeConfig } from "./helpers.js";

const stores: LoopGaugeStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

class EditingProvider implements AgentProvider {
  readonly id = "openai" as const;
  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    await writeFile(join(request.cwd, "generated.ts"), "export function answer() { return 42; }\n", "utf8");
    const teacher = request.model === "teacher";
    return {
      provider: this.id,
      model: request.model,
      finalResponse: "done",
      usage: {
        inputTokens: teacher ? 10_000 : 1_000,
        outputTokens: teacher ? 2_000 : 200,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningTokens: 0,
      },
      toolUsage: [],
      durationMs: 1,
      success: true,
    };
  }
}

describe("OptimizationEngine", () => {
  it("selects the cheapest candidate only after it passes the quality gate", async () => {
    const root = await createGitFixture();
    const config = makeConfig({
      project: {
        name: "fixture",
        root,
        commands: { test: 'node -e "process.exit(0)"' },
        commandTimeoutMs: 30_000,
      },
    });
    const provider = new EditingProvider();
    const registry = new ProviderRegistry(config, [provider]);
    const store = await LoopGaugeStore.open(root);
    stores.push(store);
    const engine = new OptimizationEngine(config, registry, store);
    const report = await engine.optimize({ configPath: join(root, "loop.yaml") });
    expect(report.status).toBe("completed");
    expect(report.selected?.model).toBe("candidate");
    expect(report.selected?.qualityScore).toBe(100);
    expect(report.selected?.similarityScore).toBe(100);
    expect(report.savings?.savingsPercent).toBeGreaterThan(90);
  });
});

async function createGitFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loopgauge-test-"));
  await writeFile(join(root, "README.md"), "fixture\n", "utf8");
  for (const command of [
    "git init",
    'git config user.email "loopgauge@example.invalid"',
    'git config user.name "LoopGauge Test"',
    "git add README.md",
    'git commit -m "fixture"',
  ]) {
    const result = await runShellCommand(command, { cwd: root, timeoutMs: 30_000 });
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  }
  return root;
}
