/**
 * MCP 配置管理模块
 *
 * 提供插件所需的 MCP 服务器定义，以及安装/运行时注入工具。
 * 遵循 oh-my-openagent-dev 的三层 MCP 体系：
 *   Tier 1: Built-in MCPs（插件 config hook 注入 cfg.mcp）
 *   Tier 2: .mcp.json（Claude Code 格式，静态声明）
 *   Tier 3: Skill-embedded（按需加载）
 *
 * 由于 OpenCode 的 MCP 服务生命周期在 config hook 之前初始化，
 * 最可靠的 MCP 配置方式是将 MCP 写入 opencode.json 的静态声明。
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parse, ParseError } from "jsonc-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

// ─── 规范 MCP 定义 ────────────────────────────────────────────────

/** 单个 MCP 服务器配置（OpenCode 格式） */
export interface McpServerDef {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  enabled?: boolean;
}

/**
 * Load the canonical MCP server commands from `config/mcp-servers.json`.
 *
 * This JSON file is the SINGLE SOURCE OF TRUTH for the bare MCP commands —
 * both this module (TS, runtime) and `scripts/postinstall.mjs` (mjs, install
 * time) read it. Previously each maintained its own hardcoded copy, which
 * silently drifted when only one side was updated.
 *
 * @returns Map of server name -> bare command tokens (no platform wrapping).
 */
function loadMcpCommands(): Record<string, string[]> {
  const jsonPath = join(PKG_ROOT, "config", "mcp-servers.json");
  try {
    const raw = readFileSync(jsonPath, "utf-8");
    return JSON.parse(raw) as Record<string, string[]>;
  } catch (err) {
    // Non-fatal: callers tolerate an empty map, but we log so a missing or
    // corrupt JSON doesn't make every MCP server silently disappear.
    console.error(`[oh-y-lockie-agent] failed to load ${jsonPath}:`, err);
    return {};
  }
}

const MCP_COMMANDS = loadMcpCommands();

/**
 * Canonical MCP server definitions (pure commands, no platform wrapping).
 *
 * Built from `config/mcp-servers.json` so the command tokens live in exactly
 * one place. Platform adaptation (cmd /c on Windows) is applied later by
 * {@link getPlatformCommand} / {@link getCanonicalMcpServers}.
 */
export const CANONICAL_MCP_SERVERS: Record<string, McpServerDef> = Object.fromEntries(
  Object.entries(MCP_COMMANDS).map(([name, command]) => [
    name,
    { type: "local", command, enabled: true },
  ]),
);

/** MCP 服务器在 Windows 上的命令（用 cmd /c 包装） */
const WIN_CMD_PREFIX = ["cmd", "/c"];

/**
 * 根据平台返回适配的 MCP 命令。
 * Windows 上需要 cmd /c 前缀来执行 .cmd/.ps1 文件。
 */
export function getPlatformCommand(baseCommand: string[], isWin: boolean): string[] {
  if (isWin && !baseCommand[0].startsWith("cmd")) {
    return [...WIN_CMD_PREFIX, ...baseCommand];
  }
  return baseCommand;
}

/**
 * 获取适合当前平台的规范 MCP 服务器列表。
 */
export function getCanonicalMcpServers(): Record<string, McpServerDef> {
  const isWin = process.platform === "win32";
  const servers: Record<string, McpServerDef> = {};

  for (const [name, def] of Object.entries(CANONICAL_MCP_SERVERS)) {
    if (def.type === "local" && def.command) {
      servers[name] = {
        ...def,
        command: getPlatformCommand(def.command, isWin),
      };
    } else {
      servers[name] = { ...def };
    }
  }

  return servers;
}

// ─── opencode.json MCP 注入工具 ───────────────────────────────────

/** opencode.json 的路径 */
export function getOpenCodeConfigPath(): string {
  return join(homedir(), ".config", "opencode", "opencode.json");
}

/**
 * 读取用户当前的 opencode.json 配置。
 */
