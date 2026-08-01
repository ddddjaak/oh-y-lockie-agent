import { describe, it, expect, afterEach } from "vitest";
import {
  buildTargetContextBlock,
  injectTargetContext,
  buildReferenceIndex,
  resetContextCaches,
  REFERENCE_MARKER,
} from "../context.js";

afterEach(() => resetContextCaches());

describe("buildTargetContextBlock", () => {
  it("returns null when no target is configured", () => {
    expect(buildTargetContextBlock(undefined)).toBeNull();
    expect(buildTargetContextBlock({})).toBeNull();
  });

  it("returns null when every field is empty", () => {
    expect(buildTargetContextBlock({ chip: "", family: "", sdk: "", toolchain: "" })).toBeNull();
  });

  it("builds a block from a partially-filled target", () => {
    const block = buildTargetContextBlock({ chip: "CS32F103C8T6", family: "Cortex-M3" });
    expect(block).toBeTruthy();
    expect(block).toContain("CS32F103C8T6");
    expect(block).toContain("Cortex-M3");
    expect(block).not.toContain("SDK");
  });

  it("includes all four fields when provided", () => {
    const block = buildTargetContextBlock({
      chip: "C", family: "F", sdk: "S", toolchain: "T",
    });
    expect(block).toContain("芯片型号: C");
    expect(block).toContain("架构家族: F");
    expect(block).toContain("SDK: S");
    expect(block).toContain("工具链: T");
  });
});

describe("injectTargetContext", () => {
  const agents = {
    a: { prompt: "base prompt" },
    b: { prompt: "another" },
  };

  it("returns the same map unchanged when target is empty", () => {
    expect(injectTargetContext(agents, undefined)).toBe(agents);
  });

  it("appends the block to every agent prompt", () => {
    const out = injectTargetContext(agents, { chip: "X" });
    expect(out.a.prompt).toContain("[oh-y-lockie-agent 目标芯片上下文]");
    expect(out.b.prompt).toContain("X");
    expect(out.a.prompt).toContain("base prompt");
  });

  it("is idempotent — a second pass does not double-append", () => {
    const once = injectTargetContext(agents, { chip: "X" });
    const twice = injectTargetContext(once, { chip: "X" });
    const count = (twice.a.prompt as string).split("[oh-y-lockie-agent 目标芯片上下文]").length - 1;
    expect(count).toBe(1);
  });

  it("leaves agents without a string prompt untouched", () => {
    const weird = { a: { prompt: undefined } } as Record<string, { prompt?: string }>;
    const out = injectTargetContext(weird, { chip: "X" });
    expect(out.a.prompt).toBeUndefined();
  });
});

describe("buildReferenceIndex", () => {
  it("lists the bundled reference markdown docs with the marker", () => {
    const idx = buildReferenceIndex();
    expect(idx).toContain(REFERENCE_MARKER);
    // all 5 shipped docs appear
    for (const name of [
      "accessibility-checklist.md",
      "orchestration-patterns.md",
      "performance-checklist.md",
      "security-checklist.md",
      "testing-patterns.md",
    ]) {
      expect(idx).toContain(name);
    }
  });

  it("is cached — same string on repeated calls", () => {
    expect(buildReferenceIndex()).toBe(buildReferenceIndex());
  });
});
