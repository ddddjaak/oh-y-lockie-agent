/**
 * Skill matching subsystem for oh-y-lockie-agent.
 *
 * Builds a skill index from SKILL.md files under a skills directory,
 * then provides keyword-based matching against user input.
 *
 * All I/O is pushed to the caller — these functions are pure
 * transformation and easily testable.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRouteTableFromMap, skillsForIntent, getSkillTriggers } from "./intent.js";
import type { Intent } from "./intent.js";
import { log, warn, error } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

// ─── Types ───────────────────────────────────────────────────────

export interface SkillEntry {
  name: string;
  description: string;
  keywords: string[];
}

// ─── Frontmatter parsing ─────────────────────────────────────────

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 * Expected format:
 *   ---
 *   name: skill-name
 *   description: ...
 *   ---
 *
 * Handles both LF and CRLF line endings.
 */
export function parseFrontmatter(content: string): { name: string; description: string } | null {
  // Handle both \n and \r\n line endings
  const match = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (!match) return null;
  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descMatch) return null;
  return { name: nameMatch[1].trim(), description: descMatch[1].trim() };
}

// ─── Keyword extraction ──────────────────────────────────────────

/**
 * Extract routing keywords from a skill description.
 * The description may contain trigger phrases in English and Chinese,
 * plus tech terms that help route user requests to the right skill.
 */
export function extractKeywords(desc: string): string[] {
  const keywords = new Set<string>();

  // 1. "Use when the user says ..." explicit trigger phrases
  const useWhen = desc.match(/Use when the user says\s+(.+?)(?:\.|$)/);
  if (useWhen) {
    for (const token of useWhen[1].split(/[,、]/)) {
      const kw = token.trim().toLowerCase();
      if (kw && kw.length >= 2) keywords.add(kw);
    }
  }

  // 2. Chinese "当" trigger
  const cnWhen = desc.match(/当用户(?:提到|说|需要)\s*(.+?)(?:。|\.|$)/);
  if (cnWhen) {
    for (const token of cnWhen[1].split(/[,，、]/)) {
      const kw = token.trim().toLowerCase();
      if (kw && kw.length >= 2) keywords.add(kw);
    }
  }

  // 3. Tech terms from description body (Chinese colon-separated lists)
  //    Match ALL ：...。 pairs, not just the first one
  const techTermsRegex = /：(.+?)。/g;
  let techMatch: RegExpExecArray | null;
  while ((techMatch = techTermsRegex.exec(desc)) !== null) {
    for (const token of techMatch[1].split(/[，、]/)) {
      const kw = token.trim().toLowerCase();
      if (kw && kw.length >= 2) keywords.add(kw);
    }
  }

  // 4. English terms (comma-separated in the middle section before "Use when")
  const enSection = desc.match(
    /[A-Z][a-z]+(?: [a-z]+)* (?:design|configuration|analysis|methodology|debugging|review|protection|development|planning|engineering|optimization|authoring|management|recovery|verification|generation|automation|migration|hardening|launch|bringup)/i,
  );
  if (enSection) {
    const lower = desc.toLowerCase();
    // Extract common tech acronyms and terms
    const techTerms = [
      "dma", "isr", "mpu", "mmu", "rtos", "dvfs", "pmic", "pll",
      "hsi", "hse", "lsi", "lse", "cortex-m", "jtag", "swd", "hal",
      "api", "sdk", "dts", "dtsi", "kconfig", "cmake", "gcc", "linker",
      "bootloader", "secure boot", "ota", "dfu", "crc", "ecc", "efuse",
      "otp", "rdp", "wrp", "pcrop", "trustzone", "fcc", "ce", "ul",
      "iso 26262", "iec 61508", "misra", "nand", "nor", "emmc", "ssd",
      "wear leveling", "bad block", "hardfault", "memmanage", "busfault",
      "watchdog", "stack overflow", "uart", "spi", "i2c", "gpio", "adc",
      "pwm", "espi", "ncsi", "ble", "wifi", "zigbee",
      "firmware", "driver", "peripheral", "interrupt", "timer",
      "power tree", "voltage domain", "power sequence", "current budget",
      "decoupling", "memory map", "address space", "flash partition",
      "sram", "linker script", "bring-up", "bsp", "first boot", "console",
      "register map", "bit field", "svd", "cmsis",
      "clock tree", "clock gating", "rc oscillator", "mco",
      "traceability", "coverage", "gap analysis",
      "schematic", "pcb", "bom", "pdn", "signal integrity",
      "state machine", "error handling", "thread safety",
      "compile", "lint", "static analysis",
      "signal processing", "filter design", "calibration",
      "pin assignment", "pinmux", "pinctrl",
      "requirement", "specification", "architecture", "interface",
    ];
    for (const term of techTerms) {
      if (lower.includes(term)) keywords.add(term);
    }
  }

  return Array.from(keywords);
}

