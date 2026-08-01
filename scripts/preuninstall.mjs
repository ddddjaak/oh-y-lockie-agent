#!/usr/bin/env node
// oh-y-lockie-agent preuninstall — clean MCP entries + user config on uninstall
//
// 清理必须清理的：
// - MCP 条目 → 需要清理（写入 opencode.json 的）
// - oh-y-lockie-agent.jsonc → 用户级配置模板（postinstall 生成的），卸载时移除
//
// 不需要清理的（从未复制 / 由 config hook 注入，无残留文件）：
// - agents/ → config hook 注入，不残留文件
// - skills/ → 从插件目录读取，不残留文件
// - references/ → 从插件目录读取，不残留文件
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_CONFIG = join(OPENCODE_DIR, "opencode.json");
const USER_CONFIG = join(OPENCODE_DIR, "oh-y-lockie-agent.jsonc");

/** MCP 键名从 config/mcp-servers.json 派生，与 postinstall/setup-mcp 共享单源 */
let MCP_KEYS = [];
try {
  MCP_KEYS = Object.keys(
    JSON.parse(readFileSync(join(PKG_ROOT, "config", "mcp-servers.json"), "utf-8")),
  );
} catch (e) {
  // 兜底：读取失败时退回历史硬编码列表，保证卸载清理不失效
  console.error(`[警告] 读取 config/mcp-servers.json: ${e.message}`);
  MCP_KEYS = ["codegraph", "context7", "memory", "sequential-thinking"];
}

/** 原子写 JSON（与 src/mcp.ts / postinstall.mjs 一致） */
function atomicWriteJson(filePath, data) {
  const tmp = filePath + ".tmp";
  const bak = filePath + ".bak";
  if (existsSync(filePath)) {
    copyFileSync(filePath, bak);
  }
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

console.log("[oh-y-lockie-agent] preuninstall: 开始清理...");

// ─── 清理 MCP 条目 ──────────────────────────────────────────────
console.log("\n  --- 清理 opencode.json MCP 条目 ---");
if (existsSync(OPENCODE_CONFIG)) {
  try {
    const config = JSON.parse(readFileSync(OPENCODE_CONFIG, "utf-8"));
    if (config.mcp) {
      let removed = 0;
      for (const key of MCP_KEYS) {
        if (key in config.mcp) { delete config.mcp[key]; removed++; }
      }
      if (removed > 0) {
        atomicWriteJson(OPENCODE_CONFIG, config);
        console.log(`  [删除] 已从 opencode.json 移除 ${removed} 个 MCP 条目`);
      } else {
        console.log(`  [跳过] opencode.json 中未找到插件 MCP 条目`);
      }
    }
  } catch (e) {
    console.error(`  [警告] 无法清理 opencode.json MCP: ${e.message}`);
  }
}

// ─── 清理用户级配置模板 ─────────────────────────────────────────
console.log("\n  --- 清理用户级配置模板 ---");
if (existsSync(USER_CONFIG)) {
  try {
    // 删除用户自定义配置前先备份，防误删（.bak 可手动回滚）
    copyFileSync(USER_CONFIG, USER_CONFIG + ".bak");
    rmSync(USER_CONFIG);
    console.log(`  [删除] 已移除 ${USER_CONFIG}（备份在 ${USER_CONFIG}.bak）`);
  } catch (e) {
    console.error(`  [警告] 无法移除用户配置模板: ${e.message}`);
  }
} else {
  console.log(`  [跳过] 用户配置模板不存在: ${USER_CONFIG}`);
}

console.log("\n[oh-y-lockie-agent] preuninstall: 完成");
console.log("[oh-y-lockie-agent] 提示: agents/skills 通过 config hook 注入，卸载后自动消失");
