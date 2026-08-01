import { describe, it, expect, vi } from "vitest";
import { lockieServer } from "../index.js";
import type { Hooks } from "@opencode-ai/plugin";
import { ROUTE_MARKER } from "../skills.js";

/**
 * Hook behavior tests for src/index.ts.
 *
 * These cover the three runtime hooks that previously had ZERO test protection:
 *   - config                              : agent + MCP injection
 *   - chat.message                        : skill routing prepend
 *   - experimental.chat.system.transform  : routing table injection
 *
 * node:os.homedir() is mocked so loadPluginConfig never reads the real
 * ~/.config/opencode/oh-y-lockie-agent.jsonc (deterministic across machines).
 * vi.mock (not spyOn) is required — node:os exposes a read-only ESM namespace.
 */
vi.mock("node:os", () => ({
  homedir: () =>
    process.platform === "win32" ? "C:\\lockie-isolated-home" : "/lockie-isolated-home",
  tmpdir: () =>
    process.platform === "win32" ? "C:\\lockie-isolated-tmp" : "/tmp",
}));

/** Boot the plugin once and cache the hooks — lockieServer is the entry point. */
async function getHooks(): Promise<Hooks> {
  return lockieServer({} as never);
}

// ─── config hook ────────────────────────────────────────────────

describe("config hook", () => {
  it("injects built-in agents", async () => {
    const hooks = await getHooks();
    const cfg: Record<string, unknown> = {};
    await hooks.config!(cfg as never);

    const agent = cfg.agent as Record<string, unknown>;
    expect(agent.architect).toBeDefined();
    expect(agent.firmware).toBeDefined();
    expect(agent["code-reviewer"]).toBeDefined();
  });

  it("does NOT clobber agents the user already defined", async () => {
    const hooks = await getHooks();
    const userDefined = { model: "user/custom-model", prompt: "user prompt" };
    const cfg: Record<string, unknown> = { agent: { "my-custom": userDefined } };
    await hooks.config!(cfg as never);

    const agent = cfg.agent as Record<string, unknown>;
    // user-defined agent untouched
    expect(agent["my-custom"]).toEqual(userDefined);
    // built-in still injected alongside
    expect(agent.architect).toBeDefined();
  });

  it("applies disable overrides for built-in explore/general", async () => {
    const hooks = await getHooks();
    const cfg = {} as Record<string, unknown>;
    await hooks.config!(cfg as never);

    const agent = cfg.agent as Record<string, { disable?: boolean }>;
    expect(agent.explore?.disable).toBe(true);
    expect(agent.general?.disable).toBe(true);
  });

  it("injects MCP server definitions", async () => {
    const hooks = await getHooks();
    const cfg = {} as Record<string, unknown>;
    await hooks.config!(cfg as never);

    const mcp = cfg.mcp as Record<string, unknown>;
    expect(mcp.codegraph).toBeDefined();
    expect(mcp.context7).toBeDefined();
    expect(mcp.memory).toBeDefined();
    expect(mcp["sequential-thinking"]).toBeDefined();
  });
});

// ─── chat.message hook ──────────────────────────────────────────

describe("chat.message hook", () => {
  it("does NOT route for non-lockie agents", async () => {
    const hooks = await getHooks();
    const parts: unknown[] = [{ type: "text", text: "I need a bootloader design", id: "p1" }];
    const msgInput = { agent: "some-other-agent", sessionID: "s1", model: { modelID: "x" } };
    const msgOutput = { parts, message: { id: "m1" } };

    await hooks["chat.message"]!(msgInput as never, msgOutput as never);

    // No SKILL_ROUTE prepended for non-lockie agents
    expect(parts.length).toBe(1);
    expect((parts[0] as { text: string }).text).not.toContain("[SKILL_ROUTE]");
  });

  it("prepends SKILL_ROUTE when a lockie agent receives a keyword match", async () => {
    const hooks = await getHooks();
    // "bootloader" is a known keyword in the real skills index
    const parts: unknown[] = [
      { type: "text", text: "help me design a bootloader with secure boot", id: "p1" },
    ];
    const msgInput = { agent: "architect", sessionID: "s1", model: { modelID: "x" } };
    const msgOutput = { parts, message: { id: "m1" } };

    await hooks["chat.message"]!(msgInput as never, msgOutput as never);

    expect(parts.length).toBe(2);
    const routed = parts[0] as { text: string; synthetic?: boolean };
    expect(routed.text).toContain("[SKILL_ROUTE]");
    expect(routed.synthetic).toBe(true);
  });

  it("does not route when input matches no skill keyword", async () => {
    const hooks = await getHooks();
    const parts: unknown[] = [{ type: "text", text: "hello world, nothing to match", id: "p1" }];
    const msgInput = { agent: "architect", sessionID: "s1", model: { modelID: "x" } };
    const msgOutput = { parts, message: { id: "m1" } };

    await hooks["chat.message"]!(msgInput as never, msgOutput as never);

    expect(parts.length).toBe(1);
    expect((parts[0] as { text: string }).text).not.toContain("[SKILL_ROUTE]");
  });
});

