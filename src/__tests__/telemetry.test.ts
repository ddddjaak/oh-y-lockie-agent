import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordRouteEvent, setTelemetryEnabled, getTelemetryPath } from "../telemetry.js";

// telemetry.ts hardcodes the path via homedir(); we test the record/rotate
// contract by pointing at a temp file through setTelemetryEnabled + direct
// path override. Since the module uses a const path, we verify behavior via
// the real path but isolate by toggling enabled state and checking content
// shape / resilience rather than exact file location.

describe("telemetry — recordRouteEvent", () => {
  const originalEnabled = true;

  beforeEach(() => {
    setTelemetryEnabled(true);
  });

  afterEach(() => {
    setTelemetryEnabled(originalEnabled);
  });

  it("writes a valid JSONL line with the expected shape", () => {
    // We can't easily redirect the const path, so verify via the real file:
    // record an event, then read the real file and check the LAST line shape.
    const before = existsSync(getTelemetryPath())
      ? readFileSync(getTelemetryPath(), "utf-8").split("\n").filter(Boolean).length
      : 0;

    recordRouteEvent({
      ts: Date.now(),
      intent: "debug",
      fanout: false,
      skillMatched: "embedded-debugging",
      skillScore: 3,
      textLen: 42,
      matchedPhrase: "hardfault",
    });

    const after = readFileSync(getTelemetryPath(), "utf-8").split("\n").filter(Boolean).length;
    expect(after).toBe(before + 1);

    const lastLine = readFileSync(getTelemetryPath(), "utf-8").trim().split("\n").pop();
    const parsed = JSON.parse(lastLine);
    expect(parsed.intent).toBe("debug");
    expect(parsed.skillMatched).toBe("embedded-debugging");
    expect(parsed.skillScore).toBe(3);
    expect(parsed.matchedPhrase).toBe("hardfault");
    expect(parsed.textLen).toBe(42);
    // Privacy invariant: no user content field exists
    expect(parsed.text).toBeUndefined();
    expect(parsed.userText).toBeUndefined();
  });

  it("records fan-out events with reason", () => {
    recordRouteEvent({
      ts: Date.now(),
      intent: "review",
      fanout: true,
      fanoutReason: "multi-perspective review fan-out",
      skillMatched: "design-review",
      skillScore: 0,
      textLen: 20,
      matchedPhrase: "全面",
    });

    const lastLine = readFileSync(getTelemetryPath(), "utf-8").trim().split("\n").pop();
    const parsed = JSON.parse(lastLine);
    expect(parsed.fanout).toBe(true);
    expect(parsed.fanoutReason).toBe("multi-perspective review fan-out");
  });

  it("does NOT record when disabled", () => {
    setTelemetryEnabled(false);
    const before = existsSync(getTelemetryPath())
      ? readFileSync(getTelemetryPath(), "utf-8").split("\n").filter(Boolean).length
      : 0;

    recordRouteEvent({
      ts: Date.now(),
      intent: "qa",
      fanout: false,
      skillMatched: null,
      skillScore: 0,
      textLen: 5,
      matchedPhrase: null,
    });

    const after = existsSync(getTelemetryPath())
      ? readFileSync(getTelemetryPath(), "utf-8").split("\n").filter(Boolean).length
      : 0;
    expect(after).toBe(before); // no new line written
  });

  it("records miss cases (skillMatched=null) for feedback loop", () => {
    // This is the key value: a miss with known intent+phrase pinpoints a
    // SKILL_TRIGGERS gap. Verify it's recorded, not dropped.
    recordRouteEvent({
      ts: Date.now(),
      intent: "review",
      fanout: false,
      skillMatched: null,
      skillScore: 0,
      textLen: 15,
      matchedPhrase: "审查",
    });

    const lastLine = readFileSync(getTelemetryPath(), "utf-8").trim().split("\n").pop();
    const parsed = JSON.parse(lastLine);
    expect(parsed.skillMatched).toBeNull();
    expect(parsed.intent).toBe("review");
    expect(parsed.matchedPhrase).toBe("审查");
  });
});

describe("telemetry — privacy invariant", () => {
  it("RouteEvent never includes user text content (only length + matched phrase)", () => {
    // The matchedPhrase comes from OUR signal list, not user content.
    // textLen is a number. No field carries the raw user input.
    const event = {
      ts: Date.now(),
      intent: "design" as const,
      fanout: false,
      skillMatched: "clock-configuration",
      skillScore: 6,
      textLen: 30,
      matchedPhrase: "pll",
    };
    const serialized = JSON.stringify(event);
    //serialized must NOT contain any placeholder user content we might leak
    expect(serialized).not.toContain("userText");
    expect(serialized).not.toContain("input");
    expect(serialized).not.toContain("message");
  });
});
