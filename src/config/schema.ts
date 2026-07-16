import { z } from "zod";

const providerIdSchema = z.enum(["openai", "anthropic"]);
const reasoningEffortSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"]);

const modelPriceSchema = z.object({
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
  cacheReadPerMillionUsd: z.number().nonnegative().default(0),
  cacheWritePerMillionUsd: z.number().nonnegative().default(0),
  tools: z.record(z.string(), z.number().nonnegative()).default({}),
});

const providerConfigSchema = z.object({
  allowedModels: z.array(z.string().min(1)).min(1),
  prices: z.record(z.string(), modelPriceSchema),
});

const roleSelectionSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1),
});

const modelDiscoverySchema = z.object({
  current: roleSelectionSchema,
  maxCandidates: z.number().int().min(1).max(10).default(4),
  refreshFromProvider: z.boolean().default(true),
  source: z.enum(["provider-api", "built-in-catalog"]).optional(),
  resolvedAt: z.iso.datetime().optional(),
  candidates: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string()).default([]),
});

const commandSchema = z.string().min(1).optional();

const sampleTaskSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  requirementScore: z.number().min(0).max(1).default(1),
  baselinePatchPath: z.string().min(1).optional(),
});

export const loopConfigSchema = z
  .object({
    version: z.literal(1),
    project: z.object({
      name: z.string().min(1),
      root: z.string().default("."),
      commands: z
        .object({
          setup: commandSchema,
          build: commandSchema,
          test: commandSchema,
          lint: commandSchema,
          typecheck: commandSchema,
        })
        .default({}),
      commandTimeoutMs: z.number().int().positive().default(300_000),
    }),
    task: z.object({
      name: z.string().min(1),
      samples: z.array(sampleTaskSchema).min(1).max(20),
    }),
    providers: z.object({
      priceCatalogAsOf: z.iso.datetime(),
      selectionMode: z.enum(["manual", "auto-within-allowlist"]).default("manual"),
      allowedProviders: z.array(providerIdSchema).min(1),
      openai: providerConfigSchema.optional(),
      anthropic: providerConfigSchema.optional(),
      modelDiscovery: modelDiscoverySchema.optional(),
      roles: z.object({
        teacher: roleSelectionSchema,
        candidates: z.array(roleSelectionSchema).min(1),
        judge: roleSelectionSchema.optional(),
      }),
    }),
    quality: z
      .object({
        minimumBaselineRatio: z.number().positive().max(1).default(0.95),
        weights: z
          .object({
            functional: z.number().nonnegative().default(60),
            requirements: z.number().nonnegative().default(20),
            regression: z.number().nonnegative().default(10),
            staticAnalysis: z.number().nonnegative().default(10),
          })
          .default({ functional: 60, requirements: 20, regression: 10, staticAnalysis: 10 }),
        similarityWeights: z
          .object({
            behavior: z.number().nonnegative().default(70),
            structure: z.number().nonnegative().default(20),
            text: z.number().nonnegative().default(10),
          })
          .default({ behavior: 70, structure: 20, text: 10 }),
      })
      .default({
        minimumBaselineRatio: 0.95,
        weights: { functional: 60, requirements: 20, regression: 10, staticAnalysis: 10 },
        similarityWeights: { behavior: 70, structure: 20, text: 10 },
      }),
    optimization: z
      .object({
        budgetUsd: z.number().positive().default(30),
        perRunBudgetUsd: z.number().positive().default(3),
        baselineRepetitions: z.number().int().min(1).max(5).default(3),
        maxIterations: z.number().int().min(1).max(100).default(30),
        noImprovementLimit: z.number().int().min(1).default(4),
        reasoningEfforts: z.array(reasoningEffortSchema).min(1).default(["low", "medium"]),
        promptVariants: z
          .array(z.enum(["plain", "verify", "budget-aware"]))
          .min(1)
          .default(["plain", "verify", "budget-aware"]),
        allowedTools: z.array(z.string()).default(["Read", "Edit", "Write", "Bash", "Glob", "Grep"]),
        networkAccess: z.boolean().default(false),
      })
      .default({
        budgetUsd: 30,
        perRunBudgetUsd: 3,
        baselineRepetitions: 3,
        maxIterations: 30,
        noImprovementLimit: 4,
        reasoningEfforts: ["low", "medium"],
        promptVariants: ["plain", "verify", "budget-aware"],
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
        networkAccess: false,
      }),
  })
  .superRefine((config, context) => {
    const allowed = new Set(config.providers.allowedProviders);
    const selections = [
      config.providers.roles.teacher,
      ...config.providers.roles.candidates,
      ...(config.providers.roles.judge ? [config.providers.roles.judge] : []),
    ];

    for (const selection of selections) {
      if (!allowed.has(selection.provider)) {
        context.addIssue({
          code: "custom",
          path: ["providers", "roles"],
          message: `Role references disallowed provider: ${selection.provider}`,
        });
        continue;
      }
      const provider = config.providers[selection.provider];
      if (!provider) {
        context.addIssue({
          code: "custom",
          path: ["providers", selection.provider],
          message: `Missing configuration for allowed provider: ${selection.provider}`,
        });
      } else if (!provider.allowedModels.includes(selection.model)) {
        context.addIssue({
          code: "custom",
          path: ["providers", "roles"],
          message: `Model ${selection.model} is not allowed for ${selection.provider}`,
        });
      }
    }

    for (const providerId of config.providers.allowedProviders) {
      const provider = config.providers[providerId];
      if (!provider) {
        context.addIssue({
          code: "custom",
          path: ["providers", providerId],
          message: `Missing configuration for allowed provider: ${providerId}`,
        });
        continue;
      }
      for (const model of provider.allowedModels) {
        if (!provider.prices[model]) {
          context.addIssue({
            code: "custom",
            path: ["providers", providerId, "prices", model],
            message: `Missing price snapshot for allowed model: ${model}`,
          });
        }
      }
    }

    const weightTotal = Object.values(config.quality.weights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(weightTotal - 100) > 0.001) {
      context.addIssue({
        code: "custom",
        path: ["quality", "weights"],
        message: "Quality weights must sum to 100",
      });
    }
    const similarityTotal = Object.values(config.quality.similarityWeights).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (Math.abs(similarityTotal - 100) > 0.001) {
      context.addIssue({
        code: "custom",
        path: ["quality", "similarityWeights"],
        message: "Similarity weights must sum to 100",
      });
    }
  });

export type LoopConfig = z.infer<typeof loopConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ModelPrice = z.infer<typeof modelPriceSchema>;
