import { Codex, type ModelReasoningEffort, type ThreadEvent } from "@openai/codex-sdk";
import type {
  AgentEvent,
  AgentProvider,
  AgentRunRequest,
  AgentRunResult,
  ToolUsage,
} from "../core/types.js";
import type { CredentialResolver } from "./credentials.js";

export class OpenAICodexProvider implements AgentProvider {
  readonly id = "openai" as const;

  constructor(private readonly credentials: CredentialResolver) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const started = Date.now();
    const apiKey = await this.credentials.getApiKey(this.id);
    if (!apiKey) throw new Error("OPENAI_API_KEY or CODEX_API_KEY is required for OpenAI runs");
    const codex = new Codex({ apiKey });
    const threadOptions = {
      model: request.model,
      workingDirectory: request.cwd,
      sandboxMode: request.readOnly ? ("read-only" as const) : ("workspace-write" as const),
      approvalPolicy: "never" as const,
      skipGitRepoCheck: false,
      networkAccessEnabled: request.networkAccess ?? false,
      ...(request.reasoningEffort
        ? { modelReasoningEffort: request.reasoningEffort as ModelReasoningEffort }
        : {}),
    };
    const thread = request.sessionId
      ? codex.resumeThread(request.sessionId, threadOptions)
      : codex.startThread(threadOptions);
    const streamed = await thread.runStreamed(request.prompt, {
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const toolCounts = new Map<string, number>();
    let finalResponse = "";
    let usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
    };
    let failure: string | undefined;

    for await (const event of streamed.events) {
      await request.onEvent?.(mapCodexEvent(event));
      if (event.type === "thread.started") {
        await request.onEvent?.({
          type: "session.started",
          timestamp: new Date().toISOString(),
          data: { sessionId: event.thread_id },
        });
      } else if (event.type === "turn.completed") {
        usage = {
          inputTokens: event.usage.input_tokens,
          outputTokens: event.usage.output_tokens,
          cachedInputTokens: event.usage.cached_input_tokens,
          cacheWriteInputTokens: 0,
          reasoningTokens: event.usage.reasoning_output_tokens,
        };
      } else if (event.type === "turn.failed") {
        failure = event.error.message;
      } else if (event.type === "error") {
        failure = event.message;
      } else if (event.type === "item.completed") {
        if (event.item.type === "agent_message") finalResponse = event.item.text;
        if (event.item.type === "command_execution") increment(toolCounts, "shell");
        if (event.item.type === "mcp_tool_call") increment(toolCounts, `mcp:${event.item.server}/${event.item.tool}`);
        if (event.item.type === "web_search") increment(toolCounts, "web_search");
        if (event.item.type === "file_change") increment(toolCounts, "apply_patch");
      }
    }

    const toolUsage: ToolUsage[] = [...toolCounts].map(([name, calls]) => ({ name, calls }));
    return {
      provider: this.id,
      model: request.model,
      ...(thread.id ? { sessionId: thread.id } : {}),
      finalResponse,
      usage,
      toolUsage,
      durationMs: Date.now() - started,
      success: !failure,
      ...(failure ? { error: failure } : {}),
    };
  }
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function mapCodexEvent(event: ThreadEvent): AgentEvent {
  const timestamp = new Date().toISOString();
  if (event.type === "item.started") return { type: "tool.started", timestamp, data: event.item };
  if (event.type === "item.completed") {
    if (event.item.type === "agent_message") return { type: "message", timestamp, data: event.item };
    if (event.item.type === "file_change") return { type: "file.changed", timestamp, data: event.item };
    return { type: "tool.completed", timestamp, data: event.item };
  }
  if (event.type === "turn.completed") return { type: "usage", timestamp, data: event.usage };
  if (event.type === "turn.failed" || event.type === "error") {
    return { type: "error", timestamp, data: event };
  }
  return { type: "message", timestamp, data: event };
}
