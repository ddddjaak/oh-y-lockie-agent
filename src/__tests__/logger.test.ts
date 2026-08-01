import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Isolate from the real ~/.opencode/oh-y-lockie-agent dir — logger writes its
// debug.log under node:os.homedir(), so stub homedir to an isolated path.
vi.mock("node:os", () => ({
  homedir: () =>
    process.platform === "win32" ? "C:\\lockie-logger-home" : "/lockie-logger-home",
  tmpdir: () =>
    process.platform === "win32" ? "C:\\lockie-logger-tmp" : "/tmp",
}));

const LOGGER_DIR = join(
  process.platform === "win32" ? "C:\\lockie-logger-home" : "/lockie-logger-home",
  ".opencode",
  "oh-y-lockie-agent",
);
const LOG_FILE = join(LOGGER_DIR, "debug.log");

// Re-import after env setup so the module's homedir() stub is used.
import { log, warn, error, getDebugLogPath } from "../logger.js";

const savedDebug = process.env.LOCKIE_DEBUG;

beforeEach(() => {
  delete process.env.LOCKIE_DEBUG;
  delete process.env.OH_Y_LOCKIE_DEBUG;
  rmSync(LOGGER_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(LOGGER_DIR, { recursive: true, force: true });
  if (savedDebug === undefined) delete process.env.LOCKIE_DEBUG;
  else process.env.LOCKIE_DEBUG = savedDebug;
});

describe("logger — stdout gating", () => {
  it("keeps info logs silent on stdout by default (no LOCKIE_DEBUG)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("emits info logs to stdout when LOCKIE_DEBUG=1", () => {
    process.env.LOCKIE_DEBUG = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hello", { a: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("[oh-y-lockie-agent]");
    expect(spy.mock.calls[0]?.[0]).toContain("hello");
    spy.mockRestore();
  });

  it("emits warn/error to stdout regardless of LOCKIE_DEBUG", () => {
    const w = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = vi.spyOn(console, "error").mockImplementation(() => {});
    warn("careful");
    error("boom");
    expect(w).toHaveBeenCalledTimes(1);
    expect(e).toHaveBeenCalledTimes(1);
    w.mockRestore();
    e.mockRestore();
  });

  it("honors OH_Y_LOCKIE_DEBUG alias", () => {
    process.env.OH_Y_LOCKIE_DEBUG = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hi");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("logger — file persistence", () => {
  it("always writes debug.log with level and timestamp", () => {
    log("info line");
    warn("warn line");
    error("error line");

    expect(existsSync(LOG_FILE)).toBe(true);
    const content = readFileSync(LOG_FILE, "utf-8");
    expect(content).toContain("[info] [oh-y-lockie-agent] info line");
    expect(content).toContain("[warn] [oh-y-lockie-agent] warn line");
    expect(content).toContain("[error] [oh-y-lockie-agent] error line");
    // ISO timestamp prefix, e.g. [2026-08-01T07:00:00.000Z]
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[info\]/);
  });

  it("formats non-string args as JSON", () => {
    log("obj", { k: "v" }, [1, 2]);
    const content = readFileSync(LOG_FILE, "utf-8");
    expect(content).toContain('{"k":"v"}');
    expect(content).toContain("[1,2]");
  });

  it("exposes the debug log path", () => {
    expect(getDebugLogPath()).toBe(LOG_FILE);
  });
});
