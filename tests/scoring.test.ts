import { describe, expect, it } from "vitest";
import type { ValidationResult } from "../src/core/types.js";
import { scoreQuality, scoreSimilarity } from "../src/quality/scoring.js";
import { makeConfig } from "./helpers.js";

const pass = (command: string) => ({
  command,
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 1,
  timedOut: false,
});

describe("quality and similarity scoring", () => {
  it("scores passing checks according to the 60/20/10/10 weights", () => {
    const validation: ValidationResult = {
      build: pass("build"),
      test: pass("test"),
      lint: pass("lint"),
      typecheck: pass("typecheck"),
      mandatoryPassed: true,
    };
    expect(scoreQuality(validation, 1, makeConfig())).toEqual({
      functional: 60,
      requirements: 20,
      regression: 10,
      staticAnalysis: 10,
      total: 100,
      mandatoryPassed: true,
    });
  });

  it("marks mandatory test failure even when other scores pass", () => {
    const validation: ValidationResult = {
      test: { ...pass("test"), exitCode: 1 },
      lint: pass("lint"),
      mandatoryPassed: false,
    };
    const score = scoreQuality(validation, 1, makeConfig());
    expect(score.mandatoryPassed).toBe(false);
    expect(score.total).toBeLessThan(100);
  });

  it("reports both similarity and inverse difference", () => {
    const validation: ValidationResult = { test: pass("test"), mandatoryPassed: true };
    const score = scoreSimilarity(
      { validation, patch: "+export function hello() { return 1 }" },
      { validation, patch: "+export function hello() { return 1 }" },
      makeConfig(),
    );
    expect(score.total).toBe(100);
    expect(score.difference).toBe(0);
  });
});
