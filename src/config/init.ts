import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import type { ProviderId } from "../core/types.js";

export interface InitOptions {
  projectName: string;
  providers: ProviderId[];
  path?: string;
  force?: boolean;
}

export async function initializeConfig(options: InitOptions): Promise<string> {
  if (options.providers.length === 0) throw new Error("At least one provider must be selected");
  const path = resolve(options.path ?? "loop.yaml");
  if (!options.force && (await exists(path))) throw new Error(`${path} already exists; pass --force to replace it`);
  const providerBlocks: Record<string, unknown> = {};
  const roles: Record<string, unknown> = {};

  for (const provider of options.providers) {
    const teacher = `your-${provider}-teacher-model`;
    const candidate = `your-${provider}-candidate-model`;
    providerBlocks[provider] = {
      allowedModels: [teacher, candidate],
      prices: {
        [teacher]: pricePlaceholder(),
        [candidate]: pricePlaceholder(),
      },
    };
  }
  const first = options.providers[0];
  if (!first) throw new Error("At least one provider must be selected");
  roles.teacher = { provider: first, model: `your-${first}-teacher-model` };
  roles.candidates = options.providers.map((provider) => ({
    provider,
    model: `your-${provider}-candidate-model`,
  }));

  const document = {
    version: 1,
    project: {
      name: options.projectName,
      root: ".",
      commands: {
        setup: "npm ci",
        build: "npm run build",
        test: "npm test",
        lint: "npm run lint",
        typecheck: "npm run typecheck",
      },
      commandTimeoutMs: 300000,
    },
    task: {
      name: "replace-with-your-repeated-task",
      samples: [
        { id: "sample-1", prompt: "Replace this with a representative task.", requirementScore: 1 },
        { id: "sample-2", prompt: "Add a second representative task.", requirementScore: 1 },
        { id: "sample-3", prompt: "Add an edge-case representative task.", requirementScore: 1 },
      ],
    },
    providers: {
      priceCatalogAsOf: new Date().toISOString(),
      selectionMode: "manual",
      allowedProviders: options.providers,
      ...providerBlocks,
      roles,
    },
    quality: {
      minimumBaselineRatio: 0.95,
      weights: { functional: 60, requirements: 20, regression: 10, staticAnalysis: 10 },
      similarityWeights: { behavior: 70, structure: 20, text: 10 },
    },
    optimization: {
      budgetUsd: 30,
      perRunBudgetUsd: 3,
      baselineRepetitions: 3,
      maxIterations: 30,
      noImprovementLimit: 4,
      reasoningEfforts: ["low", "medium"],
      promptVariants: ["plain", "verify", "budget-aware"],
      allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      networkAccess: false,
    },
  };
  await writeFile(path, YAML.stringify(document, { lineWidth: 0 }), "utf8");
  return path;
}

function pricePlaceholder(): Record<string, unknown> {
  return {
    inputPerMillionUsd: 0,
    outputPerMillionUsd: 0,
    cacheReadPerMillionUsd: 0,
    cacheWritePerMillionUsd: 0,
    tools: {},
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
