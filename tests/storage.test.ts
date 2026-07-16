import { describe, expect, it } from "vitest";
import { sanitizeTrace } from "../src/storage/store.js";

describe("trace sanitization", () => {
  it("redacts credentials and reasoning while preserving usage counters", () => {
    expect(
      sanitizeTrace({
        apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz",
        authorization: "Bearer secret",
        reasoning: "private reasoning",
        reasoningTokens: 42,
        content: [{ type: "thinking", thinking: "private" }],
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      reasoning: "[REDACTED]",
      reasoningTokens: 42,
      content: [{ type: "thinking", redacted: true }],
    });
  });
});
