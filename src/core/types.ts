export type ProviderId = "openai" | "anthropic";

export type SelectionMode = "manual" | "auto-within-allowlist";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
}

export interface ToolUsage {
  name: string;
  calls: number;
  units?: number;
}

export type AgentEventType =
  | "session.started"
  | "message"
  | "tool.started"
  | "tool.completed"
  | "file.changed"
  | "usage"
  | "error"
  | "session.completed";

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  data: unknown;
}

export interface AgentRunRequest {
  provider: ProviderId;
  model: string;
  prompt: string;
  cwd: string;
  reasoningEffort?: ReasoningEffort;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  networkAccess?: boolean;
  readOnly?: boolean;
  sessionId?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}

export interface AgentRunResult {
  provider: ProviderId;
  model: string;
  sessionId?: string;
  finalResponse: string;
  usage: TokenUsage;
  toolUsage: ToolUsage[];
  reportedCostUsd?: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface AgentProvider {
  readonly id: ProviderId;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  abort?(sessionId: string): Promise<void>;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ValidationResult {
  setup?: CommandResult;
  build?: CommandResult;
  test?: CommandResult;
  lint?: CommandResult;
  typecheck?: CommandResult;
  mandatoryPassed: boolean;
}

export interface QualityScore {
  functional: number;
  requirements: number;
  regression: number;
  staticAnalysis: number;
  total: number;
  mandatoryPassed: boolean;
}

export interface SimilarityScore {
  behavior: number;
  structure: number;
  text: number;
  total: number;
  difference: number;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  toolsUsd: number;
  reportedUsd: number;
  retryUsd: number;
  judgeUsd: number;
  escalationUsd: number;
  totalUsd: number;
}

export interface EvaluatedRun {
  id: string;
  jobId: string;
  taskId: string;
  role: "teacher" | "candidate" | "judge";
  provider: ProviderId;
  model: string;
  variant: string;
  result: AgentRunResult;
  judge?: AgentRunResult;
  validation: ValidationResult;
  quality: QualityScore;
  similarity?: SimilarityScore;
  cost: CostBreakdown;
  patch: string;
  createdAt: string;
}

export interface CandidateSummary {
  provider: ProviderId;
  model: string;
  variant: string;
  qualityScore: number;
  baselineRatio: number;
  successRate: number;
  averageCostUsd: number;
  costPerSuccessUsd: number;
  similarityScore: number;
  differenceScore: number;
  eligible: boolean;
  runs: string[];
}

export interface SavingsEstimate {
  baselineCostPerSuccessUsd: number;
  candidateCostPerSuccessUsd: number;
  savingsPercent: number;
  amortizedSavingsPercent: number;
  optimizationCostUsd: number;
  breakEvenRuns: number | null;
}

export interface ImprovementOpportunity {
  name: string;
  evidence: string;
  expectedAdditionalSavingsMinPercent: number;
  expectedAdditionalSavingsMaxPercent: number;
  experimentCostUsd: number;
}

export interface OptimizationReport {
  jobId: string;
  status: OptimizationJobStatus;
  priceCatalogAsOf: string;
  baselineQuality: number;
  selected?: CandidateSummary;
  candidates: CandidateSummary[];
  savings?: SavingsEstimate;
  totalOptimizationCostUsd: number;
  confidence: "low" | "medium" | "high";
  improvements: ImprovementOpportunity[];
  startedAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface OptimizedTaskResult {
  runId: string;
  agent: AgentRunResult;
  validation: ValidationResult;
  patch: string;
  cost: CostBreakdown;
}

export type OptimizationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface OptimizationJobRecord {
  id: string;
  status: OptimizationJobStatus;
  projectRoot: string;
  configPath: string;
  currentStep?: string;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
