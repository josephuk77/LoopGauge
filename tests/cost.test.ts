import { describe, expect, it } from "vitest";
import { calculateSavings, PriceCatalog } from "../src/cost/pricing.js";
import type { AgentRunResult } from "../src/core/types.js";
import { makeConfig } from "./helpers.js";

describe("cost accounting", () => {
  it("includes input, output, cache, and tool charges", () => {
    const catalog = new PriceCatalog(makeConfig(), "2026-07-16T00:00:00.000Z");
    const run: AgentRunResult = {
      provider: "openai",
      model: "teacher",
      finalResponse: "ok",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cachedInputTokens: 100_000,
        cacheWriteInputTokens: 50_000,
        reasoningTokens: 0,
      },
      toolUsage: [{ name: "web_search", calls: 2 }],
      durationMs: 1,
      success: true,
    };
    const cost = catalog.calculate(run);
    expect(cost.inputUsd).toBe(10);
    expect(cost.outputUsd).toBe(10);
    expect(cost.cacheReadUsd).toBeCloseTo(0.1);
    expect(cost.cacheWriteUsd).toBeCloseTo(0.6);
    expect(cost.toolsUsd).toBeCloseTo(0.02);
    expect(cost.totalUsd).toBeCloseTo(20.72);
  });

  it("reports measured, amortized, and break-even savings", () => {
    const savings = calculateSavings(1, 0.4, 12, 100);
    expect(savings.savingsPercent).toBeCloseTo(60);
    expect(savings.amortizedSavingsPercent).toBeCloseTo(48);
    expect(savings.breakEvenRuns).toBe(20);
  });
});
