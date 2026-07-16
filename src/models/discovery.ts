import type { ModelPrice } from "../config/schema.js";
import type { ProviderId } from "../core/types.js";
import type { CredentialResolver } from "../providers/credentials.js";
import {
  MODEL_CATALOG_AS_OF,
  catalogModels,
  findCatalogModel,
  matchesCatalogModel,
  type CatalogModel,
} from "./catalog.js";

type JsonObject = Record<string, unknown>;

export interface ModelDiscoveryOptions {
  credentials: CredentialResolver;
  fetch?: typeof fetch;
}

export interface CandidateDiscovery {
  current: { provider: ProviderId; model: string };
  candidates: Array<{ provider: ProviderId; model: string; price: ModelPrice }>;
  source: "provider-api" | "built-in-catalog";
  warnings: string[];
}

interface DiscoveryRequest {
  input: JsonObject;
  providerSection: JsonObject;
  provider: ProviderId;
  model: string;
  maxCandidates: number;
  refreshFromProvider: boolean;
}

export async function resolveAutomaticModelConfig(
  input: unknown,
  options: ModelDiscoveryOptions,
): Promise<unknown> {
  const request = readDiscoveryRequest(input);
  if (!request) return input;
  const discovery = await discoverCandidates(
    request.provider,
    request.model,
    request.maxCandidates,
    request.refreshFromProvider,
    options,
  );
  return applyDiscovery(request, discovery);
}

export function resolveAutomaticModelConfigFromCatalog(input: unknown): unknown {
  const request = readDiscoveryRequest(input);
  if (!request) return input;
  const candidates = selectCandidates(request.provider, request.model, request.maxCandidates);
  return applyDiscovery(request, {
    current: { provider: request.provider, model: request.model },
    candidates,
    source: "built-in-catalog",
    warnings: ["Used the built-in dated catalog without querying the provider Models API"],
  });
}

function applyDiscovery(request: DiscoveryRequest, discovery: CandidateDiscovery): unknown {
  const { input, providerSection, provider, model, maxCandidates, refreshFromProvider } = request;
  const prices: Record<string, ModelPrice> = {};
  const currentCatalogModel = findCatalogModel(provider, model);
  if (!currentCatalogModel) {
    throw new Error(
      `The current model ${provider}/${model} has no verified price entry in the ${MODEL_CATALOG_AS_OF} catalog`,
    );
  }
  prices[model] = currentCatalogModel.price;
  for (const candidate of discovery.candidates) prices[candidate.model] = candidate.price;

  const nextProviders: JsonObject = { ...providerSection };
  delete nextProviders.openai;
  delete nextProviders.anthropic;
  nextProviders.priceCatalogAsOf = MODEL_CATALOG_AS_OF;
  nextProviders.selectionMode = "auto-within-allowlist";
  nextProviders.allowedProviders = [provider];
  nextProviders[provider] = {
    allowedModels: [model, ...discovery.candidates.map((candidate) => candidate.model)],
    prices,
  };
  nextProviders.roles = {
    teacher: { provider, model },
    candidates: discovery.candidates.map((candidate) => ({
      provider: candidate.provider,
      model: candidate.model,
    })),
  };
  nextProviders.modelDiscovery = {
    current: { provider, model },
    maxCandidates,
    refreshFromProvider,
    source: discovery.source,
    resolvedAt: new Date().toISOString(),
    candidates: discovery.candidates.map((candidate) => candidate.model),
    warnings: discovery.warnings,
  };

  return { ...input, providers: nextProviders };
}

export async function discoverCandidates(
  provider: ProviderId,
  currentModelId: string,
  maxCandidates: number,
  refreshFromProvider: boolean,
  options: ModelDiscoveryOptions,
): Promise<CandidateDiscovery> {
  const current = findCatalogModel(provider, currentModelId);
  if (!current) {
    throw new Error(
      `Unknown current model ${provider}/${currentModelId}. Update LoopGauge's dated price catalog before optimizing it.`,
    );
  }
  const warnings: string[] = [];
  let availableIds: string[] | undefined;
  let source: CandidateDiscovery["source"] = "built-in-catalog";

  if (refreshFromProvider) {
    const apiKey = await options.credentials.getApiKey(provider);
    if (!apiKey) {
      warnings.push(`No ${provider} API key was available; used the built-in dated catalog`);
    } else {
      try {
        availableIds = await listAvailableModels(provider, apiKey, options.fetch ?? fetch);
        source = "provider-api";
      } catch (error) {
        warnings.push(
          `Could not refresh ${provider} models; used the built-in dated catalog: ${errorMessage(error)}`,
        );
      }
    }
  }

  const candidates = selectCandidates(provider, currentModelId, maxCandidates, availableIds);

  return {
    current: { provider, model: currentModelId },
    candidates,
    source,
    warnings,
  };
}

