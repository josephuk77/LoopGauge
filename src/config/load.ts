import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import {
  resolveAutomaticModelConfig,
  resolveAutomaticModelConfigFromCatalog,
} from "../models/discovery.js";
import { EnvironmentCredentialResolver, type CredentialResolver } from "../providers/credentials.js";
import { loopConfigSchema, type LoopConfig } from "./schema.js";

export async function loadConfig(
  configPath = "loop.yaml",
  credentials: CredentialResolver = new EnvironmentCredentialResolver(),
): Promise<LoopConfig> {
  const absolutePath = resolve(configPath);
  const source = await readFile(absolutePath, "utf8");
  const parsed = YAML.parse(source) as unknown;
  const resolvedModels = await resolveAutomaticModelConfig(parsed, { credentials });
  const config = loopConfigSchema.parse(resolvedModels);
  return {
    ...config,
    project: {
      ...config.project,
      root: resolve(dirname(absolutePath), config.project.root),
    },
  };
}

export function parseConfig(source: string): LoopConfig {
  return loopConfigSchema.parse(resolveAutomaticModelConfigFromCatalog(YAML.parse(source) as unknown));
}