export function readOpenCodeConfig(): Record<string, unknown> | null {
  const configPath = getOpenCodeConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    const errors: ParseError[] = [];
    const result = parse(raw, errors);
    if (errors.length > 0) {
      console.error(`[oh-y-lockie-agent] opencode.json parse errors:`, errors);
      return null;
    }
    return result as Record<string, unknown>;
  } catch (err) {
    console.error(`[oh-y-lockie-agent] failed to read opencode.json:`, err);
    return null;
  }
}

/**
 * 检查用户 opencode.json 中已配置了哪些 MCP 服务器。
 * 返回缺失的规范 MCP 服务器列表。
 */
export function getMissingMcpServers(
  userConfig: Record<string, unknown> | null,
): Record<string, McpServerDef> {
  const canonical = getCanonicalMcpServers();
  const existing: Record<string, unknown> =
    (userConfig?.mcp as Record<string, unknown>) || {};

  const missing: Record<string, McpServerDef> = {};
  for (const [name, def] of Object.entries(canonical)) {
    if (!(name in existing)) {
      missing[name] = def;
    }
  }
  return missing;
}

/**
 * 将缺失的 MCP 服务器写入 opencode.json。
 *
 * 注意：此操作会丢失原文件的注释和格式。
 * JSONC 的注释在解析时已被丢弃，写回的是标准 JSON。
 *
 * @returns 写入的 MCP 服务器数量
 */
/**
 * 原子写 JSON:写 tmp → 备份 .bak → rename(原子)。
 *
 * 直接 writeFileSync 覆盖用户 opencode.json 在写一半被中断时会损坏配置。
 * 此流程保证:① 目标文件要么是完整的旧内容(.bak 还在、目标未替换),
 * ② 要么是完整的新内容(rename 原子完成)。.tmp 残留可清理,.bak 供手动回滚。
 *
 * 与 scripts/postinstall.mjs 的 atomicWriteJson 保持逻辑一致(跨 TS/mjs 共享语义)。
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = filePath + ".tmp";
  const bak = filePath + ".bak";
  if (existsSync(filePath)) {
    copyFileSync(filePath, bak);
  }
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);  // Node rename 在两平台都原子替换已存在目标
}

export function injectMcpToOpenCodeConfig(): number {
  const configPath = getOpenCodeConfigPath();
  const userConfig = readOpenCodeConfig();

  if (!userConfig) {
    console.error("[oh-y-lockie-agent] opencode.json 不存在或解析失败，跳过 MCP 注入");
    return 0;
  }

  const missing = getMissingMcpServers(userConfig);

  if (Object.keys(missing).length === 0) {
    console.log("[oh-y-lockie-agent] 所有 MCP 服务器已在 opencode.json 中");
    return 0;
  }

  // 构建新的 MCP 配置
  const existingMcp =
    (userConfig?.mcp as Record<string, unknown>) || {};
  const mergedMcp = { ...existingMcp };

  for (const [name, def] of Object.entries(missing)) {
    mergedMcp[name] = def;
  }

  // 写回（需要保留原有所有字段，如 provider）
  const updatedConfig = {
    ...userConfig,
    mcp: mergedMcp,
  };

  try {
    atomicWriteJson(configPath, updatedConfig);
    const names = Object.keys(missing).join(", ");
    console.log(`[oh-y-lockie-agent] 已添加 MCP 服务器到 opencode.json: ${names}(原子写,备份 .bak)`);
    return Object.keys(missing).length;
  } catch (err) {
    console.error(`[oh-y-lockie-agent] 写入 opencode.json 失败:`, err);
    // 清理残留的 .tmp(若 rename 前失败)
    return 0;
  }
}

/**
 * 检查 MCP 配置状态并返回诊断信息。
 */
export function diagnoseMcpStatus(): {
  configured: string[];
  missing: string[];
} {
  const userConfig = readOpenCodeConfig();
  const existing: Record<string, unknown> =
    (userConfig?.mcp as Record<string, unknown>) || {};
  const canonical = getCanonicalMcpServers();

  const configured: string[] = [];
  const missing: string[] = [];

  for (const name of Object.keys(canonical)) {
    if (name in existing) {
      configured.push(name);
    } else {
      missing.push(name);
    }
  }

  return { configured, missing };
}