// ─── experimental.chat.system.transform hook ────────────────────

describe("experimental.chat.system.transform hook", () => {
  it("injects the skill routing table and reference index into the system prompt", async () => {
    const hooks = await getHooks();
    const sysOutput = { system: ["existing system text"] };

    await hooks["experimental.chat.system.transform"]!({} as never, sysOutput as never);

    // original + routing table + reference index
    expect(sysOutput.system.length).toBe(3);
    expect(sysOutput.system.some((s) => s.includes(ROUTE_MARKER))).toBe(true);
  });

  it("does NOT inject the routing table twice on repeated calls", async () => {
    const hooks = await getHooks();
    const sysOutput = { system: ["existing"] };

    await hooks["experimental.chat.system.transform"]!({} as never, sysOutput as never);
    await hooks["experimental.chat.system.transform"]!({} as never, sysOutput as never);

    const markerCount = sysOutput.system.filter((s) => s.includes(ROUTE_MARKER)).length;
    expect(markerCount).toBe(1);
    const refCount = sysOutput.system.filter((s) => s.includes("[oh-y-lockie-agent 参考文档]")).length;
    expect(refCount).toBe(1);
  });
});

// ─── plugin tools ───────────────────────────────────────────────

describe("plugin tools", () => {
  it("exposes lockie_list_agents and lockie_status", async () => {
    const hooks = await getHooks();
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!.lockie_list_agents).toBeDefined();
    expect(hooks.tool!.lockie_status).toBeDefined();
  });

  it("lockie_list_agents returns categorized agents", async () => {
    const hooks = await getHooks();
    const tool = hooks.tool!.lockie_list_agents as { execute: (args?: { category?: string }) => Promise<string> };
    const output = await tool.execute({ category: "all" });
    expect(output).toContain("主 Agent:");
    expect(output).toContain("architect");
    expect(output).toContain("审查类: code-reviewer");
  });

  it("lockie_status reports agents, skills, mcp and config", async () => {
    const hooks = await getHooks();
    const tool = hooks.tool!.lockie_status as { execute: () => Promise<string> };
    const output = await tool.execute();
    expect(output).toContain("健康状态");
    expect(output).toContain("[agents]");
    expect(output).toContain("[skills]");
    expect(output).toContain("[mcp]");
    expect(output).toContain("[config]");
  });
});

// ─── tool.execute.before hook — arg guard ──────────────────────
describe("tool.execute.before hook — null-byte scrubbing", () => {
  it("scrubs null bytes from string args in place (nested + arrays)", async () => {
    const hooks = await getHooks();
    const args: Record<string, unknown> = {
      name: "file\0name",
      nested: { val: "a\0b" },
      arr: ["x\0y", 123, null],
    };
    await hooks["tool.execute.before"]!({ tool: "t", sessionID: "s", callID: "c" }, { args });

    expect(args.name).toBe("filename");
    expect((args.nested as { val: string }).val).toBe("ab");
    expect((args.arr as unknown[])[0]).toBe("xy");
    expect((args.arr as unknown[])[1]).toBe(123); // non-string untouched
  });

  it("does not crash on empty / null / non-object args", async () => {
    const hooks = await getHooks();
    const call = hooks["tool.execute.before"]!;
    await call({ tool: "t", sessionID: "s", callID: "c" }, { args: null });
    await call({ tool: "t", sessionID: "s", callID: "c" }, { args: {} });
    await call({ tool: "t", sessionID: "s", callID: "c" }, { args: [] });
    await call({ tool: "t", sessionID: "s", callID: "c" }, { args: "plain\0string" });
  });
});

// ─── event hook — error recording ──────────────────────────────

describe("event hook — error recording", () => {
  it("does not throw on normal events", async () => {
    const hooks = await getHooks();
    await hooks.event!({ event: { type: "session.created", properties: {} } } as never);
  });

  it("records error events without throwing", async () => {
    const hooks = await getHooks();
    // error event → console.error internally; we only verify no throw
    await hooks.event!({
      event: { type: "message.error", properties: { reason: "rate_limit" } },
    } as never);
  });

  it("handles events without a type field defensively", async () => {
    const hooks = await getHooks();
    await hooks.event!({ event: {} } as never);
  });
});
