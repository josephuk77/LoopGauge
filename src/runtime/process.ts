import { spawn } from "node:child_process";
import type { CommandResult } from "../core/types.js";

export interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export async function runShellCommand(
  command: string,
  options: RunCommandOptions,
): Promise<CommandResult> {
  const started = Date.now();
  const child = spawn(command, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: true,
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, options.timeoutMs ?? 300_000);
  timeout.unref();

  const abort = (): void => {
    child.kill("SIGTERM");
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  }).finally(() => {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  });

  return {
    command,
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - started,
    timedOut,
  };
}
