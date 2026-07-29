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
import { join } from "node:path";

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
 * Scan a skills directory and build the skill index from SKILL.md files.
 *
 * @param skillsDir  Absolute path to the skills directory containing skill subdirectories.
 * @returns Array of SkillEntry, one per valid skill.
 */
export function buildSkillTable(skillsDir: string): SkillEntry[] {
  if (!existsSync(skillsDir)) {
    console.log("[oh-y-lockie-agent] skills dir not found, skipping skill index");
    return [];
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const skillPath = join(skillsDir, d.name, "SKILL.md");
      if (!existsSync(skillPath)) return null;
      try {
        const content = readFileSync(skillPath, "utf-8");
        const fm = parseFrontmatter(content);
        if (!fm) return null;
        return {
          name: fm.name,
          description: fm.description,
          keywords: extractKeywords(fm.description),
        };
      } catch {
        return null;
      }
    })
    .filter((e): e is SkillEntry => e !== null);

  console.log(`[oh-y-lockie-agent] skill index: ${entries.length} skills loaded`);
  return entries;
}

// ─── Skill matching ──────────────────────────────────────────────

/**
 * Match user input against the skill table using keyword scoring.
 *
 * @param userText    The user's input text.
 * @param skillTable  The skill index to match against.
 * @returns The best-matching SkillEntry, or null if below threshold.
 */
export function matchSkill(userText: string, skillTable: SkillEntry[]): SkillEntry | null {
  if (!userText || skillTable.length === 0) return null;
  const lower = userText.trim().toLowerCase();

  let bestMatch: SkillEntry | null = null;
  let bestScore = 0;

  for (const skill of skillTable) {
    let score = 0;
    for (const kw of skill.keywords) {
      if (lower.includes(kw)) {
        // Longer keyword = stronger signal
        score += kw.length >= 4 ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = skill;
    }
  }

  // Require at least 2 points to avoid noise matches
  if (bestScore >= 2 && bestMatch) {
    console.log(`[oh-y-lockie-agent] skill match: "${bestMatch.name}" (score=${bestScore})`);
    return bestMatch;
  }

  return null;
}

// ─── Routing table (system prompt injection) ─────────────────────

export const ROUTE_MARKER = "[oh-y-lockie-agent skill routing table]";

export const SKILL_ROUTE_TABLE = `
${ROUTE_MARKER}

## Skill Routing Table

When you receive a user request, check this routing table BEFORE answering. If the task matches a row, use the \`skill\` tool to load the corresponding skill.

### SE Pipeline (芯片系统设计)
| 用户意图 | 加载 Skill | 阶段 |
|---------|-----------|------|
| 需求分解、PRD分析、需求梳理 | requirements-decompose | Define |
| 系统架构、模块划分、接口定义 | architecture-design | Design |
| 固件架构、RTOS设计、线程模型 | software-architecture-design | Design |
| 硬件架构、引脚分配、电源树 | hardware-architecture-design | Design |
| 规格编写、SOD、HW-SW接口规格 | spec-authoring | Document |
| 软件详细设计、函数签名、状态机 | software-detailed-design | Document |
| 硬件详细设计、原理图、PCB布局 | hardware-detailed-design | Document |
| 算法设计、信号处理、滤波器 | algorithm-design | Document |
| 四视角设计审查、跨部门评审 | design-review | Verify |
| 需求文档审查 | requirements-review | Verify |
| 代码静态审查、编码规范检查 | code-static-review | Verify |
| 测试方案审查 | test-plan-review | Verify |
| 测试报告审查 | test-report-review | Verify |
| 发布审查、发布就绪 | release-review | Verify |
| 追溯矩阵、覆盖缺口分析 | traceability-matrix | Validate |

### AE Pipeline (嵌入式固件开发)
| 用户意图 | 加载 Skill | 阶段 |
|---------|-----------|------|
| 需求不明确、澄清意图 | interview-me | Define |
| 想法精炼、头脑风暴 | idea-refine | Define |
| 写规格、定义需求 | spec-driven-development | Define |
| 任务拆解、计划 | planning-and-task-breakdown | Plan |
| 增量实现、分步开发 | incremental-implementation | Build |
| 源码驱动开发、查阅文档 | source-driven-development | Build |
| 怀疑驱动、对抗式审查 | doubt-driven-development | Build |
| 上下文优化 | context-engineering | Build |
| API/接口设计、HAL层 | api-and-interface-design | Build |
| TDD测试驱动开发 | test-driven-development | Verify |
| 通用调试 | debugging-and-error-recovery | Verify |
| 嵌入式调试、HardFault分析 | embedded-debugging | Embedded |
| RTOS/并发设计 | rtos-and-concurrency | Embedded |
| 外设驱动设计 | peripheral-driver-design | Embedded |
| 构建/工具链配置 | embedded-build-and-toolchain | Embedded |
| 代码评审 | code-review-and-quality | Review |
| 代码简化 | code-simplification | Review |
| 安全加固 | security-and-hardening | Review |
| 性能优化 | performance-optimization | Review |
| Git工作流 | git-workflow-and-versioning | Ship |
| CI/CD自动化 | ci-cd-and-automation | Ship |
| 弃用/迁移 | deprecation-and-migration | Ship |
| 文档/ADR | documentation-and-adrs | Ship |
| 发布/部署 | shipping-and-launch | Ship |

### Domain-Specific Skills
| 用户意图 | 加载 Skill |
|---------|-----------|
| 电源管理、低功耗、DVFS、PMIC | power-management |
| 时钟配置、PLL、时钟树 | clock-configuration |
| 内存保护、MPU、TrustZone | memory-protection |
| 设备树、DTS、pinctrl | device-tree |
| 板级bring-up、首次上电 | board-bringup |
| Bootloader、安全启动、OTA | bootloader-design |
| 依赖源码分析 | clonedeps |

### Rule
- If the user's intent maps to exactly one skill, LOAD IT immediately.
- If ambiguous (maps to 2+), pick the most specific one or ask the user.
- If no match, proceed without loading a skill.
`.trim();
