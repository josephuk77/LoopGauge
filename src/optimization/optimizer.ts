import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LoopConfig } from "../config/schema.js";
import type {
  AgentRunResult,
  CandidateSummary,
  EvaluatedRun,
  ImprovementOpportunity,
  OptimizedTaskResult,
  OptimizationJobRecord,
  OptimizationReport,
  ProviderId,
  ReasoningEffort,
} from "../core/types.js";
import { calculateSavings, PriceCatalog } from "../cost/pricing.js";
import { scoreQuality, scoreSimilarity } from "../quality/scoring.js";
import { ProviderRegistry } from "../providers/registry.js";
import { validateProject } from "../runtime/validator.js";
import { WorktreeManager } from "../runtime/worktree.js";
import { LoopGaugeStore } from "../storage/store.js";

export interface OptimizeOptions {
  jobId?: string;
  configPath: string;
  signal?: AbortSignal;
  onProgress?: (job: OptimizationJobRecord) => void | Promise<void>;
}

interface Selection {
  provider: ProviderId;
  model: string;
}

export class OptimizationEngine {
  private readonly catalog: PriceCatalog;
  private readonly worktrees: WorktreeManager;

  constructor(
    private readonly config: LoopConfig,
    private readonly registry: ProviderRegistry,
    private readonly store: LoopGaugeStore,
  ) {
    this.catalog = new PriceCatalog(config);
    this.worktrees = new WorktreeManager(config.project.root, store.stateDirectory);
  }

