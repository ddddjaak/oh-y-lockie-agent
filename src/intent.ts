/**
 * Intent classification layer for oh-y-lockie-agent.
 *
 * The previous routing design jumped straight from keywords to a single skill,
 * which caused cross-category mismatches: "PLL 对不对" (intent = review) got
 * routed to clock-configuration (a design skill) because "PLL" matched.
 *
 * This module adds a middle layer:
 *   user text → classifyIntent → matchSkill(intent subset) → route
 *                       ↓
 *                 detectFanout → multi-agent orchestration
 *
 * It also makes the SKILL_ROUTE_TABLE self-generating from a single source
 * (INTENT_SKILL_MAP), so new skills appear in routing automatically instead
 * of requiring a hand-maintained table to be updated.
 *
 * All functions are pure and synchronous — no I/O, no LLM calls. Intent
 * classification is rule-based (signal phrases) so it stays fast and free.
 */

// ─── Types ───────────────────────────────────────────────────────

export type Intent = "design" | "review" | "debug" | "build" | "ship" | "plan" | "qa";

export interface FanoutDecision {
  fanout: boolean;
  /** Agents to invoke in parallel (lockie subagent names). Empty if skill handles orchestration itself. */
  agents: string[];
  /** Skill that coordinates the fan-out, if any. */
  skill?: string;
  /** Human-readable reason for telemetry / debugging. */
  reason: string;
}

// ─── Intent → skill mapping (single source of truth) ─────────────

/**
 * Maps each intent to the skills that serve it. This is the ONLY place to
 * update when skills are added/removed — buildRouteTableFromMap() and
 * matchSkill's intent filtering both derive from this.
 *
 * Coverage: all 56 skills under skills/opencode/ must appear exactly once.
 * intent.test.ts enforces this invariant.
 */
export const INTENT_SKILL_MAP: Record<Intent, string[]> = {
  design: [
    "architecture-design",
    "software-architecture-design",
    "hardware-architecture-design",
    "software-detailed-design",
    "hardware-detailed-design",
    "algorithm-design",
    "api-and-interface-design",
    "spec-authoring",
    "peripheral-driver-design",
    "bootloader-design",
    "memory-protection",
    "clock-configuration",
    "power-management",
    "register-map",
    "memory-map",
    "pinmux",
    "power-tree",
    "device-tree",
    "rtos-and-concurrency",
  ],
  review: [
    "design-review",
    "requirements-review",
    "code-static-review",
    "code-review-and-quality",
    "code-simplification",
    "test-plan-review",
    "test-report-review",
    "release-review",
    "ship-review",
    "security-and-hardening",
    "performance-optimization",
    "traceability-matrix",
    "doubt-driven-development",
    "verification-planning",
  ],
  debug: [
    "debugging-and-error-recovery",
    "embedded-debugging",
  ],
  build: [
    "incremental-implementation",
    "source-driven-development",
    "embedded-build-and-toolchain",
    "board-bringup",
    "context-engineering",
    "test-driven-development",
    "clonedeps",
  ],
  ship: [
    "git-workflow-and-versioning",
    "ci-cd-and-automation",
    "deprecation-and-migration",
    "documentation-and-adrs",
    "shipping-and-launch",
  ],
  plan: [
    "requirements-decompose",
    "planning-and-task-breakdown",
    "interview-me",
    "idea-refine",
    "spec-driven-development",
  ],
  qa: [
    "deepwork",
    "reflect",
    "simplify",
    "worktrees",
  ],
};

/** Display metadata for each intent, used by buildRouteTableFromMap. */
export const INTENT_META: Record<Intent, { label: string; desc: string }> = {
  design: { label: "设计 — 创造新方案", desc: "架构/详细设计/规格/驱动/配置" },
  review: { label: "审查 — 评估已有产物", desc: "设计审查/代码审查/测试审查/发布审查" },
  debug: { label: "调试 — 排查故障", desc: "错误恢复/HardFault/异常排查" },
  build: { label: "构建 — 实现/编译", desc: "增量实现/工具链/bring-up/TDD" },
  ship: { label: "发布 — 交付上线", desc: "Git/CI-CD/文档/发布部署" },
  plan: { label: "规划 — 前置思考", desc: "需求分解/任务拆解/想法精炼" },
  qa: { label: "通用 — 元技能", desc: "深度工作/反思/简化/worktrees" },
};

