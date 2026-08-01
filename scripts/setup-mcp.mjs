#!/usr/bin/env node
// oh-y-lockie-agent setup-mcp — 将规范 MCP 服务器注入 opencode.json
// 使用方式: node scripts/setup-mcp.mjs  或  npm run setup-mcp
//
// 与 postinstall.mjs 共享同一份单源: config/mcp-servers.json
// 原子写保证中断时不会损坏用户 opencode.json（与 src/mcp.ts 语义一致）。
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_CONFIG_PATH = join(OPENCODE_DIR, "opencode.json");

/** 纯 MCP 命令定义（不含平台包装）— 从 config/mcp-servers.json 读取，
 *  与 postinstall.mjs / src/mcp.ts 共享同一份 JSON 单源，避免硬编码漂移 */
let MCP_COMMANDS = {};
try {
  MCP_COMMANDS = JSON.parse(readFileSync(join(PKG_ROOT, "config", "mcp-servers.json"), "utf-8"));
} catch (e) {
  console.error(`[失败] 读取 config/mcp-servers.json: ${e.message}`);
  process.exit(1);
}

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

/**
 * 原子写 JSON:写 tmp → 备份 .bak → rename(原子)。
 * 与 postinstall.mjs / src/mcp.ts 的 atomicWriteJson 保持逻辑一致。
 */
function atomicWriteJson(filePath, data) {
  const tmp = filePath + ".tmp";
  const bak = filePath + ".bak";
  if (existsSync(filePath)) {
    copyFileSync(filePath, bak);
  }
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

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

    let added = 0;
    let skipped = 0;
    for (const [name, def] of Object.entries(CANONICAL_MCP_SERVERS)) {
      if (name in config.mcp) {
        console.log(`  [跳过] ${name} — 已存在`);
        skipped++;
      } else {
        config.mcp[name] = def;
        console.log(`  [添加] ${name} — ${def.command.join(" ")}`);
        added++;
      }
    }

    if (added > 0) {
      atomicWriteJson(OPENCODE_CONFIG_PATH, config);
    }
    console.log(`\n[完成] 新增 ${added} 个 MCP 服务器，跳过 ${skipped} 个已有配置`);
    console.log(`配置文件: ${OPENCODE_CONFIG_PATH}`);
    console.log(`\n请重启 OpenCode 以加载新的 MCP 服务器。`);
  } catch (e) {
    console.error(`[失败] ${e.message}`);
    process.exit(1);
  }
}

main();
