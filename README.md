# oh-y-lockie-agent

> 双主 Agent 协作框架 — 覆盖 SE（系统架构）与 AE（应用工程）两条开发管线。OpenCode Plugin 即插即用。

## 概述

`oh-y-lockie-agent` 是一个 **OpenCode Plugin**（非 install 脚本方式），提供**两个主 Agent**，共享同一套 **14 个专项 Subagent** 和 **62 个 Skills**（55 个 opencode 端 + 7 个 agents 端）：

| 主 Agent | 管线 | 适用场景 |
|----------|------|----------|
| **architect**（默认） | 需求分解 → 架构设计 → 规格撰写 → 审查 → 追溯 | 芯片系统设计、HW-SW 接口、跨部门评审 |
| **firmware** | 需求澄清 → 规格 → 规划 → 实现 → 测试 → 审查 → 发布 | 嵌入式固件开发、驱动编写、RTOS、调试 |

安装后默认启动 `architect`。切换只需将对应 agent 的 `mode` 改为 `"primary"`。

---

## 安装

### 前置条件

- [OpenCode](https://opencode.ai) >= 1.0
- Node.js >= 20
- 一个已在 `opencode.json` 中配置好的 provider（如 `openai`、`azure` 等）

### 步骤

```bash
# 1. 编译
npm run build

# 2. 打包
npm pack

# 3. 全局安装（--ignore-scripts 避免在全局 node_modules 里触发 postinstall）
npm install -g --ignore-scripts ./oh-y-lockie-agent-2.0.0.tgz

# 4. 编辑 ~/.config/opencode/opencode.json，在 plugin 数组中加入插件名：
#    "plugin": ["oh-my-openagent", "oh-y-lockie-agent"]

# 5. （可选）在 config/oh-y-lockie-agent.jsonc 中覆盖 agent 模型
#    默认已配置为 ddddjaak/mimo-v2.5（标准）与 ddddjaak/mimo-v2.5-pro（Pro）

# 6. 重启 OpenCode
```

### postinstall 自动部署

全局安装后，postinstall 脚本会自动将以下内容复制到对应目录：

| 源目录 | 目标目录 | 说明 |
|--------|----------|------|
| `opencode.json` (MCP 段) | `~/.config/opencode/opencode.json` | 注入缺失的 MCP 服务器（不覆盖已有项） |

> `agents/` `skills/` `references/` 由插件 config hook 从插件目录**注入**，不复制。

---

## 插件架构

```
oh-y-lockie-agent (Plugin)
│
├── src/
│   ├── index.ts          # OpenCode Plugin 入口
│   │   ├── config hook       ── collectAgents() 注入 agent + MCP 配置
│   │   ├── chat.message hook ── 意图分类 → 自动路由 skill
│   │   ├── experimental.chat.system.transform hook
│   │   │                       ── 注入 Skill Routing Table 到 system prompt
│   │   └── tool              ── lockie_list_agents
│   │
│   ├── config.ts         # 配置加载（3 级优先级链 + 合并 overrides/mcp）
│   ├── skills.ts         # Skill 匹配引擎（关键词提取 + 评分匹配）
│   ├── agents/            # Agent 注册表（factory + registry 结构）
│   └── __tests__/        # 单元测试（vitest）
│
├── config/
│   └── oh-y-lockie-agent.jsonc   # 默认配置（agent model 覆盖 + MCP）
│
├── agents/      # 16 个 agent prompt 文件
├── skills/      # 62 个 skill 定义
├── references/  # 5 个参考文档
└── scripts/     # postinstall / preuninstall
```

### 配置优先级链

插件配置按以下优先级合并（高优先级覆盖低）：

1. **项目级**: `<project>/.opencode/oh-y-lockie-agent.jsonc`
2. **用户级**: `~/.config/opencode/oh-y-lockie-agent.jsonc`
3. **插件默认**: `<plugin>/config/oh-y-lockie-agent.jsonc`

### 意图分类 → Skill 自动路由

`chat.message` hook 监听每次对话，对用户输入进行关键词评分匹配：

- 从所有 SKILL.md 的 description 字段提取触发关键词
- 按关键词长度加权评分（长词 ≥4 字符权重 3，短词权重 1）
- 评分 ≥2 时自动在响应中注入 `[SKILL_ROUTE]` 指令
- `experimental.chat.system.transform` hook 在 system prompt 中注入路由表

---

## 包含内容

| 组件 | 数量 | 说明 |
|------|------|------|
| 主 Agents | 2 | Architect（SE 管线）+ Firmware（AE 管线） |
| Subagents | 14 | 专项 review/audit/design 子代理 |
| Skills | 58 | 专业领域能力（51 opencode + 7 agents） |

### 主 Agent 对比

| | Architect (SE) | Firmware (AE) |
|---|---|---|
| **颜色** | 🟢 绿色 | 🔵 蓝色 |
| **管线** | Define→Design→Document→Verify→Validate | Concept→Spec→Plan→Code→Test→Review→Ship |
| **核心场景** | 芯片系统设计、架构评审、规格制定 | 嵌入式固件开发、驱动编写、RTOS 调试 |
| **默认** | ✅ primary | ✅ primary |
| **模型** | `ddddjaak/mimo-v2.5` | `ddddjaak/mimo-v2.5` |

**切换方式：** 在 OpenCode 中按 **Tab** 键，即可在 Architect (SE) 和 Firmware (AE) 之间切换。

### Subagent 清单

| Subagent | 职责 | 默认模型 |
|----------|------|----------|
| `code-reviewer` | 五维度代码审查（正确性/可读性/架构/安全/性能） | ddddjaak/mimo-v2.5-pro |
| `security-auditor` | 安全审计：安全启动、加密、密钥管理、通信安全 | ddddjaak/mimo-v2.5-pro |
| `system-architect` | 系统架构审查：模块边界、接口契约、约束分析 | ddddjaak/mimo-v2.5-pro |
| `test-engineer` | 可测试性审查、测试覆盖率和测试策略 | ddddjaak/mimo-v2.5 |
| `verification-engineer` | 设计方案完整性和一致性验证，追溯矩阵审查 | ddddjaak/mimo-v2.5 |
| `fw-domain-expert` | 固件领域审查：RTOS配置、驱动设计、内存规划 | ddddjaak/mimo-v2.5 |
| `hw-domain-expert` | 硬件设计审查：引脚分配、电源树、时钟树、PCB布局约束 | ddddjaak/mimo-v2.5 |
| `compliance-reviewer` | 合规审查：行业标准、法规要求、安全规范 | ddddjaak/mimo-v2.5 |
| `power-architect` | 电源架构设计：电源树、电压域、上电时序、电流预算 | ddddjaak/mimo-v2.5-pro |
| `boot-bringup-specialist` | 启动与bring-up：启动序列、Boot ROM验证、首次上电检查 | ddddjaak/mimo-v2.5-pro |
| `memory-map-specialist` | 内存映射设计：Flash分区、SRAM分配、MPU配置、链接脚本 | ddddjaak/mimo-v2.5-pro |
| `firmware-architect` | 固件架构设计：任务分解、IPC拓扑、HAL分层、状态机 | ddddjaak/mimo-v2.5 |
| `timing-analyst` | 时序分析：时钟树、PLL配置、建立/保持时序、抖动预算 | ddddjaak/mimo-v2.5-pro |
| `register-map-generator` | 寄存器映射生成：从数据手册提取寄存器定义、验证对齐 | ddddjaak/mimo-v2.5 |

### 命令层（已移除）

> 自 v2.0.0 起 slash command 层已移除，能力全部由 Skill 通过自然语言触发（例如「进行架构评审」「帮我做引脚复用分配」「生成内存映射」）。无需记忆 `/xxx` 命令名。

### Skills 清单
### Skills 清单（62 个）

| 类别 | Skills |
|------|--------|
| **SE 管线** | requirements-decompose, architecture-design, software-architecture-design, hardware-architecture-design, spec-authoring, software-detailed-design, hardware-detailed-design, algorithm-design, design-review, requirements-review, code-static-review, test-plan-review, test-report-review, release-review, traceability-matrix |
| **AE 管线** | interview-me, idea-refine, spec-driven-development, planning-and-task-breakdown, incremental-implementation, source-driven-development, doubt-driven-development, context-engineering, api-and-interface-design, test-driven-development, debugging-and-error-recovery, embedded-debugging, rtos-and-concurrency, peripheral-driver-design, embedded-build-and-toolchain, code-review-and-quality, code-simplification, security-and-hardening, performance-optimization, git-workflow-and-versioning, ci-cd-and-automation, deprecation-and-migration, documentation-and-adrs, shipping-and-launch |
| **领域专项** | power-management, clock-configuration, memory-protection, device-tree, board-bringup, bootloader-design, clonedeps |
| **Agents 端** | company-docx-generator, company-pptx-generator, markdown-to-docx, markitdown, mermaid-diagram-generation, storage-analysis, zephyr-doxygen-docs |

---

## Tool

插件注册了一个工具供 AI 调用：

- **`lockie_list_agents`** — 列出所有可用的 agent，支持按分类筛选（`all`/`design`/`review`/`domain`/`quality`）

---

## 目录结构

```
oh-y-lockie-agent/
├── README.md                     # 本文件
├── AGENTS.md                     # Agent 行为准则
├── package.json                  # npm 包配置 — 插件入口 dist/index.js
├── tsconfig.json                 # TypeScript 编译配置
├── vitest.config.ts              # 单元测试配置
│
├── src/
│   ├── index.ts                  # 插件主入口
│   ├── config.ts                 # 配置加载链
│   ├── skills.ts                 # Skill 匹配引擎
│   ├── agents/                   # Agent 注册表（factory + registry 结构）
│   └── __tests__/                # 单元测试
│
├── dist/                         # 编译产物（不提交到 git）
│
├── config/
│   └── oh-y-lockie-agent.jsonc   # 默认 agent model 覆盖 + MCP 配置
│
├── agents/                       # 16 个 agent prompt 文件
├── references/                   # 5 个参考文档
│
├── skills/
│   ├── opencode/                 # 55 个 opencode 端 skill
│   └── agents/                   # 7 个 agents 端 skill
│
└── scripts/
    ├── postinstall.mjs           # 安装后自动部署静态文件
    └── preuninstall.mjs          # 卸载前清理
```

---

## 开发

```bash
# 编译 TypeScript
npm run build

# 运行单元测试
npm test

# 持续测试
npm run test:watch

# 打包
npm pack

# 全局安装开发版
npm install -g --ignore-scripts ./oh-y-lockie-agent-2.0.0.tgz
```

### 测试

单元测试使用 [vitest](https://vitest.dev)：

- `src/__tests__/config.test.ts` — 配置加载链测试（优先级合并、jsonc 解析）
- `src/__tests__/skills.test.ts` — Skill 匹配测试（关键词提取、评分匹配）

---

## 配置

### 模型配置

Agent 的默认模型在 `src/agents/definitions.ts` 中通过 `defaultModel` 定义（标准 `ddddjaak/mimo-v2.5`、Pro `ddddjaak/mimo-v2.5-pro`）。如需更换 provider 或模型，在 `config/oh-y-lockie-agent.jsonc` 的 `agent.<name>.model` 覆盖即可，例如：

```jsonc
// 把 architect 换成 openai 的模型
"architect": { "model": "openai/glm-5.1" }
```

### 用户级覆盖

创建 `~/.config/opencode/oh-y-lockie-agent.jsonc`，只需包含你想覆盖的字段：

```jsonc
{
  "agent": {
    "architect": {
      "model": "openai/glm-5.1"      // 只覆盖 architect 的模型
    }
  }
}
```

### 项目级覆盖

创建 `<project>/.opencode/oh-y-lockie-agent.jsonc`，优先于用户级配置。

---

## 升级

```bash
# 卸载旧版
npm uninstall -g oh-y-lockie-agent

# 安装新版
npm install -g --ignore-scripts ./oh-y-lockie-agent-2.0.0.tgz
```

---

## 卸载

```bash
npm uninstall -g oh-y-lockie-agent
```

`preuninstall.mjs` 会自动清理 `~/.config/opencode/agents/`、`~/.config/opencode/skills/`、`~/.config/opencode/references/`、`~/.agents/skills/` 中属于本插件的文件。

完成后重启 OpenCode。

---

## 版本

- **插件版本**: 2.0.0
- **兼容 OpenCode**: >= 1.0

## 许可

MIT
