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
import { buildSkillTable, matchSkill, SKILL_ROUTE_TABLE, ROUTE_MARKER } from "./skills.js";
import type { SkillEntry } from "./skills.js";
import { diagnoseMcpStatus } from "./mcp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

function getPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch {
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
    const list = categories[cat as keyof typeof categories] || [];
    return `${cat} 类 agent: ${list.join(", ")}`;
  },
});

// ─── Plugin hooks ────────────────────────────────────────────────

const lockieServer = async (input: PluginInput): Promise<Hooks> => {
  // Load user-tunable config from the priority chain（含项目级 cwd）
  const cwd = process.cwd();
  const { overrides, mcp: mcpConfig } = loadPluginConfig(cwd);

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

      // 4. Match skill
      const match = matchSkill(textPart.text, skillTable);
      if (!match) return;

      // 5. Prepend routing instruction
      msgOutput.parts.unshift({
        id: textPart.id || randomUUID(),
        sessionID: msgInput.sessionID,
        messageID: msgInput.messageID ?? msgOutput.message.id,
        type: "text",
        text: `[SKILL_ROUTE] 请先用 skill 工具加载 "${match.name}" skill，再用该 skill 的指令处理用户问题。`,
        synthetic: true,
        ignored: true,
        time: { start: Date.now() },
      });
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
