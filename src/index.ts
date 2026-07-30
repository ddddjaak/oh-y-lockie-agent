import type { PluginInput, Hooks, Config, PluginModule } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { z } from "zod";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { loadPluginConfig } from "./config.js";
import {
  collectAgents,
  getAgentKeys,
  getActiveAgentKeys,
  buildAgentCategoryMap,
  agentSources,
} from "./agents/index.js";
import type { AgentOverride } from "./agents/types.js";
import { buildSkillTable, matchSkillDetail, SKILL_ROUTE_TABLE, ROUTE_MARKER } from "./skills.js";
import type { SkillEntry } from "./skills.js";
import { classifyIntentWithDetail, detectFanout } from "./intent.js";
import { diagnoseMcpStatus } from "./mcp.js";
import { recordRouteEvent, setTelemetryEnabled } from "./telemetry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

function getPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch (err) {
    // Non-fatal: version is cosmetic (used only in log lines). But we log the
    // failure so a corrupted package.json doesn't disappear silently.
    console.error("[oh-y-lockie-agent] failed to read package.json version:", err);
    return "unknown";
  }
}
const PKG_VERSION = getPkgVersion();

// ─── Module-level state ──────────────────────────────────────────

let skillTable: SkillEntry[] = [];

// ─── Agent listing tool ──────────────────────────────────────────

const lockieListAgentsTool = tool({
  description: "列出 oh-y-lockie-agent 提供的所有 agent (14 个 subagent + 2 个主 agent)",
  args: {
    category: z.enum(["all", "design", "review", "domain", "quality"]).optional().default("all"),
  },
  async execute(args) {
    // Re-read config at tool-call time so overrides are hot-reload safe.
    const { overrides } = loadPluginConfig();
    const categories = buildAgentCategoryMap(overrides);

    const cat = args.category || "all";
    if (cat === "all") {
      const primary = categories.primary.join(", ");
      const design = categories.design.join(", ");
      const review = categories.review.join(", ");
      const domain = categories.domain.join(", ");
      const quality = categories.quality.join(", ");
      return (
        `oh-y-lockie-agent v${PKG_VERSION} 提供:\n` +
        `主 Agent: ${primary}\n` +
        `设计类: ${design}\n` +
        `审查类: ${review}\n` +
        `领域专家: ${domain}\n` +
        `质量保障: ${quality}`
      );
    }
    const list = categories[cat as keyof typeof categories] || [];  // safe: cat is one of "design"|"review"|"domain"|"quality"; "all" is handled above
    return `${cat} 类 agent: ${list.join(", ")}`;
  },
});

// ─── Tool arg guards & event recording ──────────────────────────

/**
 * Recursively strip null bytes (\0) from string values in a tool-call args
 * object. Null bytes in args can reach shell tools and cause injection or
 * truncation. Always-on, permission-free guard — future debugger-mcp write
 * operations will layer stricter confirmation on top.
 *
 * Mutates in place: OpenCode passes `output.args` as a mutable container.
 */
function scrubNullBytes(value: unknown): void {
  if (typeof value === "string") return; // immutable; caller reassigns via container
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] === "string") {
        value[i] = (value[i] as string).replace(/\0/g, "");
      } else {
        scrubNullBytes(value[i]);
      }
    }
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "string") {
        obj[k] = (obj[k] as string).replace(/\0/g, "");
      } else {
        scrubNullBytes(obj[k]);
      }
    }
  }
}

/**
 * Record OpenCode runtime events. Surfaces errors loudly so they don't vanish
 * silently (the previous behavior was try/catch + console.log only on direct
 * plugin calls). Full model-fallback — auto-retry on a backup model after an
 * API error — needs OpenCode runtime support (plugins can observe errors but
 * cannot re-issue requests); this hook is the foundation: it records errors
 * now, and a future telemetry-diagnostics.jsonl + fallback trigger can build
 * on it.
 */
function recordEvent(event: unknown): void {
  // Event shape varies across OpenCode versions; match defensively.
  const e = event as { type?: string; properties?: Record<string, unknown> };
  const type = e?.type ?? "unknown";
  if (type.includes("error") || type.includes("Error")) {
    console.error(`[oh-y-lockie-agent] event ${type}:`, e?.properties ?? "(no details)");
  }
}

