import { query, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEvent,
  AgentProvider,
  AgentRunRequest,
  AgentRunResult,
  ToolUsage,
} from "../core/types.js";
import type { CredentialResolver } from "./credentials.js";

export class AnthropicProvider implements AgentProvider {
  readonly id = "anthropic" as const;

  constructor(private readonly credentials: CredentialResolver) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const started = Date.now();
    const apiKey = await this.credentials.getApiKey(this.id);
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for Anthropic runs");
    const abortController = new AbortController();
    const forwardAbort = (): void => abortController.abort();
    request.signal?.addEventListener("abort", forwardAbort, { once: true });
    const options: Options = {
      abortController,
      cwd: request.cwd,
      model: request.model,
      maxTurns: request.maxTurns ?? 20,
      ...(request.maxBudgetUsd ? { maxBudgetUsd: request.maxBudgetUsd } : {}),
      ...(request.readOnly
        ? { allowedTools: ["Read", "Glob", "Grep"] }
        : request.allowedTools
          ? { allowedTools: request.allowedTools }
          : {}),
      tools: request.readOnly ? ["Read", "Glob", "Grep"] : { type: "preset", preset: "claude_code" },
      permissionMode: request.readOnly ? "dontAsk" : "acceptEdits",
      persistSession: true,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        CLAUDE_AGENT_SDK_CLIENT_APP: "loopgauge/0.2.0",
      },
      ...(request.sessionId ? { resume: request.sessionId } : {}),
      ...(request.reasoningEffort
        ? { effort: request.reasoningEffort === "minimal" ? "low" : request.reasoningEffort }
        : {}),
    };
    const toolCounts = new Map<string, number>();
    let resultMessage: SDKResultMessage | undefined;
    let sessionId: string | undefined;

    try {
      for await (const message of query({ prompt: request.prompt, options })) {
        sessionId = "session_id" in message ? message.session_id : sessionId;
        collectTools(message, toolCounts);
        if (message.type === "result") resultMessage = message;
        await request.onEvent?.(mapClaudeEvent(message));
      }
    } finally {
      request.signal?.removeEventListener("abort", forwardAbort);
    }

    if (!resultMessage) throw new Error("Claude Agent SDK completed without a result message");
    const modelUsage = Object.values(resultMessage.modelUsage);
    const usage = modelUsage.reduce(
      (total, item) => ({
        inputTokens: total.inputTokens + item.inputTokens,
        outputTokens: total.outputTokens + item.outputTokens,
        cachedInputTokens: total.cachedInputTokens + item.cacheReadInputTokens,
        cacheWriteInputTokens: total.cacheWriteInputTokens + item.cacheCreationInputTokens,
        reasoningTokens: total.reasoningTokens,
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningTokens: 0,
      },
    );
    const toolUsage: ToolUsage[] = [...toolCounts].map(([name, calls]) => ({ name, calls }));
    const success = resultMessage.subtype === "success";
    const finalResponse = resultMessage.subtype === "success" ? resultMessage.result : "";
    const error =
      resultMessage.subtype === "success"
        ? undefined
        : resultMessage.errors.join("; ") || resultMessage.subtype;
    return {
      provider: this.id,
      model: request.model,
      ...(sessionId ? { sessionId } : {}),
      finalResponse,
      usage,
      toolUsage,
      reportedCostUsd: resultMessage.total_cost_usd,
      durationMs: Date.now() - started,
      success,
      ...(error ? { error } : {}),
    };
  }
}

function collectTools(message: SDKMessage, counts: Map<string, number>): void {
  if (message.type !== "assistant") return;
  for (const block of message.message.content) {
    if (block.type === "tool_use") counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
  }
}

function mapClaudeEvent(message: SDKMessage): AgentEvent {
  const timestamp = new Date().toISOString();
  if (message.type === "assistant") {
    const hasTool = message.message.content.some((block) => block.type === "tool_use");
    return { type: hasTool ? "tool.started" : "message", timestamp, data: message };
  }
  if (message.type === "result") {
    return {
      type: message.subtype === "success" ? "session.completed" : "error",
      timestamp,
      data: message,
    };
  }
  if (message.type === "system" && message.subtype === "init") {
    return { type: "session.started", timestamp, data: message };
  }
  return { type: "message", timestamp, data: message };
}
