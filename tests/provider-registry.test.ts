import { describe, expect, it } from "vitest";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "../src/core/types.js";
import { ProviderPolicyError, ProviderRegistry } from "../src/providers/registry.js";
import { makeConfig } from "./helpers.js";

class MockProvider implements AgentProvider {
  calls = 0;
  constructor(readonly id: "openai" | "anthropic") {}
  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.calls++;
    return result(request);
  }
}

describe("ProviderRegistry", () => {
  it("never invokes a provider outside the user's allowlist", async () => {
    const openai = new MockProvider("openai");
    const anthropic = new MockProvider("anthropic");
    const registry = new ProviderRegistry(makeConfig(), [openai, anthropic]);
    await expect(
      registry.run({ provider: "anthropic", model: "anything", prompt: "x", cwd: "." }),
    ).rejects.toBeInstanceOf(ProviderPolicyError);
    expect(anthropic.calls).toBe(0);
    expect(openai.calls).toBe(0);
  });

  it("never invokes a model outside the provider model allowlist", async () => {
    const openai = new MockProvider("openai");
    const registry = new ProviderRegistry(makeConfig(), [openai]);
    await expect(
      registry.run({ provider: "openai", model: "unlisted", prompt: "x", cwd: "." }),
    ).rejects.toBeInstanceOf(ProviderPolicyError);
    expect(openai.calls).toBe(0);
  });

  it("invokes an explicitly allowed provider and model", async () => {
    const openai = new MockProvider("openai");
    const registry = new ProviderRegistry(makeConfig(), [openai]);
    await registry.run({ provider: "openai", model: "candidate", prompt: "x", cwd: "." });
    expect(openai.calls).toBe(1);
  });
});

function result(request: AgentRunRequest): AgentRunResult {
  return {
    provider: request.provider,
    model: request.model,
    finalResponse: "ok",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
    },
    toolUsage: [],
    durationMs: 1,
    success: true,
  };
}