// ─── Skill trigger words (中英双语,解决 extractKeywords 中英不匹配) ──

/**
 * Chinese+English trigger words per skill. This is the fix for the eval-exposed
 * extractKeywords flaw: extractKeywords pulls English terms from skill
 * descriptions, but users type Chinese ("时钟树" ≠ "clock"). matchSkill merges
 * these triggers with extractKeywords output so both languages match.
 *
 * Each skill gets 3-6 core triggers — the terms engineers actually use when
 * asking for that skill. Maintain here (single source), not in 56 SKILL.md files.
 */
export const SKILL_TRIGGERS: Record<string, string[]> = {
  // design
  "architecture-design": ["系统架构", "架构设计", "模块划分", "接口定义", "architecture", "system design"],
  "software-architecture-design": ["固件架构", "软件架构", "软件分层", "线程模型", "software architecture"],
  "hardware-architecture-design": ["硬件架构", "器件选型", "信号完整性", "pcb 约束", "hardware architecture"],
  "software-detailed-design": ["软件详细设计", "函数签名", "状态机设计", "详细设计"],
  "hardware-detailed-design": ["硬件详细设计", "原理图设计", "pcb 布局", "硬件详细"],
  "algorithm-design": ["算法设计", "信号处理", "滤波器", "dsp", "filter design", "算法"],
  "api-and-interface-design": ["api 设计", "接口设计", "hal 层", "hal", "接口定义"],
  "spec-authoring": ["规格编写", "规格文档", "sod", "hw-sw 接口", "spec"],
  "peripheral-driver-design": ["外设驱动", "驱动设计", "uart 驱动", "spi 驱动", "i2c 驱动", "driver"],
  "bootloader-design": ["bootloader", "安全启动", "secure boot", "ota", "dfu", "启动流程"],
  "memory-protection": ["mpu", "内存保护", "trustzone", "保护区域", "内存区域"],
  "clock-configuration": ["时钟", "时钟树", "pll", "倍频", "分频", "hse", "lse", "clock"],
  "power-management": ["低功耗", "功耗管理", "电源管理", "dvfs", "pmic", "sleep mode"],
  "register-map": ["寄存器映射", "register map", "位域", "寄存器", "bit field"],
  "memory-map": ["内存映射", "memory map", "链接脚本", "地址空间", "地址映射"],
  "pinmux": ["引脚复用", "pinmux", "pinctrl", "复用分配", "引脚分配"],
  "power-tree": ["电源树", "power tree", "电压域", "上电时序", "电流预算", "电源架构"],
  "device-tree": ["设备树", "dts", "dtsi", "pinctrl", "device tree"],
  "rtos-and-concurrency": ["rtos", "并发", "任务调度", "实时操作系统", "freertos", "mutex", "信号量"],

  // review
  "design-review": ["设计审查", "四视角审查", "跨部门评审", "设计评审", "design review"],
  "requirements-review": ["需求审查", "需求评审", "需求文档审查"],
  "code-static-review": ["静态审查", "编码规范", "静态分析", "lint", "代码静态"],
  "code-review-and-quality": ["代码评审", "代码审查", "代码质量", "code review"],
  "code-simplification": ["代码简化", "简化代码", "简化", "重构", "refactor"],
  "test-plan-review": ["测试方案审查", "测试计划评审", "测试方案"],
  "test-report-review": ["测试报告审查", "测试报告"],
  "release-review": ["发布审查", "发布就绪", "release review"],
  "ship-review": ["ship review", "发布前审查", "上线审查", "go/no-go", "发布前"],
  "security-and-hardening": ["安全加固", "安全审查", "security", "hardening", "安全漏洞"],
  "performance-optimization": ["性能优化", "性能", "性能达标", "优化性能", "performance"],
  "traceability-matrix": ["追溯矩阵", "覆盖缺口", "traceability", "追溯"],
  "doubt-driven-development": ["怀疑驱动", "对抗式审查", "doubt driven"],
  "verification-planning": ["验证计划", "验证规划", "verification plan"],

  // debug
  "debugging-and-error-recovery": ["通用调试", "错误恢复", "调试", "debug", "排查错误"],
  "embedded-debugging": ["嵌入式调试", "hardfault", "硬错误", "异常排查", "embedded debug"],

  // build
  "incremental-implementation": ["增量实现", "分步开发", "增量开发", "incremental"],
  "source-driven-development": ["源码驱动", "查阅源码", "源码查阅", "source driven"],
  "embedded-build-and-toolchain": ["工具链", "编译构建", "gcc arm", "toolchain", "makefile", "cmake"],
  "board-bringup": ["bring-up", "bring up", "首次上电", "板级 bring", "bringup"],
  "context-engineering": ["上下文优化", "上下文工程", "context engineering"],
  "test-driven-development": ["tdd", "测试驱动", "测试驱动开发", "test driven"],
  "clonedeps": ["依赖源码", "依赖分析", "clonedeps", "依赖"],

  // ship
  "git-workflow-and-versioning": ["git 工作流", "版本控制", "分支策略", "versioning", "git"],
  "ci-cd-and-automation": ["ci/cd", "ci-cd", "cicd", "持续集成", "自动化部署", "ci"],
  "deprecation-and-migration": ["弃用", "迁移", "deprecation", "migration"],
  "documentation-and-adrs": ["文档", "adr", "架构决策记录", "changelog", "documentation"],
  "shipping-and-launch": ["发布上线", "部署上线", "发布部署", "ship", "launch"],

  // plan
  "requirements-decompose": ["需求分解", "需求拆解", "prd", "需求梳理"],
  "planning-and-task-breakdown": ["任务拆解", "任务分解", "排期", "开发计划", "planning"],
  "interview-me": ["需求不明确", "澄清意图", "澄清需求", "interview"],
  "idea-refine": ["想法精炼", "头脑风暴", "精炼想法", "idea refine"],
  "spec-driven-development": ["写规格", "定义需求", "规格驱动", "spec driven"],

  // qa
  "deepwork": ["深度工作", "deep work", "专注模式"],
  "reflect": ["反思", "复盘", "reflect"],
  "simplify": ["简化", "精简", "simplify"],
  "worktrees": ["worktree", "工作树", "git worktree"],
};