function selectCandidates(
  provider: ProviderId,
  currentModelId: string,
  maxCandidates: number,
  availableIds?: string[],
): CandidateDiscovery["candidates"] {
  const current = findCatalogModel(provider, currentModelId);
  if (!current) {
    throw new Error(
      `Unknown current model ${provider}/${currentModelId}. Update LoopGauge's dated price catalog before optimizing it.`,
    );
  }
  const currentBlended = blendedPrice(current.price);
  const eligible = catalogModels(provider)
    .filter(
      (candidate) =>
        candidate.codingAgentCompatible &&
        candidate.capabilityRank < current.capabilityRank &&
        blendedPrice(candidate.price) < currentBlended,
    )
    .map((candidate) => ({ candidate, availableId: selectAvailableId(candidate, availableIds) }))
    .filter(
      (entry): entry is { candidate: CatalogModel; availableId: string } =>
        entry.availableId !== undefined,
    );
  const frontier = eligible
    .filter(
      (entry) =>
        !eligible.some(
          (other) =>
            other !== entry &&
            other.candidate.capabilityRank >= entry.candidate.capabilityRank &&
            blendedPrice(other.candidate.price) <= blendedPrice(entry.candidate.price) &&
            (other.candidate.capabilityRank > entry.candidate.capabilityRank ||
              blendedPrice(other.candidate.price) < blendedPrice(entry.candidate.price)),
        ),
    )
    .sort(
      (left, right) =>
        right.candidate.capabilityRank - left.candidate.capabilityRank ||
        blendedPrice(left.candidate.price) - blendedPrice(right.candidate.price),
    );
  const limit = Math.max(1, Math.min(10, Math.trunc(maxCandidates)));
  const selected =
    frontier.length <= limit
      ? frontier
      : [...frontier.slice(0, Math.max(0, limit - 1)), frontier.at(-1)!];
  const candidates = selected
    .map(({ candidate, availableId }) => ({ provider, model: availableId, price: candidate.price }));

  if (candidates.length === 0) {
    throw new Error(
      `No cheaper coding-agent model is available below ${provider}/${currentModelId} in the selected catalog scope`,
    );
  }

  return candidates;
}

async function listAvailableModels(
  provider: ProviderId,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const response = await fetchImpl(
    provider === "openai" ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models?limit=1000",
    {
      headers:
        provider === "openai"
          ? { Authorization: `Bearer ${apiKey}` }
          : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`model API returned HTTP ${response.status}`);
  const body = (await response.json()) as unknown;
  if (!isObject(body) || !Array.isArray(body.data)) throw new Error("model API returned an invalid response");
  return body.data
    .map((item) => (isObject(item) && typeof item.id === "string" ? item.id : undefined))
    .filter((id): id is string => id !== undefined);
}

function selectAvailableId(model: CatalogModel, availableIds: string[] | undefined): string | undefined {
  if (!availableIds) return model.id;
  const preferred = [model.id, ...model.aliases].find((id) => availableIds.includes(id));
  return preferred ?? availableIds.find((id) => matchesCatalogModel(model, id));
}

function blendedPrice(price: ModelPrice): number {
  return price.inputPerMillionUsd * 0.75 + price.outputPerMillionUsd * 0.25;
}

function parseProvider(value: unknown): ProviderId {
  if (value !== "openai" && value !== "anthropic") {
    throw new Error("providers.modelDiscovery.current.provider must be openai or anthropic");
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readDiscoveryRequest(input: unknown): DiscoveryRequest | undefined {
  if (!isObject(input) || !isObject(input.providers)) return undefined;
  const providerSection = input.providers;
  if (!isObject(providerSection.modelDiscovery)) return undefined;
  const discoveryConfig = providerSection.modelDiscovery;
  if (!isObject(discoveryConfig.current)) {
    throw new Error("providers.modelDiscovery.current must contain provider and model");
  }
  return {
    input,
    providerSection,
    provider: parseProvider(discoveryConfig.current.provider),
    model: requireString(discoveryConfig.current.model, "providers.modelDiscovery.current.model"),
    maxCandidates: numberOr(discoveryConfig.maxCandidates, 4),
    refreshFromProvider: discoveryConfig.refreshFromProvider !== false,
  };
}
