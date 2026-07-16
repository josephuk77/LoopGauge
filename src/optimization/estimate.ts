import type { LoopConfig } from "../config/schema.js";

export interface PreflightEstimate {
  teacher: string;
  candidates: Array<{
    provider: string;
    model: string;
    estimatedSavingsMinPercent: number;
    estimatedSavingsMaxPercent: number;
  }>;
  confidence: "low" | "medium";
  assumptions: string[];
}

export function estimateSavingsFromPrices(config: LoopConfig): PreflightEstimate {
  const teacher = config.providers.roles.teacher;
  const teacherPrice = config.providers[teacher.provider]?.prices[teacher.model];
  if (!teacherPrice) throw new Error(`Missing teacher price: ${teacher.provider}/${teacher.model}`);
  const teacherBlended = teacherPrice.inputPerMillionUsd * 0.75 + teacherPrice.outputPerMillionUsd * 0.25;
  const selections =
    config.providers.selectionMode === "manual"
      ? config.providers.roles.candidates
      : config.providers.allowedProviders.flatMap((provider) =>
          (config.providers[provider]?.allowedModels ?? [])
            .filter((model) => provider !== teacher.provider || model !== teacher.model)
            .map((model) => ({ provider, model })),
        );
  const hasPlaceholderPrice =
    teacherBlended <= 0 ||
    selections.some((candidate) => {
      const price = config.providers[candidate.provider]?.prices[candidate.model];
      return !price || price.inputPerMillionUsd + price.outputPerMillionUsd <= 0;
    });
  const candidates = selections.map((candidate) => {
    const price = config.providers[candidate.provider]?.prices[candidate.model];
    if (!price) throw new Error(`Missing candidate price: ${candidate.provider}/${candidate.model}`);
    const blended = price.inputPerMillionUsd * 0.75 + price.outputPerMillionUsd * 0.25;
    const raw = teacherBlended > 0 ? (1 - blended / teacherBlended) * 100 : 0;
    return {
      provider: candidate.provider,
      model: candidate.model,
      estimatedSavingsMinPercent: hasPlaceholderPrice ? 0 : round(clamp(raw - 20, -100, 99)),
      estimatedSavingsMaxPercent: hasPlaceholderPrice ? 0 : round(clamp(raw + 10, -100, 99)),
    };
  });
  return {
    teacher: `${teacher.provider}/${teacher.model}`,
    candidates,
    confidence: !hasPlaceholderPrice && config.task.samples.length >= 3 ? "medium" : "low",
    assumptions: [
      ...(hasPlaceholderPrice ? ["One or more prices are zero-value placeholders; no savings claim is available yet."] : []),
      "Uses configured price snapshots and a 75/25 input-output token mix.",
      "Does not claim quality parity until pilot tasks have been executed.",
      "Retry, tool, judge, and escalation costs are measured during optimization.",
    ],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
