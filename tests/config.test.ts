import { mkdtemp, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { initializeConfig } from "../src/config/init.js";
import { loadConfig } from "../src/config/load.js";
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

  it("writes only the current model choice and resolves managed candidates on load", async () => {
    const directory = await mkdtemp(join(tmpdir(), "loopgauge-config-"));
    const path = await initializeConfig({
      projectName: "fixture",
      provider: "openai",
      currentModel: "gpt-5.6",
      path: join(directory, "loop.yaml"),
    });
    const raw = YAML.parse(await readFile(path, "utf8"));
    expect(raw.providers).toEqual({
      modelDiscovery: {
        current: { provider: "openai", model: "gpt-5.6" },
        maxCandidates: 4,
        refreshFromProvider: true,
      },
    });

    const loaded = await loadConfig(path, { async getApiKey() { return undefined; } });
    expect(loaded.providers.roles.teacher.model).toBe("gpt-5.6");
    expect(loaded.providers.roles.candidates.length).toBeGreaterThan(0);
    expect(loaded.providers.allowedProviders).toEqual(["openai"]);
  });
});
