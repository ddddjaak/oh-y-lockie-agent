/**
 * Logging facade for oh-y-lockie-agent.
 *
 * WHY THIS EXISTS (v1.1.1):
 *   Plugin console.log output is rendered into the opencode TUI input-box area,
 *   polluting the UI. So plain info logs must be SILENT by default. But the
 *   plugin's own developer still needs logs to debug — hence the runtime switch.
 *
 *   - `log`  (info)   → stdout ONLY when LOCKIE_DEBUG=1; always written to file
 *   - `warn` / `error`→ stdout always (rare, signal real problems); file too
 *   - File: ~/.opencode/oh-y-lockie-agent/debug.log, 7-day / 5MB rotation
 *     (tmp→rename atomic, same pattern as telemetry.ts) — so production users
 *     can inspect logs post-hoc without restarting with an env var.
 *
 * Debug usage:  LOCKIE_DEBUG=1 opencode
 */

import { mkdirSync, existsSync, appendFileSync, readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PREFIX = "[oh-y-lockie-agent]";
const DEBUG_DIR = join(homedir(), ".opencode", "oh-y-lockie-agent");
const DEBUG_FILE = join(DEBUG_DIR, "debug.log");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ROTATE_SIZE = 5 * 1024 * 1024; // 5MB triggers rotation

/** Runtime toggle — read at call time so tests can flip the env var. */
function isDebug(): boolean {
  return process.env.LOCKIE_DEBUG === "1" || process.env.OH_Y_LOCKIE_DEBUG === "1";
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function appendFile(line: string, level: "info" | "warn" | "error"): void {
  try {
    if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
    appendFileSync(DEBUG_FILE, `[${new Date().toISOString()}] [${level}] ${line}\n`, "utf-8");
    maybeRotate();
  } catch {
    // Non-fatal: logging must never break the plugin.
  }
}

/**
 * Info-level log. Silent on stdout unless LOCKIE_DEBUG=1; always written to
 * debug.log. Use for routine lifecycle/startup messages.
 */
export function log(...args: unknown[]): void {
  const line = `${PREFIX} ${args.map(formatArg).join(" ")}`;
  if (isDebug()) console.log(line);
  appendFile(line, "info");
}

/** Warning-level log. Always shown on stdout (rare, soft problems). */
export function warn(...args: unknown[]): void {
  const line = `${PREFIX} ${args.map(formatArg).join(" ")}`;
  console.warn(line);
  appendFile(line, "warn");
}

/** Error-level log. Always shown on stdout (real problems). */
export function error(...args: unknown[]): void {
  const line = `${PREFIX} ${args.map(formatArg).join(" ")}`;
  console.error(line);
  appendFile(line, "error");
}

/** Path exposed for tests / tooling. */
export function getDebugLogPath(): string {
  return DEBUG_FILE;
}

/** Drop entries older than MAX_AGE_MS when the file exceeds ROTATE_SIZE. */
function maybeRotate(): void {
  try {
    const stat = statSync(DEBUG_FILE);
    if (stat.size < ROTATE_SIZE) return;

    const cutoff = Date.now() - MAX_AGE_MS;
    const raw = readFileSync(DEBUG_FILE, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const kept: string[] = [];
    for (const line of lines) {
      const m = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
      if (!m) continue; // skip malformed lines rather than failing rotation
      if (Date.parse(m[1]) >= cutoff) kept.push(line);
    }
    const tmp = DEBUG_FILE + ".tmp";
    writeFileSync(tmp, kept.join("\n") + (kept.length ? "\n" : ""), "utf-8");
    renameSync(tmp, DEBUG_FILE);
  } catch {
    // Rotation failure is non-fatal.
  }
}
