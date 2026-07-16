import type { LoopConfig } from "../config/schema.js";
import type { ValidationResult } from "../core/types.js";
import { runShellCommand } from "./process.js";

export async function validateProject(
  config: LoopConfig,
  cwd: string,
  signal?: AbortSignal,
): Promise<ValidationResult> {
  const run = async (command: string | undefined) =>
    command
      ? runShellCommand(command, {
          cwd,
          timeoutMs: config.project.commandTimeoutMs,
          ...(signal ? { signal } : {}),
        })
      : undefined;

  const setup = await run(config.project.commands.setup);
  if (setup && setup.exitCode !== 0) return { setup, mandatoryPassed: false };

  const [build, test, lint, typecheck] = await Promise.all([
    run(config.project.commands.build),
    run(config.project.commands.test),
    run(config.project.commands.lint),
    run(config.project.commands.typecheck),
  ]);
  const mandatoryPassed = (!build || build.exitCode === 0) && (!test || test.exitCode === 0);
  return {
    ...(setup ? { setup } : {}),
    ...(build ? { build } : {}),
    ...(test ? { test } : {}),
    ...(lint ? { lint } : {}),
    ...(typecheck ? { typecheck } : {}),
    mandatoryPassed,
  };
}
