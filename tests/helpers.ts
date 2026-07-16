import type { LoopConfig } from "../src/config/schema.js";

export function makeConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  const base: LoopConfig = {
    version: 1,
    project: {
      name: "fixture",
      root: ".",
      commands: {},
      commandTimeoutMs: 30_000,
    },
    task: {
      name: "fixture task",
      samples: [{ id: "one", prompt: "make the requested change", requirementScore: 1 }],
    },
    providers: {
      priceCatalogAsOf: "2026-07-16T00:00:00.000Z",
      selectionMode: "manual",
      allowedProviders: ["openai"],
      openai: {
        allowedModels: ["teacher", "candidate"],
        prices: {
          teacher: {
            inputPerMillionUsd: 10,
            outputPerMillionUsd: 20,
            cacheReadPerMillionUsd: 1,
            cacheWritePerMillionUsd: 12,
            tools: { web_search: 0.01 },
          },
          candidate: {
            inputPerMillionUsd: 1,
            outputPerMillionUsd: 2,
            cacheReadPerMillionUsd: 0.1,
            cacheWritePerMillionUsd: 1.2,
            tools: {},
          },
        },
      },
      roles: {
        teacher: { provider: "openai", model: "teacher" },
        candidates: [{ provider: "openai", model: "candidate" }],
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
      allowedTools: ["Read", "Edit", "Write", "Bash"],
      networkAccess: false,
    },
  };
  return deepMerge(base, overrides);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (!isObject(base) || !isObject(override)) return (override ?? base) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value;
  }
  return result as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