// ─── Skill index building ────────────────────────────────────────

/**
 * Locate a skill's main markdown file case-insensitively.
 *
 * WHY: `company-docx-generator` once shipped its spec as lowercase `skill.md`,
 * which exact "SKILL.md" matching silently skipped on case-sensitive
 * filesystems (Linux/macOS) — the skill vanished from routing, install copies
 * and the loader while Windows tests stayed green. Resolving against actual
 * directory entries makes file-name case irrelevant, on every platform.
 *
 * @param skillDir  Absolute path of the skill directory.
 * @returns Path of the skill spec file, or null when none exists.
 */
export function resolveSkillMd(skillDir: string): string | null {
  const exact = join(skillDir, "SKILL.md");
  if (existsSync(exact)) return exact;
  // Guard before readdirSync — a nonexistent directory must return null,
  // not throw ENOENT.
  if (!existsSync(skillDir)) return null;
  const lower = readdirSync(skillDir, { withFileTypes: true }).find(
    (f) => f.isFile() && f.name.toLowerCase() === "skill.md",
  );
  return lower ? join(skillDir, lower.name) : null;
}

/**
 * Scan a skills directory and build the skill index from SKILL.md files.
 *
 * @param skillsDir  Absolute path to the skills directory containing skill subdirectories.
 * @returns Array of SkillEntry, one per valid skill.
 */
export function buildSkillTable(skillsDir: string): SkillEntry[] {
  if (!existsSync(skillsDir)) {
    log("skills dir not found, skipping skill index");
    return [];
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const skillPath = resolveSkillMd(join(skillsDir, d.name));
      if (!skillPath) return null;
      try {
        const content = readFileSync(skillPath, "utf-8");
        const fm = parseFrontmatter(content);
        if (!fm) {
          warn(`skill ${d.name}: frontmatter missing or incomplete, skipped`);
          return null;
        }
        return {
          name: fm.name,
          description: fm.description,
          keywords: extractKeywords(fm.description),
        };
      } catch (err) {
        // A single broken skill must not abort the whole index build, but we
        // log which skill failed so it doesn't silently vanish from routing.
        error(`skill ${d.name}: failed to load SKILL.md:`, err);
        return null;
      }
    })
    .filter((e): e is SkillEntry => e !== null);

  log(`skill index: ${entries.length} skills loaded`);
  return entries;
}

// ─── Skill matching ──────────────────────────────────────────────

/**
 * Match user input against the skill table using keyword scoring.
 *
 * @param userText    The user's input text.
 * @param skillTable  The skill index to match against.
 * @param intent      Optional intent to restrict matching to that intent's skill
 *                    subset. When provided, only skills in INTENT_SKILL_MAP[intent]
 *                    are scored — this prevents cross-category mismatches like
 *                    "PLL 对不对" (review intent) routing to clock-configuration
 *                    (a design skill). When omitted, all skills are scored
 *                    (backward-compatible with existing callers).
 * @returns The best-matching SkillEntry, or null if below threshold.
 */
export interface SkillMatch {
  entry: SkillEntry;
  score: number;
}

/**
 * Match AND return the score. Telemetry uses the score to distinguish "matched
 * weakly" from "matched strongly" — a pattern of low-score matches on an intent
 * signals the SKILL_TRIGGERS for that intent need stronger words.
 */
