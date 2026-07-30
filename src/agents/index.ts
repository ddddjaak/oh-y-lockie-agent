/**
 * Agent registry + build/collect pipeline for oh-y-lockie-agent.
 *
 * This is the single registration point for all built-in agents, mirroring
 * omo-opencode's `agentSources` + `collectPendingBuiltinAgents` design:
 *
 *   - `agentSources`  : name -> AgentFactory registry
 *   - `buildAgent`    : factory(model) -> AgentConfig (carries static `mode`)
 *   - `collectAgents` : applies user overrides + optional availability gating,
 *                       returns the map to inject into OpenCode's cfg.agent
 */

import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentFactory, AgentOverride } from "./types.js";
import * as defs from "./definitions.js";

export * from "./types.js";

/** Registry of all built-in agents (name -> factory). */
export const agentSources: Record<string, AgentFactory> = {
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

/** Build a single agent's AgentConfig from its factory. */
export function buildAgent(factory: AgentFactory, model: string): AgentConfig {
  const base = factory(model) as AgentConfig & { mode?: AgentFactory["mode"] };
  // Carry the static mode onto the produced config (omo-opencode does the same
  // in agent-builder.ts).
  if (base.mode === undefined) {
    base.mode = factory.mode;
  }
  return base;
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

  for (const [name, factory] of Object.entries(agentSources)) {
    const ov = overrides[name];
    if (ov?.disable) {
      console.log(`[oh-y-lockie-agent] agent ${name} disabled by config`);
      continue;
    }

    const model = ov?.model ?? factory.defaultModel;

    if (availableModels && !availableModels.has(model)) {
      console.log(
        `[oh-y-lockie-agent] skip ${name}: model "${model}" not in available set`,
      );
      continue;
    }

    out[name] = buildAgent(factory, model);
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
 * Categorization follows description keywords (same rules as before).
 */
export function buildAgentCategoryMap(
  overrides: Record<string, AgentOverride> = {},
): AgentCategoryMap {
  const primary: string[] = [];
  const design: string[] = [];
  const review: string[] = [];
  const domain: string[] = [];
  const quality: string[] = [];

  for (const [name, factory] of Object.entries(agentSources)) {
    if (overrides[name]?.disable) continue;

    if (factory.mode === "primary") {
      primary.push(name);
      continue;
    }

    const desc = (factory(factory.defaultModel).description || "").toLowerCase();
    // Order matters: more specific semantic categories (领域/合规/测试/验证/审查)
    // are matched before broad design keywords like "固件架构", so a "领域专家"
    // is not mis-filed under design.
    if (desc.includes("领域") || desc.includes("合规")) {
      domain.push(name);
    } else if (desc.includes("代码") || desc.includes("安全审计") || desc.includes("架构审查")) {
      review.push(name);
    } else if (desc.includes("测试") || desc.includes("验证")) {
      quality.push(name);
    } else if (
      desc.includes("电源") ||
      desc.includes("启动") ||
      desc.includes("内存") ||
      desc.includes("固件架构") ||
      desc.includes("时序") ||
      desc.includes("寄存器")
    ) {
      design.push(name);
    } else {
      design.push(name);
    }
  }

  return { primary, design, review, domain, quality };
}
