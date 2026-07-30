/**
 * Config loader for oh-y-lockie-agent.
 *
 * Loads user-tunable agent overrides (model / disable) and MCP definitions from
 * oh-y-lockie-agent.jsonc with the following priority chain (highest first):
 *   1. {project}/.opencode/oh-y-lockie-agent.jsonc          (project-level)
 *   2. ~/.config/opencode/oh-y-lockie-agent.jsonc            (user-level)
 *   3. <plugin>/config/oh-y-lockie-agent.jsonc               (plugin default)
 *
 * Agent *definitions* (prompt / description / mode / color) now live in code
 * under src/agents/. This file only handles what the user is meant to tune.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parse, ParseError } from "jsonc-parser";
import type { AgentOverride } from "./agents/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const CONFIG_FILENAME = "oh-y-lockie-agent.jsonc";

/** Shape of the loaded plugin config. */
export interface PluginConfig {
  /** User-tunable per-agent overrides (model / disable). */
  overrides: Record<string, AgentOverride>;
  /** MCP server definitions to inject. */
  mcp: Record<string, unknown>;
}

// ─── Config chain ────────────────────────────────────────────────

/** Load a single jsonc file and return parsed config, or null. */
function loadJsoncFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const errors: ParseError[] = [];
    const result = parse(raw, errors);
    if (errors.length > 0) {
      console.error(`[oh-y-lockie-agent] config parse errors in ${filePath}:`, errors);
      return null;
    }
    return result as Record<string, unknown>;
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
 *            If provided, checks cwd/.opencode/ and ancestors for the config.
 */
export function loadPluginConfig(cwd?: string): PluginConfig {
  // 1. Load plugin default
  const defaultPath = join(PKG_ROOT, "config", CONFIG_FILENAME);
  const defaultCfg = loadJsoncFile(defaultPath);

  let overrides: Record<string, AgentOverride> =
    (defaultCfg?.agent as Record<string, AgentOverride>) || {};
  const mcpConfig: Record<string, unknown> =
    (defaultCfg?.mcp as Record<string, unknown>) || {};

  // 2. Attempt user-level override
  const userPath = join(homedir(), ".config", "opencode", CONFIG_FILENAME);
  const userCfg = loadJsoncFile(userPath);
  if (userCfg) {
    overrides = mergeOverrides(
      overrides,
      (userCfg.agent || {}) as Record<string, AgentOverride>,
    );
    for (const [k, v] of Object.entries((userCfg.mcp || {}) as Record<string, unknown>)) {
      mcpConfig[k] = v;
    }
    console.log(`[oh-y-lockie-agent] user config loaded: ${userPath}`);
  }

  // 3. Attempt project-level override (if cwd provided)
  if (cwd) {
    const projectPath = join(cwd, ".opencode", CONFIG_FILENAME);
    const projectCfg = loadJsoncFile(projectPath);
    if (projectCfg) {
      overrides = mergeOverrides(
        overrides,
        (projectCfg.agent || {}) as Record<string, AgentOverride>,
      );
      for (const [k, v] of Object.entries((projectCfg.mcp || {}) as Record<string, unknown>)) {
        mcpConfig[k] = v;
      }
      console.log(`[oh-y-lockie-agent] project config loaded: ${projectPath}`);
    }
  }

  return { overrides, mcp: mcpConfig };
}
