/**
 * Context enrichment for oh-y-lockie-agent.
 *
 * Two previously-dead resources are activated here:
 *
 * 1. TARGET chip context — the `target` section of oh-y-lockie-agent.jsonc
 *    (chip / family / sdk / toolchain) was loaded by config.ts but never
 *    consumed. Now it is appended to every agent's prompt, so agents give
 *    chip-specific advice instead of generic answers (e.g. actual register
 *    bit names for CS32F103 vs a Cortex-M0+ part). Empty target → no-op.
 *
 * 2. REFERENCES index — the 5 docs under references/ were shipped but never
 *    surfaced. A lightweight index (name + one-line description) is injected
 *    into the system prompt so agents know these checklists/patterns exist and
 *    can read them on demand — without bloating context with full contents.
 *
 * All functions are pure (file reads are cached) and never throw into callers.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_ROUTE_TABLE, ROUTE_MARKER } from "./skills.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/context.ts → ../references (works both from src/ under vitest and from
// dist/ under the compiled plugin).
const REFERENCES_DIR = join(__dirname, "..", "references");

const TARGET_MARKER = "[oh-y-lockie-agent 目标芯片上下文]";
export const REFERENCE_MARKER = "[oh-y-lockie-agent 参考文档]";

/** Shape of the config `target` section (see config-schema.ts). */
export interface TargetContext {
  chip?: string;
  family?: string;
  sdk?: string;
  toolchain?: string;
}

/**
 * Build the target-context markdown block, or null when no target is set.
 * Appending null is a no-op, so the default (unconfigured) plugin is unchanged.
 */
export function buildTargetContextBlock(target?: TargetContext): string | null {
  if (
    !target ||
    (!target.chip && !target.family && !target.sdk && !target.toolchain)
  ) {
    return null;
  }

  const lines = [
    `\n\n${TARGET_MARKER}`,
    "以下目标芯片上下文来自 oh-y-lockie-agent 配置：",
  ];
  if (target.chip) lines.push(`- 芯片型号: ${target.chip}`);
  if (target.family) lines.push(`- 架构家族: ${target.family}`);
  if (target.sdk) lines.push(`- SDK: ${target.sdk}`);
  if (target.toolchain) lines.push(`- 工具链: ${target.toolchain}`);
  lines.push(
    "所有硬件/固件建议请优先匹配上述目标（寄存器位、时钟参数、地址映射、驱动 API 等），不要给与目标冲突的泛化方案。",
  );

  return lines.join("\n");
}

/**
 * Append the target-context block to each agent's prompt (idempotent).
 *
 * Mutates the caller's map via reassignment so a future hot-reload re-injection
 * does not double-append. Returns a new map only when something changed.
 */
export function injectTargetContext<T extends { prompt?: string }>(
  agents: Record<string, T>,
  target?: TargetContext,
): Record<string, T> {
  const block = buildTargetContextBlock(target);
  if (!block) return agents;

  const out: Record<string, T> = {};
  let changed = false;
  for (const [name, cfg] of Object.entries(agents)) {
    if (typeof cfg.prompt === "string" && !cfg.prompt.includes(TARGET_MARKER)) {
      out[name] = { ...cfg, prompt: cfg.prompt + block };
      changed = true;
    } else {
      out[name] = cfg;
    }
  }
  return changed ? out : agents;
}

/**
 * Append the skill routing table to every agent's prompt (idempotent).
 *
 * WHY: the routing table is also injected through
 * `experimental.chat.system.transform`, but that hook's mutations are silently
 * discarded by some OpenCode runtimes (see anomalyco/opencode#17100). An agent's
 * `prompt` is part of its system prompt, so appending the table here guarantees
 * the model can see which skill to load regardless of the experimental hook.
 */
export function injectSkillRouting<T extends { prompt?: string }>(
  agents: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = {};
  let changed = false;
  for (const [name, cfg] of Object.entries(agents)) {
    if (typeof cfg.prompt === "string" && !cfg.prompt.includes(ROUTE_MARKER)) {
      out[name] = { ...cfg, prompt: cfg.prompt + "\n\n" + SKILL_ROUTE_TABLE };
      changed = true;
    } else {
      out[name] = cfg;
    }
  }
  return changed ? out : agents;
}

/** One-line description of a reference doc (first non-heading line). */
function firstLineOf(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const line = content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("#"));
    return (line ?? "").slice(0, 140);
  } catch {
    return "";
  }
}

let referenceIndexCache: string | null = null;

/**
 * Build a lightweight index of the plugin's reference docs for system-prompt
 * injection. Cached after first build. Never throws — a broken docs dir just
 * yields an empty index.
 */
export function buildReferenceIndex(): string {
  if (referenceIndexCache !== null) return referenceIndexCache;

  const lines = [
    `${REFERENCE_MARKER}`,
    "插件随附以下参考文档（位于插件目录 references/，需要时用 Read 读取）：",
  ];
  if (existsSync(REFERENCES_DIR)) {
    for (const name of readdirSync(REFERENCES_DIR).filter((f) => f.endsWith(".md")).sort()) {
      lines.push(`- \`${name}\`: ${firstLineOf(join(REFERENCES_DIR, name))}`);
    }
  }

  referenceIndexCache = lines.join("\n");
  return referenceIndexCache;
}

/** Reset the cache (test hook). */
export function resetContextCaches(): void {
  referenceIndexCache = null;
}
