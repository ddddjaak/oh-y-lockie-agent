#!/usr/bin/env node
// oh-y-lockie-agent postinstall — copy static files on npm install
import { cpSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const AGENTS_DIR = join(homedir(), ".agents");

console.log("[oh-y-lockie-agent] postinstall: 开始复制静态文件...");

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest, label) {
  if (!existsSync(src)) { console.log(`  [跳过] ${label}: 源目录不存在`); return; }
  ensureDir(dest);
  try {
    cpSync(src, dest, { recursive: true, force: true });
    console.log(`  [OK] ${label}: ${src} → ${dest}`);
  } catch (e) {
    console.error(`  [失败] ${label}: ${e.message}`);
  }
}

try {
  // Commands
  copyDir(join(PKG_ROOT, "commands"), join(OPENCODE_DIR, "commands"), "commands");

  // Agents
  copyDir(join(PKG_ROOT, "agents"), join(OPENCODE_DIR, "agents"), "agents");

  // Skills (opencode)
  copyDir(join(PKG_ROOT, "skills", "opencode"), join(OPENCODE_DIR, "skills"), "skills/opencode");

  // Skills (agents)
  copyDir(join(PKG_ROOT, "skills", "agents"), join(AGENTS_DIR, "skills"), "skills/agents");

  // References
  copyDir(join(PKG_ROOT, "references"), join(OPENCODE_DIR, "references"), "references");

  // AGENTS.md (only if not exists)
  const agentsMdSrc = join(PKG_ROOT, "AGENTS.md");
  if (existsSync(agentsMdSrc)) {
    const agentsMdDest = join(homedir(), "AGENTS.md");
    if (!existsSync(agentsMdDest)) {
      copyFileSync(agentsMdSrc, agentsMdDest);
      console.log(`  [OK] AGENTS.md → ${agentsMdDest}`);
    } else {
      console.log(`  [跳过] AGENTS.md 已存在`);
    }
  }

  // oh-y-lockie-agent.jsonc config reference (only if not exists)
  const configSrc = join(PKG_ROOT, "config", "oh-y-lockie-agent.jsonc");
  if (existsSync(configSrc)) {
    const configDest = join(OPENCODE_DIR, "oh-y-lockie-agent.jsonc");
    if (!existsSync(configDest)) {
      copyFileSync(configSrc, configDest);
      console.log(`  [OK] oh-y-lockie-agent.jsonc → ${configDest}（参考配置 — 请将 your-provider 替换为实际 provider 名称）`);
    } else {
      console.log(`  [跳过] oh-y-lockie-agent.jsonc 已存在`);
    }
  }

  console.log("[oh-y-lockie-agent] postinstall: 完成");
} catch (e) {
  console.error(`[oh-y-lockie-agent] postinstall 失败: ${e.message}`);
  // Don't fail npm install — plugin still works via config hook
  process.exit(0);
}
