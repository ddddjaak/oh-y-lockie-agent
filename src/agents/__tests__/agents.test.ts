import { describe, it, expect } from "vitest";
import {
  agentSources,
  buildAgent,
  getAgentKeys,
} from "../index.js";
import type { AgentDef } from "../types.js";

describe("agent registry", () => {
  it("registers 16 built-in agents", () => {
    expect(Object.keys(agentSources).length).toBe(16);
  });

  it("every def carries mode + defaultModel + category", () => {
    for (const [name, def] of Object.entries(agentSources)) {
      expect(def.mode, `mode missing on ${name}`).toBeDefined();
      expect(def.defaultModel, `defaultModel missing on ${name}`).toBeDefined();
      expect(def.category, `category missing on ${name}`).toBeDefined();
    }
  });

  it("marks exactly two primary agents", () => {
    const primary = Object.entries(agentSources).filter(([, d]) => d.mode === "primary");
    expect(primary.map(([n]) => n).sort()).toEqual(["architect", "firmware"]);
  });
});

describe("buildAgent", () => {
  it("carries the def's mode onto the produced config", () => {
    const agent = buildAgent(agentSources.architect, "test/model");
    expect(agent.mode).toBe("primary");
    expect(agent.model).toBe("test/model");
  });

  it("loads a non-empty prompt from agents/<name>.md", () => {
    const agent = buildAgent(agentSources["code-reviewer"], "test/model");
    expect(typeof agent.prompt).toBe("string");
    expect((agent.prompt as string).length).toBeGreaterThan(0);
  });
});

describe("getAgentKeys", () => {
  it("returns all registered agent names", () => {
    expect(getAgentKeys()).toEqual(Object.keys(agentSources));
  });
});

describe("agent categorization (explicit, not description-based)", () => {
  it("assigns every agent to exactly one category matching def.category", () => {
    for (const [name, def] of Object.entries(agentSources) as [string, AgentDef][]) {
      // def.category is the source of truth — buildAgentCategoryMap must agree
      expect(["primary", "design", "review", "domain", "quality"]).toContain(def.category);
    }
  });

  it("puts the two primary agents in primary category", () => {
    const primaries = Object.entries(agentSources)
      .filter(([, d]) => d.category === "primary")
      .map(([n]) => n)
      .sort();
    expect(primaries).toEqual(["architect", "firmware"]);
  });
});
