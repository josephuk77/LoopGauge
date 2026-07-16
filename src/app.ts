import { resolve } from "node:path";
import { loadConfig } from "./config/load.js";
import type { LoopConfig } from "./config/schema.js";
import { OptimizationEngine } from "./optimization/optimizer.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { EnvironmentCredentialResolver, type CredentialResolver } from "./providers/credentials.js";
import { OpenAICodexProvider } from "./providers/openai-codex.js";
import { ProviderRegistry } from "./providers/registry.js";
import { LoopGaugeStore } from "./storage/store.js";

export class LoopGaugeApp {
  readonly engine: OptimizationEngine;

  private constructor(
    readonly config: LoopConfig,
    readonly store: LoopGaugeStore,
    readonly registry: ProviderRegistry,
  ) {
    this.engine = new OptimizationEngine(config, registry, store);
  }

  static async create(
    configPath = "loop.yaml",
    credentials: CredentialResolver = new EnvironmentCredentialResolver(),
  ): Promise<LoopGaugeApp> {
    const config = await loadConfig(resolve(configPath), credentials);
    const adapters = config.providers.allowedProviders.map((provider) =>
      provider === "openai"
        ? new OpenAICodexProvider(credentials)
        : new AnthropicProvider(credentials),
    );
    const registry = new ProviderRegistry(config, adapters);
    const store = await LoopGaugeStore.open(config.project.root);
    return new LoopGaugeApp(config, store, registry);
  }

  close(): void {
    this.store.close();
  }
}
