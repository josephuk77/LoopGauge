import type { ModelPrice } from "../config/schema.js";
import type { ProviderId } from "../core/types.js";

export const MODEL_CATALOG_AS_OF = "2026-07-16T00:00:00.000Z";

export interface CatalogModel {
  provider: ProviderId;
  id: string;
  aliases: string[];
  price: ModelPrice;
  capabilityRank: number;
  codingAgentCompatible: boolean;
}

export const MODEL_CATALOG: readonly CatalogModel[] = [
  openai("gpt-5.6-sol", ["gpt-5.6"], 5, 30, 0.5, 100),
  openai("gpt-5.6-terra", [], 2.5, 15, 0.25, 92),
  openai("gpt-5.6-luna", [], 1, 6, 0.1, 82),
  openai("gpt-5.4", [], 2.5, 15, 0.25, 88),
  openai("gpt-5.4-mini", [], 0.75, 4.5, 0.075, 74),
  openai("gpt-5.4-nano", [], 0.2, 1.25, 0.02, 58),
  openai("gpt-5", [], 1.25, 10, 0.125, 80),
  openai("gpt-5-mini", [], 0.25, 2, 0.025, 65),
  anthropic("claude-fable-5", [], 10, 50, 100),
  anthropic("claude-opus-4-8", [], 5, 25, 95),
  anthropic("claude-sonnet-5", [], 2, 10, 86),
  anthropic("claude-haiku-4-5", ["claude-haiku-4-5-20251001"], 1, 5, 70),
  anthropic("claude-opus-4-1", ["claude-opus-4-1-20250805"], 15, 75, 90),
  anthropic("claude-opus-4", ["claude-opus-4-20250514"], 15, 75, 87),
  anthropic("claude-sonnet-4", ["claude-sonnet-4-20250514"], 3, 15, 80),
  anthropic("claude-3-5-haiku-latest", ["claude-3-5-haiku-20241022"], 0.8, 4, 62),
];

export function catalogModels(provider: ProviderId): CatalogModel[] {
  return MODEL_CATALOG.filter((model) => model.provider === provider);
}

export function findCatalogModel(provider: ProviderId, modelId: string): CatalogModel | undefined {
  return catalogModels(provider).find((model) => matchesCatalogModel(model, modelId));
}

export function matchesCatalogModel(model: CatalogModel, modelId: string): boolean {
  return [model.id, ...model.aliases].some(
    (knownId) => modelId === knownId || modelId.startsWith(`${knownId}-20`),
  );
}

function openai(
  id: string,
  aliases: string[],
  input: number,
  output: number,
  cacheRead: number,
  capabilityRank: number,
): CatalogModel {
  return {
    provider: "openai",
    id,
    aliases,
    price: price(input, output, cacheRead, 0),
    capabilityRank,
    codingAgentCompatible: true,
  };
}

function anthropic(
  id: string,
  aliases: string[],
  input: number,
  output: number,
  capabilityRank: number,
): CatalogModel {
  return {
    provider: "anthropic",
    id,
    aliases,
    price: price(input, output, input * 0.1, input * 1.25),
    capabilityRank,
    codingAgentCompatible: true,
  };
}

function price(
  inputPerMillionUsd: number,
  outputPerMillionUsd: number,
  cacheReadPerMillionUsd: number,
  cacheWritePerMillionUsd: number,
): ModelPrice {
  return {
    inputPerMillionUsd,
    outputPerMillionUsd,
    cacheReadPerMillionUsd,
    cacheWritePerMillionUsd,
    tools: {},
  };
}
