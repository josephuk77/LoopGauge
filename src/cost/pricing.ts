import type { LoopConfig, ModelPrice } from "../config/schema.js";
import type { AgentRunResult, CostBreakdown, ProviderId, SavingsEstimate } from "../core/types.js";

export class PriceCatalog {
  readonly asOf: string;
  private readonly prices = new Map<string, ModelPrice>();

  constructor(config: LoopConfig, asOf = config.providers.priceCatalogAsOf) {
    this.asOf = asOf;
    for (const providerId of config.providers.allowedProviders) {
      const provider = config.providers[providerId];
      if (!provider) continue;
      for (const [model, price] of Object.entries(provider.prices)) {
        this.prices.set(this.key(providerId, model), price);
      }
    }
  }

  assertUsable(): void {
    for (const [key, price] of this.prices) {
      if (price.inputPerMillionUsd + price.outputPerMillionUsd <= 0) {
        throw new Error(`Price snapshot is still a zero-value placeholder: ${key}`);
      }
    }
  }

  has(provider: ProviderId, model: string): boolean {
    return this.prices.has(this.key(provider, model));
  }

  get(provider: ProviderId, model: string): ModelPrice {
    const price = this.prices.get(this.key(provider, model));
    if (!price) throw new Error(`No price snapshot for ${provider}/${model}`);
    return price;
  }

  calculate(result: AgentRunResult): CostBreakdown {
    const price = this.get(result.provider, result.model);
    const perMillion = (tokens: number, usd: number): number => (tokens / 1_000_000) * usd;
    const inputUsd = perMillion(result.usage.inputTokens, price.inputPerMillionUsd);
    const outputUsd = perMillion(result.usage.outputTokens, price.outputPerMillionUsd);
    const cacheReadUsd = perMillion(result.usage.cachedInputTokens, price.cacheReadPerMillionUsd);
    const cacheWriteUsd = perMillion(
      result.usage.cacheWriteInputTokens,
      price.cacheWritePerMillionUsd,
    );
    const toolsUsd = result.toolUsage.reduce((sum, tool) => {
      const unitPrice = price.tools[tool.name] ?? 0;
      return sum + unitPrice * (tool.units ?? tool.calls);
    }, 0);
    const calculated = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd + toolsUsd;
    const reportedUsd = result.reportedCostUsd ?? 0;
    const totalUsd = reportedUsd > 0 ? reportedUsd : calculated;
    return {
      inputUsd,
      outputUsd,
      cacheReadUsd,
      cacheWriteUsd,
      toolsUsd,
      reportedUsd,
      retryUsd: 0,
      judgeUsd: 0,
      escalationUsd: 0,
      totalUsd,
    };
  }

  private key(provider: ProviderId, model: string): string {
    return `${provider}:${model}`;
  }
}

export function calculateSavings(
  baselineCostPerSuccessUsd: number,
  candidateCostPerSuccessUsd: number,
  optimizationCostUsd: number,
  projectedRuns = 100,
): SavingsEstimate {
  const savingsPercent =
    baselineCostPerSuccessUsd > 0
      ? (1 - candidateCostPerSuccessUsd / baselineCostPerSuccessUsd) * 100
      : 0;
  const baselineProjected = baselineCostPerSuccessUsd * projectedRuns;
  const candidateProjected = candidateCostPerSuccessUsd * projectedRuns + optimizationCostUsd;
  const amortizedSavingsPercent =
    baselineProjected > 0 ? (1 - candidateProjected / baselineProjected) * 100 : 0;
  const savingsPerRun = baselineCostPerSuccessUsd - candidateCostPerSuccessUsd;
  const breakEvenRuns = savingsPerRun > 0 ? Math.ceil(optimizationCostUsd / savingsPerRun) : null;
  return {
    baselineCostPerSuccessUsd,
    candidateCostPerSuccessUsd,
    savingsPercent,
    amortizedSavingsPercent,
    optimizationCostUsd,
    breakEvenRuns,
  };
}
