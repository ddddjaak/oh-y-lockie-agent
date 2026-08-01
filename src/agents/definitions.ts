/**
 * Agent definitions for oh-y-lockie-agent.
 *
 * Each agent is an explicit {@link AgentDef} object — the single source of
 * truth for its factory, mode, defaultModel, and category. Prompts are loaded
 * lazily from `agents/<name>.md` via `loadPrompt` inside each factory.
 *
 * Why not `Object.assign(fn, { mode, defaultModel })`?
 *   That pattern attaches static props onto a function, which TS cannot infer
 *   statically — it forced `as AgentConfig & { mode?: ... }` assertions in
 *   `buildAgent`. A plain object lets `mode` / `defaultModel` / `category`
 *   flow through the type system with zero assertions.
 *
 * `category` is declared here (not reverse-inferred from description wording)
 * so editing a description never silently mis-categorizes an agent.
 */

import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentDef } from "./types.js";
import { loadPrompt } from "./prompts.js";

/**
 * Read-only permission profile for review/domain/quality agents.
 *
 * These agents exist to ASSESS artifacts, never to mutate them: editing source,
 * rewriting files, or mutating the todo list would defeat the purpose of an
 * independent review. They still keep bash/read/grep/glob at their defaults so
 * a reviewer can compile, run tests, and inspect the tree.
 */
const READONLY_PERMISSION = { edit: "deny", todowrite: "deny" } as const;

// ─── 主 Agent (primary) ───────────────────────────────────────────

export const architect: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("architect.md"),
    description: "SE 系统架构师 — 芯片系统级设计：需求分解、架构设计、规格撰写、跨部门审查",
    color: "#4CAF50",
    temperature: 0.2,
  }),
  mode: "primary",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "primary",
};

export const firmware: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("firmware.md"),
    description: "AE 应用工程师 — 嵌入式固件开发：驱动设计、RTOS、调试、性能优化",
    color: "#2196F3",
    temperature: 0.2,
  }),
  mode: "primary",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "primary",
};

// ─── Subagent: 设计类 (design) ───────────────────────────────────

export const powerArchitect: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("power-architect.md"),
    description: "电源架构设计师：设计电源树、电压域、上电时序、电流预算、去耦策略",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5-pro",
  category: "design",
};

export const bootBringupSpecialist: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("boot-bringup-specialist.md"),
    description: "启动与bring-up专家：设计启动序列、验证Boot ROM行为、创建首次上电检查清单",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5-pro",
  category: "design",
};

export const memoryMapSpecialist: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("memory-map-specialist.md"),
    description: "内存映射专家：设计Flash分区、SRAM分配、外设地址映射、MPU配置、链接脚本",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5-pro",
  category: "design",
};

export const firmwareArchitect: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("firmware-architect.md"),
    description: "固件架构师：设计固件架构——任务分解、IPC拓扑、HAL分层、引导架构、状态机设计",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "design",
};

export const timingAnalyst: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("timing-analyst.md"),
    description: "时序分析师：设计时钟树、配置PLL、验证建立/保持时序、计算波特率容差",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5-pro",
  category: "design",
};

export const registerMapGenerator: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("register-map-generator.md"),
    description: "寄存器映射生成器：从数据手册提取寄存器定义、验证地址对齐、检查保留位",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "design",
};

// ─── Subagent: 审查类 (review) ───────────────────────────────────

export const codeReviewer: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("code-reviewer.md"),
    permission: { ...READONLY_PERMISSION },
    description: "Senior code reviewer — 五维度代码审查：正确性、可读性、架构、安全、性能",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5-pro",
  category: "review",
};

export const securityAuditor: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("security-auditor.md"),
    permission: { ...READONLY_PERMISSION },
    description: "安全审计师 — 固件安全审计：安全启动、加密、密钥管理、通信安全、物理安全",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5-pro",
  category: "review",
};

export const systemArchitect: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("system-architect.md"),
    permission: { ...READONLY_PERMISSION },
    description: "系统架构审查师 — 从系统级视角审查架构决策：模块边界、接口契约、约束分析",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5-pro",
  category: "review",
};

// ─── Subagent: 领域专家 (domain) ─────────────────────────────────

export const fwDomainExpert: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("fw-domain-expert.md"),
    permission: { ...READONLY_PERMISSION },
    description: "固件领域专家 — 审查固件架构决策、RTOS配置、驱动设计、内存规划",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "domain",
};

export const hwDomainExpert: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("hw-domain-expert.md"),
    permission: { ...READONLY_PERMISSION },
    description: "硬件领域专家 — 审查硬件设计决策：引脚分配、电源树、时钟树、PCB布局约束",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "domain",
};

export const complianceReviewer: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("compliance-reviewer.md"),
    permission: { ...READONLY_PERMISSION },
    description: "合规审查员 — 审查设计合规性：行业标准、法规要求、安全规范",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "domain",
};

// ─── Subagent: 质量保障 (quality) ────────────────────────────────

export const testEngineer: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("test-engineer.md"),
    permission: { ...READONLY_PERMISSION },
    description: "测试工程师 — 审查设计方案的可测试性、测试覆盖率和测试策略",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "quality",
};

export const verificationEngineer: AgentDef = {
  factory: (model): AgentConfig => ({
    model,
    prompt: loadPrompt("verification-engineer.md"),
    permission: { ...READONLY_PERMISSION },
    description: "验证工程师 — 验证设计方案完整性和一致性，追溯矩阵审查",
  }),
  mode: "subagent",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "quality",
};