export function matchSkillDetail(userText: string, skillTable: SkillEntry[], intent?: Intent): SkillMatch | null {
  if (!userText || skillTable.length === 0) return null;
  const lower = userText.trim().toLowerCase();

  // Restrict to the intent's skill subset when an intent is provided.
  const candidates = intent
    ? skillTable.filter((s) => skillsForIntent(intent).includes(s.name))
    : skillTable;

  let bestMatch: SkillEntry | null = null;
  let bestScore = 0;

  for (const skill of candidates) {
    let score = 0;
    // Merge extractKeywords output (English, from description) with SKILL_TRIGGERS
    // (Chinese+English, manually curated in intent.ts). This fixes the eval-exposed
    // flaw where "时钟树" couldn't match "clock" — Chinese triggers now match.
    const triggers = [...skill.keywords, ...getSkillTriggers(skill.name)];
    for (const kw of triggers) {
      if (lower.includes(kw)) {
        // Chinese chars are info-dense (2 CN chars ≈ 4 EN letters), and 3-letter
        // English abbrevs (tdd/pll/mpu) are strong signals. Score them as strong
        // to avoid the eval-exposed flaw where "调试" (2 CN chars) scored only 1
        // and fell below the threshold. Short EN noise ("ci") still scores 1.
        const isStrong = kw.length >= 3 || /[\u4e00-\u9fa5]/.test(kw);
        score += isStrong ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = skill;
    }
  }

  // Require at least 2 points to avoid noise matches
  if (bestScore >= 2 && bestMatch) {
    log(`skill match: "${bestMatch.name}" (score=${bestScore})`);
    return { entry: bestMatch, score: bestScore };
  }

  return null;
}

/** Backward-compatible wrapper: returns just the SkillEntry. */
export function matchSkill(userText: string, skillTable: SkillEntry[], intent?: Intent): SkillEntry | null {
  return matchSkillDetail(userText, skillTable, intent)?.entry ?? null;
}

// ─── On-demand skill loading ─────────────────────────────────────

/** Name of the plugin-provided skill-loading tool (see src/index.ts). */
export const SKILL_LOAD_TOOL_NAME = "lockie_load_skill";

export interface LoadedSkill {
  name: string;
  /** Directory the skill lives in: "opencode" | "agents". */
  source: string;
  /** Full SKILL.md content. */
  content: string;
  /** Relative paths of supporting files (scripts/references/assets). */
  relatedFiles: string[];
}

/** Plugin skill roots, ordered: opencode skills first, then agent skills. */
export function skillRoots(): string[] {
  return [
    join(PKG_ROOT, "skills", "opencode"),
    join(PKG_ROOT, "skills", "agents"),
  ];
}

/**
 * List all skill names discoverable under the plugin's skills directories.
 * Falls back to a directory scan when a SKILL.md frontmatter is missing.
 */
export function listSkillNames(): string[] {
  const names: string[] = [];
  for (const root of skillRoots()) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const skillPath = resolveSkillMd(join(root, dir.name));
      if (!skillPath) continue;
      try {
        const fm = parseFrontmatter(readFileSync(skillPath, "utf-8"));
        names.push(fm?.name ?? dir.name);
      } catch {
        names.push(dir.name);
      }
    }
  }
  return names.sort();
}

/**
 * Load a skill's SKILL.md content (and supporting-file list) from the
 * plugin's own skills directories. This is what the `lockie_load_skill`
 * tool uses — it makes the bundled skills loadable regardless of whether
 * the runtime's native `skill` tool can discover them.
 *
 * Matching order: exact name → name contains query → normalized name
 * (hyphens/spaces removed) contains normalized query.
 *
 * @returns The loaded skill, or null when nothing matches.
 */
export function loadSkillContent(query: string): LoadedSkill | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const scan = (): Array<{ name: string; source: string; dir: string }> => {
    const found: Array<{ name: string; source: string; dir: string }> = [];
    for (const root of skillRoots()) {
      if (!existsSync(root)) continue;
      const source = root.endsWith("agents") ? "agents" : "opencode";
      for (const d of readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const skillPath = resolveSkillMd(join(root, d.name));
        if (!skillPath) continue;
        try {
          const fm = parseFrontmatter(readFileSync(skillPath, "utf-8"));
          found.push({ name: fm?.name ?? d.name, source, dir: join(root, d.name) });
        } catch (err) {
          error(`skill ${d.name}: failed to read SKILL.md:`, err);
        }
      }
    }
    return found;
  };

  const skills = scan();
  const exact = skills.find((s) => s.name.toLowerCase() === q);
  if (exact) return readLoadedSkill(exact);

  const contains = skills.find((s) => s.name.toLowerCase().includes(q));
  if (contains) return readLoadedSkill(contains);

  const normQ = q.replace(/[\s-]+/g, "");
  const normalized = skills.find((s) => s.name.toLowerCase().replace(/[\s-]+/g, "").includes(normQ));
  if (normalized) return readLoadedSkill(normalized);

  return null;
}

/** Read SKILL.md content + list supporting files for a located skill. */
function readLoadedSkill(skill: { name: string; source: string; dir: string }): LoadedSkill {
  // Callers only reach here for directories resolveSkillMd already confirmed,
  // so a missing spec is a genuine invariant violation worth surfacing loudly.
  const skillPath = resolveSkillMd(skill.dir);
  if (!skillPath) throw new Error(`skill ${skill.name}: SKILL.md not found in ${skill.dir}`);
  const content = readFileSync(skillPath, "utf-8");
  const relatedFiles = readdirSync(skill.dir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.toLowerCase() !== "skill.md")
    .map((f) => f.name)
    .sort();
  return { name: skill.name, source: skill.source, content, relatedFiles };
}

// ─── Routing table (system prompt injection) ─────────────────────

export const ROUTE_MARKER = "[oh-y-lockie-agent skill routing table]";

/**
 * Skill routing table injected into the system prompt.
 *
 * Self-generated from INTENT_SKILL_MAP (see intent.ts) so new skills appear
 * automatically — no hand-maintained table to keep in sync. Previously this
 * was a 70-line hand-written string that had drifted: 5 skills (deepwork,
 * reflect, simplify, verification-planning, worktrees) were missing entirely.
 */
export const SKILL_ROUTE_TABLE = buildRouteTableFromMap();
