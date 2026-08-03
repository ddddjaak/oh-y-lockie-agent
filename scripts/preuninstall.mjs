#!/usr/bin/env node
// oh-y-lockie-agent preuninstall — clean MCP entries + user config on uninstall
//
// 清理必须清理的：
// - MCP 条目 → 需要清理（写入 opencode.json 的）
// - oh-y-lockie-agent.jsonc → 用户级配置模板（postinstall 生成的），卸载时移除
// - skills/   → postinstall 复制到 ~/.config/opencode/skills/ 的目录（仅删除
//                仍与安装时内容一致的，用户改动过的保留）
//
// 不需要清理的（从未复制 / 由 config hook 注入，无残留文件）：
// - agents/ → config hook 注入，不残留文件
// - references/ → 从插件目录读取，不残留文件
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { join, dirname, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_CONFIG = join(OPENCODE_DIR, "opencode.json");
const USER_CONFIG = join(OPENCODE_DIR, "oh-y-lockie-agent.jsonc");
const SKILLS_DEST = join(OPENCODE_DIR, "skills");
const MANIFEST_PATH = join(OPENCODE_DIR, ".oh-y-lockie-agent-skills.json");

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

// ─── 清理 postinstall 复制的 skills ─────────────────────────────
// 只删除 manifest 中登记过、且目标 SKILL.md 与安装时内容一致（sha256 相同）
// 的目录——用户改过的 skill 绝不删。删除前校验路径必须位于
// ~/.config/opencode/skills/ 之内，防止路径逃逸。
console.log("\n  --- 清理 skills（postinstall 复制） ---");
let manifest = { skills: {} };
try {
  if (existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  }
} catch (e) {
  console.error(`  [警告] 读取 skills manifest 失败: ${e.message}（跳过 skills 清理）`);
}

const manifestSkills = manifest && manifest.skills ? manifest.skills : {};
const skillNames = Object.keys(manifestSkills);
if (skillNames.length === 0) {
  console.log("  [跳过] manifest 中没有登记的 skills");
} else {
  let removed = 0;
  let kept = 0;
  for (const name of skillNames) {
    const destDir = join(SKILLS_DEST, name);
    // 路径逃逸防护：destDir 必须严格位于 SKILLS_DEST 之内
    const rel = relative(SKILLS_DEST, destDir);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      console.error(`  [警告] 跳过越界路径: ${destDir}`);
      continue;
    }
    const destSkill = join(destDir, "SKILL.md");
    if (!existsSync(destSkill)) {
      kept++;
      continue;
    }
    const expected = manifestSkills[name]?.sha256;
    const actual = createHash("sha256").update(readFileSync(destSkill, "utf-8")).digest("hex");
    if (expected && expected === actual) {
      try {
        rmSync(destDir, { recursive: true, force: true });
        console.log(`  [删除] ${destDir}（内容未改动）`);
        removed++;
      } catch (e) {
        console.error(`  [警告] 无法删除 ${destDir}: ${e.message}`);
      }
    } else {
      console.log(`  [保留] ${destDir}（已被用户修改，不删除）`);
      kept++;
    }
  }
  console.log(`  [完成] 删除 ${removed} 个，保留 ${kept} 个`);
}
try {
  if (existsSync(MANIFEST_PATH)) {
    rmSync(MANIFEST_PATH, { force: true });
    console.log("  [删除] skills manifest 已移除");
  }
} catch (e) {
  console.error(`  [警告] 无法移除 skills manifest: ${e.message}`);
}

console.log("\n[oh-y-lockie-agent] preuninstall: 完成");
console.log("[oh-y-lockie-agent] 提示: agents/参考文档通过 config hook 注入，卸载后自动消失；复制的 skills 已按 manifest 清理");
