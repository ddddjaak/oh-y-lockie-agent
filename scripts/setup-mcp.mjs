#!/usr/bin/env node
// oh-y-lockie-agent setup-mcp — 将规范 MCP 服务器注入 opencode.json
// 使用方式: node scripts/setup-mcp.mjs
// 或: npm run setup-mcp
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_CONFIG_PATH = join(OPENCODE_DIR, "opencode.json");

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

function main() {
  console.log("[oh-y-lockie-agent] setup-mcp: 开始配置 MCP 服务器...");

  if (!existsSync(OPENCODE_CONFIG_PATH)) {
    console.error(`[错误] opencode.json 不存在: ${OPENCODE_CONFIG_PATH}`);
    console.log(`请先安装 OpenCode 并运行一次后，再执行此命令。`);
    process.exit(1);
  }

  try {
    const raw = readFileSync(OPENCODE_CONFIG_PATH, "utf-8");
    let config = JSON.parse(raw);

    // 确保 mcp 段存在
    if (!config.mcp) config.mcp = {};

    const mcpTarget = config.mcp;

    let added = 0;
    let skipped = 0;
    for (const [name, def] of Object.entries(CANONICAL_MCP_SERVERS)) {
      if (name in mcpTarget) {
        console.log(`  [跳过] ${name} — 已存在`);
        skipped++;
      } else {
        mcpTarget[name] = def;
        console.log(`  [添加] ${name} — ${def.command.join(" ")}`);
        added++;
      }
    }

    writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    console.log(`\n[完成] 新增 ${added} 个 MCP 服务器，跳过 ${skipped} 个已有配置`);
    console.log(`配置文件: ${OPENCODE_CONFIG_PATH}`);
    console.log(`\n请重启 OpenCode 以加载新的 MCP 服务器。`);
  } catch (e) {
    console.error(`[失败] ${e.message}`);
    process.exit(1);
  }
}

main();
