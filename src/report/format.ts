import type { OptimizationReport } from "../core/types.js";

export function formatReport(report: OptimizationReport): string {
  const lines = [
    `LoopGauge optimization ${report.jobId}`,
    `Status: ${report.status}`,
    `Price snapshot: ${report.priceCatalogAsOf}`,
    `Confidence: ${report.confidence}`,
    `Baseline quality: ${number(report.baselineQuality)}/100`,
    `Optimization cost: $${money(report.totalOptimizationCostUsd)}`,
  ];
  if (report.selected) {
    lines.push(
      `Selected: ${report.selected.provider}/${report.selected.model} (${report.selected.variant})`,
      `Quality: ${number(report.selected.qualityScore)}/100 (${number(report.selected.baselineRatio * 100)}% of baseline)`,
      `Result similarity: ${number(report.selected.similarityScore)}/100`,
      `Result difference: ${number(report.selected.differenceScore)}/100`,
      `Success rate: ${number(report.selected.successRate * 100)}%`,
      `Cost per success: $${money(report.selected.costPerSuccessUsd)}`,
    );
  } else {
    lines.push("Selected: none (no candidate passed the quality gate)");
  }
  if (report.savings) {
    lines.push(
      `Measured savings: ${number(report.savings.savingsPercent)}%`,
      `Amortized savings at 100 runs: ${number(report.savings.amortizedSavingsPercent)}%`,
      `Break-even: ${report.savings.breakEvenRuns ?? "never"} runs`,
    );
  }
  if (report.improvements.length > 0) {
    lines.push("Evidence-backed improvements:");
    for (const item of report.improvements) {
      lines.push(
        `- ${item.name}: ${item.expectedAdditionalSavingsMinPercent}-${item.expectedAdditionalSavingsMaxPercent}% ($${money(item.experimentCostUsd)} experiment)`,
        `  ${item.evidence}`,
      );
    }
  }
  if (report.failureReason) lines.push(`Failure: ${report.failureReason}`);
  return lines.join("\n");
}

function money(value: number): string {
  return value.toFixed(4);
}

function number(value: number): string {
  return value.toFixed(1);
}
