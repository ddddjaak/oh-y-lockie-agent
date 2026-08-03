# oh-y-lockie-agent

> 芯片系统架构师 + 嵌入式工程师双管线智能编排插件 — OpenCode 即插即用，自然语言触发，无需 slash 命令。

## 概述

`oh-y-lockie-agent` 是一个 **OpenCode Plugin**，提供 **2 个主 Agent**（architect / firmware）、共享 **14 个专项 Subagent** 和 **63 个 Skills**（56 个 opencode 端 + 7 个 agents 端），通过自然语言路由自动触发，覆盖 SE（系统架构）与 AE（应用工程）两条开发管线。

| 主 Agent | 管线 | 适用场景 |
|----------|------|----------|
| **architect**（默认） | 需求分解 → 架构设计 → 规格撰写 → 审查 → 追溯 | 芯片系统设计、HW-SW 接口、跨部门评审 |
| **firmware** | 需求澄清 → 规格 → 规划 → 实现 → 测试 → 审查 → 发布 | 嵌入式固件开发、驱动编写、RTOS、调试 |

已发布到 [npm registry](https://www.npmjs.com/package/oh-y-lockie-agent)，OpenCode 用裸名即可从 registry 拉取加载。

---

## 安装

### 前置条件

- [OpenCode](https://opencode.ai) >= 1.0
- Node.js >= 20
- `opencode.json` 中已配置好 provider（如 `openai`、`azure` 等）

### 方式一：OpenCode 裸名引用（推荐）

在 `~/.config/opencode/opencode.json` 的 `plugin` 数组中加入裸名：

```jsonc
{
  "plugin": ["oh-y-lockie-agent"]
}
```

重启 OpenCode，它会自动从 npm registry 拉取并加载。MCP 服务由插件 `config hook` 在运行时注入，无需手动配置。

### 方式二：npm 全局安装

```bash
npm install -g oh-y-lockie-agent
```

`postinstall` 脚本会自动把 4 个 MCP 服务写入 `~/.config/opencode/opencode.json`
（仅添加缺失项，不覆盖已有），并把 63 个 skill 复制到 `~/.config/opencode/skills/`
（让 OpenCode 原生 `skill` 工具可发现）。之后仍需在 `plugin` 数组中引用裸名 `"oh-y-lockie-agent"`。

### 验证

重启 OpenCode。**注意：插件日志默认不打印到终端**（`console.log` 会被
opencode TUI 渲染到输入框区域，污染界面——v1.1.1 起改为日志门面控制）。

### 日志策略（开发 / 排障）

| 级别 | 终端输出 | 文件 `~/.opencode/oh-y-lockie-agent/debug.log` |
|------|----------|-----------------------------------------------|
| `log`（常规） | 仅 `LOCKIE_DEBUG=1` 时 | 始终记录（7 天 / 5MB 轮转） |
| `warn` / `error` | 始终（仅出问题时出现） | 始终记录 |

- **正常使用**：终端完全干净，无日志干扰输入框
- **开发 / 调试插件**：`LOCKIE_DEBUG=1 opencode` 启动，所有日志输出到终端
- **事后排障**：无需重启，直接查看 `~/.opencode/oh-y-lockie-agent/debug.log`
  （每条含 ISO 时间戳 + 级别，如 `[2026-08-01T07:00:00.000Z] [info] ...`）
- **健康状态**：也可用 `lockie_status` 工具查询（agents / MCP / 配置链）

### MCP 注入机制

| 机制 | 触发时机 | 是否写 opencode.json |
|------|----------|----------------------|
| `config hook` 运行时注入 | 每次启动 OpenCode | 否（注册到进程，不持久化） |
| `postinstall` 脚本 | `npm install -g` 时 | 是（写入 mcp 段，仅添加缺失项） |
| `setup-mcp` 手动命令 | `npx oh-y-lockie-agent setup-mcp`（或 `npm run setup-mcp`） | 是 |

> 三者互不冲突：若 opencode.json 已有同名 MCP，插件不会覆盖。裸名引用方式下 `config hook` 已足够，无需 postinstall。

---

### Skills 如何被发现

插件随附 63 个 `SKILL.md`（`skills/opencode/` 56 个 + `skills/agents/` 7 个），有两条加载通道：

1. **原生 `skill` 工具**：`npm install -g` 时 postinstall 会把 63 个 skill 复制到 `~/.config/opencode/skills/`
   （仅补缺失、绝不覆盖用户已有同名 skill；卸载时按 manifest 只清理未改动的目录）。
2. **`lockie_load_skill` 工具（插件自带，最可靠）**：直接从插件包内读取 SKILL.md 全文，
   不依赖 OpenCode 的 skill 发现路径。路由指令会优先让模型调用它，它不可用时再退回内置 `skill` 工具。

> 路由表与路由指令会注入到每个 lockie agent 的 prompt（config hook 注入 agent 时完成），
> 因此不依赖 `experimental.chat.system.transform` 这类实验性 hook 是否被运行时接受。

---

## 插件架构

```
oh-y-lockie-agent (Plugin)
│
├── src/
│   ├── index.ts          # OpenCode Plugin 入口
│   │   ├── config hook              ── collectAgents() 注入 agent + MCP 配置 + 更新提醒
│   │   ├── chat.message hook        ── 意图分类 → 自动路由 skill
│   │   └── tool                     ── lockie_list_agents / lockie_status / lockie_load_skill
│   │
│   ├── config.ts         # 配置加载（3 级优先级链 + 合并 overrides/mcp/updateCheck）
│   ├── config-schema.ts  # zod 配置校验 schema
│   ├── intent.ts         # 意图分类 + 中英双语 SKILL_TRIGGERS + fan-out 检测
│   ├── models.ts         # provider 模型探测 + 智能解析（过滤非对话模型）
│   ├── context.ts        # 目标芯片上下文 + 参考文档索引 + 路由表注入 agent prompt
│   ├── logger.ts         # 日志门面（LOCKIE_DEBUG 控制 stdout + debug.log 文件轮转）
│   ├── update-checker.ts # 版本更新提醒（npm registry 检查 + TUI toast + 日志兜底）
│   ├── telemetry.ts      # 路由遥测（仅记录匹配元数据，不含用户内容）
│   ├── skills.ts         # Skill 匹配引擎 + lockie_load_skill 内容加载
│   ├── mcp.ts            # MCP 诊断 / 注入
│   ├── agents/           # Agent 定义（definitions / index / prompts / types）
│   └── __tests__/        # 单元测试（vitest）
│
├── config/
│   └── oh-y-lockie-agent.jsonc   # 默认配置（agent model 覆盖 + MCP）
│
├── agents/      # 16 个 agent prompt 文件
├── skills/      # 63 个 skill 定义（56 opencode + 7 agents）
├── references/  # 5 个参考文档
└── scripts/     # postinstall / preuninstall / setup-mcp
```

### 配置优先级链

插件配置按以下优先级合并（高优先级覆盖低）：

1. **项目级**: `<project>/.opencode/oh-y-lockie-agent.jsonc`
2. **用户级**: `~/.config/opencode/oh-y-lockie-agent.jsonc`
3. **插件默认**: `<plugin>/config/oh-y-lockie-agent.jsonc`

### 意图分类 → Skill 自动路由

`chat.message` hook 监听每次对话，对用户输入进行关键词评分匹配：

- 先做**意图分类**（design / review / debug / build / ship / plan / qa，规则信号词，中英双语），
  再在意图对应的 skill 子集内做关键词评分匹配（≥2 分命中），避免跨类别误路由
- 命中后在用户消息前注入 `[SKILL_ROUTE]` 指令，让模型调用 `lockie_load_skill` 加载对应 skill
- 路由表（按意图分组）会注入到**每个 lockie agent 的 prompt**，保证模型能看到
- "全面审查 / 多角度审查"触发 fan-out 指令（并行调 3 个审查 agent）；"ship review / 发布前审查"路由到 `ship-review` skill
- 每次路由尝试都会写入本地遥测（`~/.opencode/oh-y-lockie-agent/telemetry-routes.jsonl`），用于定位路由词表缺口

> 命令层已移除：能力全部由 Skill 通过自然语言触发（例如「进行架构评审」「帮我做引脚复用分配」「生成内存映射」）。无需记忆 `/xxx` 命令名。

> 注意：插件默认配置禁用了 OpenCode 自带的 `explore` / `general` agent
> （见 `config/oh-y-lockie-agent.jsonc`）。如不需要，删除对应 `disable` 配置即可恢复。

---

## 包含内容

| 组件 | 数量 | 说明 |
|------|------|------|
| 主 Agents | 2 | Architect（SE 管线）+ Firmware（AE 管线） |
| Subagents | 14 | 专项 review / audit / design 子代理 |
| Skills | 63 | 专业领域能力（56 opencode + 7 agents） |
| MCP | 4 | codegraph / context7 / memory / sequential-thinking |

### 主 Agent 对比

| | Architect (SE) | Firmware (AE) |
|---|---|---|
| **颜色** | 🟢 绿色 | 🔵 蓝色 |
| **管线** | Define→Design→Document→Verify→Validate | Concept→Spec→Plan→Code→Test→Review→Ship |
| **核心场景** | 芯片系统设计、架构评审、规格制定 | 嵌入式固件开发、驱动编写、RTOS 调试 |
| **默认模型** | `ddddjaak/mimo-v2.5` | `ddddjaak/mimo-v2.5` |

**切换方式：** 在 OpenCode 中按 **Tab** 键，即可在 Architect (SE) 和 Firmware (AE) 之间切换。

### Subagent 清单

| Subagent | 职责 | 默认模型 |
|----------|------|----------|
| `code-reviewer` | 五维度代码审查（正确性/可读性/架构/安全/性能） | ddddjaak/mimo-v2.5-pro |
| `security-auditor` | 安全审计：安全启动、加密、密钥管理、通信安全 | ddddjaak/mimo-v2.5-pro |
| `system-architect` | 系统架构审查：模块边界、接口契约、约束分析 | ddddjaak/mimo-v2.5-pro |
| `test-engineer` | 可测试性审查、测试覆盖率和测试策略 | ddddjaak/mimo-v2.5 |
| `verification-engineer` | 设计方案完整性和一致性验证，追溯矩阵审查 | ddddjaak/mimo-v2.5 |
| `fw-domain-expert` | 固件领域审查：RTOS 配置、驱动设计、内存规划 | ddddjaak/mimo-v2.5 |
| `hw-domain-expert` | 硬件设计审查：引脚分配、电源树、时钟树、PCB 布局约束 | ddddjaak/mimo-v2.5 |
| `compliance-reviewer` | 合规审查：行业标准、法规要求、安全规范 | ddddjaak/mimo-v2.5 |
| `power-architect` | 电源架构设计：电源树、电压域、上电时序、电流预算 | ddddjaak/mimo-v2.5-pro |
| `boot-bringup-specialist` | 启动与 bring-up：启动序列、Boot ROM 验证、首次上电检查 | ddddjaak/mimo-v2.5-pro |
| `memory-map-specialist` | 内存映射设计：Flash 分区、SRAM 分配、MPU 配置、链接脚本 | ddddjaak/mimo-v2.5-pro |
| `firmware-architect` | 固件架构设计：任务分解、IPC 拓扑、HAL 分层、状态机 | ddddjaak/mimo-v2.5 |
| `timing-analyst` | 时序分析：时钟树、PLL 配置、建立/保持时序、抖动预算 | ddddjaak/mimo-v2.5-pro |
| `register-map-generator` | 寄存器映射生成：从数据手册提取寄存器定义、验证对齐 | ddddjaak/mimo-v2.5 |

### Skills 清单（63 个）

| 类别 | Skills |
|------|--------|
| **SE 管线**（16） | requirements-decompose, architecture-design, software-architecture-design, hardware-architecture-design, spec-authoring, software-detailed-design, hardware-detailed-design, algorithm-design, design-review, requirements-review, code-static-review, test-plan-review, test-report-review, release-review, traceability-matrix, verification-planning |
| **AE 管线**（24） | interview-me, idea-refine, spec-driven-development, planning-and-task-breakdown, incremental-implementation, source-driven-development, doubt-driven-development, context-engineering, api-and-interface-design, test-driven-development, debugging-and-error-recovery, embedded-debugging, rtos-and-concurrency, peripheral-driver-design, embedded-build-and-toolchain, code-review-and-quality, code-simplification, security-and-hardening, performance-optimization, git-workflow-and-versioning, ci-cd-and-automation, deprecation-and-migration, documentation-and-adrs, shipping-and-launch |
| **领域专项**（10） | power-management, clock-configuration, memory-protection, device-tree, board-bringup, bootloader-design, pinmux, register-map, memory-map, power-tree |
| **通用工作流**（5） | clonedeps, deepwork, reflect, simplify, worktrees |
| **Agents 端**（7） | company-docx-generator, company-pptx-generator, markdown-to-docx, markitdown, mermaid-diagram-generation, storage-analysis, zephyr-doxygen-docs |

---

## Tool

插件注册了以下工具供 AI 调用：

- **`lockie_list_agents`** — 列出所有可用的 agent，支持按分类筛选（`all` / `design` / `review` / `domain` / `quality`）
- **`lockie_status`** — 插件健康检查：活跃 agent 与各自解析到的模型、skill 索引、MCP 服务器状态、配置链、遥测开关、目标芯片上下文
- **`lockie_load_skill`** — 按名称加载插件随附 skill 的完整内容（SKILL.md + 相关文件清单），支持模糊匹配

---

## 目录结构

```
oh-y-lockie-agent/
├── README.md                     # 本文件
├── AGENTS.md                     # Agent 行为准则
├── package.json                  # npm 包配置 — 插件入口 dist/index.js
├── tsconfig.json                 # TypeScript 编译配置
├── vitest.config.ts              # 单元测试配置
├── .mcp.json                     # MCP 服务器规范定义
│
├── src/
│   ├── index.ts                  # 插件主入口
│   ├── config.ts                 # 配置加载链
│   ├── skills.ts                 # Skill 匹配引擎
│   ├── mcp.ts                    # MCP 诊断 / 注入
│   ├── agents/                   # Agent 定义（definitions / index / prompts / types）
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
│   ├── opencode/                 # 56 个 opencode 端 skill
│   └── agents/                   # 7 个 agents 端 skill
│
├── docs/                         # 文档（对比报告等）
└── scripts/
    ├── postinstall.mjs           # 安装后注入 MCP 到 opencode.json
    ├── preuninstall.mjs          # 卸载前清理 MCP 条目
    └── setup-mcp.mjs             # 手动注入/修复 MCP（npm run setup-mcp）
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

# 打包（发布前会自动 build）
npm pack

# 手动注入/修复 MCP 配置
npm run setup-mcp
```

### 测试

单元测试使用 [vitest](https://vitest.dev)：

- `src/__tests__/config.test.ts` — 配置加载链（优先级合并、jsonc 解析）
- `src/__tests__/skills.test.ts` — Skill 匹配（关键词提取、评分匹配）
- `src/__tests__/mcp.test.ts` — MCP 诊断 / 注入
- `src/__tests__/update-checker.test.ts` — 版本检查（semver 比较、防抖、toast 重试、日志兜底）
- `src/__tests__/logger.test.ts` — 日志门面（LOCKIE_DEBUG 控制、文件持久化）
- `src/agents/__tests__/agents.test.ts` — Agent 定义 / 注册表

---

## 配置

### 模型配置

Agent 的默认模型在 `src/agents/definitions.ts` 中通过 `defaultModel` 定义（标准 `ddddjaak/mimo-v2.5`、Pro `ddddjaak/mimo-v2.5-pro`）。如需更换 provider 或模型，在 `config/oh-y-lockie-agent.jsonc` 的 `agent.<name>.model` 覆盖即可：

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

### 完整配置示例

```jsonc
{
  // 可选：模型覆盖（agent.<name>.model / disable）
  "agent": {
    "architect": { "model": "openai/glm-5.1" },
    "explore": { "disable": true }
  },
  // 可选：MCP 服务器（与 opencode.json 的 mcp 段合并，仅添加缺失项）
  "mcp": {
    "custom-tool": { "type": "local", "command": ["npx", "custom-tool"] }
  },
  // 可选：目标芯片上下文（agent 给出针对性建议）
  "target": { "chip": "CS32F103C8T6", "family": "Cortex-M3" },
  // 可选：路由遥测开关（默认开启，写入 telemetry-routes.jsonl，不含用户内容）
  "telemetry": true,
  // 可选：更新提醒（默认开启，24h 防抖，仅提醒不自动更新）
  "updateCheck": { "enabled": true, "intervalHours": 24 }
}
```

---

## 升级

```bash
# npm 全局安装方式升级
npm install -g oh-y-lockie-agent@latest

# OpenCode 裸名引用方式：清缓存后重启
rm -rf ~/.cache/opencode/packages/oh-y-lockie-agent@latest && opencode
```

> ⚠️ **裸名引用并非每次启动都自动更新**：OpenCode 会把拉取到的插件缓存在
> `~/.cache/opencode/packages/`，同一版本不会重复拉取（历史缓存 bug 甚至可能
> 锁死在旧版本，需清缓存恢复）。因此请以**更新提醒**为准，不要依赖"启动即最新"。

### 更新提醒

插件每次启动时（默认 24 小时防抖）异步检查 npm registry，发现新版本后在
TUI 右下角弹出提醒（8 秒）：

```
┌──────────────────────────────────────┐
│ oh-y-lockie-agent 有新版本           │
│ v1.0.2 → v1.1.0（请手动更新）       │
└──────────────────────────────────────┘
```

- **只提醒，不自动更新**：opencode 缓存机制决定了自动重装不可靠，升级由你手动执行
- **TUI 未就绪时自动重试**：toast 发送失败会在 3s / 8s 后重试，全部失败则写入
  `~/.opencode/oh-y-lockie-agent/update-notice.log` 兜底（日志包含时间戳与版本号）
- **不重复打扰**：同一版本只提醒一次；同一版本号不会再弹第二次
- **可关闭**：见下方 `updateCheck` 配置

### 更新检查配置

在 `~/.config/opencode/oh-y-lockie-agent.jsonc`（或项目级 `.opencode/` 同名文件）中：

```jsonc
{
  "updateCheck": {
    "enabled": true,       // false = 完全关闭更新检查
    "intervalHours": 24    // 检查间隔（1 ~ 720 小时，默认 24）
  }
}
```

---

## 卸载

```bash
# 从 opencode.json 的 plugin 数组移除 "oh-y-lockie-agent"
# 然后（若曾 npm 全局安装）：
npm uninstall -g oh-y-lockie-agent
```

`preuninstall.mjs` 会自动从 `~/.config/opencode/opencode.json` 移除 4 个 MCP 条目（codegraph / context7 / memory / sequential-thinking）。agents / skills / references 由 `config hook` 运行时注入，卸载后随插件消失，无残留文件。

完成后重启 OpenCode。

---

## 版本

- **插件版本**: 1.1.2
- **兼容 OpenCode**: >= 1.0
- **npm**: https://www.npmjs.com/package/oh-y-lockie-agent
- **GitHub**: https://github.com/ddddjaak/oh-y-lockie-agent

## 许可

MIT
