import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LoopConfig } from "../config/schema.js";

export interface ProjectAnalysis {
  root: string;
  name: string;
  ecosystem: string[];
  detectedCommands: Partial<Record<"setup" | "build" | "test" | "lint" | "typecheck", string>>;
  configuredCommands: LoopConfig["project"]["commands"];
  sampleCount: number;
  allowedProviders: string[];
  allowedModels: Record<string, string[]>;
  warnings: string[];
}

export async function analyzeProject(config: LoopConfig): Promise<ProjectAnalysis> {
  const root = resolve(config.project.root);
  const ecosystem: string[] = [];
  const detectedCommands: ProjectAnalysis["detectedCommands"] = {};
  const warnings: string[] = [];

  const packageJsonPath = join(root, "package.json");
  if (await exists(packageJsonPath)) {
    ecosystem.push("node");
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    if (scripts.build) detectedCommands.build = "npm run build";
    if (scripts.test) detectedCommands.test = "npm test";
    if (scripts.lint) detectedCommands.lint = "npm run lint";
    if (scripts.typecheck) detectedCommands.typecheck = "npm run typecheck";
    detectedCommands.setup = (await exists(join(root, "package-lock.json"))) ? "npm ci" : "npm install";
  }
  if (await exists(join(root, "pyproject.toml"))) ecosystem.push("python");
  if (await exists(join(root, "Cargo.toml"))) ecosystem.push("rust");
  if (await exists(join(root, "go.mod"))) ecosystem.push("go");
  if (ecosystem.length === 0) warnings.push("No supported package manifest was detected");
  if (config.task.samples.length < 3) {
    warnings.push("Savings estimates based on fewer than 3 samples have low confidence");
  }

  const allowedModels: Record<string, string[]> = {};
  for (const provider of config.providers.allowedProviders) {
    allowedModels[provider] = config.providers[provider]?.allowedModels ?? [];
    for (const model of allowedModels[provider] ?? []) {
      const price = config.providers[provider]?.prices[model];
      if (price && price.inputPerMillionUsd + price.outputPerMillionUsd <= 0) {
        warnings.push(`Price snapshot for ${provider}/${model} is still a zero-value placeholder`);
      }
    }
  }

  return {
    root,
    name: config.project.name,
    ecosystem,
    detectedCommands,
    configuredCommands: config.project.commands,
    sampleCount: config.task.samples.length,
    allowedProviders: config.providers.allowedProviders,
    allowedModels,
    warnings,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
