import { describe, expect, it, vi } from "vitest";
import { loopConfigSchema } from "../src/config/schema.js";
import {
  discoverCandidates,
  resolveAutomaticModelConfig,
} from "../src/models/discovery.js";
import type { CredentialResolver } from "../src/providers/credentials.js";

const noCredentials: CredentialResolver = {
  async getApiKey() {
    return undefined;
  },
};

describe("automatic model discovery", () => {
  it("requires only the user's current model and derives cheaper OpenAI candidates", async () => {
    const resolved = await resolveAutomaticModelConfig(minimalConfig("openai", "gpt-5.6"), {
      credentials: noCredentials,
    });
    const config = loopConfigSchema.parse(resolved);

    expect(config.providers.allowedProviders).toEqual(["openai"]);
    expect(config.providers.roles.teacher).toEqual({ provider: "openai", model: "gpt-5.6" });
    expect(config.providers.roles.candidates.map((candidate) => candidate.model)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
    ]);
    expect(config.providers.anthropic).toBeUndefined();
    expect(config.providers.modelDiscovery?.source).toBe("built-in-catalog");
  });

  it("intersects catalog candidates with models available to the user's provider account", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [{ id: "gpt-5.6" }, { id: "gpt-5.6-luna" }, { id: "unrelated" }] }),
    );
    const credentials: CredentialResolver = {
      async getApiKey(provider) {
        return provider === "openai" ? "secret" : undefined;
      },
    };

    const discovery = await discoverCandidates("openai", "gpt-5.6", 4, true, {
      credentials,
      fetch: fetchMock as typeof fetch,
    });

    expect(discovery.source).toBe("provider-api");
    expect(discovery.candidates.map((candidate) => candidate.model)).toEqual(["gpt-5.6-luna"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    );
  });

  it("never introduces OpenAI while discovering lower Anthropic models", async () => {
    const resolved = await resolveAutomaticModelConfig(minimalConfig("anthropic", "claude-sonnet-5"), {
      credentials: noCredentials,
    });
    const config = loopConfigSchema.parse(resolved);

    expect(config.providers.allowedProviders).toEqual(["anthropic"]);
    expect(config.providers.openai).toBeUndefined();
    expect(config.providers.roles.candidates).toEqual([
      { provider: "anthropic", model: "claude-haiku-4-5" },
      { provider: "anthropic", model: "claude-3-5-haiku-latest" },
    ]);
  });

  it("stops instead of guessing a price for an unknown current model", async () => {
    await expect(
      resolveAutomaticModelConfig(minimalConfig("openai", "unknown-model"), {
        credentials: noCredentials,
      }),
    ).rejects.toThrow(/unknown current model/i);
  });
});

function minimalConfig(provider: "openai" | "anthropic", model: string) {
  return {
    version: 1,
    project: { name: "fixture", root: ".", commands: {}, commandTimeoutMs: 30_000 },
    task: {
      name: "fixture task",
      samples: [{ id: "one", prompt: "make the requested change", requirementScore: 1 }],
    },
    providers: {
      modelDiscovery: {
        current: { provider, model },
        maxCandidates: 4,
        refreshFromProvider: true,
      },
    },
    quality: {
      minimumBaselineRatio: 0.95,
      weights: { functional: 60, requirements: 20, regression: 10, staticAnalysis: 10 },
      similarityWeights: { behavior: 70, structure: 20, text: 10 },
    },
    optimization: {
      budgetUsd: 30,
      perRunBudgetUsd: 3,
      baselineRepetitions: 1,
      maxIterations: 10,
      noImprovementLimit: 3,
      reasoningEfforts: ["low"],
      promptVariants: ["plain"],
      allowedTools: ["Read"],
      networkAccess: false,
    },
  };
}
