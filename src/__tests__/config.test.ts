import { describe, it, expect } from "vitest";
import { loadPluginConfig, getActiveAgentKeys, buildAgentCategoryMap, getAgentKeys } from "../config.js";
import type { AgentDef } from "../config.js";

// ─── loadPluginConfig ────────────────────────────────────────────

describe("loadPluginConfig", () => {
  it("loads the default config from the plugin package", () => {
    const config = loadPluginConfig();
    expect(config).toBeDefined();
    expect(config.agent).toBeDefined();
    expect(config.mcp).toBeDefined();
  });

  it("includes the architect agent", () => {
    const config = loadPluginConfig();
    expect(config.agent.architect).toBeDefined();
    expect(config.agent.architect.mode).toBe("primary");
  });

  it("includes the firmware agent", () => {
    const config = loadPluginConfig();
    expect(config.agent.firmware).toBeDefined();
    expect(config.agent.firmware.mode).toBe("primary");
  });

  it("includes subagents", () => {
    const config = loadPluginConfig();
    expect(config.agent["code-reviewer"]).toBeDefined();
    expect(config.agent["power-architect"]).toBeDefined();
  });

  it("disables explore and general agents", () => {
    const config = loadPluginConfig();
    expect(config.agent.explore?.disable).toBe(true);
    expect(config.agent.general?.disable).toBe(true);
  });

  it("includes MCP server configs", () => {
    const config = loadPluginConfig();
    expect(config.mcp.codegraph).toBeDefined();
    expect(config.mcp["sequential-thinking"]).toBeDefined();
  });
});

// ─── getActiveAgentKeys ─────────────────────────────────────────

describe("getActiveAgentKeys", () => {
  it("excludes disabled agents", () => {
    const agents: Record<string, AgentDef> = {
      architect: { mode: "primary" },
      explore: { disable: true },
      "code-reviewer": { mode: "subagent" },
    };
    const keys = getActiveAgentKeys(agents);
    expect(keys).toContain("architect");
    expect(keys).toContain("code-reviewer");
    expect(keys).not.toContain("explore");
  });

  it("returns all keys when none are disabled", () => {
    const agents: Record<string, AgentDef> = {
      a: { mode: "primary" },
      b: { mode: "subagent" },
    };
    expect(getActiveAgentKeys(agents)).toEqual(["a", "b"]);
  });

  it("returns empty array for empty config", () => {
    expect(getActiveAgentKeys({})).toEqual([]);
  });
});

// ─── buildAgentCategoryMap ───────────────────────────────────────

describe("buildAgentCategoryMap", () => {
  it("categorizes primary agents", () => {
    const agents: Record<string, AgentDef> = {
      architect: { mode: "primary", description: "System architect" },
    };
    const map = buildAgentCategoryMap(agents);
    expect(map.primary).toContain("architect");
  });

  it("categorizes subagents by description keywords", () => {
    const agents: Record<string, AgentDef> = {
      "power-architect": {
        mode: "subagent",
        description: "电源架构设计师：设计电源树",
      },
      "code-reviewer": {
        mode: "subagent",
        description: "Senior code reviewer — 代码审查：正确性、可读性",
      },
      "fw-domain-expert": {
        mode: "subagent",
        description: "固件领域专家",
      },
      "test-engineer": {
        mode: "subagent",
        description: "测试工程师",
      },
    };
    const map = buildAgentCategoryMap(agents);
    expect(map.design).toContain("power-architect");
    expect(map.review).toContain("code-reviewer");
    expect(map.domain).toContain("fw-domain-expert");
    expect(map.quality).toContain("test-engineer");
  });

  it("excludes disabled agents", () => {
    const agents: Record<string, AgentDef> = {
      disabled: { disable: true },
      enabled: { mode: "subagent", description: "电源设计" },
    };
    const map = buildAgentCategoryMap(agents);
    expect(map.design).toContain("enabled");
    expect(map.design).not.toContain("disabled");
  });
});

// ─── getAgentKeys ────────────────────────────────────────────────

describe("getAgentKeys", () => {
  it("returns all keys including disabled", () => {
    const agents: Record<string, AgentDef> = {
      a: { mode: "primary" },
      b: { disable: true },
    };
    const keys = getAgentKeys(agents);
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys.length).toBe(2);
  });
});