/** Get trigger words for a skill (Chinese+English). Empty if skill not mapped. */
export function getSkillTriggers(name: string): string[] {
  return SKILL_TRIGGERS[name] ?? [];
}

// ─── Intent classification ───────────────────────────────────────

/**
 * Signal phrases per intent. Checked in priority order: the first intent whose
 * phrase appears in the (lowercased) text wins. Priority reflects signal
 * clarity — a failure word is a stronger intent signal than a design word.
 *
 * Phrases are ≥2 chars (CN) / ≥3 letters (EN) to avoid single-char noise.
 * Conflict resolution: specific multi-word phrases (e.g. "测试驱动") are placed
 * in the correct intent rather than relying on single-word matching.
 */
/**
 * Composite phrases that override single-word priority. "ship review" contains
 * "review" (a review signal) but the intent is ship (release-readiness review).
 * These are checked BEFORE INTENT_SIGNALS to avoid misclassification.
 * Populated by eval failures (see intent-evals.test.ts).
 */
const INTENT_OVERRIDES: { phrase: string; intent: Intent }[] = [
  { phrase: "ship review", intent: "ship" },
  { phrase: "发布前审查", intent: "ship" },
  { phrase: "go/no-go", intent: "ship" },
  { phrase: "go no go", intent: "ship" },
];

