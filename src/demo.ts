export interface DemoPolicyResult {
  name: string;
  modelPolicy: string;
  qualityScore: number;
  successRate: number;
  costPerApprovedTaskUsd: number;
  eligible: boolean;
  note: string;
}

export interface DemoReport {
  kind: "synthetic-replay";
  apiCallsMade: 0;
  baseline: DemoPolicyResult;
  qualityThreshold: number;
  candidates: DemoPolicyResult[];
  selected: DemoPolicyResult;
  savingsPercent: number;
  syntheticOptimizationCostUsd: number;
  breakEvenTasks: number;
  disclaimer: string;
}

const SYNTHETIC_OPTIMIZATION_COST_USD = 1.24;

export function createDemoReport(): DemoReport {
  const baseline: DemoPolicyResult = {
    name: "baseline",
    modelPolicy: "Claude Opus 4.8 for every task",
    qualityScore: 100,
    successRate: 1,
    costPerApprovedTaskUsd: 0.18,
    eligible: true,
    note: "Synthetic teacher reference",
  };
  const qualityThreshold = baseline.qualityScore * 0.95;
  const candidates: DemoPolicyResult[] = [
    {
      name: "sonnet-verify",
      modelPolicy: "Claude Sonnet 5 + verify prompt",
      qualityScore: 97.4,
      successRate: 1,
      costPerApprovedTaskUsd: 0.072,
      eligible: true,
      note: "Passes the synthetic 95% quality gate",
    },
    {
      name: "haiku-direct",
      modelPolicy: "Claude Haiku 4.5 only",
      qualityScore: 89.1,
      successRate: 0.8,
      costPerApprovedTaskUsd: 0.026,
      eligible: false,
      note: "Rejected because quality and success rate are below the gate",
    },
    {
      name: "haiku-guarded",
      modelPolicy: "Claude Haiku 4.5 + validation + Opus escalation",
      qualityScore: 96.4,
      successRate: 1,
      costPerApprovedTaskUsd: 0.057,
      eligible: true,
      note: "Synthetic escalation cost is included",
    },
  ];
  const selected = candidates
    .filter((candidate) => candidate.eligible && candidate.qualityScore >= qualityThreshold)
    .sort((left, right) => left.costPerApprovedTaskUsd - right.costPerApprovedTaskUsd)[0];
  if (!selected) throw new Error("Synthetic demo has no eligible policy");
  const savingsPerTask = baseline.costPerApprovedTaskUsd - selected.costPerApprovedTaskUsd;
  return {
    kind: "synthetic-replay",
    apiCallsMade: 0,
    baseline,
    qualityThreshold,
    candidates,
    selected,
    savingsPercent: round((1 - selected.costPerApprovedTaskUsd / baseline.costPerApprovedTaskUsd) * 100),
    syntheticOptimizationCostUsd: SYNTHETIC_OPTIMIZATION_COST_USD,
    breakEvenTasks: Math.ceil(SYNTHETIC_OPTIMIZATION_COST_USD / savingsPerTask),
    disclaimer:
      "Synthetic demonstration only. These numbers do not claim measured model performance or real API savings.",
  };
}

export function formatDemoReport(report: DemoReport): string {
  const rows = report.candidates.map(
    (candidate) =>
      `${candidate.eligible ? "PASS" : "FAIL"}  ${candidate.name.padEnd(17)} quality ${candidate.qualityScore.toFixed(1).padStart(5)}  success ${(candidate.successRate * 100).toFixed(0).padStart(3)}%  $${candidate.costPerApprovedTaskUsd.toFixed(3)}/approved`,
  );
  return [
    "LoopGauge API-free demo",
    "=======================",
    "SYNTHETIC REPLAY - no provider API calls were made",
    "",
    `Baseline: ${report.baseline.modelPolicy}`,
    `Quality gate: ${report.qualityThreshold.toFixed(1)} / 100`,
    "",
    ...rows,
    "",
    `Selected: ${report.selected.modelPolicy}`,
    `Synthetic savings: ${report.savingsPercent.toFixed(1)}%`,
    `Synthetic break-even: ${report.breakEvenTasks} approved tasks`,
    "",
    report.disclaimer,
    "Run a real project benchmark before making any savings claim.",
  ].join("\n");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
