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
import { probeFromRawProvider } from "./models.js";
import { injectTargetContext, buildReferenceIndex, REFERENCE_MARKER } from "./context.js";
import type { AgentOverride } from "./agents/types.js";
import { buildSkillTable, matchSkillDetail, SKILL_ROUTE_TABLE, ROUTE_MARKER } from "./skills.js";
import type { SkillEntry } from "./skills.js";
import { classifyIntentWithDetail, detectFanout } from "./intent.js";
import { diagnoseMcpStatus } from "./mcp.js";
import { readOpenCodeConfig } from "./mcp.js";
import { recordRouteEvent, setTelemetryEnabled } from "./telemetry.js";
import { checkForUpdate } from "./update-checker.js";
import { log, warn, error } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

function getPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch (err) {
    // Non-fatal: version is cosmetic (used only in log lines). But we log the
    // failure so a corrupted package.json doesn't disappear silently.
    error("failed to read package.json version:", err);
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

// ─── Plugin health check tool ─────────────────────────────────────

/**
 * One-shot diagnostic of the whole plugin: active agents with their RESOLVED
 * models, skill index size, MCP server status, config chain, telemetry toggle,
 * and target context. Everything is recomputed at call time so the output is
 * always current (hot-reload safe) rather than reflecting plugin-boot state.
 */
const lockieStatusTool = tool({
  description:
    "检查 oh-y-lockie-agent 插件健康状态：活跃 agent 与各自解析到的模型、skill 索引、MCP 服务器、配置链、遥测开关、目标芯片上下文。",
  args: {},
  async execute() {
    const lines: string[] = [];
    const { overrides, mcp, target, telemetry } = loadPluginConfig();

    // Model resolution — mirror the config hook exactly.
    const userCfg = readOpenCodeConfig();
    const probe = probeFromRawProvider(userCfg?.provider);
    const agents = collectAgents(overrides, probe);
    const activeKeys = Object.keys(agents);

    lines.push(`oh-y-lockie-agent v${PKG_VERSION} 健康状态`);
    lines.push("");

    // 1. Agents
    lines.push(`[agents] ${activeKeys.length}/${getAgentKeys().length} 活跃`);
    for (const name of activeKeys) {
      const cfg = agents[name];
      const model = cfg.model ?? "(未设置)";
      // Only flag unavailable when we could actually probe the environment —
      // an empty probe (no provider section) means "unknown", not "unavailable".
      const marked =
        model !== "(未设置)" && probe.any.length > 0 && !probe.available.has(model)
          ? " ⚠模型不可用"
          : "";
      lines.push(`  ${name} -> ${model}${marked}`);
    }
    const missing = getAgentKeys().filter((k) => !activeKeys.includes(k));
    if (missing.length) lines.push(`  已禁用: ${missing.join(", ")}`);

    // 2. Skills
    lines.push("");
    lines.push(`[skills] ${skillTable.length} 个已索引 (skills/opencode)`);

    // 3. MCP
    const mcpStatus = diagnoseMcpStatus();
    lines.push("");
    if (mcpStatus.missing.length === 0) {
      lines.push(`[mcp] 全部配置: ${mcpStatus.configured.join(", ")}`);
    } else {
      lines.push(`[mcp] 已配置: ${mcpStatus.configured.join(", ") || "(无)"}`);
      lines.push(`[mcp] ⚠ 缺失: ${mcpStatus.missing.join(", ")}`);
      lines.push(`  → 运行 "npm run setup-mcp" 或 node scripts/setup-mcp.mjs 自动配置`);
    }

    // 4. Config chain
    lines.push("");
    lines.push(`[config] override 数量: ${Object.keys(overrides).length}`);
    lines.push(`[config] 遥测: ${telemetry === false ? "关闭" : "开启"}`);
    if (target && Object.keys(target).some((k) => (target as Record<string, string | undefined>)[k])) {
      lines.push(
        `[target] ${["chip", "family", "sdk", "toolchain"]
          .map((k) => `${k}=${(target as Record<string, string | undefined>)[k] ?? "-"}`)
          .join(" ")}`,
      );
    } else {
      lines.push("[target] 未配置（agent 给出通用建议）");
    }

    return lines.join("\n");
  },
});

// ─── Tool arg guards & event recording ──────────────────────────

/**
 * Recursively strip null bytes (\0) from string values in a tool-call args
 * object. Null bytes in args can reach shell tools and cause injection or
 * truncation. Always-on, permission-free guard — future debugger-mcp write
 * operations will layer stricter confirmation on top.
 *
 * Returns the (possibly cleaned) value so the caller can reassign top-level
 * strings; nested containers are mutated in place.
 */
function scrubNullBytes(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\0/g, "");
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = typeof value[i] === "string" ? value[i].replace(/\0/g, "") : scrubNullBytes(value[i]);
    }
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      obj[k] = typeof obj[k] === "string" ? (obj[k] as string).replace(/\0/g, "") : scrubNullBytes(obj[k]);
    }
  }
  return value;
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
    error(`event ${type}:`, e?.properties ?? "(no details)");
  }
}

// ─── Plugin hooks ────────────────────────────────────────────────

