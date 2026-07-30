/**
 * Intent routing eval suite — borrowed from Superpowers' evals philosophy.
 *
 * Unlike intent.test.ts (which tests mechanism: "does this signal phrase match"),
 * this suite tests REAL routing accuracy against ~53 embedded-domain queries that
 * mimic how engineers actually talk. It loads the real skill table from disk and
 * runs the full classifyIntent → matchSkill → detectFanout pipeline.
 *
 * Superpowers uses evals because LLMs are non-deterministic (must run N times).
 * Our classifyIntent is deterministic rules, so we can assert exact accuracy —
 * fast, free, no LLM calls. The threshold is 85% (not 100%) because rule-based
 * classification has an inherent ceiling; cases that miss expose signal-phrase
 * gaps to fix in intent.ts.
 *
 * When a case fails, it's a signal to either:
 *  (a) add the missing signal phrase to INTENT_SIGNALS in intent.ts, or
 *  (b) accept it as a known limitation if the phrasing is genuinely ambiguous.
 */
import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIntent, detectFanout } from "../intent.js";
import { buildSkillTable, matchSkill } from "../skills.js";
import type { SkillEntry } from "../skills.js";
import type { Intent } from "../intent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dirname, "..", "..", "skills", "opencode");
const skillTable: SkillEntry[] = buildSkillTable(skillsDir);

interface EvalCase {
  text: string;
  expectIntent: Intent;
  /** Expected skill (matched within intent subset). Omit if any skill in intent is acceptable. */
  expectSkill?: string;
  /** Fan-out expectation. Omit if fan-out is not expected. */
  fanout?: boolean;
  fanoutSkill?: string;
}

const EVAL_CASES: EvalCase[] = [
  // ── design (创造新方案) ──────────────────────────────────────
  { text: "帮我设计 STM32 的时钟树", expectIntent: "design", expectSkill: "clock-configuration" },
  { text: "怎么配置 PLL 倍频", expectIntent: "design", expectSkill: "clock-configuration" },
  { text: "设计一个 UART 驱动", expectIntent: "design", expectSkill: "peripheral-driver-design" },
  { text: "划分内存映射区域", expectIntent: "design", expectSkill: "memory-map" },
  { text: "写一个 bootloader", expectIntent: "design", expectSkill: "bootloader-design" },
  { text: "MPU 区域怎么配", expectIntent: "design", expectSkill: "memory-protection" },
  { text: "设计低功耗策略", expectIntent: "design", expectSkill: "power-management" },
  { text: "引脚复用怎么分配", expectIntent: "design", expectSkill: "pinmux" },

  // ── review (评估已有产物) ────────────────────────────────────
  { text: "PLL 配置对不对", expectIntent: "review" }, // cross-category trap: PLL is design term, 对不对 is review intent
  { text: "审查这个驱动代码", expectIntent: "review", expectSkill: "code-review-and-quality" },
  { text: "这个设计有没有问题", expectIntent: "review", expectSkill: "design-review" },
  { text: "检查安全启动流程", expectIntent: "review", expectSkill: "security-and-hardening" },
  { text: "代码质量怎么样", expectIntent: "review", expectSkill: "code-review-and-quality" },
  { text: "测试方案评审一下", expectIntent: "review", expectSkill: "test-plan-review" },
  { text: "性能达标吗", expectIntent: "review", expectSkill: "performance-optimization" },
  { text: "简化这段代码", expectIntent: "review", expectSkill: "code-simplification" },

  // ── debug (排查故障) ─────────────────────────────────────────
  { text: "HardFault 排查", expectIntent: "debug", expectSkill: "embedded-debugging" },
  { text: "为什么启动失败", expectIntent: "debug" },
  { text: "设备挂了不工作", expectIntent: "debug" },
  { text: "UART 收不到数据", expectIntent: "debug" }, // exposes gap: "收不到" missing from debug signals
  { text: "程序跑飞了", expectIntent: "debug" },
  { text: "看门狗一直复位", expectIntent: "debug" },
  { text: "烧录后没反应", expectIntent: "debug" }, // exposes gap: "没反应" missing, "烧录" is build signal
  { text: "调试这个崩溃", expectIntent: "debug", expectSkill: "debugging-and-error-recovery" },

  // ── build (实现/编译) ────────────────────────────────────────
  { text: "配置 GCC ARM 工具链", expectIntent: "build", expectSkill: "embedded-build-and-toolchain" },
  { text: "bring-up 这块板子", expectIntent: "build", expectSkill: "board-bringup" },
  { text: "增量实现这个模块", expectIntent: "build", expectSkill: "incremental-implementation" },
  { text: "TDD 开发驱动", expectIntent: "build", expectSkill: "test-driven-development" },
  { text: "构建固件", expectIntent: "build" },
  { text: "编译链接", expectIntent: "build" },
  { text: "查阅源码实现", expectIntent: "build", expectSkill: "source-driven-development" },

  // ── ship (交付上线) ──────────────────────────────────────────
  { text: "准备发布上线", expectIntent: "ship", expectSkill: "shipping-and-launch" },
  { text: "部署到生产环境", expectIntent: "ship" },
  { text: "配置 CI/CD", expectIntent: "ship", expectSkill: "ci-cd-and-automation" },
  { text: "git 工作流规范", expectIntent: "ship", expectSkill: "git-workflow-and-versioning" },
  { text: "写 ADR 文档", expectIntent: "ship", expectSkill: "documentation-and-adrs" },

  // ── plan (前置规划) ──────────────────────────────────────────
  { text: "任务拆解", expectIntent: "plan", expectSkill: "planning-and-task-breakdown" },
  { text: "需求分解", expectIntent: "plan", expectSkill: "requirements-decompose" },
  { text: "想法精炼", expectIntent: "plan", expectSkill: "idea-refine" },
  { text: "排个开发计划", expectIntent: "plan" },
  { text: "需求不明确帮我梳理", expectIntent: "plan", expectSkill: "interview-me" }, // exposes gap: "梳理" without "需求" suffix

  // ── qa (通用疑问/元技能) ─────────────────────────────────────
  { text: "什么是 MPU", expectIntent: "qa" },
  { text: "TrustZone 原理", expectIntent: "qa" },
  { text: "DMA 和中断区别", expectIntent: "qa" },
  { text: "解释下 SVD 文件", expectIntent: "qa" },

  // ── fan-out (多视角编排) ─────────────────────────────────────
  { text: "全面审查这个设计", expectIntent: "review", fanout: true },
  { text: "ship review 这个版本", expectIntent: "ship", fanout: true, fanoutSkill: "ship-review" },
  { text: "多角度看看架构", expectIntent: "review", fanout: true },
  { text: "发布前审查", expectIntent: "ship", fanout: true, fanoutSkill: "ship-review" },
  { text: "各角度评估一下", expectIntent: "review", fanout: true },

  // ── cross-category traps ─────────────────────────────────────
  { text: "审查这个报错", expectIntent: "debug" }, // debug wins over review (failure > evaluation)
  { text: "测试驱动开发这个模块", expectIntent: "build" }, // build phrase "测试驱动" wins, not review "测试"
  { text: "全面分析架构", expectIntent: "design", fanout: false }, // fan-out signal but intent≠review → no fanout
];

