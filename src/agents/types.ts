import type { AgentConfig } from "@opencode-ai/sdk";

/**
 * Agent mode, mirrors OpenCode's `AgentConfig.mode`.
 * - "primary":   selectable orchestrator agent (respects UI-selected model)
 * - "subagent":  delegated worker (uses its own model)
 * - "all":       available in both contexts
 */
export type AgentMode = "primary" | "subagent" | "all";

/**
 * Explicit agent category for the `lockie_list_agents` tool grouping.
 * Declared per-agent in {@link AgentDef.category} so categorization does NOT
 * depend on description wording (which silently breaks when copy is edited).
 *
 * - "primary": top-level orchestrators (architect / firmware)
 * - "design":  design-phase specialists (power / boot / memory / timing / register / fw-arch)
 * - "review":  review-phase specialists (code / security / system-arch)
 * - "domain":  domain experts (firmware / hardware / compliance)
 * - "quality": test & verification engineers
 */
export type AgentCategory = "primary" | "design" | "review" | "domain" | "quality";

/**
 * Explicit agent definition — the single source of truth for one agent.
 *
 * Replaces the earlier `Object.assign(factory, { mode, defaultModel })` pattern
 * (which forced `as` assertions because TS cannot statically infer properties
 * attached onto a function). With a plain object, `mode` / `defaultModel` /
 * `category` flow through the type system without any assertion.
 *
 * `factory` is still a function so the prompt is loaded lazily at build time
 * (prompts live in `agents/<name>.md` and are read by `loadPrompt`).
 */
export interface AgentDef {
  /** Builds the AgentConfig for a given model. Prompt is loaded here. */
  factory: (model: string) => AgentConfig;
  mode: AgentMode;
  defaultModel: string;
  category: AgentCategory;
}

/** User-tunable per-agent overrides loaded from JSONC config. */
export interface AgentOverride {
  model?: string;
  disable?: boolean;
}
