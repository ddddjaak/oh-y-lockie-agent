#!/usr/bin/env node
// oh-y-lockie-agent preuninstall — clean MCP entries on uninstall
//
// 只清理必须清理的：
// - MCP 条目 → 需要清理（写入 opencode.json 的）
//
// 不需要清理的（从未复制 / 由 config hook 注入，无残留文件）：
// - commands/ → 已移除（能力改由 skill + 自然语言路由提供）
// - agents/ → config hook 注入，不残留文件
// - skills/ → 从插件目录读取，不残留文件
// - references/ → 从插件目录读取，不残留文件
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_CONFIG = join(OPENCODE_DIR, "opencode.json");

console.log("[oh-y-lockie-agent] preuninstall: 开始清理...");

// ─── 清理 MCP 条目 ──────────────────────────────────────────────
console.log("\n  --- 清理 opencode.json MCP 条目 ---");
if (existsSync(OPENCODE_CONFIG)) {
  try {
    const config = JSON.parse(readFileSync(OPENCODE_CONFIG, "utf-8"));
    if (config.mcp) {
      const MCP_KEYS = ["codegraph", "context7", "memory", "sequential-thinking"];
      let removed = 0;
      for (const key of MCP_KEYS) {
        if (key in config.mcp) { delete config.mcp[key]; removed++; }
      }
      if (removed > 0) {
        writeFileSync(OPENCODE_CONFIG, JSON.stringify(config, null, 2), "utf-8");
        console.log(`  [删除] 已从 opencode.json 移除 ${removed} 个 MCP 条目`);
      } else {
        console.log(`  [跳过] opencode.json 中未找到插件 MCP 条目`);
      }
    }
  } catch (e) {
    console.error(`  [警告] 无法清理 opencode.json MCP: ${e.message}`);
  }
}

console.log("\n[oh-y-lockie-agent] preuninstall: 完成");
console.log("[oh-y-lockie-agent] 提示: agents/skills 通过 config hook 注入，卸载后自动消失");
