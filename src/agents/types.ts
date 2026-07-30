import type { AgentConfig } from "@opencode-ai/sdk";

/**
 * Agent mode, mirrors OpenCode's `AgentConfig.mode`.
 * - "primary":   selectable orchestrator agent (respects UI-selected model)
 * - "subagent":  delegated worker (uses its own model)
 * - "all":       available in both contexts
 */
export type AgentMode = "primary" | "subagent" | "all";

/**
 * Agent factory: a function that builds an {@link AgentConfig} for a given
 * model, carrying a static `mode` and `defaultModel`.
 *
 * This mirrors omo-opencode's `AgentFactory` so our plugin registers agents
 * the same way the reference project does. The static `mode` is copied onto
 * the produced config by `buildAgent`.
 */
export type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode;
  defaultModel: string;
};

/** User-tunable per-agent overrides loaded from JSONC config. */
export interface AgentOverride {
  model?: string;
  disable?: boolean;
}
