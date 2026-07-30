/**
 * Agent factory definitions for oh-y-lockie-agent.
 *
 * Each agent is a factory `(model) => AgentConfig` carrying a static `mode`
 * ("primary" | "subagent") and `defaultModel`. This mirrors omo-opencode's
 * per-agent factories (e.g. metis.ts). Prompts are loaded from the plugin's
 * `agents/<name>.md` via `loadPrompt`.
 *
 * User-tunable bits (model override / disable) live in the JSONC config, NOT
 * here — factories always receive the resolved model at build time.
 */

import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentFactory } from "./types.js";
import { loadPrompt } from "./prompts.js";

// ─── 主 Agent (primary) ───────────────────────────────────────────

export const architect: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("architect.md"),
    description: "SE 系统架构师 — 芯片系统级设计：需求分解、架构设计、规格撰写、跨部门审查",
    color: "#4CAF50",
    temperature: 0.2,
  }),
  { mode: "primary" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

export const firmware: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("firmware.md"),
    description: "AE 应用工程师 — 嵌入式固件开发：驱动设计、RTOS、调试、性能优化",
    color: "#2196F3",
    temperature: 0.2,
  }),
  { mode: "primary" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

// ─── Subagent: 设计类 ────────────────────────────────────────────

export const powerArchitect: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("power-architect.md"),
    description: "电源架构设计师：设计电源树、电压域、上电时序、电流预算、去耦策略",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5-pro" },
);

export const bootBringupSpecialist: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("boot-bringup-specialist.md"),
    description: "启动与bring-up专家：设计启动序列、验证Boot ROM行为、创建首次上电检查清单",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5-pro" },
);

export const memoryMapSpecialist: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("memory-map-specialist.md"),
    description: "内存映射专家：设计Flash分区、SRAM分配、外设地址映射、MPU配置、链接脚本",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5-pro" },
);

export const firmwareArchitect: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("firmware-architect.md"),
    description: "固件架构师：设计固件架构——任务分解、IPC拓扑、HAL分层、引导架构、状态机设计",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

export const timingAnalyst: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("timing-analyst.md"),
    description: "时序分析师：设计时钟树、配置PLL、验证建立/保持时序、计算波特率容差",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5-pro" },
);

export const registerMapGenerator: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("register-map-generator.md"),
    description: "寄存器映射生成器：从数据手册提取寄存器定义、验证地址对齐、检查保留位",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

// ─── Subagent: 审查类 ────────────────────────────────────────────

export const codeReviewer: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("code-reviewer.md"),
    description: "Senior code reviewer — 五维度代码审查：正确性、可读性、架构、安全、性能",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5-pro" },
);

export const securityAuditor: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("security-auditor.md"),
    description: "安全审计师 — 固件安全审计：安全启动、加密、密钥管理、通信安全、物理安全",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5-pro" },
);

export const systemArchitect: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("system-architect.md"),
    description: "系统架构审查师 — 从系统级视角审查架构决策：模块边界、接口契约、约束分析",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5-pro" },
);

// ─── Subagent: 领域专家 ──────────────────────────────────────────

export const fwDomainExpert: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("fw-domain-expert.md"),
    description: "固件领域专家 — 审查固件架构决策、RTOS配置、驱动设计、内存规划",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

export const hwDomainExpert: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("hw-domain-expert.md"),
    description: "硬件领域专家 — 审查硬件设计决策：引脚分配、电源树、时钟树、PCB布局约束",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

export const complianceReviewer: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("compliance-reviewer.md"),
    description: "合规审查员 — 审查设计合规性：行业标准、法规要求、安全规范",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

// ─── Subagent: 质量保障 ──────────────────────────────────────────

export const testEngineer: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("test-engineer.md"),
    description: "测试工程师 — 审查设计方案的可测试性、测试覆盖率和测试策略",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

export const verificationEngineer: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({
    model,
    prompt: loadPrompt("verification-engineer.md"),
    description: "验证工程师 — 验证设计方案完整性和一致性，追溯矩阵审查",
  }),
  { mode: "subagent" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);
