/**
 * Route telemetry for oh-y-lockie-agent.
 *
 * Records every skill-routing decision to a JSONL file so the team can measure
 * REAL routing quality (not just the eval suite's curated queries) and feed
 * gaps back into INTENT_SIGNALS / SKILL_TRIGGERS.
 *
 * Privacy: records ONLY the matched signal phrase + intent + skill + score +
 * text length. NEVER records user input content. A miss (skillMatched=null)
 * with a known intent + phrase pinpoints exactly which SKILL_TRIGGERS gap to fill.
 *
 * Resilience: all I/O is wrapped in try/catch — telemetry must NEVER break the
 * routing path. Rotation (7-day retention) uses tmp→rename atomic write so a
 * crash mid-rotation can't corrupt the file.
 *
 * Borrowed from oh-my-openagent's telemetry-diagnostics.jsonl pattern, trimmed
 * to route events only (single-package plugin doesn't need full diagnostics).
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TELEMETRY_DIR = join(homedir(), ".opencode", "oh-y-lockie-agent");
const TELEMETRY_FILE = join(TELEMETRY_DIR, "telemetry-routes.jsonl");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ROTATE_SIZE = 5 * 1024 * 1024; // 5MB triggers rotation

export interface RouteEvent {
  /** Unix epoch ms. */
  ts: number;
  /** Classified intent (design/review/debug/build/ship/plan/qa). */
  intent: string;
  /** Whether fan-out was triggered. */
  fanout: boolean;
  /** Why fan-out fired (telemetry label). */
  fanoutReason?: string;
  /** Skill that matchSkill selected, or null if no match. */
  skillMatched: string | null;
  /** matchSkill score (0 if no match). Weak scores on a frequent intent signal
   *  SKILL_TRIGGERS gaps. */
  skillScore: number;
  /** User text length (privacy: length only, no content). */
  textLen: number;
  /** The signal phrase that decided the intent (privacy: phrase from our list,
   *  not user content). Null when intent fell back to qa. */
  matchedPhrase: string | null;
}

let telemetryEnabled = true;

/** Toggle telemetry at startup from config (default on). */
export function setTelemetryEnabled(enabled: boolean): void {
  telemetryEnabled = enabled;
}

/** Path exposed for tests / analysis tooling. */
export function getTelemetryPath(): string {
  return TELEMETRY_FILE;
}

/**
 * Append a route event as one JSON line. Failures are swallowed — telemetry
 * must not affect routing. Rotation runs opportunistically when the file grows
 * past ROTATE_SIZE.
 */
export function recordRouteEvent(event: RouteEvent): void {
  if (!telemetryEnabled) return;
  try {
    if (!existsSync(TELEMETRY_DIR)) mkdirSync(TELEMETRY_DIR, { recursive: true });
    appendFileSync(TELEMETRY_FILE, JSON.stringify(event) + "\n", "utf-8");
    maybeRotate();
  } catch {
    // Swallow: telemetry is best-effort.
  }
}

/**
 * When the file exceeds ROTATE_SIZE, drop entries older than MAX_AGE_MS.
 * Uses tmp→rename so a crash mid-rotation leaves either the old or new file
 * intact, never a truncated one.
 */
function maybeRotate(): void {
  try {
    const stat = statSync(TELEMETRY_FILE);
    if (stat.size < ROTATE_SIZE) return;

    const cutoff = Date.now() - MAX_AGE_MS;
    const raw = readFileSync(TELEMETRY_FILE, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const kept: string[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as RouteEvent;
        if (e.ts >= cutoff) kept.push(line);
      } catch {
        // Skip malformed lines rather than failing rotation.
      }
    }
    const tmp = TELEMETRY_FILE + ".tmp";
    writeFileSync(tmp, kept.join("\n") + (kept.length ? "\n" : ""), "utf-8");
    renameSync(tmp, TELEMETRY_FILE);
  } catch {
    // Rotation failure is non-fatal.
  }
}
