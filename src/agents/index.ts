/**
 * Agent registry + build/collect pipeline for oh-y-lockie-agent.
 *
 * Single registration point for all built-in agents:
 *
 *   - `agentSources`        : name -> AgentDef registry
 *   - `buildAgent`          : def(model) -> AgentConfig (carries `mode` from def)
 *   - `collectAgents`       : applies user overrides + optional availability gating,
 *                             returns the map to inject into OpenCode's cfg.agent
 *   - `buildAgentCategoryMap`: groups agents by `def.category` for the listing tool
 *
 * No `as` assertions, no `description.includes(...)` reverse-inference —
 * categorization is driven by the explicit `category` field on each AgentDef.
 */

import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentDef, AgentOverride } from "./types.js";
import * as defs from "./definitions.js";

export * from "./types.js";

/** Registry of all built-in agents (name -> definition). */
export const agentSources: Record<string, AgentDef> = {
  architect: defs.architect,
  firmware: defs.firmware,
  "power-architect": defs.powerArchitect,
  "boot-bringup-specialist": defs.bootBringupSpecialist,
  "memory-map-specialist": defs.memoryMapSpecialist,
  "firmware-architect": defs.firmwareArchitect,
  "timing-analyst": defs.timingAnalyst,
  "register-map-generator": defs.registerMapGenerator,
  "code-reviewer": defs.codeReviewer,
  "security-auditor": defs.securityAuditor,
  "system-architect": defs.systemArchitect,
  "fw-domain-expert": defs.fwDomainExpert,
  "hw-domain-expert": defs.hwDomainExpert,
  "compliance-reviewer": defs.complianceReviewer,
  "test-engineer": defs.testEngineer,
  "verification-engineer": defs.verificationEngineer,
};

/**
 * Build a single agent's AgentConfig from its definition.
 *
 * `mode` is carried from `def.mode` onto the produced config — no assertion
 * needed because AgentDef is a plain object with a statically-typed `mode`.
 */
export function buildAgent(def: AgentDef, model: string): AgentConfig {
  return { ...def.factory(model), mode: def.mode };
}

/**
 * Collect all active agent configs for injection into OpenCode's `cfg.agent`.
 *
 * @param overrides       User-tunable per-agent overrides (model / disable).
 * @param availableModels Optional set of models known to be available. When
 *                         provided, agents whose resolved model is absent are
 *                         skipped (mirrors omo-opencode's availability gating).
 */
export function collectAgents(
  overrides: Record<string, AgentOverride> = {},
  availableModels?: Set<string>,
): Record<string, AgentConfig> {
  const out: Record<string, AgentConfig> = {};

  for (const [name, def] of Object.entries(agentSources)) {
    const ov = overrides[name];
    if (ov?.disable) {
      console.log(`[oh-y-lockie-agent] agent ${name} disabled by config`);
      continue;
    }

    const model = ov?.model ?? def.defaultModel;

    if (availableModels && !availableModels.has(model)) {
      console.log(
        `[oh-y-lockie-agent] skip ${name}: model "${model}" not in available set`,
      );
      continue;
    }

    out[name] = buildAgent(def, model);
  }

  return out;
}

/** All agent keys (including disabled), for logging/filtering. */
export function getAgentKeys(): string[] {
  return Object.keys(agentSources);
}

/** Active agent keys (excluding those disabled via overrides). */
export function getActiveAgentKeys(overrides: Record<string, AgentOverride> = {}): string[] {
  return Object.keys(agentSources).filter((k) => !overrides[k]?.disable);
}

export type AgentCategoryMap = {
  primary: string[];
  design: string[];
  review: string[];
  domain: string[];
  quality: string[];
};

/**
 * Build the lockieListAgentsTool's category map from the registry.
 *
 * Categorization uses the explicit `def.category` field — NOT description
 * keyword matching. This means editing an agent's description can never
 * silently move it to the wrong category.
 */
export function buildAgentCategoryMap(
  overrides: Record<string, AgentOverride> = {},
): AgentCategoryMap {
  const map: AgentCategoryMap = {
    primary: [],
    design: [],
    review: [],
    domain: [],
    quality: [],
  };

  for (const [name, def] of Object.entries(agentSources)) {
    if (overrides[name]?.disable) continue;
    // safe: def.category is one of the literal keys of AgentCategoryMap
    map[def.category].push(name);
  }

  return map;
}
