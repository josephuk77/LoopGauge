import { mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { loopConfigSchema } from "../src/config/schema.js";
import { generateProviderArtifacts } from "../src/project/artifacts.js";
import { makeConfig } from "./helpers.js";

describe("loop config provider policy", () => {
  it("accepts a fully user-selected provider and model set", () => {
    const parsed = loopConfigSchema.parse(makeConfig());
    expect(parsed.providers.allowedProviders).toEqual(["openai"]);
    expect(parsed.providers.selectionMode).toBe("manual");
  });

  it("rejects a role that references a disallowed provider", () => {
    const config = makeConfig();
    const raw = YAML.parse(YAML.stringify(config));
    raw.providers.roles.teacher = { provider: "anthropic", model: "anything" };
    expect(() => loopConfigSchema.parse(raw)).toThrow(/disallowed provider/i);
  });

  it("rejects models without a price snapshot", () => {
    const config = makeConfig();
    const raw = YAML.parse(YAML.stringify(config));
    raw.providers.openai.prices = { teacher: raw.providers.openai.prices.teacher };
    expect(() => loopConfigSchema.parse(raw)).toThrow(/missing price snapshot/i);
  });

  it("generates instructions only for providers selected by the user", async () => {
    const directory = await mkdtemp(join(tmpdir(), "loopgauge-artifacts-"));
    const written = await generateProviderArtifacts(makeConfig(), directory);
    expect(written.map((path) => path.split(/[\\/]/).at(-1))).toEqual(["AGENTS.md"]);
    await expect(access(join(directory, "generated", "CLAUDE.md"))).rejects.toThrow();
  });
});