// ─── Plugin hooks ────────────────────────────────────────────────

const lockieServer = async (input: PluginInput): Promise<Hooks> => {
  // Load user-tunable config from the priority chain（含项目级 cwd）
  const cwd = process.cwd();
  const { overrides, mcp: mcpConfig, telemetry: telemetryEnabled } = loadPluginConfig(cwd);

  // Telemetry toggle (default on; config can disable for privacy-sensitive envs)
  setTelemetryEnabled(telemetryEnabled !== false);

  // Build skill index at init
  const skillsDir = join(PKG_ROOT, "skills", "opencode");
  skillTable = buildSkillTable(skillsDir);

  const agentKeys = getActiveAgentKeys(overrides);
  const allAgentKeys = getAgentKeys();
  console.log(`[oh-y-lockie-agent v${PKG_VERSION}] 已加载 ${agentKeys.length} 个活跃 agent 定义`);

  // ─── MCP 状态诊断 ──────────────────────────────────────────────
  const mcpStatus = diagnoseMcpStatus();
  if (mcpStatus.missing.length > 0) {
    console.log(
      `[oh-y-lockie-agent] ⚠ MCP 服务器未在 opencode.json 中配置: ${mcpStatus.missing.join(", ")}\n` +
      `  运行 npx oh-y-lockie-agent setup-mcp 自动配置，或手动添加至 opencode.json 的 "mcp" 段`,
    );
  } else {
    console.log(`[oh-y-lockie-agent] MCP 服务器状态: ${mcpStatus.configured.join(", ")} ✅`);
  }

  return {
    config: async (cfg: Config) => {
      if (!cfg.agent) cfg.agent = {};
      // safe: Config.agent is an open string-keyed map; we only inject built-in
      // agents and never read typed fields back through this reference.
      const target = cfg.agent as Record<string, unknown>;

      // Inject our built-in agents (user override > factory default model).
      // We never clobber agents the user already defined in opencode.json.
      const agents = collectAgents(overrides);
      for (const [key, val] of Object.entries(agents)) {
        if (!(key in target)) {
          target[key] = val;
        }
      }

      // Apply built-in agent disable overrides (explore / general, etc.)
      for (const [name, ov] of Object.entries(overrides)) {
        if (ov.disable && !(name in agentSources)) {
          target[name] = { disable: true };
        }
      }

      // MCP 服务器注入（补充层）
      // 主机制：静态 opencode.json 声明（由 postinstall/setup-mcp 管理）
      // 补充层：plugin config hook 注入 cfg.mcp（兼容未来 OpenCode 版本）
      // 注意：当前 OpenCode 的 MCP 生命周期在 config hook 之前初始化，
      //       此补充层仅作为后续版本兼容，不保证启动 MCP 服务。
      if (!cfg.mcp) cfg.mcp = {};
      // safe: Config.mcp is an open string-keyed map; we only inject server
      // definitions and never read typed fields back through this reference.
      const mcpTarget = cfg.mcp as Record<string, unknown>;
      for (const [key, value] of Object.entries(mcpConfig)) {
        if (!(key in mcpTarget)) {
          mcpTarget[key] = value;
        }
      }

      console.log(
        `[oh-y-lockie-agent] config 注入完成 — agents: ${
          Object.keys(cfg.agent || {}).length
        }, mcp: ${Object.keys(cfg.mcp || {}).length}`,
      );
    },

    "chat.message": async (msgInput, msgOutput) => {
      // 1. Log lockie agent usage
      const agent = msgInput.agent || "unknown";
      if (allAgentKeys.includes(agent)) {
        console.log(`[lockie] agent=${agent} model=${msgInput.model?.modelID || "?"}`);
      }

      // 2. Only route skills for lockie agents
      if (!allAgentKeys.includes(agent)) return;

      // 3. Extract user text
      const textPart = msgOutput.parts.find((p) => p.type === "text") as
        | { type: "text"; text: string; id?: string }
        | undefined;
      if (!textPart || !textPart.text) return;

      // 4. Intent classification — the middle layer that prevents cross-category
      //    mismatches (e.g. "PLL 对不对" is review, not design).
      //    Use WithDetail to capture the deciding signal phrase for telemetry.
      const { intent, matchedPhrase } = classifyIntentWithDetail(textPart.text);

      // 5. Fan-out detection — "全面审查"/"ship review" triggers multi-agent orchestration
      const fanout = detectFanout(textPart.text, intent);
      if (fanout.fanout) {
        const instruction =
          fanout.skill === "ship-review"
            ? `[SKILL_ROUTE] 用户请求发布前审查（fan-out）。请先用 skill 工具加载 "ship-review" skill，它协调代码/安全/测试三视角审查并汇总 go/no-go。`
            : `[SKILL_ROUTE] 用户请求多视角审查（fan-out）。请用 agent 工具并行调用 ${fanout.agents.join("、")} 进行多视角审查，然后汇总各 agent 结论给出综合判断。`;
        msgOutput.parts.unshift({
          id: textPart.id || randomUUID(),
          sessionID: msgInput.sessionID,
          messageID: msgInput.messageID ?? msgOutput.message.id,
          type: "text",
          text: instruction,
          synthetic: true,
          ignored: true,
          time: { start: Date.now() },
        });
        console.log(`[oh-y-lockie-agent] fan-out: ${fanout.reason} (intent=${intent})`);
        recordRouteEvent({
          ts: Date.now(), intent, fanout: true, fanoutReason: fanout.reason,
          skillMatched: fanout.skill ?? null, skillScore: 0,
          textLen: textPart.text.length, matchedPhrase,
        });
        return;
      }

      // 6. Intent-restricted single skill routing — match only within the
      //    intent's skill subset to avoid cross-category mismatches.
      const matchDetail = matchSkillDetail(textPart.text, skillTable, intent);

      // Record telemetry for EVERY route attempt (match or miss). Misses with a
      // known intent + phrase pinpoint SKILL_TRIGGERS gaps to fill.
      recordRouteEvent({
        ts: Date.now(), intent, fanout: false,
        skillMatched: matchDetail?.entry.name ?? null,
        skillScore: matchDetail?.score ?? 0,
        textLen: textPart.text.length, matchedPhrase,
      });

      if (!matchDetail) return;
      const match = matchDetail.entry;

      // 7. Prepend routing instruction
      msgOutput.parts.unshift({
        id: textPart.id || randomUUID(),
        sessionID: msgInput.sessionID,
        messageID: msgInput.messageID ?? msgOutput.message.id,
        type: "text",
        text: `[SKILL_ROUTE] (intent=${intent}) 请先用 skill 工具加载 "${match.name}" skill，再用该 skill 的指令处理用户问题。`,
        synthetic: true,
        ignored: true,
        time: { start: Date.now() },
      });
      console.log(`[oh-y-lockie-agent] skill route: "${match.name}" (intent=${intent})`);
    },

    "experimental.chat.system.transform": async (_sysInput, sysOutput) => {
      // Prevent duplicate injection
      const alreadyInjected = sysOutput.system.some((s) => s.includes(ROUTE_MARKER));
      if (!alreadyInjected) {
        sysOutput.system.push(SKILL_ROUTE_TABLE);
        console.log("[oh-y-lockie-agent] skill routing table injected into system prompt");
      }
    },

    tool: {
      lockie_list_agents: lockieListAgentsTool,
    },

    "tool.execute.before": async (_input, output) => {
      // Always-on guard: strip null bytes from tool args to prevent shell
      // injection / truncation. Future debugger-mcp write ops add stricter
      // confirmation on top of this baseline.
      scrubNullBytes(output.args);
    },

    event: async (input) => {
      // Structured error recording — foundation for telemetry & model-fallback.
      // Full model-fallback needs OpenCode runtime support (plugins observe
      // errors but cannot re-issue requests); this records them now.
      recordEvent(input.event);
    },

    dispose: async () => {
      console.log("[oh-y-lockie-agent] 已卸载");
    },
  };
};

const lockiePlugin: PluginModule = {
  id: "oh-y-lockie-agent",
  server: lockieServer,
};

export { lockieServer };
export default lockiePlugin;
