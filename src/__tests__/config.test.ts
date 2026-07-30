import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import os from "node:os";
import { loadPluginConfig } from "../config.js";
import { validatePluginConfig } from "../config-schema.js";
import {
  getActiveAgentKeys,
  buildAgentCategoryMap,
  getAgentKeys,
  collectAgents,
} from "../agents/index.js";
import type { AgentOverride } from "../agents/types.js";

// Isolate from any real user-level config (~/.config/opencode/oh-y-lockie-agent.jsonc).
// loadPluginConfig merges user/project overrides on top of the plugin default; these
// unit tests assert the *plugin default*, so stub os.homedir() to a path that contains
// no override file. This keeps the suite deterministic across machines.
let homedirSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  homedirSpy = vi
    .spyOn(os, "homedir")
    .mockReturnValue(process.platform === "win32" ? "C:\\lockie-isolated-home" : "/lockie-isolated-home");
});
afterAll(() => {
  homedirSpy.mockRestore();
});

// ─── loadPluginConfig ────────────────────────────────────────────

describe("loadPluginConfig", () => {
  it("loads the default config from the plugin package", () => {
    const config = loadPluginConfig();
    expect(config).toBeDefined();
    expect(config.overrides).toBeDefined();
    expect(config.mcp).toBeDefined();
  });

  it("includes the architect agent with its default model", () => {
    const config = loadPluginConfig();
    expect(config.overrides.architect).toBeDefined();
    expect(config.overrides.architect.model).toBe("ddddjaak/mimo-v2.5");
  });

  it("includes the firmware agent with its default model", () => {
    const config = loadPluginConfig();
    expect(config.overrides.firmware).toBeDefined();
    expect(config.overrides.firmware.model).toBe("ddddjaak/mimo-v2.5");
  });

  it("disables explore and general built-in agents", () => {
    const config = loadPluginConfig();
    expect(config.overrides.explore?.disable).toBe(true);
    expect(config.overrides.general?.disable).toBe(true);
  });

  it("includes MCP server configs", () => {
    const config = loadPluginConfig();
    expect(config.mcp.codegraph).toBeDefined();
    expect(config.mcp["sequential-thinking"]).toBeDefined();
  });
});

// ─── getActiveAgentKeys ─────────────────────────────────────────

describe("getActiveAgentKeys", () => {
  it("excludes agents disabled via overrides", () => {
    const overrides: Record<string, AgentOverride> = { architect: { disable: true } };
    const keys = getActiveAgentKeys(overrides);
    expect(keys).not.toContain("architect");
    expect(keys).toContain("firmware");
  });

  it("returns all registry keys when no overrides disable anything", () => {
    const keys = getActiveAgentKeys({});
    expect(keys).toContain("architect");
    expect(keys).toContain("firmware");
    expect(keys).toContain("code-reviewer");
    expect(keys.length).toBe(16);
  });
});

// ─── buildAgentCategoryMap ───────────────────────────────────────

describe("buildAgentCategoryMap", () => {
  it("categorizes primary agents", () => {
    const map = buildAgentCategoryMap();
    expect(map.primary).toContain("architect");
    expect(map.primary).toContain("firmware");
  });

  it("categorizes subagents by description keywords", () => {
    const map = buildAgentCategoryMap();
    expect(map.design).toContain("power-architect");
    expect(map.review).toContain("code-reviewer");
    expect(map.domain).toContain("fw-domain-expert");
    expect(map.quality).toContain("test-engineer");
  });

  it("excludes disabled agents", () => {
    const map = buildAgentCategoryMap({ "power-architect": { disable: true } });
    expect(map.design).not.toContain("power-architect");
  });
});

// ─── getAgentKeys ────────────────────────────────────────────────

describe("getAgentKeys", () => {
  it("returns all registry keys including primary agents", () => {
    const keys = getAgentKeys();
    expect(keys).toContain("architect");
    expect(keys).toContain("firmware");
    expect(keys.length).toBe(16);
  });
});

// ─── collectAgents ───────────────────────────────────────────────

describe("collectAgents", () => {
  it("builds all active agents with resolved models", () => {
    const agents = collectAgents(loadPluginConfig().overrides);
    expect(agents.architect).toBeDefined();
    expect(agents.architect.model).toBe("ddddjaak/mimo-v2.5");
    expect(agents.architect.mode).toBe("primary");
  });

  it("honors a user model override", () => {
    const agents = collectAgents({ architect: { model: "custom/provider-model" } });
    expect(agents.architect.model).toBe("custom/provider-model");
  });

  it("skips disabled agents", () => {
    const agents = collectAgents({ architect: { disable: true } });
    expect(agents.architect).toBeUndefined();
  });

  it("skips agents whose model is not in the available set", () => {
    const agents = collectAgents({}, new Set(["other-model"]));
    expect(Object.keys(agents).length).toBe(0);
  });
});

// ─── validatePluginConfig — schema enforcement ─────────────────

describe("validatePluginConfig — schema enforcement", () => {
  it("rejects unknown top-level field (strict)", () => {
    const r = validatePluginConfig({ agent: {}, bogusField: true }, "test.jsonc");
    expect(r.success).toBe(false);
    expect(r.error).toContain("bogusField");
  });

  it("rejects typo in agent override field (e.g. modle → model)", () => {
    const r = validatePluginConfig({ agent: { architect: { modle: "x" } } }, "test.jsonc");
    expect(r.success).toBe(false);
    expect(r.error).toContain("modle");
  });

  it("rejects wrong type for model (must be string)", () => {
    const r = validatePluginConfig({ agent: { architect: { model: 123 } } }, "test.jsonc");
    expect(r.success).toBe(false);
  });

  it("rejects wrong type for disable (must be boolean)", () => {
    const r = validatePluginConfig({ agent: { architect: { disable: "yes" } } }, "test.jsonc");
    expect(r.success).toBe(false);
  });

  it("accepts valid config with embedded target context", () => {
    const r = validatePluginConfig(
      {
        agent: { architect: { model: "m1" } },
        target: { chip: "CS32F103C8T6", family: "Cortex-M3", sdk: "Chipsea SDK", toolchain: "GCC ARM" },
      },
      "test.jsonc",
    );
    expect(r.success).toBe(true);
    expect(r.data?.target?.chip).toBe("CS32F103C8T6");
    expect(r.data?.target?.family).toBe("Cortex-M3");
  });

  it("warns on unknown agent key (soft, non-blocking)", () => {
    // "code-reviwer" is a typo of "code-reviewer" — should warn, not fail
    const r = validatePluginConfig({ agent: { "code-reviwer": { model: "x" } } }, "test.jsonc");
    expect(r.success).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toContain("code-reviwer");
  });

  it("does not warn on known agent keys", () => {
    const r = validatePluginConfig({ agent: { architect: { model: "x" }, explore: { disable: true } } }, "test.jsonc");
    expect(r.success).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("accepts $schema hint field (JSON Schema standard)", () => {
    const r = validatePluginConfig(
      { $schema: "https://opencode.ai/config.json", agent: {} },
      "test.jsonc",
    );
    expect(r.success).toBe(true);
  });

  it("rejects unknown field in target (strict)", () => {
    const r = validatePluginConfig({ target: { chip: "X", bogus: true } }, "test.jsonc");
    expect(r.success).toBe(false);
    expect(r.error).toContain("bogus");
  });

  it("accepts empty config (all fields optional)", () => {
    const r = validatePluginConfig({}, "test.jsonc");
    expect(r.success).toBe(true);
  });
});
