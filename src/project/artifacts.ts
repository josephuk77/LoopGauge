import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoopConfig } from "../config/schema.js";

export async function generateProviderArtifacts(config: LoopConfig, stateDirectory: string): Promise<string[]> {
  const directory = join(stateDirectory, "generated");
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  const common = renderInstructions(config);
  if (config.providers.allowedProviders.includes("openai")) {
    const path = join(directory, "AGENTS.md");
    await writeFile(path, common, "utf8");
    written.push(path);
  }
  if (config.providers.allowedProviders.includes("anthropic")) {
    const path = join(directory, "CLAUDE.md");
    await writeFile(path, common, "utf8");
    written.push(path);
  }
  return written;
}

function renderInstructions(config: LoopConfig): string {
  const commands = Object.entries(config.project.commands)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name, command]) => `- ${name}: \`${command}\``)
    .join("\n");
  return `# LoopGauge generated harness\n\nTask: ${config.task.name}\n\n## Completion checks\n\n${commands || "- Follow the task-specific grader."}\n\n## Guardrails\n\n- Work only inside the provided worktree.\n- Run the configured checks before declaring completion.\n- Do not change credentials or provider policy.\n- Stop when the task is complete; do not perform unrelated refactors.\n`;
}
