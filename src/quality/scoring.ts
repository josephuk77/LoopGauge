import type { LoopConfig } from "../config/schema.js";
import type { QualityScore, SimilarityScore, ValidationResult } from "../core/types.js";

function passed(result: { exitCode: number } | undefined): boolean | undefined {
  return result ? result.exitCode === 0 : undefined;
}

function configuredPassRatio(results: Array<boolean | undefined>): number {
  const configured = results.filter((value): value is boolean => value !== undefined);
  if (configured.length === 0) return 1;
  return configured.filter(Boolean).length / configured.length;
}

export function scoreQuality(
  validation: ValidationResult,
  requirementScore: number,
  config: LoopConfig,
): QualityScore {
  const weights = config.quality.weights;
  const functionalRatio = configuredPassRatio([
    passed(validation.build),
    passed(validation.test),
  ]);
  const regressionRatio = configuredPassRatio([passed(validation.test)]);
  const staticRatio = configuredPassRatio([
    passed(validation.lint),
    passed(validation.typecheck),
  ]);
  const functional = functionalRatio * weights.functional;
  const requirements = clamp01(requirementScore) * weights.requirements;
  const regression = regressionRatio * weights.regression;
  const staticAnalysis = staticRatio * weights.staticAnalysis;
  return {
    functional,
    requirements,
    regression,
    staticAnalysis,
    total: functional + requirements + regression + staticAnalysis,
    mandatoryPassed: validation.mandatoryPassed,
  };
}

export function scoreSimilarity(
  baseline: { validation: ValidationResult; patch: string },
  candidate: { validation: ValidationResult; patch: string },
  config: LoopConfig,
): SimilarityScore {
  const weights = config.quality.similarityWeights;
  const behavior = behaviorSimilarity(baseline.validation, candidate.validation);
  const structure = jaccard(extractStructureTokens(baseline.patch), extractStructureTokens(candidate.patch));
  const text = jaccard(normalizedLines(baseline.patch), normalizedLines(candidate.patch));
  const total = behavior * weights.behavior + structure * weights.structure + text * weights.text;
  return {
    behavior: behavior * 100,
    structure: structure * 100,
    text: text * 100,
    total,
    difference: 100 - total,
  };
}

function behaviorSimilarity(a: ValidationResult, b: ValidationResult): number {
  const keys = ["build", "test", "lint", "typecheck"] as const;
  const compared = keys.flatMap((key) => {
    const left = a[key];
    const right = b[key];
    return left && right ? [left.exitCode === right.exitCode] : [];
  });
  return compared.length === 0 ? 1 : compared.filter(Boolean).length / compared.length;
}

function extractStructureTokens(patch: string): Set<string> {
  const tokens = new Set<string>();
  const pattern = /\b(?:export|public|class|interface|type|function|def|struct|enum)\s+([\w$]+)/g;
  for (const match of patch.matchAll(pattern)) {
    if (match[1]) tokens.add(match[1].toLowerCase());
  }
  return tokens.size > 0 ? tokens : normalizedLines(patch);
}

function normalizedLines(patch: string): Set<string> {
  const lines = patch
    .split(/\r?\n/)
    .filter((line) => /^[+-](?![+-])/.test(line))
    .map((line) => line.slice(1).trim().replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean);
  return new Set(lines);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 1 : intersection / union;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