const INTENT_SIGNALS: { intent: Intent; phrases: string[] }[] = [
  {
    intent: "debug",
    phrases: [
      "报错", "失败", "错误", "异常", "排查", "挂了", "死机", "崩溃", "跑飞", "卡死",
      "不工作", "不启动", "重启", "复位", "为什么", "怎么回事", "hardfault", "memmanage",
      "busfault", "crash", "fault", "error", "failed", "panic", "hang", "stuck",
      "watchdog reset", "栈溢出",
      // eval-driven additions: real engineer phrasings that were missed
      "收不到", "接收不到", "没反应", "无响应", "不正常", "不通", "丢失",
    ],
  },
  {
    intent: "review",
    phrases: [
      "审查", "评审", "评估", "检查", "对不对", "好不好", "有没有问题", "质量",
      "合规", "看看", "审查一下", "检查一下", "review", "audit", "verify", "inspect",
      "evaluate", "代码评审", "设计审查", "测试方案审查", "测试报告审查",
      // eval-driven additions
      "简化", "达标", "规范吗", "合理吗",
    ],
  },
  {
    intent: "ship",
    phrases: [
      "发布", "上线", "部署", "交付", "发布前", "上线前",
      "ship", "launch", "release", "deploy", "deliv",
      // eval-driven additions
      "ci/cd", "ci-cd", "cicd", "git", "adr", "changelog", "版本号",
    ],
  },
  {
    intent: "plan",
    phrases: [
      "计划", "拆解", "规划", "排期", "路线", "分解", "梳理需求", "明确需求",
      "头脑风暴", "plan", "breakdown", "schedule", "roadmap", "decompose",
      // eval-driven additions
      "精炼", "梳理", "澄清", "明确",
    ],
  },
  {
    intent: "design",
    phrases: [
      "设计", "架构", "定义", "划分", "写一个", "创建", "生成", "怎么配", "如何设计",
      "帮我设计", "configure", "design", "architect", "define", "create", "generate",
      "方案", "建模", "model",
      // eval-driven additions
      "分配", "规划", "选型",
    ],
  },
  {
    intent: "build",
    phrases: [
      "编译", "构建", "链接", "工具链", "bring-up", "bring up", "实现", "开发",
      "写代码", "烧录", "测试驱动", "tdd", "compile", "build", "link", "toolchain",
      "implement", "develop", "flash", "bsp",
    ],
  },
];

/**
 * Classify user text into an intent. Returns "qa" as the default when no
 * signal phrase matches (general questions / meta-skills).
 *
 * Priority: debug > review > ship > plan > design > build > qa.
 * A failure word always wins over a design word ("PLL 报错" → debug, not design).
 */
export function classifyIntent(text: string): Intent {
  return classifyIntentWithDetail(text).intent;
}

export interface IntentClassification {
  intent: Intent;
  /** The signal phrase that decided the intent (for telemetry / debugging).
   *  Null when no signal matched and intent fell back to "qa". */
  matchedPhrase: string | null;
}

/**
 * Classify intent AND return the deciding signal phrase. The phrase is used by
 * telemetry to record WHY a route was chosen — when matchSkill later misses,
 * the phrase + intent pinpoints which SKILL_TRIGGERS gap to fill.
 */
export function classifyIntentWithDetail(text: string): IntentClassification {
  if (!text) return { intent: "qa", matchedPhrase: null };
  const lower = text.toLowerCase();
  // Override composite phrases first (e.g. "ship review" → ship, not review).
  for (const { phrase, intent } of INTENT_OVERRIDES) {
    if (lower.includes(phrase)) return { intent, matchedPhrase: phrase };
  }
  for (const { intent, phrases } of INTENT_SIGNALS) {
    for (const phrase of phrases) {
      if (lower.includes(phrase)) return { intent, matchedPhrase: phrase };
    }
  }
  return { intent: "qa", matchedPhrase: null };
}

// ─── Fan-out detection ───────────────────────────────────────────

/** Signal words that indicate the user wants multi-perspective coverage. */
const FANOUT_SIGNALS = [
  "全面", "多角度", "多视角", "综合", "各角度", "各方面", "所有视角",
  "对抗式", "ship review", "发布前审查", "go/no-go", "go no go",
];

/** Agents to fan-out for a multi-perspective review (matches lockie agent names). */
const REVIEW_FANOUT_AGENTS = ["code-reviewer", "security-auditor", "test-engineer"];

