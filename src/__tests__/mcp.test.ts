import { describe, it, expect } from "vitest";
import { getPlatformCommand, CANONICAL_MCP_SERVERS, getCanonicalMcpServers } from "../mcp.js";

// ─── getPlatformCommand ─────────────────────────────────────────

describe("getPlatformCommand", () => {
  it("adds cmd /c prefix on Windows when command does not start with cmd", () => {
    const result = getPlatformCommand(["npx", "-y", "some-package"], true);
    expect(result).toEqual(["cmd", "/c", "npx", "-y", "some-package"]);
  });

  it("does not add cmd /c prefix on Windows when command already starts with cmd", () => {
    const result = getPlatformCommand(["cmd", "/c", "npx", "-y", "some-package"], true);
    expect(result).toEqual(["cmd", "/c", "npx", "-y", "some-package"]);
  });

  it("returns command as-is on non-Windows", () => {
    const result = getPlatformCommand(["npx", "-y", "some-package"], false);
    expect(result).toEqual(["npx", "-y", "some-package"]);
  });

  it("returns codegraph command unchanged on non-Windows", () => {
    const result = getPlatformCommand(["codegraph", "serve", "--mcp"], false);
    expect(result).toEqual(["codegraph", "serve", "--mcp"]);
  });
});

// ─── CANONICAL_MCP_SERVERS ──────────────────────────────────────

describe("CANONICAL_MCP_SERVERS", () => {
  it("defines all 4 MCP servers", () => {
    expect(Object.keys(CANONICAL_MCP_SERVERS)).toEqual([
      "codegraph",
      "context7",
      "memory",
      "sequential-thinking",
    ]);
  });

  it("codegraph uses pure command without cmd /c", () => {
    expect(CANONICAL_MCP_SERVERS.codegraph.command).toEqual(["codegraph", "serve", "--mcp"]);
  });

  it("context7 uses pure npx command without cmd /c", () => {
    expect(CANONICAL_MCP_SERVERS.context7.command).toEqual(["npx", "-y", "@upstash/context7-mcp"]);
  });

  it("all servers are type local", () => {
    for (const def of Object.values(CANONICAL_MCP_SERVERS)) {
      expect(def.type).toBe("local");
    }
  });

  it("all servers are enabled", () => {
    for (const def of Object.values(CANONICAL_MCP_SERVERS)) {
      expect(def.enabled).toBe(true);
    }
  });

  it("no command contains cmd /c (pure commands only)", () => {
    for (const def of Object.values(CANONICAL_MCP_SERVERS)) {
      expect(def.command![0]).not.toBe("cmd");
    }
  });
});

// ─── getCanonicalMcpServers ─────────────────────────────────────

describe("getCanonicalMcpServers", () => {
  it("returns all 4 servers", () => {
    const servers = getCanonicalMcpServers();
    expect(Object.keys(servers)).toEqual([
      "codegraph",
      "context7",
      "memory",
      "sequential-thinking",
    ]);
  });

  it("preserves server structure", () => {
    const servers = getCanonicalMcpServers();
    expect(servers.codegraph.type).toBe("local");
    expect(servers.codegraph.enabled).toBe(true);
    expect(servers.codegraph.command).toBeDefined();
  });
});
