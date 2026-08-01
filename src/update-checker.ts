/**
 * Update checker for oh-y-lockie-agent.
 *
 * Notifies the user once when a newer version of the plugin is published to
 * npm. Deliberately notify-ONLY: we never auto-update (opencode caches the
 * installed package in ~/.cache/opencode/packages; reinstall is the user's
 * call).
 *
 * Flow (all async, fire-and-forget — never blocks the config hook):
 *   1. Debounce: state file (~/.opencode/oh-y-lockie-agent/update-state.json)
 *      stores lastCheckAt; skip when within intervalHours (default 24h).
 *   2. Fetch https://registry.npmjs.org/oh-y-lockie-agent/latest and compare
 *      against the running PKG_VERSION.
 *   3. On newer version: POST /tui/show-toast via client.tui.showToast with a
 *      retry schedule (3s / 8s / 15s) so a just-starting TUI has time to
 *      connect. Toast failures fall back to an append-only
 *      update-notice.log in the same directory.
 *   4. Same version already notified once → never re-notify (lastNotifiedVersion).
 *
 * Resilience: every failure path is swallowed — update checking must never
 * break plugin startup. All state writes are tmp→rename atomic (crash-safe,
 * same pattern as telemetry.ts).
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PluginInput } from "@opencode-ai/plugin";

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org/oh-y-lockie-agent/latest";
const DEFAULT_INTERVAL_HOURS = 24;
const STATE_FILENAME = "update-state.json";
const NOTICE_FILENAME = "update-notice.log";

/** Retry schedule for showToast (ms delays before attempts 2 and 3). */
const TOAST_RETRY_DELAYS_MS = [3_000, 8_000];
const TOAST_DURATION_MS = 8_000;

export interface UpdateCheckOptions {
  /** Running plugin version (from package.json). Required. */
  currentVersion: string;
  /** Master toggle (config updateCheck.enabled). Default true. */
  enabled?: boolean;
  /** Debounce window in hours. Default 24. */
  intervalHours?: number;
  /** npm registry endpoint. Overridable for tests. */
  registryUrl?: string;
  /** State/log directory. Defaults to ~/.opencode/oh-y-lockie-agent. */
  stateDir?: string;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable fallback logger (tests). */
  log?: (line: string) => void;
}

interface UpdateState {
  /** Unix epoch ms of the last registry check. */
  lastCheckAt: number;
  /** Version we already notified about (null = never notified). */
  lastNotifiedVersion: string | null;
}

function defaultStateDir(): string {
  return join(homedir(), ".opencode", "oh-y-lockie-agent");
}

// ─── Version comparison (no dependency) ─────────────────────────

interface ParsedVersion {
  core: [number, number, number];
  pre: string[] | undefined;
}

/** Parse "1.2.3", "v1.2.3-beta.1", "1.2.3-rc.2" → core + prerelease tags. */
function parseVersion(v: string): ParsedVersion {
  const raw = String(v).trim().replace(/^v/i, "");
  const [corePart, prePart] = raw.split("-", 2);
  const parts = corePart.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  while (parts.length < 3) parts.push(0);
  const core: [number, number, number] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const pre = prePart && prePart.length > 0 ? prePart.split(".") : undefined;
  return { core, pre };
}

