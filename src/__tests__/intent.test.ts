import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyIntent,
  detectFanout,
  buildRouteTableFromMap,
  skillsForIntent,
  allMappedSkills,
  INTENT_SKILL_MAP,
  INTENT_META,
} from "../intent.js";
import type { Intent } from "../intent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dirname, "..", "..", "skills", "opencode");

// ─── classifyIntent ──────────────────────────────────────────────

describe("classifyIntent", () => {
  it("classifies review intent (evaluation of existing artifact)", () => {
    // The canonical cross-category case: "PLL" is a design term, but "对不对"
    // makes the intent review. Without the intent layer this routed to design.
    expect(classifyIntent("PLL 对不对")).toBe("review");
    expect(classifyIntent("帮我检查这个驱动写得好不好")).toBe("review");
    expect(classifyIntent("审查一下架构设计")).toBe("review");
    expect(classifyIntent("review this code")).toBe("review");
  });

  it("classifies debug intent with highest priority (failure overrides all)", () => {
    // "报错" is debug signal; even though "编译" is a build signal, debug wins.
    expect(classifyIntent("编译报错")).toBe("debug");
    expect(classifyIntent("PLL 报错了")).toBe("debug");
    expect(classifyIntent("hardfault 排查")).toBe("debug");
    expect(classifyIntent("为什么启动失败")).toBe("debug");
    expect(classifyIntent("设备挂了不工作")).toBe("debug");
  });

  it("classifies design intent (creating something new)", () => {
    expect(classifyIntent("怎么配置 PLL")).toBe("design");
    expect(classifyIntent("帮我设计时钟树")).toBe("design");
    expect(classifyIntent("设计一个 bootloader")).toBe("design");
    expect(classifyIntent("架构划分")).toBe("design");
  });

  it("classifies build intent (implementation/compile)", () => {
    // "测试驱动" is a build phrase (TDD), not a review signal.
    expect(classifyIntent("测试驱动开发这个模块")).toBe("build");
    expect(classifyIntent("编译链接工具链配置")).toBe("build");
    expect(classifyIntent("bring-up 板子")).toBe("build");
  });

  it("classifies ship intent (delivery)", () => {
    expect(classifyIntent("准备发布上线")).toBe("ship");
    expect(classifyIntent("部署到生产环境")).toBe("ship");
  });

  it("classifies plan intent (upfront thinking)", () => {
    expect(classifyIntent("任务拆解和排期")).toBe("plan");
    expect(classifyIntent("需求分解规划")).toBe("plan");
  });

  it("defaults to qa when no signal phrase matches", () => {
    expect(classifyIntent("什么是 MPU")).toBe("qa");
    expect(classifyIntent("hello world")).toBe("qa");
    expect(classifyIntent("")).toBe("qa");
  });

  it("resolves conflicts by priority: debug > review > ship > plan > design > build", () => {
    // "审查" (review) + "设计" (design) → review wins (reviewing a design, not creating one)
    expect(classifyIntent("审查这个设计")).toBe("review");
    // "报错" (debug) + "审查" (review) → debug wins (investigating an error)
    expect(classifyIntent("审查这个报错")).toBe("debug");
  });
});

// ─── detectFanout ────────────────────────────────────────────────

describe("detectFanout", () => {
  it("detects multi-perspective review fan-out", () => {
    const r = detectFanout("全面审查这个设计", "review");
    expect(r.fanout).toBe(true);
    expect(r.agents).toEqual(["code-reviewer", "security-auditor", "test-engineer"]);
    expect(r.skill).toBe("design-review");
  });

  it("detects ship-review orchestration", () => {
    expect(detectFanout("ship review 这个版本", "ship")).toEqual({
      fanout: true,
      agents: [],
      skill: "ship-review",
      reason: "ship-review orchestration",
    });
    expect(detectFanout("发布前审查", "ship").fanout).toBe(true);
    expect(detectFanout("go/no-go 决策", "ship").fanout).toBe(true);
  });

  it("returns no fan-out when signal absent", () => {
    expect(detectFanout("帮我设计时钟树", "design").fanout).toBe(false);
    expect(detectFanout("编译报错", "debug").fanout).toBe(false);
  });

  it("returns no fan-out when signal present but intent is not review/ship", () => {
    // "全面" present, but intent is design (user said "全面分析架构" not "审查")
    const r = detectFanout("全面分析这个架构", "design");
    expect(r.fanout).toBe(false);
    expect(r.reason).toContain("not review");
  });

  it("handles empty input", () => {
    expect(detectFanout("", "review").fanout).toBe(false);
  });
});

// ─── INTENT_SKILL_MAP coverage ───────────────────────────────────

describe("INTENT_SKILL_MAP coverage", () => {
  it("every intent has a non-empty skill list", () => {
    for (const intent of Object.keys(INTENT_SKILL_MAP) as Intent[]) {
      expect(INTENT_SKILL_MAP[intent].length, `intent "${intent}"`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate skill across intents", () => {
    const all = allMappedSkills();
    const unique = new Set(all);
    expect(all.length).toBe(unique.size);
  });

  it("covers ALL on-disk skills under skills/opencode/ (no skill left unrouted)", () => {
    // This is the key invariant: adding a skill directory without registering it
    // in INTENT_SKILL_MAP will fail this test, preventing silent routing gaps.
    if (!existsSync(skillsDir)) return; // skip if skills dir absent in CI
    const onDisk = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const mapped = allMappedSkills().sort();
    expect(mapped).toEqual(onDisk);
  });

  it("skillsForIntent returns the mapped list", () => {
    expect(skillsForIntent("debug")).toEqual([
      "debugging-and-error-recovery",
      "embedded-debugging",
    ]);
    expect(skillsForIntent("qa").length).toBe(4);
  });
});

// ─── buildRouteTableFromMap ──────────────────────────────────────

describe("buildRouteTableFromMap", () => {
  const table = buildRouteTableFromMap();

  it("starts with the route marker (used for duplicate-injection detection)", () => {
    expect(table.startsWith("[oh-y-lockie-agent skill routing table]")).toBe(true);
  });

  it("contains a section for every intent", () => {
    for (const intent of Object.keys(INTENT_META) as Intent[]) {
      expect(table).toContain(INTENT_META[intent].label);
    }
  });

  it("mentions every mapped skill by name", () => {
    for (const skill of allMappedSkills()) {
      expect(table).toContain(`\`${skill}\``);
    }
  });

  it("includes the fan-out rule for multi-perspective review", () => {
    expect(table).toContain("fan-out");
    expect(table).toContain("ship-review");
  });
});
