import { describe, expect, it } from "vitest";
import { createDemoReport, formatDemoReport } from "../src/demo.js";

describe("API-free demo", () => {
  it("selects the cheapest synthetic policy that passes the quality gate", () => {
    const report = createDemoReport();
    expect(report.apiCallsMade).toBe(0);
    expect(report.selected.name).toBe("haiku-guarded");
    expect(report.selected.qualityScore).toBeGreaterThanOrEqual(report.qualityThreshold);
    expect(report.savingsPercent).toBe(68.3);
    expect(report.breakEvenTasks).toBe(11);
  });

  it("labels every displayed number as synthetic", () => {
    const output = formatDemoReport(createDemoReport());
    expect(output).toMatch(/SYNTHETIC REPLAY/);
    expect(output).toMatch(/no provider API calls/i);
    expect(output).toMatch(/do not claim measured model performance/i);
  });
});