/**
 * Detect whether the user's request should fan-out to multiple subagents.
 *
 * - "ship review" / "发布前审查" → ship-review skill (it fans out the same 3 review agents)
 * - "全面审查" / "多角度" + review intent → parallel fan-out to 3 review agents
 *
 * Returns { fanout: false } when no signal is present, so the caller can
 * fall through to single-skill routing.
 */
export function detectFanout(text: string, intent: Intent): FanoutDecision {
  if (!text) return { fanout: false, agents: [], reason: "empty input" };

  const lower = text.toLowerCase();
  const hasSignal = FANOUT_SIGNALS.some((s) => lower.includes(s));
  if (!hasSignal) return { fanout: false, agents: [], reason: "no fan-out signal" };

  // Ship review is a distinct orchestration entry — the skill fans out the same
  // three review agents (fresh context) and merges them into a go/no-go verdict.
  if (lower.includes("ship review") || lower.includes("发布前审查") || lower.includes("go/no-go") || lower.includes("go no go")) {
    return {
      fanout: true,
      agents: [...REVIEW_FANOUT_AGENTS],
      skill: "ship-review",
      reason: "ship-review fan-out to 3 review agents",
    };
  }

  // Multi-perspective review → fan out to 3 review agents in parallel.
  if (intent === "review") {
    return {
      fanout: true,
      agents: [...REVIEW_FANOUT_AGENTS],
      skill: "design-review",
      reason: "multi-perspective review fan-out",
    };
  }

  // Fan-out signal present but intent isn't review — let single-skill routing handle it.
  return { fanout: false, agents: [], reason: "fan-out signal but intent not review" };
}

// ─── Self-generating route table ─────────────────────────────────

/**
 * Build the skill routing table markdown from INTENT_SKILL_MAP.
 *
 * Replaces the previously hand-maintained SKILL_ROUTE_TABLE string. New skills
 * appear automatically once added to INTENT_SKILL_MAP — no second file to update.
 */
export function buildRouteTableFromMap(): string {
  const lines: string[] = [];
  lines.push("[oh-y-lockie-agent skill routing table]");
  lines.push("");
  lines.push("## Skill Routing Table");
  lines.push("");
  lines.push(
    "When you receive a user request, check this routing table BEFORE answering. " +
      "If the task matches a row, load the corresponding skill with the `lockie_load_skill` tool " +
      "(a tool provided by this plugin). If `lockie_load_skill` is unavailable, fall back to the built-in `skill` tool.",
  );
  lines.push("");

  const intentOrder: Intent[] = ["design", "review", "debug", "build", "ship", "plan", "qa"];
  for (const intent of intentOrder) {
    const meta = INTENT_META[intent];
    const skills = INTENT_SKILL_MAP[intent];
    lines.push(`### ${meta.label}`);
    lines.push(`| Skill | 适用场景 |`);
    lines.push(`|-------|---------|`);
    for (const skill of skills) {
      lines.push(`| \`${skill}\` | ${meta.desc} |`);
    }
    lines.push("");
  }

  lines.push("### Rule");
  lines.push("- If the user's intent maps to exactly one skill, LOAD IT immediately via `lockie_load_skill` (fallback: built-in `skill` tool).");
  lines.push("- If the user asks for a comprehensive / multi-perspective review (全面审查/多角度), fan-out to multiple review agents (code-reviewer, security-auditor, test-engineer) via the `task` tool.");
  lines.push("- For release-readiness (ship review / 发布前审查 / go no-go), load `ship-review`; it fans out the same three agents (fresh context) and produces the go/no-go verdict.");
  lines.push("- If ambiguous (maps to 2+), pick the most specific one or ask the user.");
  lines.push("- If no match, proceed without loading a skill.");

  return lines.join("\n");
}

/**
 * Get the list of skill names that belong to an intent. Used by matchSkill to
 * restrict matching to the intent's subset and avoid cross-category mismatches.
 */
export function skillsForIntent(intent: Intent): string[] {
  return INTENT_SKILL_MAP[intent] ?? [];
}

/**
 * All skill names known to the intent map. Used by tests to verify full
 * coverage against the on-disk skill directory.
 */
export function allMappedSkills(): string[] {
  return Object.values(INTENT_SKILL_MAP).flat();
}