describe("intent routing eval suite", () => {
  it("classifyIntent accuracy ≥ 85% across real embedded-domain queries", () => {
    let correct = 0;
    const failures: string[] = [];
    for (const c of EVAL_CASES) {
      const actual = classifyIntent(c.text);
      if (actual === c.expectIntent) {
        correct++;
      } else {
        failures.push(`  "${c.text}" → expected ${c.expectIntent}, got ${actual}`);
      }
    }
    const rate = correct / EVAL_CASES.length;
    console.log(`\n[eval] classifyIntent accuracy: ${(rate * 100).toFixed(1)}% (${correct}/${EVAL_CASES.length})`);
    if (failures.length) {
      console.log(`[eval] ${failures.length} failure(s):\n${failures.join("\n")}`);
    }
    expect(rate).toBeGreaterThanOrEqual(0.85);
  });

  it("matchSkill routes to expected skill within intent subset (where specified)", () => {
    const skillCases = EVAL_CASES.filter((c) => c.expectSkill !== undefined);
    let correct = 0;
    const failures: string[] = [];
    for (const c of skillCases) {
      const intent = classifyIntent(c.text);
      const match = matchSkill(c.text, skillTable, intent);
      if (match && match.name === c.expectSkill) {
        correct++;
      } else {
        failures.push(`  "${c.text}" → expected skill ${c.expectSkill}, got ${match?.name ?? "null"}`);
      }
    }
    const rate = correct / skillCases.length;
    console.log(`\n[eval] matchSkill accuracy: ${(rate * 100).toFixed(1)}% (${correct}/${skillCases.length})`);
    if (failures.length) {
      console.log(`[eval] ${failures.length} failure(s):\n${failures.join("\n")}`);
    }
    // extractKeywords refactor DONE: SKILL_TRIGGERS (intent.ts) now provides
    // Chinese+English triggers per skill, merged with extractKeywords output in
    // matchSkill. Scoring also fixed to treat Chinese 2-char terms and 3-letter
    // abbrevs as strong signals. Accuracy jumped from 23% → 80%+. Remaining
    // misses are genuinely ambiguous phrasings ("审查这个驱动代码" could be any
    // review skill). Raise this threshold when adding more trigger coverage.
    expect(rate).toBeGreaterThanOrEqual(0.7);
  });

  it("detectFanout matches expectations on fan-out cases", () => {
    const fanoutCases = EVAL_CASES.filter((c) => c.fanout !== undefined);
    for (const c of fanoutCases) {
      const intent = classifyIntent(c.text);
      const f = detectFanout(c.text, intent);
      expect(f.fanout, `"${c.text}" fanout`).toBe(c.fanout);
      if (c.fanoutSkill) {
        expect(f.skill, `"${c.text}" fanout skill`).toBe(c.fanoutSkill);
      }
    }
  });
});