const lockieServer = async (input: PluginInput): Promise<Hooks> => {
  // Load user-tunable config from the priority chain（含项目级 cwd）
  const cwd = process.cwd();
  const {
    overrides,
    mcp: mcpConfig,
    telemetry: telemetryEnabled,
    target: targetContext,
    updateCheck: updateCheckCfg,
  } = loadPluginConfig(cwd);

  // Telemetry toggle (default on; config can disable for privacy-sensitive envs)
  setTelemetryEnabled(telemetryEnabled !== false);

  // Build skill index at init
  const skillsDir = join(PKG_ROOT, "skills", "opencode");
  skillTable = buildSkillTable(skillsDir);

  // 日志策略：info 级默认静默（不污染 TUI 输入框），仅 LOCKIE_DEBUG=1 时
  // 输出到 stdout；所有级别始终写入 ~/.opencode/oh-y-lockie-agent/debug.log。
  // 诊断也可用 lockie_status 工具。
  const agentKeys = getActiveAgentKeys(overrides);
  log(`v${PKG_VERSION} 已加载 ${agentKeys.length} 个活跃 agent 定义`);

  // ─── MCP 状态诊断 ──────────────────────────────────────────────
  const mcpStatus = diagnoseMcpStatus();
  if (mcpStatus.missing.length > 0) {
    warn(
      `MCP 服务器未在 opencode.json 中配置: ${mcpStatus.missing.join(", ")}。` +
        `运行 npx oh-y-lockie-agent setup-mcp 自动配置，或手动添加至 opencode.json 的 "mcp" 段`,
    );
  } else {
    log(`MCP 服务器状态: ${mcpStatus.configured.join(", ")} ✅`);
  }

  const allAgentKeys = getAgentKeys();

  return {
    config: async (cfg: Config) => {
      // Update notification: fire-and-forget, never awaited, never blocks
      // config merging. Debounced by intervalHours in update-state.json.
      void checkForUpdate(input.client, {
        currentVersion: PKG_VERSION,
        enabled: updateCheckCfg?.enabled,
        intervalHours: updateCheckCfg?.intervalHours,
      });

      if (!cfg.agent) cfg.agent = {};
      // safe: Config.agent is an open string-keyed map; we only inject built-in
      // agents and never read typed fields back through this reference.
      const agentTarget = cfg.agent as Record<string, unknown>;

      // Inject our built-in agents (user override > factory default model).
      // We never clobber agents the user already defined in opencode.json.
      // Model resolution: probe the user's configured providers so hardcoded
      // defaults like "ddddjaak/mimo-v2.5" resolve to an actually-available
      // model (e.g. "my-mimo/mimo-v2.5") instead of failing at runtime.
      const probe = probeFromRawProvider(cfg.provider);
      const agents = collectAgents(overrides, probe);
      // Enrich each agent's prompt with the configured target-chip context
      // (chip/family/sdk/toolchain). Empty target → no-op, zero overhead.
      const enriched = injectTargetContext(agents, targetContext);
      for (const [key, val] of Object.entries(enriched)) {
        if (!(key in agentTarget)) {
          agentTarget[key] = val;
        }
      }

      // Apply built-in agent disable overrides (explore / general, etc.)
      for (const [name, ov] of Object.entries(overrides)) {
        if (ov.disable && !(name in agentSources)) {
          agentTarget[name] = { disable: true };
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

      log(
        `config 注入完成 — agents: ${Object.keys(cfg.agent || {}).length}, mcp: ${Object.keys(cfg.mcp || {}).length}`,
      );
    },

    "chat.message": async (msgInput, msgOutput) => {
      // 1. Log lockie agent usage (info 级：LOCKIE_DEBUG=1 时可见)
      const agent = msgInput.agent || "unknown";
      if (allAgentKeys.includes(agent)) {
        log(`agent=${agent} model=${msgInput.model?.modelID || "?"}`);
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
        recordRouteEvent({
          ts: Date.now(), intent, fanout: true, fanoutReason: fanout.reason,
          skillMatched: fanout.skill ?? null, skillScore: 0,
          textLen: textPart.text.length, matchedPhrase,
        });
        log(`fan-out: ${fanout.reason} (intent=${intent})`);
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
      log(`skill route: "${match.name}" (intent=${intent})`);
    },

    "experimental.chat.system.transform": async (_sysInput, sysOutput) => {
      // Prevent duplicate injection
      const alreadyInjected = sysOutput.system.some((s) => s.includes(ROUTE_MARKER));
      if (!alreadyInjected) {
        sysOutput.system.push(SKILL_ROUTE_TABLE);
        log("skill routing table injected into system prompt");
      }

      // Reference-doc index — lets agents know the bundled checklists/patterns
      // exist and can be read on demand (lightweight, cached, idempotent).
      const refIdx = buildReferenceIndex();
      if (refIdx && !sysOutput.system.some((s) => s.includes(REFERENCE_MARKER))) {
        sysOutput.system.push(refIdx);
        log("reference index injected into system prompt");
      }
    },

    tool: {
      lockie_list_agents: lockieListAgentsTool,
      lockie_status: lockieStatusTool,
    },

    "tool.execute.before": async (_input, output) => {
      // Always-on guard: strip null bytes from tool args to prevent shell
      // injection / truncation. Future debugger-mcp write ops add stricter
      // confirmation on top of this baseline.
      output.args = scrubNullBytes(output.args);
    },

    event: async (input) => {
      // Structured error recording — foundation for telemetry & model-fallback.
      // Full model-fallback needs OpenCode runtime support (plugins observe
      // errors but cannot re-issue requests); this records them now.
      recordEvent(input.event);
    },

    dispose: async () => {
      // 无资源需清理（telemetry/update-state 均为文件追加/覆盖，不依赖进程生命周期）。
      log("已卸载");
    },
  };
};

const lockiePlugin: PluginModule = {
  id: "oh-y-lockie-agent",
  server: lockieServer,
};

export { lockieServer };
export default lockiePlugin;
