/**
 * Config loader for oh-y-lockie-agent.
 *
 * Loads user-tunable agent overrides (model / disable), MCP definitions, and
 * the embedded-domain target context from oh-y-lockie-agent.jsonc with the
 * following priority chain (highest first):
 *   1. {project}/.opencode/oh-y-lockie-agent.jsonc          (project-level)
 *   2. ~/.config/opencode/oh-y-lockie-agent.jsonc            (user-level)
 *   3. <plugin>/config/oh-y-lockie-agent.jsonc               (plugin default)
 *
 * All config is validated against PluginConfigSchema (zod) at load time —
 * bad configs (typos, wrong types) fail fast with a precise error instead of
 * silently producing undefined behavior. No `as` assertions remain: the schema
 * is the single source of truth for the config shape.
 *
 * Agent *definitions* (prompt / description / mode / color) live in code under
 * src/agents/. This file only handles what the user is meant to tune.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parse, ParseError } from "jsonc-parser";
import type { AgentOverride } from "./agents/types.js";
import {
  validatePluginConfig,
  type PluginConfigParsed,
  type McpServerParsed,
  type TargetContext,
  type UpdateCheckParsed,
} from "./config-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const CONFIG_FILENAME = "oh-y-lockie-agent.jsonc";

/** Shape of the loaded plugin config (all fields schema-validated). */
export interface PluginConfig {
  /** User-tunable per-agent overrides (model / disable). */
  overrides: Record<string, AgentOverride>;
  /** MCP server definitions to inject. */
  mcp: Record<string, McpServerParsed>;
  /** Embedded-domain target chip context (optional, reserved). */
  target?: TargetContext;
  /** Route telemetry toggle (undefined = default on). */
  telemetry?: boolean;
  /** Update-notification settings (undefined = defaults). */
  updateCheck?: UpdateCheckParsed;
}

// ─── Config chain ────────────────────────────────────────────────

/**
 * Load and schema-validate a single jsonc config file.
 *
 * Returns the typed parsed config, or null if the file is missing, fails to
 * parse as JSONC, or fails schema validation. Schema errors are logged with
 * the offending field path so users can fix typos like "modle" → "model".
 */
function loadJsoncFile(filePath: string): PluginConfigParsed | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const errors: ParseError[] = [];
    const result = parse(raw, errors);
    if (errors.length > 0) {
      console.error(`[oh-y-lockie-agent] config parse errors in ${filePath}:`, errors);
      return null;
    }
    const validation = validatePluginConfig(result, filePath);
    if (!validation.success) {
      console.error(validation.error);
      return null;
    }
    for (const w of validation.warnings) {
      console.warn(`[oh-y-lockie-agent] ${w}`);
    }
    return validation.data ?? null;
  } catch (err) {
    console.error(`[oh-y-lockie-agent] failed to load config ${filePath}:`, err);
    return null;
  }
}

/** Shallow-merge per-key agent overrides (user/project override base). */
function mergeOverrides(
  base: Record<string, AgentOverride>,
  override: Record<string, AgentOverride>,
): Record<string, AgentOverride> {
  const merged: Record<string, AgentOverride> = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val && typeof val === "object") {
      merged[key] = { ...(merged[key] || {}), ...val };
    } else {
      merged[key] = val;
    }
  }
  return merged;
}

/**
 * Load the plugin config by walking the priority chain.
 *
 * @param cwd Optional working directory for project-level config discovery.
 *            If provided, checks cwd/.opencode/ for the config.
 */
export function loadPluginConfig(cwd?: string): PluginConfig {
  // 1. Load plugin default
  const defaultPath = join(PKG_ROOT, "config", CONFIG_FILENAME);
  const defaultCfg = loadJsoncFile(defaultPath);

  let overrides: Record<string, AgentOverride> = defaultCfg?.agent ?? {};
  const mcpConfig: Record<string, McpServerParsed> = { ...(defaultCfg?.mcp ?? {}) };
  let target: TargetContext | undefined = defaultCfg?.target;
  let updateCheck: UpdateCheckParsed | undefined = defaultCfg?.updateCheck;

  // 2. Attempt user-level override
  const userPath = join(homedir(), ".config", "opencode", CONFIG_FILENAME);
  const userCfg = loadJsoncFile(userPath);
  if (userCfg) {
    if (userCfg.agent) {
      overrides = mergeOverrides(overrides, userCfg.agent);
    }
    if (userCfg.mcp) {
      for (const [k, v] of Object.entries(userCfg.mcp)) {
        mcpConfig[k] = v;
      }
    }
    if (userCfg.target) {
      target = { ...(target ?? {}), ...userCfg.target };
    }
    if (userCfg.updateCheck) {
      updateCheck = { ...(updateCheck ?? {}), ...userCfg.updateCheck };
    }
    console.log(`[oh-y-lockie-agent] user config loaded: ${userPath}`);
  }

  // 3. Attempt project-level override (if cwd provided)
  // Telemetry: project config wins over user over default. undefined = default on.
  let telemetry: boolean | undefined = defaultCfg?.telemetry;
  if (userCfg?.telemetry !== undefined) telemetry = userCfg.telemetry;
  if (cwd) {
    const projectPath = join(cwd, ".opencode", CONFIG_FILENAME);
    const projectCfg = loadJsoncFile(projectPath);
    if (projectCfg) {
      if (projectCfg.agent) {
        overrides = mergeOverrides(overrides, projectCfg.agent);
      }
      if (projectCfg.mcp) {
        for (const [k, v] of Object.entries(projectCfg.mcp)) {
          mcpConfig[k] = v;
        }
      }
      if (projectCfg.target) {
        target = { ...(target ?? {}), ...projectCfg.target };
      }
      if (projectCfg.telemetry !== undefined) telemetry = projectCfg.telemetry;
      if (projectCfg.updateCheck) {
        updateCheck = { ...(updateCheck ?? {}), ...projectCfg.updateCheck };
      }
      console.log(`[oh-y-lockie-agent] project config loaded: ${projectPath}`);
    }
  }

  return { overrides, mcp: mcpConfig, target, telemetry, updateCheck };
}
