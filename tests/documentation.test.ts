import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const markdownPairs = [
  ["README.md", "README.ko.md"],
  ["CONTRIBUTING.md", "CONTRIBUTING.ko.md"],
  ["SECURITY.md", "SECURITY.ko.md"],
  ["CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT.ko.md"],
  ["CHANGELOG.md", "CHANGELOG.ko.md"],
  ["docs/benchmark-methodology.md", "docs/benchmark-methodology.ko.md"],
  ["docs/roadmap.md", "docs/roadmap.ko.md"],
  ["benchmarks/README.md", "benchmarks/README.ko.md"],
  ["benchmarks/synthetic-demo/README.md", "benchmarks/synthetic-demo/README.ko.md"],
] as const;

const bilingualTemplates = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
  ".github/ISSUE_TEMPLATE/benchmark.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
] as const;

describe("bilingual documentation", () => {
  it.each(markdownPairs)("keeps %s paired with %s", (englishPath, koreanPath) => {
    expect(existsSync(englishPath)).toBe(true);
    expect(existsSync(koreanPath)).toBe(true);

    const english = readFileSync(englishPath, "utf8");
    const korean = readFileSync(koreanPath, "utf8");

    expect(english).toContain(koreanPath.split("/").at(-1));
    expect(korean).toMatch(/[가-힣]/);
  });

  it("ships an explicitly unofficial Korean license translation", () => {
    const translation = readFileSync("LICENSE.ko.md", "utf8");
    expect(translation).toContain("비공식 번역");
    expect(translation).toContain("영어 원문");
  });

  it("ships English and Korean configuration examples", () => {
    expect(existsSync("loop.example.yaml")).toBe(true);
    expect(readFileSync("loop.example.ko.yaml", "utf8")).toMatch(/[가-힣]/);
  });

  it.each(bilingualTemplates)("keeps %s bilingual", (templatePath) => {
    expect(readFileSync(templatePath, "utf8")).toMatch(/[가-힣]/);
  });
});