  async optimize(options: OptimizeOptions): Promise<OptimizationReport> {
    const jobId = options.jobId ?? crypto.randomUUID();
    const previousJob = options.jobId ? this.store.getJob(jobId) : undefined;
    const existingRuns = previousJob ? this.store.listRuns(jobId) : [];
    const startedAt = previousJob?.createdAt ?? new Date().toISOString();
    let job: OptimizationJobRecord = {
      id: jobId,
      status: "running",
      projectRoot: this.config.project.root,
      configPath: resolve(options.configPath),
      currentStep: "checking repository",
      spentUsd: previousJob?.spentUsd ?? 0,
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    await this.updateJob(job, options);

    try {
      this.catalog.assertUsable();
      await this.worktrees.assertReady();
      const teacherRuns: EvaluatedRun[] = existingRuns.filter((run) => run.role === "teacher");
      let iterations = existingRuns.length;

      for (const sample of this.config.task.samples) {
        for (let repetition = 0; repetition < this.config.optimization.baselineRepetitions; repetition++) {
          const variant = `baseline-${repetition + 1}`;
          if (teacherRuns.some((run) => run.taskId === sample.id && run.variant === variant)) continue;
          this.assertCanContinue(job.spentUsd, iterations, options.signal);
          job = this.withStep(job, `baseline ${sample.id} #${repetition + 1}`);
          await this.updateJob(job, options);
          const run = await this.executeEvaluatedRun({
            jobId,
            taskId: sample.id,
            prompt: sample.prompt,
            requirementScore: sample.requirementScore,
            role: "teacher",
            selection: this.config.providers.roles.teacher,
            variant,
            reasoningEffort: "high",
            ...(options.signal ? { signal: options.signal } : {}),
          });
          teacherRuns.push(run);
          iterations++;
          job = this.withSpent(job, run.cost.totalUsd);
          await this.updateJob(job, options);
        }
      }

      const successfulTeachers = teacherRuns.filter(
        (run) => run.result.success && run.validation.mandatoryPassed,
      );
      if (successfulTeachers.length === 0) {
        throw new Error("No successful teacher baseline was produced");
      }
      const baselineQuality = average(successfulTeachers.map((run) => run.quality.total));
      const baselineCostPerSuccess =
        sum(teacherRuns.map((run) => run.cost.totalUsd)) / successfulTeachers.length;
      const baselineByTask = new Map<string, EvaluatedRun>();
      for (const run of successfulTeachers) {
        if (!baselineByTask.has(run.taskId)) {
          const sample = this.config.task.samples.find((item) => item.id === run.taskId);
          const referencePatch = sample?.baselinePatchPath
            ? await readFile(resolve(this.config.project.root, sample.baselinePatchPath), "utf8")
            : run.patch;
          baselineByTask.set(run.taskId, { ...run, patch: referencePatch });
        }
      }

      const candidateRuns: EvaluatedRun[] = existingRuns.filter((run) => run.role === "candidate");
      let noImprovement = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      outer: for (const selection of candidateSelections(this.config)) {
        for (const effort of this.config.optimization.reasoningEfforts) {
          for (const variant of this.config.optimization.promptVariants) {
            let variantImproved = false;
            for (const sample of this.config.task.samples) {
              const variantKey = `${variant}:${effort}`;
              if (
                candidateRuns.some(
                  (run) =>
                    run.taskId === sample.id &&
                    run.provider === selection.provider &&
                    run.model === selection.model &&
                    run.variant === variantKey,
                )
              ) {
                continue;
              }
              if (!this.canContinue(job.spentUsd, iterations, options.signal)) break outer;
              const baseline = baselineByTask.get(sample.id);
              job = this.withStep(job, `candidate ${selection.provider}/${selection.model} ${variant}/${effort}`);
              await this.updateJob(job, options);
              const run = await this.executeEvaluatedRun({
                jobId,
                taskId: sample.id,
                prompt: applyPromptVariant(sample.prompt, variant, this.config),
                requirementScore: sample.requirementScore,
                role: "candidate",
                selection,
                variant: variantKey,
                reasoningEffort: effort,
                ...(baseline ? { baseline } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
              });
              candidateRuns.push(run);
              iterations++;
              job = this.withSpent(job, run.cost.totalUsd);
              await this.updateJob(job, options);
              if (
                run.quality.mandatoryPassed &&
                run.quality.total >= baselineQuality * this.config.quality.minimumBaselineRatio &&
                run.cost.totalUsd < bestCost
              ) {
                bestCost = run.cost.totalUsd;
                variantImproved = true;
              }
            }
            noImprovement = variantImproved ? 0 : noImprovement + 1;
            if (noImprovement >= this.config.optimization.noImprovementLimit) break outer;
          }
        }
      }

      const candidates = summarizeCandidates(candidateRuns, baselineQuality, this.config);
      const selected = candidates
        .filter((candidate) => candidate.eligible)
        .sort((a, b) => a.costPerSuccessUsd - b.costPerSuccessUsd)[0];
      const savings = selected
        ? calculateSavings(
            baselineCostPerSuccess,
            selected.costPerSuccessUsd,
            job.spentUsd,
          )
        : undefined;
      const completedAt = new Date().toISOString();
      const report: OptimizationReport = {
        jobId,
        status: "completed",
        priceCatalogAsOf: this.catalog.asOf,
        baselineQuality,
        ...(selected ? { selected } : {}),
        candidates,
        ...(savings ? { savings } : {}),
        totalOptimizationCostUsd: job.spentUsd,
        confidence: confidenceFor(teacherRuns.length, candidateRuns.length),
        improvements: findEvidenceBackedImprovements(candidates),
        startedAt,
        completedAt,
      };
      job = { ...job, status: "completed", currentStep: "complete", updatedAt: completedAt };
      this.store.saveReport(report);
      await this.updateJob(job, options);
      return report;
    } catch (error) {
      const cancelled = options.signal?.aborted ?? false;
      const message = error instanceof Error ? error.message : String(error);
      const completedAt = new Date().toISOString();
      const status = cancelled ? "cancelled" : "failed";
      job = { ...job, status, error: message, updatedAt: completedAt };
      await this.updateJob(job, options);
      const report: OptimizationReport = {
        jobId,
        status,
        priceCatalogAsOf: this.catalog.asOf,
        baselineQuality: 0,
        candidates: [],
        totalOptimizationCostUsd: job.spentUsd,
        confidence: "low",
        improvements: [],
        startedAt,
        completedAt,
        failureReason: message,
      };
      this.store.saveReport(report);
      return report;
    }
  }

  async runSelectedTask(
    report: OptimizationReport,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<OptimizedTaskResult> {
    if (!report.selected) throw new Error("Optimization report has no eligible selected policy");
    const worktree = await this.worktrees.create(report.jobId, "production-run");
    try {
      let agent = await this.safeRun({
        provider: report.selected.provider,
        model: report.selected.model,
        prompt: applyPromptVariant(prompt, report.selected.variant.split(":")[0] ?? "plain", this.config),
        cwd: worktree.path,
        maxBudgetUsd: this.config.optimization.perRunBudgetUsd,
        maxTurns: 20,
        allowedTools: this.config.optimization.allowedTools,
        networkAccess: this.config.optimization.networkAccess,
        ...(signal ? { signal } : {}),
      });
      let validation = await validateProject(this.config, worktree.path, signal);
      let escalationUsd = 0;
      const teacher = this.config.providers.roles.teacher;
      const canEscalate =
        this.config.providers.selectionMode === "auto-within-allowlist" &&
        (teacher.provider !== report.selected.provider || teacher.model !== report.selected.model);
      if (canEscalate && (!agent.success || !validation.mandatoryPassed)) {
        const escalation = await this.safeRun({
          provider: teacher.provider,
          model: teacher.model,
          prompt: retryPrompt(prompt, validation, agent.error),
          cwd: worktree.path,
          reasoningEffort: "high",
          maxBudgetUsd: this.config.optimization.perRunBudgetUsd,
          maxTurns: 20,
          allowedTools: this.config.optimization.allowedTools,
          networkAccess: this.config.optimization.networkAccess,
          ...(signal ? { signal } : {}),
        });
        escalationUsd = this.catalog.calculate(escalation).totalUsd;
        agent = mergeRunResults(agent, escalation);
        validation = await validateProject(this.config, worktree.path, signal);
      }
      const patch = await this.worktrees.diff(worktree.path);
      const cost = this.catalog.calculate(agent);
      cost.escalationUsd = escalationUsd;
      const result = {
        runId: crypto.randomUUID(),
        agent,
        validation,
        patch,
        cost,
      };
      await this.store.appendEvent(report.jobId, {
        type: "optimized.task.completed",
        timestamp: new Date().toISOString(),
        result,
      });
      return result;
    } finally {
      await worktree.dispose();
    }
  }

  private async executeEvaluatedRun(input: {
    jobId: string;
    taskId: string;
    prompt: string;
    requirementScore: number;
    role: "teacher" | "candidate";
    selection: Selection;
    variant: string;
    reasoningEffort: ReasoningEffort;
    baseline?: EvaluatedRun;
    signal?: AbortSignal;
  }): Promise<EvaluatedRun> {
    const runId = crypto.randomUUID();
    const worktree = await this.worktrees.create(input.jobId, `${input.role}-${input.taskId}`);
    try {
      let result = await this.safeRun({
        provider: input.selection.provider,
        model: input.selection.model,
        prompt: input.prompt,
        cwd: worktree.path,
        reasoningEffort: input.reasoningEffort,
        maxBudgetUsd: this.config.optimization.perRunBudgetUsd,
        maxTurns: 20,
        allowedTools: this.config.optimization.allowedTools,
        networkAccess: this.config.optimization.networkAccess,
        ...(input.signal ? { signal: input.signal } : {}),
        onEvent: (event) => this.store.appendEvent(input.jobId, { runId, ...event }),
      });
      let validation = await validateProject(this.config, worktree.path, input.signal);
      let retryUsd = 0;
      if (input.role === "candidate" && (!result.success || !validation.mandatoryPassed)) {
        const retry = await this.safeRun({
          provider: input.selection.provider,
          model: input.selection.model,
          prompt: retryPrompt(input.prompt, validation, result.error),
          cwd: worktree.path,
          reasoningEffort: input.reasoningEffort,
          maxBudgetUsd: this.config.optimization.perRunBudgetUsd,
          maxTurns: 10,
          allowedTools: this.config.optimization.allowedTools,
          networkAccess: this.config.optimization.networkAccess,
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          onEvent: (event) => this.store.appendEvent(input.jobId, { runId, retry: true, ...event }),
        });
        retryUsd = this.catalog.calculate(retry).totalUsd;
        result = mergeRunResults(result, retry);
        validation = await validateProject(this.config, worktree.path, input.signal);
      }
      const patch = await this.worktrees.diff(worktree.path);
      const judgeSelection = this.config.providers.roles.judge;
      const judge = judgeSelection
        ? await this.safeRun({
            provider: judgeSelection.provider,
            model: judgeSelection.model,
            prompt: judgePrompt(input.prompt, patch, validation),
            cwd: worktree.path,
            readOnly: true,
            maxTurns: 1,
            maxBudgetUsd: this.config.optimization.perRunBudgetUsd,
            allowedTools: ["Read", "Glob", "Grep"],
            networkAccess: false,
            ...(input.signal ? { signal: input.signal } : {}),
            onEvent: (event) => this.store.appendEvent(input.jobId, { runId, judge: true, ...event }),
          })
        : undefined;
      const requirementScore = judge
        ? parseJudgeScore(judge)
        : result.success
          ? input.requirementScore
          : 0;
      const quality = scoreQuality(validation, requirementScore, this.config);
      const cost = this.catalog.calculate(result);
      const judgeUsd = judge ? this.catalog.calculate(judge).totalUsd : 0;
      cost.retryUsd = retryUsd;
      cost.judgeUsd = judgeUsd;
      cost.totalUsd += judgeUsd;
      const run: EvaluatedRun = {
        id: runId,
        jobId: input.jobId,
        taskId: input.taskId,
        role: input.role,
        provider: input.selection.provider,
        model: input.selection.model,
        variant: input.variant,
        result,
        ...(judge ? { judge } : {}),
        validation,
        quality,
        ...(input.baseline
          ? {
              similarity: scoreSimilarity(
                { validation: input.baseline.validation, patch: input.baseline.patch },
                { validation, patch },
                this.config,
              ),
            }
          : {}),
        cost,
        patch,
        createdAt: new Date().toISOString(),
      };
      this.store.saveRun(run);
      return run;
    } finally {
      await worktree.dispose();
    }
  }

  private async safeRun(request: Parameters<ProviderRegistry["run"]>[0]): Promise<AgentRunResult> {
    try {
      return await this.registry.run(request);
    } catch (error) {
      return {
        provider: request.provider,
        model: request.model,
        finalResponse: "",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningTokens: 0,
        },
        toolUsage: [],
        durationMs: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private canContinue(spent: number, iterations: number, signal?: AbortSignal): boolean {
    return (
      !signal?.aborted &&
      spent < this.config.optimization.budgetUsd &&
      iterations < this.config.optimization.maxIterations
    );
  }

  private assertCanContinue(spent: number, iterations: number, signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("Optimization cancelled");
    if (spent >= this.config.optimization.budgetUsd) throw new Error("Optimization budget exhausted");
    if (iterations >= this.config.optimization.maxIterations) throw new Error("Maximum iterations reached");
  }

  private withStep(job: OptimizationJobRecord, currentStep: string): OptimizationJobRecord {
    return { ...job, currentStep, updatedAt: new Date().toISOString() };
  }

  private withSpent(job: OptimizationJobRecord, amount: number): OptimizationJobRecord {
    return { ...job, spentUsd: job.spentUsd + amount, updatedAt: new Date().toISOString() };
  }

  private async updateJob(job: OptimizationJobRecord, options: OptimizeOptions): Promise<void> {
    this.store.saveJob(job);
    await this.store.appendEvent(job.id, { type: "job.status", timestamp: job.updatedAt, job });
    await options.onProgress?.(job);
  }
}

function applyPromptVariant(prompt: string, variant: string, config: LoopConfig): string {
  const checks = Object.entries(config.project.commands)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name, command]) => `${name}: ${command}`)
    .join("\n");
  if (variant === "verify") {
    return `${prompt}\n\nBefore finishing, run and satisfy these checks:\n${checks || "the project checks"}`;
  }
  if (variant === "budget-aware") {
    return `${prompt}\n\nUse the smallest relevant context, avoid unrelated changes, run focused checks first, and stop as soon as the task and required validation are complete.`;
  }
  return prompt;
}

function candidateSelections(config: LoopConfig): Selection[] {
  if (config.providers.selectionMode === "manual") return config.providers.roles.candidates;
  const teacher = config.providers.roles.teacher;
  return config.providers.allowedProviders.flatMap((provider) =>
    (config.providers[provider]?.allowedModels ?? [])
      .filter((model) => provider !== teacher.provider || model !== teacher.model)
      .map((model) => ({ provider, model })),
  );
}

function retryPrompt(prompt: string, validation: EvaluatedRun["validation"], error?: string): string {
  const failures = [validation.build, validation.test, validation.lint, validation.typecheck]
    .filter((result) => result && result.exitCode !== 0)
    .map((result) => `${result?.command}\n${result?.stderr || result?.stdout}`)
    .join("\n\n");
  return `${prompt}\n\nThe previous attempt did not pass validation. Fix only the remaining failures and rerun the relevant checks.\n${error ?? ""}\n${failures}`;
}

function judgePrompt(prompt: string, patch: string, validation: EvaluatedRun["validation"]): string {
  const outcomes = [validation.build, validation.test, validation.lint, validation.typecheck]
    .filter(Boolean)
    .map((result) => `${result?.command}: exit ${result?.exitCode}`)
    .join("\n");
  return `Evaluate whether this code change satisfies the task. Return only JSON: {"score": number from 0 to 1, "reason": "short explanation"}.\n\nTask:\n${prompt}\n\nChecks:\n${outcomes}\n\nPatch:\n${patch.slice(0, 60_000)}`;
}

function parseJudgeScore(judge: AgentRunResult): number {
  if (!judge.success) return 0;
  const match = judge.finalResponse.match(/\{[\s\S]*\}/);
  if (!match) return 0;
  try {
    const parsed = JSON.parse(match[0]) as { score?: unknown };
    return typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : 0;
  } catch {
    return 0;
  }
}

function mergeRunResults(first: AgentRunResult, retry: AgentRunResult): AgentRunResult {
  const sessionId = retry.sessionId ?? first.sessionId;
  const reportedCostUsd = (first.reportedCostUsd ?? 0) + (retry.reportedCostUsd ?? 0);
  return {
    provider: retry.provider,
    model: retry.model,
    ...(sessionId ? { sessionId } : {}),
    finalResponse: retry.finalResponse || first.finalResponse,
    usage: {
      inputTokens: first.usage.inputTokens + retry.usage.inputTokens,
      outputTokens: first.usage.outputTokens + retry.usage.outputTokens,
      cachedInputTokens: first.usage.cachedInputTokens + retry.usage.cachedInputTokens,
      cacheWriteInputTokens: first.usage.cacheWriteInputTokens + retry.usage.cacheWriteInputTokens,
      reasoningTokens: first.usage.reasoningTokens + retry.usage.reasoningTokens,
    },
    toolUsage: mergeToolUsage(first.toolUsage, retry.toolUsage),
    ...(reportedCostUsd > 0 ? { reportedCostUsd } : {}),
    durationMs: first.durationMs + retry.durationMs,
    success: retry.success,
    ...(retry.error ? { error: retry.error } : {}),
  };
}

function mergeToolUsage(first: AgentRunResult["toolUsage"], retry: AgentRunResult["toolUsage"]) {
  const totals = new Map<string, { calls: number; units: number }>();
  for (const item of [...first, ...retry]) {
    const current = totals.get(item.name) ?? { calls: 0, units: 0 };
    current.calls += item.calls;
    current.units += item.units ?? item.calls;
    totals.set(item.name, current);
  }
  return [...totals].map(([name, value]) => ({ name, calls: value.calls, units: value.units }));
}

function summarizeCandidates(
  runs: EvaluatedRun[],
  baselineQuality: number,
  config: LoopConfig,
): CandidateSummary[] {
  const groups = new Map<string, EvaluatedRun[]>();
  for (const run of runs) {
    const key = `${run.provider}\u0000${run.model}\u0000${run.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    if (!first) throw new Error("Candidate group cannot be empty");
    const successful = group.filter((run) => run.result.success && run.validation.mandatoryPassed);
    const qualityScore = average(group.map((run) => run.quality.total));
    const baselineRatio = baselineQuality > 0 ? qualityScore / baselineQuality : 0;
    const averageCostUsd = average(group.map((run) => run.cost.totalUsd));
    const totalCost = sum(group.map((run) => run.cost.totalUsd));
    const costPerSuccessUsd = successful.length > 0 ? totalCost / successful.length : Number.MAX_SAFE_INTEGER;
    const similarityScore = average(group.map((run) => run.similarity?.total ?? 0));
    return {
      provider: first.provider,
      model: first.model,
      variant: first.variant,
      qualityScore,
      baselineRatio,
      successRate: successful.length / group.length,
      averageCostUsd,
      costPerSuccessUsd,
      similarityScore,
      differenceScore: 100 - similarityScore,
      eligible:
        successful.length === group.length &&
        baselineRatio >= config.quality.minimumBaselineRatio,
      runs: group.map((run) => run.id),
    };
  });
}

function findEvidenceBackedImprovements(candidates: CandidateSummary[]): ImprovementOpportunity[] {
  const opportunities: ImprovementOpportunity[] = [];
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const plain = eligible.find((candidate) => candidate.variant.startsWith("plain:"));
  const budget = eligible.find((candidate) => candidate.variant.startsWith("budget-aware:"));
  if (plain && budget && budget.costPerSuccessUsd < plain.costPerSuccessUsd) {
    const savings = (1 - budget.costPerSuccessUsd / plain.costPerSuccessUsd) * 100;
    opportunities.push({
      name: "budget-aware prompt",
      evidence: `Observed ${round(savings)}% lower cost than the plain prompt while passing the quality gate.`,
      expectedAdditionalSavingsMinPercent: round(Math.max(0, savings - 3)),
      expectedAdditionalSavingsMaxPercent: round(savings + 3),
      experimentCostUsd: budget.averageCostUsd,
    });
  }
  return opportunities;
}

function confidenceFor(baselines: number, candidates: number): "low" | "medium" | "high" {
  if (baselines >= 5 && candidates >= 10) return "high";
  if (baselines >= 3 && candidates >= 3) return "medium";
  return "low";
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
