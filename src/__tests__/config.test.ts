import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import os from "node:os";
import { loadPluginConfig } from "../config.js";
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
