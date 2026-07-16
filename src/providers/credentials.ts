import type { ProviderId } from "../core/types.js";

export interface CredentialResolver {
  getApiKey(provider: ProviderId): Promise<string | undefined>;
}

export class EnvironmentCredentialResolver implements CredentialResolver {
  async getApiKey(provider: ProviderId): Promise<string | undefined> {
    if (provider === "openai") return process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY;
    return process.env.ANTHROPIC_API_KEY;
  }
}

export class CompositeCredentialResolver implements CredentialResolver {
  constructor(private readonly resolvers: CredentialResolver[]) {}

  async getApiKey(provider: ProviderId): Promise<string | undefined> {
    for (const resolver of this.resolvers) {
      const key = await resolver.getApiKey(provider);
      if (key) return key;
    }
    return undefined;
  }
}
