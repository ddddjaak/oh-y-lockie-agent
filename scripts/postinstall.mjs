#!/usr/bin/env node
// oh-y-lockie-agent postinstall — setup MCP on npm install
//
// 设计原则：尽量不污染 ~/.config/opencode/
// - commands/   → 已移除（能力改由 skill + 自然语言路由提供，无需 slash 命令）
// - agents/   → 不复制（config hook 注入 inline prompt）
// - skills/   → 不复制（路由系统从插件目录读取）
// - references/ → 不复制（文档，用户可从插件目录访问）
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCODE_DIR = join(homedir(), ".config", "opencode");

console.log("[oh-y-lockie-agent] postinstall: 开始配置...");

try {
  // ─── MCP 服务器注入 ─────────────────────────────────────────────
  console.log("[oh-y-lockie-agent] 检查 MCP 服务器配置...");
  const openCodeConfigPath = join(OPENCODE_DIR, "opencode.json");

  /** 纯 MCP 命令定义（不含平台包装） */
  const MCP_COMMANDS = {
    codegraph: ["codegraph", "serve", "--mcp"],
    context7: ["npx", "-y", "@upstash/context7-mcp"],
    memory: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    "sequential-thinking": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
  };

  /** 跨平台适配：Windows 上需要 cmd /c 前缀 */
  const isWin = process.platform === "win32";
  const platformCmd = (cmd) => (isWin && cmd[0] !== "cmd" ? ["cmd", "/c", ...cmd] : cmd);

  /** 规范 MCP 服务器列表（带平台适配） */
  const CANONICAL_MCP_SERVERS = Object.fromEntries(
    Object.entries(MCP_COMMANDS).map(([name, cmd]) => [
      name,
      { type: "local", command: platformCmd(cmd), enabled: true },
    ]),
  );

  if (existsSync(openCodeConfigPath)) {
    try {
      const raw = readFileSync(openCodeConfigPath, "utf-8");
      let config = JSON.parse(raw);

      // 确保 mcp 段存在
      if (!config.mcp) config.mcp = {};

      // 只添加缺失的 MCP 服务器
      let addedCount = 0;
      for (const [name, def] of Object.entries(CANONICAL_MCP_SERVERS)) {
        if (!(name in config.mcp)) {
          config.mcp[name] = def;
          addedCount++;
        }
      }

      if (addedCount > 0) {
        writeFileSync(openCodeConfigPath, JSON.stringify(config, null, 2), "utf-8");
        console.log(`  [OK] 已添加 ${addedCount} 个 MCP 服务器到 ${openCodeConfigPath}`);
      } else {
        console.log(`  [OK] 所有 MCP 服务器已在 ${openCodeConfigPath} 中`);
      }
    } catch (e) {
      console.error(`  [失败] 更新 opencode.json MCP 段: ${e.message}`);
    }
  } else {
    console.log(`  [跳过] opencode.json 不存在于 ${openCodeConfigPath}`);
  }

  console.log("[oh-y-lockie-agent] postinstall: 完成");
  console.log("[oh-y-lockie-agent] 提示: agents/skills 通过插件 config hook 注入，无需复制到 ~/.config/opencode/");
} catch (e) {
  console.error(`[oh-y-lockie-agent] postinstall 失败: ${e.message}`);
  // Don't fail npm install — plugin still works via config hook
  process.exit(0);
}
