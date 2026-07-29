# oh-y-lockie-agent

> 双主 Agent 协作框架 — 覆盖 SE（系统架构）与 AE（应用工程）两条开发管线。OpenCode Plugin 即插即用。

## 概述

`oh-y-lockie-agent` 是一个 **OpenCode Plugin**（非 install 脚本方式），提供**两个主 Agent**，共享同一套 **14 个专项 Subagent**、**21 个 Commands** 和 **58 个 Skills**（51 个 opencode 端 + 7 个 agents 端）：

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
- 一个已在 `opencode.json` 中配置好的 provider（如 `chipsea-api`）

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

# 5. 替换 provider 名称
#    config/oh-y-lockie-agent.jsonc 中所有 "your-provider/" 改为实际 provider
#    （如 "chipsea-api/"、"openai/" 等）

# 6. 重启 OpenCode
```

### postinstall 自动部署

全局安装后，postinstall 脚本会自动将以下内容复制到对应目录：

| 源目录 | 目标目录 |
|--------|----------|
| `agents/` | `~/.config/opencode/agents/` |
| `commands/` | `~/.config/opencode/commands/` |
| `skills/opencode/` | `~/.config/opencode/skills/` |
| `skills/agents/` | `~/.agents/skills/` |
| `references/` | `~/.config/opencode/references/` |
| `AGENTS.md` | `~/AGENTS.md`（如不存在） |
| `config/oh-y-lockie-agent.jsonc` | `~/.config/opencode/oh-y-lockie-agent.jsonc`（如不存在） |

---

## 插件架构

```
oh-y-lockie-agent (Plugin)
│
├── src/
│   ├── index.ts          # OpenCode Plugin 入口
│   │   ├── config hook       ── 注入 agent 定义 + MCP 配置
│   │   ├── chat.message hook ── 意图分类 → 自动路由 skill
│   │   ├── experimental.chat.system.transform hook
│   │   │                       ── 注入 Skill Routing Table 到 system prompt
│   │   ├── shell.env hook    ── 检测 CMake 项目
│   │   └── tool              ── lockie_list_agents
│   │
│   ├── config.ts         # 配置加载链（jsonc 解析 + 优先级合并）
│   ├── skills.ts         # Skill 匹配引擎（关键词提取 + 评分匹配）
│   └── __tests__/        # 单元测试（vitest）
│
├── config/
│   └── oh-y-lockie-agent.jsonc   # 默认配置（agent 定义 + MCP）
│
├── agents/      # 16 个 agent prompt 文件
├── commands/    # 21 个命令定义
├── skills/      # 58 个 skill 定义
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
| Commands | 21 | 斜杠命令（含 fan-out 并行编排） |
| Skills | 58 | 专业领域能力（51 opencode + 7 agents） |

### 主 Agent 对比

| | Architect (SE) | Firmware (AE) |
|---|---|---|
| **颜色** | 🟢 绿色 | 🔵 蓝色 |
| **管线** | Define→Design→Document→Verify→Validate | Concept→Spec→Plan→Code→Test→Review→Ship |
| **核心场景** | 芯片系统设计、架构评审、规格制定 | 嵌入式固件开发、驱动编写、RTOS 调试 |
| **默认** | ✅ primary | 备选 |
| **模型** | `your-provider/qwen3.7-plus` | `your-provider/qwen3.7-plus` |

**切换方式：** 在 OpenCode 中按 **Tab** 键，即可在 Architect (SE) 和 Firmware (AE) 之间切换。

### Subagent 清单

