import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { loopConfigSchema, type LoopConfig } from "./schema.js";

export async function loadConfig(configPath = "loop.yaml"): Promise<LoopConfig> {
  const absolutePath = resolve(configPath);
  const source = await readFile(absolutePath, "utf8");
  const parsed = YAML.parse(source) as unknown;
  const config = loopConfigSchema.parse(parsed);
  return {
    ...config,
    project: {
      ...config.project,
      root: resolve(dirname(absolutePath), config.project.root),
    },
  };
}

export function parseConfig(source: string): LoopConfig {
  return loopConfigSchema.parse(YAML.parse(source) as unknown);
}
