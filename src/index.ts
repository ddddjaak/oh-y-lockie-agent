import type { PluginInput, Hooks, Config, PluginModule } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { z } from "zod";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { loadPluginConfig, buildAgentCategoryMap, getActiveAgentKeys, getAgentKeys } from "./config.js";
import type { AgentDef } from "./config.js";
import { buildSkillTable, matchSkill, SKILL_ROUTE_TABLE, ROUTE_MARKER } from "./skills.js";
import type { SkillEntry } from "./skills.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

// ─── Module-level state ──────────────────────────────────────────

let skillTable: SkillEntry[] = [];

// ─── Agent listing tool ──────────────────────────────────────────

const lockieListAgentsTool = tool({
  description: "列出 oh-y-lockie-agent 提供的所有 agent (14 个 subagent + 2 个主 agent)",
  args: {
    category: z.enum(["all", "design", "review", "domain", "quality"]).optional().default("all"),
  },
  async execute(args) {
    // We need the agent config to build the category map.
    // At tool-call time we re-read the config (it's hot-reload safe).
    const { agent: agentConfig } = loadPluginConfig();
    const categories = buildAgentCategoryMap(agentConfig);

    const cat = args.category || "all";
    if (cat === "all") {
      const primary = categories.primary.join(", ");
      const design = categories.design.join(", ");
      const review = categories.review.join(", ");
      const domain = categories.domain.join(", ");
      const quality = categories.quality.join(", ");
      return (
        `oh-y-lockie-agent v2.0.0 提供:\n` +
        `主 Agent: ${primary}\n` +
        `设计类: ${design}\n` +
        `审查类: ${review}\n` +
        `领域专家: ${domain}\n` +
        `质量保障: ${quality}`
      );
    }
    const list = categories[cat] || [];
    return `${cat} 类 agent: ${list.join(", ")}`;
  },
});

// ─── Plugin hooks ────────────────────────────────────────────────

const lockieServer = async (input: PluginInput): Promise<Hooks> => {
  // Load config from the priority chain
  const { agent: agentConfig, mcp: mcpConfig } = loadPluginConfig();

  // Build skill index at init
  const skillsDir = join(PKG_ROOT, "skills", "opencode");
  skillTable = buildSkillTable(skillsDir);

  const agentKeys = getActiveAgentKeys(agentConfig);
  const allAgentKeys = getAgentKeys(agentConfig);
  console.log(`[oh-y-lockie-agent v2.0.0] 已加载 ${agentKeys.length} 个活跃 agent 定义`);

  return {
    config: async (cfg: Config) => {
      // Merge plugin agent definitions with user's existing config.
      // User's opencode.json agent entries take priority (spread second).
      // Use type assertion: SDK's Config type has a constrained agent shape,
      // but our plugin-registered agents conform to the runtime schema.
      cfg.agent = {
        ...agentConfig,
        ...(cfg.agent || {}),
      } as typeof cfg.agent;

      // Inject MCP servers if not already configured by user
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

    "shell.env": async (shellInput, shellOutput) => {
      const cwd = shellInput.cwd || "";
      if (cwd && existsSync(join(cwd, "CMakeLists.txt"))) {
        if (!shellOutput.env.LOCKIE_TOOLCHAIN) {
          shellOutput.env.LOCKIE_TOOLCHAIN = "detected";
        }
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
