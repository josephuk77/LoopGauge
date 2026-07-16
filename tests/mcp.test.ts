import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createLoopGaugeMcpServer } from "../src/mcp/server.js";

describe("LoopGauge MCP server", () => {
  it("advertises the complete optimization interface", async () => {
    const server = createLoopGaugeMcpServer();
    const client = new Client({ name: "loopgauge-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
        [
          "analyze_project",
          "cancel_optimization",
          "compare_results",
          "estimate_savings",
          "get_cost_report",
          "get_optimization_status",
          "optimize_harness",
          "resume_optimization",
          "run_optimized_task",
        ].sort(),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
