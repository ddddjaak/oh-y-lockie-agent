import { describe, it, expect } from "vitest";
import {
  agentSources,
  buildAgent,
  getAgentKeys,
} from "../index.js";
import type { AgentFactory } from "../types.js";

describe("agent registry", () => {
  it("registers 16 built-in agents", () => {
    expect(Object.keys(agentSources).length).toBe(16);
  });

  it("every factory carries a static mode + defaultModel", () => {
    for (const [name, factory] of Object.entries(agentSources)) {
      expect((factory as AgentFactory).mode, `mode missing on ${name}`).toBeDefined();
      expect((factory as AgentFactory).defaultModel, `defaultModel missing on ${name}`).toBeDefined();
    }
  });

  it("marks exactly two primary agents", () => {
    const primary = Object.entries(agentSources).filter(([, f]) => f.mode === "primary");
    expect(primary.map(([n]) => n).sort()).toEqual(["architect", "firmware"]);
  });
});

describe("buildAgent", () => {
  it("carries the factory's static mode onto the produced config", () => {
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
