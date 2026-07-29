/**
 * Config loader for oh-y-lockie-agent.
 *
 * Loads agent and MCP definitions from oh-y-lockie-agent.jsonc with
 * the following priority chain (highest first):
 *   1. {project}/.opencode/oh-y-lockie-agent.jsonc          (project-level)
 *   2. ~/.config/opencode/oh-y-lockie-agent.jsonc            (user-level)
 *   3. <plugin>/config/oh-y-lockie-agent.jsonc               (plugin default)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parse, ParseError } from "jsonc-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

const CONFIG_FILENAME = "oh-y-lockie-agent.jsonc";

/** Shape of an agent definition in the config file. */
export interface AgentDef {
  color?: string;
  description?: string;
  mode?: "primary" | "subagent";
  model?: string;
  prompt?: string;
  prompt_file?: string;
  temperature?: number;
  disable?: boolean;
}

/** Shape of the loaded plugin config. */
export interface PluginConfig {
  agent: Record<string, AgentDef>;
  mcp: Record<string, unknown>;
}

// ─── Config chain ────────────────────────────────────────────────

/** Resolve the config search paths in priority order. */
function configSearchPaths(): string[] {
  const paths: string[] = [];

  // 1. Plugin default (lowest priority)
  paths.push(join(PKG_ROOT, "config", CONFIG_FILENAME));

  // 2. User-level override
  paths.push(join(homedir(), ".config", "opencode", CONFIG_FILENAME));

  // 3. Project-level override (highest among files — determined at call time)
  //    Caller passes cwd; try to find .opencode/ in or above it.
  //    We don't resolve this here; the caller provides the cwd.

  return paths;
}

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

/** Deep-merge override into base for `agent` entries. */
function mergeAgentConfigs(
  base: Record<string, AgentDef>,
  override: Record<string, AgentDef>,
): Record<string, AgentDef> {
  const merged: Record<string, AgentDef> = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val && typeof val === "object") {
      // Shallow merge: override fields, keep base fields if not overridden
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

  let agentConfig: Record<string, AgentDef> =
    (defaultCfg?.agent as Record<string, AgentDef>) || {};
  const mcpConfig: Record<string, unknown> =
    (defaultCfg?.mcp as Record<string, unknown>) || {};

  // 2. Attempt user-level override
  const userPath = join(homedir(), ".config", "opencode", CONFIG_FILENAME);
  const userCfg = loadJsoncFile(userPath);
  if (userCfg) {
    const userAgent = (userCfg.agent || {}) as Record<string, AgentDef>;
    agentConfig = mergeAgentConfigs(agentConfig, userAgent);
    // MCP: user overrides take priority per-key
    const userMCP = (userCfg.mcp || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(userMCP)) {
      mcpConfig[k] = v;
    }
    console.log(`[oh-y-lockie-agent] user config loaded: ${userPath}`);
  }

  // 3. Attempt project-level override (if cwd provided)
  if (cwd) {
    const projectPath = join(cwd, ".opencode", CONFIG_FILENAME);
    const projectCfg = loadJsoncFile(projectPath);
    if (projectCfg) {
      const projectAgent = (projectCfg.agent || {}) as Record<string, AgentDef>;
      agentConfig = mergeAgentConfigs(agentConfig, projectAgent);
      const projectMCP = (projectCfg.mcp || {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(projectMCP)) {
        mcpConfig[k] = v;
      }
      console.log(`[oh-y-lockie-agent] project config loaded: ${projectPath}`);
    }
  }

  return { agent: agentConfig, mcp: mcpConfig };
}

/** Get the list of active agent names from the loaded config (excludes disabled). */
export function getActiveAgentKeys(agentConfig: Record<string, AgentDef>): string[] {
  return Object.entries(agentConfig)
    .filter(([_, def]) => !def.disable)
    .map(([key, _]) => key);
}

/** Build the lockieListAgentsTool's category map from the config. */
export function buildAgentCategoryMap(agentConfig: Record<string, AgentDef>): Record<string, string[]> {
  const primary: string[] = [];
  const design: string[] = [];
  const review: string[] = [];
  const domain: string[] = [];
  const quality: string[] = [];

  for (const [key, def] of Object.entries(agentConfig)) {
    if (def.disable) continue;
    if (def.mode === "primary") {
      primary.push(key);
      continue;
    }
    // Categorize by description keywords
    const desc = (def.description || "").toLowerCase();
    if (desc.includes("电源") || desc.includes("启动") || desc.includes("内存") ||
        desc.includes("固件架构") || desc.includes("时序") || desc.includes("寄存器")) {
      design.push(key);
    } else if (desc.includes("代码") || desc.includes("安全审计") || desc.includes("架构审查")) {
      review.push(key);
    } else if (desc.includes("领域") || desc.includes("合规")) {
      domain.push(key);
    } else if (desc.includes("测试") || desc.includes("验证")) {
      quality.push(key);
    } else {
      // Fallback: add to design
      design.push(key);
    }
  }

  return { primary, design, review, domain, quality };
}

/** Get agent keys for logging/filtering. */
export function getAgentKeys(agentConfig: Record<string, AgentDef>): string[] {
  return Object.keys(agentConfig);
}
