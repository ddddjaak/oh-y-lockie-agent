# oh-y-lockie-agent — OpenCode 插件：芯片系统设计 + 嵌入式固件双管线

> **oh-y-lockie-agent** 是一个 OpenCode 插件，提供芯片系统设计（SE）和嵌入式固件开发（AE）双管线智能编排。包含 2 个主 Agent、14 个 Subagent、63 个 Skill（56 opencode + 7 agents）。

**生成日期:** 2026-08-04 | **版本:** 1.2.0

---

## 目录

- [STOP. 变更前必读](#stop-变更前必读)
- [默认工作流](#默认工作流)
- [架构总览](#架构总览)
- [项目结构](#项目结构)
- [Agent 目录](#agent-目录)
- [Command 层（已移除）](#command-层已移除)
- [Skill 目录](#skill-目录)
- [配置系统](#配置系统)
- [初始化流程](#初始化流程)
- [MCP 系统](#mcp-系统)
- [约定](#约定)
- [反模式（禁止）](#反模式禁止)
- [测试与验证](#测试与验证)
- [发布与部署](#发布与部署)

---

## STOP. 变更前必读

> **如果你修改了 src/index.ts、src/config.ts、config/oh-y-lockie-agent.jsonc 或任何 Agent/Skill 注册逻辑，必须验证插件能正常加载，不得静默破坏。**

- "TypeScript 编译通过"不等于"插件能工作"。你必须验证插件初始化日志打印、Agent 注册数量正确、Skill 可被自然语言路由触发。
- 修改 AGENTS.md 时确保目录树和引用路径与实际一致。
- 修改配置加载逻辑（`src/config.ts`）后必须运行 `npm test`。
- 不存在"改动太小可以跳过验证"这回事。

---

## 默认工作流

除非用户明确指定，交付变更遵循以下步骤：

1. **理解意图** — 读需求、读源码、确认范围
2. **门控检查** — 改什么文件、影响什么、依赖谁、怎么验证
3. **实施** — 按约定编码
4. **验证** — 编译/测试/静态检查
5. **提交** — 提交信息清晰，粒度合理

---

## 架构总览

oh-y-lockie-agent 提供双管线编排：

### SE Pipeline（芯片系统设计）
```
需求分解 → 架构设计 → 规格编写 → 详细设计 → 审查 → 追溯验证
```

### AE Pipeline（嵌入式固件开发）
```
需求澄清 → 计划拆解 → 增量实现 → 调试验证 → 发布部署
```

### 插件层级

```
OpenCode 运行时
  └── oh-y-lockie-agent 插件
        ├── Agent 层        — 2 主 Agent + 14 Subagent
        ├── Skill 层       — 63 个技能（56 opencode + 7 agents），自然语言触发
        ├── Config 层       — 3 级优先级链 + JSONC 解析
        ├── MCP 层          — codegraph + context7 + memory + sequential-thinking
        └── Reference 层    — 5 份参考文档
```

---

## 项目结构

```
oh-y-lockie-agent/
├── src/                          # 插件源码
│   ├── index.ts                  # 入口：PluginModule 定义，hook + 工具注册
│   ├── config.ts                 # 配置加载器（3 级优先级链 + 合并 overrides/mcp/telemetry/updateCheck/target）
│   ├── config-schema.ts          # zod 配置 schema（单一真相源）
│   ├── intent.ts                 # 意图分类（7 类）+ 中英双语 SKILL_TRIGGERS + fan-out 检测
│   ├── models.ts                 # provider 模型探测 + 智能解析（过滤非对话模型）
│   ├── context.ts                # 目标芯片上下文 + 参考文档索引 + 路由表注入 agent prompt
│   ├── logger.ts                 # 日志门面（LOCKIE_DEBUG + debug.log 轮转）
│   ├── telemetry.ts              # 路由遥测（JSONL，仅匹配元数据）
│   ├── update-checker.ts         # 版本更新提醒（npm registry + TUI toast）
│   ├── mcp.ts                    # MCP 诊断 / 原子写注入
│   ├── skills.ts                 # Skill 匹配引擎 + loadSkillContent（lockie_load_skill 工具后端）
│   ├── agents/                   # Agent 注册表（factory + registry 结构）
│   │   ├── types.ts              # AgentFactory / AgentMode / AgentOverride
│   │   ├── prompts.ts            # loadPrompt() 读取 agents/*.md
│   │   ├── definitions.ts        # 16 个 agent 工厂（静态 mode/defaultModel）
│   │   ├── index.ts              # agentSources 注册表 + buildAgent + collectAgents
│   │   └── __tests__/agents.test.ts
│   └── __tests__/                # 单元测试（12 个测试文件）
│       ├── config.test.ts
│       ├── context.test.ts
│       ├── index.test.ts
│       ├── intent.test.ts
│       ├── intent-evals.test.ts
│       ├── logger.test.ts
│       ├── mcp.test.ts
│       ├── models.test.ts
│       ├── skills.test.ts
│       ├── telemetry.test.ts
│       └── update-checker.test.ts
├── agents/                       # Agent prompt 文件（16 个 .md）
│   ├── architect.md              # SE 主 Agent
│   ├── firmware.md               # AE 主 Agent
│   ├── power-architect.md        # 电源架构设计
│   ├── boot-bringup-specialist.md
│   ├── memory-map-specialist.md
│   ├── firmware-architect.md
│   ├── timing-analyst.md
│   ├── register-map-generator.md
│   ├── code-reviewer.md
│   ├── security-auditor.md
│   ├── system-architect.md
│   ├── fw-domain-expert.md
│   ├── hw-domain-expert.md
│   ├── compliance-reviewer.md
│   ├── test-engineer.md
│   └── verification-engineer.md

├── skills/                       # 63 个 SKILL.md
│   ├── opencode/                 # 56 个 OpenCode 技能
│   │   ├── algorithm-design/
│   │   ├── api-and-interface-design/
│   │   ├── architecture-design/
│   │   ├── board-bringup/
│   │   ├── bootloader-design/
│   │   ├── ci-cd-and-automation/
│   │   ├── clock-configuration/
│   │   ├── clonedeps/
│   │   ├── code-review-and-quality/
│   │   ├── code-simplification/
│   │   ├── code-static-review/
│   │   ├── context-engineering/
│   │   ├── debugging-and-error-recovery/
│   │   ├── deepwork/
│   │   ├── deprecation-and-migration/
│   │   ├── design-review/
│   │   ├── device-tree/
│   │   ├── documentation-and-adrs/
│   │   ├── doubt-driven-development/
│   │   ├── embedded-build-and-toolchain/
│   │   ├── embedded-debugging/
│   │   ├── git-workflow-and-versioning/
│   │   ├── hardware-architecture-design/
│   │   ├── hardware-detailed-design/
│   │   ├── idea-refine/
│   │   ├── incremental-implementation/
│   │   ├── interview-me/
│   │   ├── memory-protection/
│   │   ├── performance-optimization/
│   │   ├── peripheral-driver-design/
│   │   ├── planning-and-task-breakdown/
│   │   ├── power-management/
│   │   ├── reflect/
│   │   ├── release-review/
│   │   ├── requirements-decompose/
│   │   ├── requirements-review/
│   │   ├── rtos-and-concurrency/
│   │   ├── security-and-hardening/
│   │   ├── shipping-and-launch/
│   │   ├── simplify/
│   │   ├── software-architecture-design/
│   │   ├── software-detailed-design/
│   │   ├── source-driven-development/
│   │   ├── spec-authoring/
│   │   ├── spec-driven-development/
│   │   ├── test-driven-development/
│   │   ├── test-plan-review/
│   │   ├── test-report-review/
│   │   ├── traceability-matrix/
│   │   ├── verification-planning/
│   │   └── worktrees/
│   └── agents/                   # 7 个 Agent 特色技能
│       ├── company-docx-generator/
│       ├── company-pptx-generator/
│       ├── markdown-to-docx/
│       ├── markitdown/
│       ├── mermaid-diagram-generation/
│       ├── storage-analysis/
│       └── zephyr-doxygen-docs/
├── config/
│   └── oh-y-lockie-agent.jsonc   # 插件默认配置（Agent model 映射）
├── .mcp.json                      # 规范 MCP 服务器定义（Claude Code 格式）
├── scripts/
│   ├── postinstall.mjs           # npm install 后：注入 MCP + 复制 skills 到全局技能目录 + 生成配置模板
│   ├── preuninstall.mjs          # npm uninstall 前：清理 MCP 条目 / 配置模板 / 复制的 skills（按 manifest 安全清理）
│   ├── setup-mcp.mjs             # MCP 配置工具（npm run setup-mcp 或 npx oh-y-lockie-agent setup-mcp）
│   └── analyze-telemetry.mjs     # 路由遥测分析
├── references/                   # 5 份参考文档
│   ├── accessibility-checklist.md
│   ├── orchestration-patterns.md
│   ├── performance-checklist.md
│   ├── security-checklist.md
│   └── testing-patterns.md
├── docs/                         # 团队技术文档
│   ├── architecture-comparison.md
│   ├── diff-vs-published.md
│   ├── embedded-mcp-roadmap.md
│   ├── pr-review-checklist.md
│   └── typescript-coding-standards.md
├── overview.md                   # 团队交付总览（历史文档）
├── .codegraph/                   # CodeGraph 索引
├── .omo/                         # AI 工作区状态
│   └── run-continuation/         # 运行延续会话
├── .sisyphus/                    # 旧工作区（迁移中）
├── package.json                  # 含 bin: oh-y-lockie-agent → scripts/setup-mcp.mjs
├── tsconfig.json
├── vitest.config.ts
├── AGENTS.md                     # 本文件
├── README.md
└── LICENSE
```

---

## Agent 目录

### 主 Agent（2 个）

| Agent | 角色 | 模型 | 描述 |
|-------|------|------|------|
| `architect` | SE 系统架构师 | `ddddjaak/mimo-v2.5` | 芯片系统级设计：需求分解、架构设计、规格撰写、跨部门审查 |
| `firmware` | AE 应用工程师 | `ddddjaak/mimo-v2.5` | 嵌入式固件开发：驱动设计、RTOS、调试、性能优化 |

### 设计类 Subagent（6 个）

| Agent | 模型 | 描述 |
|-------|------|------|
| `power-architect` | `ddddjaak/mimo-v2.5-pro` | 电源架构设计：电源树、电压域、上电时序、电流预算、去耦策略 |
| `boot-bringup-specialist` | `ddddjaak/mimo-v2.5-pro` | 启动与 bring-up：设计启动序列、验证 Boot ROM、首次上电检查 |
| `memory-map-specialist` | `ddddjaak/mimo-v2.5-pro` | 内存映射：Flash 分区、SRAM 分配、外设地址映射、MPU、链接脚本 |
| `firmware-architect` | `ddddjaak/mimo-v2.5` | 固件架构：任务分解、IPC 拓扑、HAL 分层、引导架构、状态机 |
| `timing-analyst` | `ddddjaak/mimo-v2.5-pro` | 时序分析：时钟树设计、PLL 配置、建立/保持时序、波特率容差 |
| `register-map-generator` | `ddddjaak/mimo-v2.5` | 寄存器映射：从数据手册提取定义、地址对齐检查、位域验证 |

### 审查类 Subagent（3 个）

| Agent | 模型 | 描述 |
|-------|------|------|
| `code-reviewer` | `ddddjaak/mimo-v2.5-pro` | 代码审查：正确性、可读性、架构、安全、性能五维度 |
| `security-auditor` | `ddddjaak/mimo-v2.5-pro` | 安全审计：安全启动、加密、密钥管理、通信安全、物理安全 |
| `system-architect` | `ddddjaak/mimo-v2.5-pro` | 系统架构审查：模块边界、接口契约、约束分析 |

### 领域专家 Subagent（3 个）

| Agent | 模型 | 描述 |
|-------|------|------|
| `fw-domain-expert` | `ddddjaak/mimo-v2.5` | 固件领域专家：RTOS 配置、驱动设计、内存规划 |
| `hw-domain-expert` | `ddddjaak/mimo-v2.5` | 硬件领域专家：引脚分配、电源树、时钟树、PCB 布局约束 |
| `compliance-reviewer` | `ddddjaak/mimo-v2.5` | 合规审查：行业标准、法规要求、安全规范 |

### 质量保障 Subagent（2 个）

| Agent | 模型 | 描述 |
|-------|------|------|
| `test-engineer` | `ddddjaak/mimo-v2.5` | 测试工程师：可测试性审查、测试覆盖率、测试策略 |
| `verification-engineer` | `ddddjaak/mimo-v2.5` | 验证工程师：设计完整性、一致性、追溯矩阵审查 |

---

## Command 层（已移除）

> 自 v1.0.0 起，slash command 层已移除。原有 21 个命令的工作流已全部并入 Skill：
> - 4 个领域专属工作流（pinmux / register-map / memory-map / power-tree）已提升为独立 Skill（见 `skills/opencode/`）；
> - 其余命令本就是对应 Skill / Agent 的调用器，删去命令不影响能力。
>
> 现在所有能力通过**自然语言触发**：例如「进行架构评审」「帮我做引脚复用分配」「生成内存映射」会由 `chat.message` 钩子经 `SKILL_ROUTE_TABLE` 路由到对应 Skill。无需记忆 `/xxx` 命令名。

---

## Skill 目录

### SE Pipeline 核心技能

| Skill | 阶段 | 描述 |
|-------|------|------|
| `requirements-decompose` | Define | 需求分解：PRD、芯片手册、行业标准 → 结构化需求 |
| `architecture-design` | Design | 系统级架构设计：模块分解、接口定义、约束分析 |
| `software-architecture-design` | Design | 固件架构设计：RTOS 线程模型、内存预算、IPC |
| `hardware-architecture-design` | Design | 硬件架构设计：引脚分配、电源树、PCB 约束 |
| `spec-authoring` | Document | 规格编写：SOD、HW-SW IF Spec、Test Plan |
| `software-detailed-design` | Document | 软件详细设计：函数签名、数据结构、状态机 |
| `hardware-detailed-design` | Document | 硬件详细设计：原理图、BOM、PCB 布局 |
| `algorithm-design` | Document | 算法设计：信号处理、控制环路、滤波器 |
| `design-review` | Verify | 四视角对抗式设计审查 |
| `requirements-review` | Verify | 需求文档完整性审查 |
| `code-static-review` | Verify | 代码静态审查（编码规范） |
| `test-plan-review` | Verify | 测试方案审查 |
| `test-report-review` | Verify | 测试报告审查 |
| `release-review` | Verify | 发布就绪审查 |
| `traceability-matrix` | Validate | 追溯矩阵构建与缺口分析 |

### AE Pipeline 核心技能

| Skill | 阶段 | 描述 |
|-------|------|------|
| `interview-me` | Define | 需求澄清：一问一答式意图提取 |
| `idea-refine` | Define | 想法精炼：发散→收敛 |
| `spec-driven-development` | Define | 先写规格再编码 |
| `planning-and-task-breakdown` | Plan | 任务拆解与计划 |
| `incremental-implementation` | Build | 增量实现：分步交付 |
| `source-driven-development` | Build | 源码驱动：查阅官方文档 |
| `doubt-driven-development` | Build | 怀疑驱动：对抗式验证 |
| `api-and-interface-design` | Build | API 接口设计：HAL 层、驱动 API |
| `test-driven-development` | Verify | 测试驱动开发 |
| `debugging-and-error-recovery` | Verify | 系统化根因调试 |
| `embedded-debugging` | Embedded | HardFault/异常/内存损坏调试 |
| `rtos-and-concurrency` | Embedded | RTOS 任务设计、IPC、同步 |
| `peripheral-driver-design` | Embedded | 外设驱动设计：I2C/SPI/UART/GPIO |
| `embedded-build-and-toolchain` | Embedded | 构建系统：CMake、链接脚本、GCC |
| `code-review-and-quality` | Review | 多维度代码审查 |
| `code-simplification` | Review | 代码简化（不改变行为） |
| `security-and-hardening` | Review | 固件安全：安全启动、加密、OTA |
| `performance-optimization` | Review | 性能优化：内存、功耗、实时性 |
| `git-workflow-and-versioning` | Ship | Git 工作流：分支、提交、PR |
| `ci-cd-and-automation` | Ship | CI/CD：编译矩阵、HIL、烧录 |
| `deprecation-and-migration` | Ship | 弃用与迁移管理 |
| `documentation-and-adrs` | Ship | 架构决策记录（ADR） |
| `shipping-and-launch` | Ship | 发布部署：检查清单、OTA |

### 领域专用技能

| Skill | 描述 |
|-------|------|
| `power-management` | DVFS、电源状态机、PMIC、功耗预算 |
| `clock-configuration` | PLL 配置、时钟树、时钟门控 |
| `memory-protection` | MPU、TrustZone-M、Flash 保护、eFuse |
| `device-tree` | DTS、设备树绑定、pinctrl、Zephyr |
| `board-bringup` | 板级首次上电：最小 BSP、UART 控制台 |
| `bootloader-design` | 多级启动、安全启动、A/B OTA |
| `clonedeps` | 克隆依赖源码供分析 |
| `context-engineering` | Agent 上下文优化 |
| `deepwork` | 高风险大规模变更编排 |
| `worktrees` | Git worktree 隔离开发 |
| `verification-planning` | 变更验证方案设计 |
| `reflect` | 回顾工作模式、改进建议 |
| `code-simplify` | 代码简化（别名） |

### 文档生成技能（agents/）

| Skill | 描述 |
|-------|------|
| `company-docx-generator` | Markdown → 公司规范 Word 文档 |
| `company-pptx-generator` | Markdown → 公司规范 PPT |
| `markdown-to-docx` | Markdown → Word 通用转换 |
| `markitdown` | 多种格式 → Markdown 转换 |
| `mermaid-diagram-generation` | Mermaid 图表生成（Word 兼容） |
| `storage-analysis` | 存储子系统分析（NAND/eMMC） |
| `zephyr-doxygen-docs` | Markdown → Zephyr 风格 Doxygen 文档 |

---

## 配置系统

Agent 的**定义**（prompt / 描述 / mode / color）收归代码，位于 `src/agents/`；配置文件只保留**用户可调项**（model 覆盖、disable 开关、mcp）。

### Agent 注册结构（src/agents/）

对齐 omo-opencode 的 `agentSources` + `collectPendingBuiltinAgents` 设计：

- `definitions.ts` — 16 个 agent 工厂函数，每个形如 `architect = (model) => ({...})`，并带静态属性 `architect.mode = "primary"` / `architect.defaultModel = "..."`
- `index.ts` — `agentSources`（name → 工厂 注册表）+ `buildAgent()`（工厂 → AgentConfig，携带静态 mode）+ `collectAgents(overrides, availableModels?)`（应用 override + 可选模型可用性门控，产出注入 `cfg.agent` 的 map）
- `prompts.ts` — `loadPrompt()` 从 `agents/*.md` 读取 prompt 注入到每个工厂
- `types.ts` — `AgentFactory` / `AgentMode` / `AgentOverride`

### 优先级链（高→低）

```
1. 项目级:  <project>/.opencode/oh-y-lockie-agent.jsonc
2. 用户级:  ~/.config/opencode/oh-y-lockie-agent.jsonc
3. 插件默认: <plugin>/config/oh-y-lockie-agent.jsonc
```

### 配置加载流程

`src/config.ts` 中的 `loadPluginConfig()` 只加载用户可调项：

1. 加载插件默认配置（仅 `agent` 段的 overrides + `mcp`）
2. 检测并合并用户级配置（~/.config/opencode/）
3. 检测并合并项目级配置（$CWD/.opencode/）
4. 按 agent key 浅合并 overrides（model / disable）
5. 用户 mcp 配置按 key 覆盖插件默认

> Agent 的 prompt / mode 不再从 jsonc 解析，而是由 `collectAgents()` 从 `src/agents/` 构建后注入。

### Agent model 映射

Agent 的默认模型在 `src/agents/definitions.ts` 中通过 `defaultModel` 字段定义；用户可在 jsonc 的 `agent.<name>.model` 按 agent 覆盖。

当前使用的模型（配置文件 `agent.*.model`）：

| 模型类型 | 配置值 |
|---------|--------|
| 标准模型 | `ddddjaak/mimo-v2.5` |
| Pro 模型 | `ddddjaak/mimo-v2.5-pro` |

### MCP 配置

MCP 服务器定义在配置文件的 `mcp` 段，插件通过 `config` hook 注入 OpenCode 运行时。

推荐做法：同时在项目根目录维护 `.mcp.json`（Claude Code 格式）作为 tier-2 MCP 来源。

---

## 初始化流程

```
OpenCode 加载插件
  └─→ lockieServer(input)                          # src/index.ts
        ├─→ loadPluginConfig(cwd)                  # 3 级优先级链 → { overrides, mcp, target, telemetry, updateCheck }
        ├─→ collectAgents(overrides, probe)        # src/agents/index.ts：工厂 → AgentConfig，模型智能解析
        ├─→ buildSkillTable(skillsDir)             # 从插件目录构建 56 个 opencode skill 索引
        ├─→ injectSkillRouting(agents)             # 路由表注入每个 agent prompt（可靠通道）
        ├─→ diagnoseMcpStatus()                    # 检查 opencode.json MCP 配置
        ├─→ log active agent count                 # 输出已加载 agent 数量
        ├─→ 返回 Hooks 对象
              ├─→ config(cfg)                      # 注入 agent（含路由表）+ MCP + 更新提醒
              │     ├─→ cfg.agent[key] = 仅注入未由用户定义的 agent（不覆盖用户已有项）
              │     ├─→ 按 overrides 对 built-in(explore/general) 设 { disable: true }
              │     └─→ cfg.mcp = { ...mcpConfig 仅补充缺失项 }
              ├─→ chat.message                     # 意图分类 → fan-out 检测 → skill 评分路由 → 注入 [SKILL_ROUTE]
              ├─→ experimental.chat.system.transform  # 补充注入路由表 + 参考文档索引（部分运行时可能丢弃，agent prompt 已兜底）
              ├─→ tool.lockie_list_agents          # 列出所有 agent
              ├─→ tool.lockie_status               # 健康检查（含模型回退警告）
              ├─→ tool.lockie_load_skill           # 按名加载插件随附 skill 内容
              └─→ dispose                          # 卸载清理
```

---

## MCP 系统

### 架构（三层 MCP）

参考 `oh-my-openagent-dev` 的三层 MCP 体系：

| Tier | 来源 | 机制 | 可靠性 |
|------|------|------|--------|
| **1. 静态声明** | `opencode.json` 的 `mcp` 段 | postinstall/setup-mcp 自动写入 | ✅ 最高（OpenCode 启动时加载） |
| **2. `.mcp.json`** | 项目根目录 `.mcp.json` | Claude Code 兼容格式，团队共享 | ✅ 标准格式 |
| **3. Config hook 注入** | 插件 config hook → `cfg.mcp` | 运行时注入（兼容机制） | ⚠️ 可能受 OpenCode 初始化时序影响 |

### MCP 服务器列表

插件依赖以下 4 个 MCP 服务器：

| MCP 服务 | 类型 | 用途 |
|----------|------|------|
| `codegraph` | local | 代码知识图谱：符号索引、调用链分析、代码搜索 |
| `context7` | local | 文档查询：库/框架/SDK API 文档检索 |
| `memory` | local | 知识图谱记忆：跨会话上下文持久化 |
| `sequential-thinking` | local | 结构化思维链：复杂问题分解与推理 |

### 配置管理

**安装时自动配置（postinstall）：**
每次 `npm install` 时，`postinstall.mjs` 会自动：
- 检查 `~/.config/opencode/opencode.json`，MCP 服务器缺失则自动添加（仅补缺失，不覆盖）
- 把 63 个 skill 复制到 `~/.config/opencode/skills/`（仅补缺失、不覆盖用户已有，manifest 记录用于安全卸载）
- 首次生成用户级配置模板 `~/.config/opencode/oh-y-lockie-agent.jsonc`（不覆盖已有）

**手动配置：**
```bash
npm run setup-mcp
# 或
node scripts/setup-mcp.mjs
```

**诊断：**
插件启动时，如果检测到 MCP 服务器缺失，会在控制台打印警告。

### .mcp.json（Claude Code 兼容格式）

插件根目录的 `.mcp.json` 提供了 Claude Code 兼容的 MCP 声明格式：

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    },
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "sequential-thinking": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
```

将此文件复制到项目根目录即可实现 Claude Code 与 OpenCode 共享 MCP 配置。

---

## 约定

- **运行时:** Node.js ESM（`"type": "module"`）
- **TypeScript:** strict 模式，ESNext 目标
- **测试:** Vitest，co-located `*.test.ts`
- **文件命名:** kebab-case
- **模块结构:** `index.ts` barrel export，避免 `utils.ts`/`helpers.ts` 等 catch-all 文件
- **配置格式:** JSONC（支持注释和尾逗号）
- **工厂模式:** `buildXxx()` / `createXxx()` 命名风格
- **注释:** 关键接口和复杂逻辑必写注释，避免"AI 废话"（obviously/simply/clearly）
- **日志:** 插件日志前缀 `[oh-y-lockie-agent]`
- **模型分配:** 重型任务（审查、安全、时序分析）→ Pro 模型，标准任务 → 标准模型
- **字符串引用:** 统一使用双引号
- **缩进:** 2 空格

---

## 反模式（禁止）

- 禁止 `as any`、`@ts-ignore`、`@ts-expect-error`
- 禁止发布时手动修改 `package.json` 的 `version` 字段
- 禁止在未读文件前写入（先读后改）
- 禁止用 `any` 类型绕过类型检查
- 禁止空的 catch 块 `catch(e) {}`
- 禁止在 `index.ts` 中堆业务逻辑（仅 barrel export）
- 禁止创建 catch-all 工具文件
- 禁止不经验证就声明"可以用"
- 禁止在 MCP 配置中使用 `your-provider` 占位符
- 禁止将用户级配置的修改直接写入插件默认配置
- 禁止未经门控检查（Section 2）就动手改代码

---

## 测试与验证

### 单元测试

```bash
npm test                 # 运行所有测试
npm run test:watch       # 监听模式
```

测试覆盖:
- `config.test.ts` — 配置加载、优先级链、合并逻辑
- `skills.test.ts` — frontmatter 解析、关键词提取、匹配评分、loadSkillContent
- `agents/__tests__/agents.test.ts` — 注册表、collectAgents、模型覆盖、分类映射
- `index.test.ts` — 三大 hook + 工具（含 lockie_load_skill）、路由指令不带 `ignored`
- `models.test.ts` — 模型探测、非对话模型过滤、解析链
- `intent.test.ts` / `intent-evals.test.ts` — 意图分类 + 触发词评估
- `context.test.ts` / `mcp.test.ts` / `logger.test.ts` / `telemetry.test.ts` / `update-checker.test.ts` — 各子系统

### 修改验证门控

每次变更后必须验证:

1. **编译** — `npx tsc --noEmit` 零错误
2. **测试** — `npm test` 全部通过
3. **Agent 注册** — 插件初始化时打印的 active agent count 正确（16 个）
4. **MCP 注入** — 检查 OpenCode 启动后 MCP 服务器状态

---

## 发布与部署

### 构建

```bash
npm run build            # tsc 编译
npm pack                 # 打包 .tgz
```

### 安装

```bash
npm install <package>.tgz
# postinstall 会自动执行:
#   MCP 服务器  → ~/.config/opencode/opencode.json（注入缺失的 MCP 条目）
#   skills/     → ~/.config/opencode/skills/（复制 63 个，仅补缺失、不覆盖；manifest 记录）
#   配置模板    → ~/.config/opencode/oh-y-lockie-agent.jsonc（首次生成，不覆盖已有）
#
# 以下内容通过插件 config hook 注入，无需复制:
#   agents/     → 读取 .md 内容 → inline prompt 注入 cfg.agent
#   references/ → 从插件目录访问，不复制
```

### 卸载

```bash
npm uninstall oh-y-lockie-agent
# preuninstall 会清理:
#   MCP 条目     → 从 opencode.json 删除
#   配置模板     → 删除前备份 .bak
#   复制的 skills → 按 manifest 只删除内容未改动的目录（用户改过的保留）
# agents/references 从未复制，卸载后自动消失
```