/** Compare numeric prerelease identifiers; numeric < alphanumeric (semver spec). */
function comparePreId(a: string, b: string): number {
  const an = Number.isFinite(Number(a));
  const bn = Number.isFinite(Number(b));
  if (an && bn) return Number(a) - Number(b);
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePre(a: string[], b: string[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const c = comparePreId(a[i], b[i]);
    if (c !== 0) return c;
  }
  // Longer prerelease list wins when prefixes are equal ("1.0.0-alpha" < "1.0.0-alpha.1").
  return a.length - b.length;
}

/**
 * Semantic version compare. Returns <0 when a<b, 0 when equal, >0 when a>b.
 * Prerelease < release ("1.0.0-beta" < "1.0.0"). Malformed input degrades to
 * numeric core comparison rather than throwing — update checks are best-effort.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === undefined) return 1; // release > prerelease
  if (pb.pre === undefined) return -1;
  return comparePre(pa.pre, pb.pre);
}

// ─── State file (tmp→rename atomic) ─────────────────────────────

function readState(stateDir: string): UpdateState | null {
  try {
    const file = join(stateDir, STATE_FILENAME);
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UpdateState>;
    if (typeof parsed.lastCheckAt !== "number") return null;
    return {
      lastCheckAt: parsed.lastCheckAt,
      lastNotifiedVersion:
        typeof parsed.lastNotifiedVersion === "string" ? parsed.lastNotifiedVersion : null,
    };
  } catch {
    return null; // corrupted/missing state → treat as first run
  }
}

function writeState(stateDir: string, state: UpdateState): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, STATE_FILENAME);
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(state), "utf-8");
    renameSync(tmp, file);
  } catch {
    // Non-fatal: worst case we re-check next startup.
  }
}

function appendNoticeLog(stateDir: string, line: string): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(join(stateDir, NOTICE_FILENAME), line + "\n", "utf-8");
  } catch {
    // Non-fatal.
  }
}

// ─── Toast delivery ──────────────────────────────────────────────

function formatToastMessage(currentVersion: string, latest: string): string {
  return `v${currentVersion} → v${latest}（请手动更新：npm update oh-y-lockie-agent）`;
}

/**
 * Deliver the update toast with a retry schedule. Returns true when a toast
 * was confirmed delivered. Defensively accepts both direct boolean and
 * { data } request shapes across SDK versions.
 */
async function notifyWithRetry(
  client: PluginInput["client"],
  currentVersion: string,
  latest: string,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const body = {
    title: "oh-y-lockie-agent 有新版本",
    message: formatToastMessage(currentVersion, latest),
    variant: "info" as const,
    duration: TOAST_DURATION_MS,
  };
  for (let attempt = 0; attempt <= TOAST_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await sleep(TOAST_RETRY_DELAYS_MS[attempt - 1]);
    }
    try {
      const result = await client.tui.showToast({ body });
      const ok = typeof result === "boolean" ? result : result?.data === true;
      if (ok) return true;
    } catch {
      // Retry on transport/parse errors; last attempt exits the loop.
    }
  }
  return false;
}

// ─── Entry point ────────────────────────────────────────────────

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fire-and-forget update check. Never throws. Safe to call from the config
 * hook without awaiting.
 */
export async function checkForUpdate(
  client: PluginInput["client"],
  opts: UpdateCheckOptions,
): Promise<void> {
  const {
    currentVersion,
    enabled = true,
    intervalHours = DEFAULT_INTERVAL_HOURS,
    registryUrl = DEFAULT_REGISTRY_URL,
    stateDir = defaultStateDir(),
    now = Date.now,
    fetchImpl = fetch,
    sleep = defaultSleep,
    log = (line: string) => appendNoticeLog(stateDir, line),
  } = opts;

  if (!enabled || !currentVersion) return;

  try {
    const nowMs = now();
    const state = readState(stateDir);
    if (state && nowMs - state.lastCheckAt < intervalHours * 3_600_000) {
      return; // debounce: checked recently
    }

    const res = await fetchImpl(registryUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) return; // registry unreachable / 404 → silent, retry next startup
    const data = (await res.json()) as { version?: string };
    const latest = data?.version;
    if (!latest) return; // malformed payload → silent

    if (compareVersions(latest, currentVersion) <= 0) {
      // Up to date. Stamp lastCheckAt so we don't hammer the registry.
      writeState(stateDir, { lastCheckAt: nowMs, lastNotifiedVersion: state?.lastNotifiedVersion ?? null });
      return;
    }

    if (state?.lastNotifiedVersion === latest) {
      // Already notified about this exact version → refresh check time only.
      writeState(stateDir, { lastCheckAt: nowMs, lastNotifiedVersion: latest });
      return;
    }

    const delivered = await notifyWithRetry(client, currentVersion, latest, sleep);
    if (!delivered) {
      log(`[${new Date(nowMs).toISOString()}] update available: v${currentVersion} → v${latest}（toast 未送达，日志兜底）`);
    }
    writeState(stateDir, { lastCheckAt: nowMs, lastNotifiedVersion: latest });
  } catch {
    // Never throw: update checking is best-effort and must not break startup.
  }
}
