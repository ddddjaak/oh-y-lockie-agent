/**
 * Zod schema for oh-y-lockie-agent plugin config.
 *
 * Replaces the previous `as Record<string, AgentOverride>` assertions in
 * config.ts — bad configs (typos, wrong types) now fail at load time with a
 * precise error instead of silently producing undefined behavior at runtime.
 *
 * Embedded-domain specifics:
 *   - `target` reserves chip / family / sdk / toolchain context. This addresses
 *     the "no target chip concept" gap: today every agent gives generic advice
 *     because it doesn't know whether the user works on STM32 vs nRF52 vs
 *     ESP32. The field is optional now; agents can read it once populated.
 *   - Agent keys are checked against KNOWN_AGENT_KEYS with a SOFT warning for
 *     unknown keys — catches typos like "code-reviwer" without blocking custom
 *     agent extension.
 */

import { z } from "zod";
import { agentSources } from "./agents/index.js";

/** Known agent keys: 16 lockie agents + built-in explore/general (disable targets). */
export const KNOWN_AGENT_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(agentSources),
  "explore",
  "general",
]);

// ─── Schemas ────────────────────────────────────────────────────

/** Per-agent override: model swap or disable. */
export const AgentOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
    disable: z.boolean().optional(),
  })
  .strict();

/** MCP server definition (OpenCode format). */
export const McpServerSchema = z
  .object({
    type: z.enum(["local", "remote"]).optional(),
    command: z.array(z.string()).optional(),
    url: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

/**
 * Target chip context — embedded-domain specific.
 *
 * Reserved for future use: when populated, agents can tailor advice to the
 * specific chip family (PLL config differs across CS32 series; register layout
 * differs between Cortex-M and RISC-V). This plugin targets Chipsea chips
 * primarily — fill `chip` with the actual Chipsea part number. Optional now.
 */
export const TargetContextSchema = z
  .object({
    chip: z.string().min(1).optional(), // Chipsea part number, e.g. "CS32F103C8T6"
    family: z.string().min(1).optional(), // e.g. "Cortex-M3", "Cortex-M0+", "RISC-V"
    sdk: z.string().min(1).optional(), // e.g. "Chipsea SDK", "Zephyr"
    toolchain: z.string().min(1).optional(), // e.g. "GCC ARM", "Keil", "IAR"
  })
  .strict();

/**
 * Update-checker settings. Notify-only: never auto-updates (opencode caches
 * the installed package; reinstall is the user's call).
 */
export const UpdateCheckSchema = z
  .object({
    /** Master toggle. Default true. Set false to disable all update checks. */
    enabled: z.boolean().optional(),
    /** Debounce window between registry checks, in hours. Default 24, min 1, max 720 (30 days). */
    intervalHours: z.number().int().min(1).max(720).optional(),
  })
  .strict();

/** Top-level plugin config. strict() rejects unknown top-level keys.
 *  $schema is allowed (JSON Schema standard hint field, unused by the loader). */
export const PluginConfigSchema = z
  .object({
    $schema: z.string().optional(),
    agent: z.record(z.string(), AgentOverrideSchema).optional(),
    mcp: z.record(z.string(), McpServerSchema).optional(),
    target: TargetContextSchema.optional(),
    /** Route telemetry toggle. Default true. When false, no routing events are
     *  written to telemetry-routes.jsonl. Set false for privacy-sensitive envs. */
    telemetry: z.boolean().optional(),
    /** Update-notification settings (npm registry check). */
    updateCheck: UpdateCheckSchema.optional(),
  })
  .strict();

// ─── Types (inferred from schema) ───────────────────────────────

export type AgentOverrideParsed = z.infer<typeof AgentOverrideSchema>;
export type McpServerParsed = z.infer<typeof McpServerSchema>;
export type TargetContext = z.infer<typeof TargetContextSchema>;
export type UpdateCheckParsed = z.infer<typeof UpdateCheckSchema>;
export type PluginConfigParsed = z.infer<typeof PluginConfigSchema>;

// ─── Validation helper ──────────────────────────────────────────

export interface ValidationResult {
  success: boolean;
  data?: PluginConfigParsed;
  error?: string;
  /** Soft warnings (e.g. unknown agent key) — non-blocking. */
  warnings: string[];
}

/**
 * Validate a raw parsed config object against PluginConfigSchema.
 *
 * @param raw      The jsonc-parser output (unknown shape).
 * @param filePath Source path, used in error/warning messages.
 * @returns Typed data on success; precise error message on failure; soft warnings either way.
 */
export function validatePluginConfig(raw: unknown, filePath: string): ValidationResult {
  const warnings: string[] = [];

  const result = PluginConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return {
      success: false,
      error: `[oh-y-lockie-agent] config schema invalid in ${filePath}:\n${issues}`,
      warnings,
    };
  }

  const data = result.data;

  // Soft warning: unknown agent keys (likely typos). Non-blocking — allows
  // custom agent extension, but surfaces "code-reviwer" → "code-reviewer".
  if (data.agent) {
    for (const key of Object.keys(data.agent)) {
      if (!KNOWN_AGENT_KEYS.has(key)) {
        warnings.push(
          `unknown agent key "${key}" in ${filePath} — not one of the 16 built-in agents nor explore/general. ` +
            `If custom, ignore. If typo, see src/agents/definitions.ts.`,
        );
      }
    }
  }

  return { success: true, data, warnings };
}
