import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { checkForUpdate, compareVersions } from "../update-checker.js";

// ─── Test helpers ────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lockie-update-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a fake client whose showToast is a vi.fn. */
function makeClient(impl?: () => unknown) {
  const showToast = vi.fn(impl ?? (() => true));
  return { client: { tui: { showToast } } as unknown as PluginInput["client"], showToast };
}

/** Instant fetch stub returning a JSON registry payload. */
function okFetch(version: string): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({ version }), { status: 200 })) as typeof fetch;
}

function failFetch(status = 500): typeof fetch {
  return vi.fn(async () => new Response("boom", { status })) as typeof fetch;
}

function stateFile(dir: string): string {
  return join(dir, "update-state.json");
}

function readState(dir: string): { lastCheckAt: number; lastNotifiedVersion: string | null } | null {
  const file = stateFile(dir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8")) as { lastCheckAt: number; lastNotifiedVersion: string | null };
}

const noSleep = async () => {};

// ─── compareVersions ─────────────────────────────────────────────

describe("compareVersions", () => {
  it("orders patch/minor/major correctly", () => {
    expect(compareVersions("1.0.2", "1.1.0")).toBeLessThan(0);
    expect(compareVersions("1.1.0", "1.0.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("treats equal versions as 0", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("accepts a leading v", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  it("treats prerelease as lower than release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
  });

  it("orders prerelease tags per semver", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha.1")).toBeGreaterThan(0);
  });

  it("degrades malformed input without throwing", () => {
    expect(() => compareVersions("garbage", "1.0.0")).not.toThrow();
    expect(compareVersions("", "")).toBe(0);
  });
});

// ─── checkForUpdate — core behavior ─────────────────────────────

describe("checkForUpdate", () => {
  it("shows a toast and stamps state when a newer version exists", async () => {
    const { client, showToast } = makeClient();
    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: okFetch("1.1.0"),
      sleep: noSleep,
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    const body = showToast.mock.calls[0]?.[0] as { body?: { title?: string; message?: string; variant?: string } };
    expect(body.body?.variant).toBe("info");
    expect(body.body?.title).toContain("有新版本");
    expect(body.body?.message).toContain("v1.0.2 → v1.1.0");

    const state = readState(tmpDir);
    expect(state?.lastNotifiedVersion).toBe("1.1.0");
    expect(state?.lastCheckAt).toBeGreaterThan(0);
  });

  it("does not toast when already up to date (stamps check time only)", async () => {
    const { client, showToast } = makeClient();
    await checkForUpdate(client, {
      currentVersion: "1.1.0",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: okFetch("1.1.0"),
      sleep: noSleep,
    });

    expect(showToast).not.toHaveBeenCalled();
    const state = readState(tmpDir);
    expect(state?.lastCheckAt).toBeGreaterThan(0);
    expect(state?.lastNotifiedVersion).toBeNull();
  });

  it("is silent on registry failure (non-OK response)", async () => {
    const { client, showToast } = makeClient();
    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: failFetch(500),
      sleep: noSleep,
    });

    expect(showToast).not.toHaveBeenCalled();
    expect(readState(tmpDir)).toBeNull(); // no state written on failed check
  });

  it("is silent when fetch throws (offline)", async () => {
    const { client, showToast } = makeClient();
    const throwingFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    await expect(
      checkForUpdate(client, {
        currentVersion: "1.0.2",
        registryUrl: "https://registry.example/latest",
        stateDir: tmpDir,
        fetchImpl: throwingFetch,
        sleep: noSleep,
      }),
    ).resolves.toBeUndefined(); // never throws

    expect(showToast).not.toHaveBeenCalled();
  });

  it("is silent on malformed registry payload", async () => {
    const { client, showToast } = makeClient();
    const badFetch = vi.fn(async () => new Response("not-json", { status: 200 })) as typeof fetch;

    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: badFetch,
      sleep: noSleep,
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not re-notify for a version already notified", async () => {
    // Seed state: already notified about 1.1.0.
    const { client, showToast } = makeClient();
    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: okFetch("1.1.0"),
      sleep: noSleep,
    });
    expect(showToast).toHaveBeenCalledTimes(1);

    // Second run (new check window) — same latest, must not toast again.
    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: okFetch("1.1.0"),
      sleep: noSleep,
      now: () => Date.now() + 100_000_000, // jump past debounce
    });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("skips the check entirely when disabled", async () => {
    const { client, showToast } = makeClient();
    const fetchSpy = okFetch("9.9.9");
    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      enabled: false,
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: fetchSpy,
      sleep: noSleep,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("respects the debounce window (no fetch when recently checked)", async () => {
    const { client } = makeClient();
    const fetchSpy = okFetch("1.1.0");

    // Seed a recent check.
    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: fetchSpy,
      sleep: noSleep,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Immediately re-check within the 24h window → fetch must not fire again.
    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: fetchSpy,
      sleep: noSleep,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the notice log when all toast attempts fail", async () => {
    const { client, showToast } = makeClient(() => false); // toast never delivers
    const log = vi.fn();

    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: okFetch("1.2.0"),
      sleep: noSleep,
      log,
    });

    expect(showToast).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("v1.0.2 → v1.2.0");
    // State still records the notification so we don't re-toast next window.
    expect(readState(tmpDir)?.lastNotifiedVersion).toBe("1.2.0");
  });

  it("retries until a toast succeeds and then skips the log", async () => {
    let calls = 0;
    const { client, showToast } = makeClient(() => (++calls === 2 ? true : false));
    const log = vi.fn();

    await checkForUpdate(client, {
      currentVersion: "1.0.2",
      registryUrl: "https://registry.example/latest",
      stateDir: tmpDir,
      fetchImpl: okFetch("1.3.0"),
      sleep: noSleep,
      log,
    });

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
  });
});
