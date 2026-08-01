#!/usr/bin/env node
// oh-y-lockie-agent postinstall — setup MCP on npm install
//
// 设计原则：最小侵入 ~/.config/opencode/
// - oh-y-lockie-agent.jsonc → 首次安装时自动生成配置模板（不覆盖已有文件）
// - commands/   → 已移除（能力改由 skill + 自然语言路由提供，无需 slash 命令）
// - agents/   → 不复制（config hook 注入 inline prompt）
// - skills/   → 不复制（路由系统从插件目录读取）
// - references/ → 不复制（文档，用户可从插件目录访问）
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const OPENCODE_DIR = join(homedir(), ".config", "opencode");

/**
 * 原子写 JSON:写 tmp → 备份 .bak → rename(原子)。
 *
 * 直接 writeFileSync 覆盖用户 opencode.json 在写一半被中断时会损坏配置。
 * 此流程保证:① 目标文件要么是完整的旧内容(.bak 还在、目标未替换),
 * ② 要么是完整的新内容(rename 原子完成)。.tmp 残留可清理,.bak 供手动回滚。
 *
 * 与 src/mcp.ts 的 atomicWriteJson 保持逻辑一致(跨 TS/mjs 共享语义)。
 */
function atomicWriteJson(filePath, data) {
  const tmp = filePath + ".tmp";
  const bak = filePath + ".bak";
  if (existsSync(filePath)) {
    copyFileSync(filePath, bak);
  }
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);  // Node rename 在两平台都原子替换已存在目标
}

console.log("[oh-y-lockie-agent] postinstall: 开始配置...");

try {
  // ─── MCP 服务器注入 ─────────────────────────────────────────────
  console.log("[oh-y-lockie-agent] 检查 MCP 服务器配置...");
  const openCodeConfigPath = join(OPENCODE_DIR, "opencode.json");

  /** 纯 MCP 命令定义（不含平台包装）— 从 config/mcp-servers.json 读取
   *  与 src/mcp.ts 共享同一份 JSON 单源，避免两处硬编码漂移。
   *  读取失败时回退到内置列表（与 preuninstall 一致），绝不让 npm install
   *  静默注入 0 个 MCP 服务器。 */
  const FALLBACK_MCP_SERVERS = {
    codegraph: ["codegraph", "serve", "--mcp"],
    context7: ["npx", "-y", "@upstash/context7-mcp"],
    memory: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    "sequential-thinking": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
  };
  let MCP_COMMANDS = FALLBACK_MCP_SERVERS;
  try {
    MCP_COMMANDS = JSON.parse(readFileSync(join(PKG_ROOT, "config", "mcp-servers.json"), "utf-8"));
  } catch (e) {
    console.error(`  [失败] 读取 config/mcp-servers.json，使用内置回退: ${e.message}`);
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
        atomicWriteJson(openCodeConfigPath, config);
        console.log(`  [OK] 已添加 ${addedCount} 个 MCP 服务器到 ${openCodeConfigPath}(原子写,备份 .bak)`);
      } else {
        console.log(`  [OK] 所有 MCP 服务器已在 ${openCodeConfigPath} 中`);
      }
    } catch (e) {
      console.error(`  [失败] 更新 opencode.json MCP 段: ${e.message}`);
    }
  } else {
    console.log(`  [跳过] opencode.json 不存在于 ${openCodeConfigPath}`);
  }

  // ─── 用户级配置模板生成 ──────────────────────────────────────────
  // 安装时自动生成一份可编辑的用户级配置模板到 ~/.config/opencode/，
  // 让用户知道去哪儿改 subagent 模型。已有文件不覆盖。
  console.log("[oh-y-lockie-agent] 检查用户级配置模板...");
  const userConfigPath = join(OPENCODE_DIR, "oh-y-lockie-agent.jsonc");
  if (existsSync(userConfigPath)) {
    console.log(`  [OK] 用户配置已存在: ${userConfigPath}（不覆盖）`);
  } else {
    try {
      mkdirSync(OPENCODE_DIR, { recursive: true });
      const defaultConfigPath = join(PKG_ROOT, "config", "oh-y-lockie-agent.jsonc");
      copyFileSync(defaultConfigPath, userConfigPath);
      console.log(`  [OK] 已生成用户配置模板: ${userConfigPath}`);
      console.log(`  [提示] 编辑此文件可修改各 subagent 的模型，详见文件内注释。`);
    } catch (e) {
      console.error(`  [失败] 生成用户配置模板: ${e.message}`);
    }
  }

  console.log("[oh-y-lockie-agent] postinstall: 完成");
  console.log("[oh-y-lockie-agent] 提示: agents/skills 通过插件 config hook 注入，无需复制到 ~/.config/opencode/");
} catch (e) {
  console.error(`[oh-y-lockie-agent] postinstall 失败: ${e.message}`);
  // Don't fail npm install — plugin still works via config hook
  process.exit(0);
}