| Subagent | 职责 | 默认模型 |
|----------|------|----------|
| `code-reviewer` | 五维度代码审查（正确性/可读性/架构/安全/性能） | deepseek-v4-pro |
| `security-auditor` | 安全审计：安全启动、加密、密钥管理、通信安全 | deepseek-v4-pro |
| `system-architect` | 系统架构审查：模块边界、接口契约、约束分析 | deepseek-v4-pro |
| `test-engineer` | 可测试性审查、测试覆盖率和测试策略 | qwen3.6-flash |
| `verification-engineer` | 设计方案完整性和一致性验证，追溯矩阵审查 | qwen3.6-flash |
| `fw-domain-expert` | 固件领域审查：RTOS配置、驱动设计、内存规划 | qwen3.7-plus |
| `hw-domain-expert` | 硬件设计审查：引脚分配、电源树、时钟树、PCB布局约束 | qwen3.7-plus |
| `compliance-reviewer` | 合规审查：行业标准、法规要求、安全规范 | qwen3.6-flash |
| `power-architect` | 电源架构设计：电源树、电压域、上电时序、电流预算 | deepseek-v4-pro |
| `boot-bringup-specialist` | 启动与bring-up：启动序列、Boot ROM验证、首次上电检查 | deepseek-v4-pro |
| `memory-map-specialist` | 内存映射设计：Flash分区、SRAM分配、MPU配置、链接脚本 | deepseek-v4-pro |
| `firmware-architect` | 固件架构设计：任务分解、IPC拓扑、HAL分层、状态机 | qwen3.7-plus |
| `timing-analyst` | 时序分析：时钟树、PLL配置、建立/保持时序、抖动预算 | deepseek-v4-pro |
| `register-map-generator` | 寄存器映射生成：从数据手册提取寄存器定义、验证对齐 | qwen3.6-plus |

### Commands 清单

| 命令 | 功能 |
|---|---|
| `/review` | 五轴代码审查 |
| `/ship` | 并行审查（code-reviewer + security-auditor + test-engineer 同时执行） |
| `/test` | TDD 测试驱动开发 |
| `/plan` | 任务分解 |
| `/build` | 构建 |
| `/spec` | 规格编写 |
| `/se-requirements` | 需求分解 |
| `/se-architecture` | 架构设计 |
| `/se-spec` | 规格文档生成 |
| `/se-review` | 四视角设计审查 |
| `/se-traceability` | 追溯矩阵 |
| `/se-goal` | 目标定义 |
| `/code-simplify` | 代码简化 |
| `/bringup` | 板级bring-up计划生成 |
| `/memory-map` | 内存映射设计 |
| `/power-tree` | 电源架构设计 |
| `/clock-tree` | 时钟树设计 |
| `/pinmux` | 引脚复用分配 |
| `/register-map` | 寄存器映射生成 |
| `/boot-sequence` | 启动序列设计 |
| `/fault-analysis` | 故障分析（HardFault/MemManage/BusFault等） |

### Skills 清单（58 个）

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
│   └── __tests__/                # 单元测试
│
├── dist/                         # 编译产物（不提交到 git）
│
├── config/
│   └── oh-y-lockie-agent.jsonc   # 默认 agent 配置 + MCP 配置
│
├── agents/                       # 16 个 agent prompt 文件
├── commands/                     # 21 个命令定义文件
├── references/                   # 5 个参考文档
│
├── skills/
│   ├── opencode/                 # 51 个 opencode 端 skill
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

### 替换 provider

`config/oh-y-lockie-agent.jsonc` 中所有 `your-provider/` 前缀需替换为你在 `opencode.json` 中配置的实际 provider 名称：

```jsonc
// 修改前
"model": "your-provider/qwen3.7-plus"

// 修改后（假设 provider 名为 chipsea-api）
"model": "chipsea-api/qwen3.7-plus"
```

### 用户级覆盖

创建 `~/.config/opencode/oh-y-lockie-agent.jsonc`，只需包含你想覆盖的字段：

```jsonc
{
  "agent": {
    "architect": {
      "model": "chipsea-api/glm-5.1"      // 只覆盖 architect 的模型
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

`preuninstall.mjs` 会自动清理 `~/.config/opencode/agents/`、`~/.config/opencode/commands/`、`~/.config/opencode/skills/`、`~/.config/opencode/references/`、`~/.agents/skills/` 中属于本插件的文件。

完成后重启 OpenCode。

---

## 版本

- **插件版本**: 2.0.0
- **兼容 OpenCode**: >= 1.0

## 许可

MIT
