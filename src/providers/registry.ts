import type { LoopConfig } from "../config/schema.js";
import type { AgentProvider, AgentRunRequest, AgentRunResult, ProviderId } from "../core/types.js";

export class ProviderPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderPolicyError";
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, AgentProvider>();
  private readonly allowedProviders: Set<ProviderId>;

  constructor(private readonly config: LoopConfig, providers: AgentProvider[]) {
    this.allowedProviders = new Set(config.providers.allowedProviders);
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  assertAllowed(providerId: ProviderId, model: string): void {
    if (!this.allowedProviders.has(providerId)) {
      throw new ProviderPolicyError(`Provider ${providerId} is not allowed by loop.yaml`);
    }
    const providerConfig = this.config.providers[providerId];
    if (!providerConfig) {
      throw new ProviderPolicyError(`Provider ${providerId} has no configuration`);
    }
    if (!providerConfig.allowedModels.includes(model)) {
      throw new ProviderPolicyError(`Model ${providerId}/${model} is not allowed by loop.yaml`);
    }
  }

  get(providerId: ProviderId, model: string): AgentProvider {
    this.assertAllowed(providerId, model);
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Provider adapter is unavailable: ${providerId}`);
    return provider;
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    return this.get(request.provider, request.model).run(request);
  }

  ids(): ProviderId[] {
    return [...this.allowedProviders];
  }
}
