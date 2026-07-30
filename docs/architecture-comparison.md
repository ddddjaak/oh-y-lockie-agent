# 架构对比:oh-y-lockie-agent vs oh-my-openagent-dev

> 基准 A = oh-my-openagent-dev(oh-my-opencode v4.19.3,27 packages monorepo,通用 agent harness)
> 对比方 B = oh-y-lockie-agent(v1.0.0,单包,嵌入式垂直插件)
> 日期:2026-07-31

B 参考了 A 的设计(agentSources/collectPendingBuiltinAgents、三层 MCP、AgentFactory 模式),但在 A 演进到 v4.19.3 的过程中,B 落后了多个架构点。本文档列出 B 该落地的改进、不该照搬的部分、以及 B 反超的一点。

---

## 1. A 领先 · B 该落地(6 项)

### P1 — event hook + 错误自愈层(最高价值)

A 的 `plugin/event.ts` 监听 `session.created/deleted/idle/error/status`、`message.updated/removed`,触发 model-fallback 自动重试(带 dedup 窗口)、runtime-fallback、context-window-limit 恢复。配套 `hooks/` 下有 `edit-error-recovery`、`json-error-recovery`、`anthropic-context-window-limit-recovery`、`delegate-task-retry`、`unstable-agent-babysitter` 等。

**B 现状**:只有 `try/catch + console.log`。任何 API 报错、上下文溢出、模型不可用都直接失败,用户得手动重试。

**B 落地建议**:不必照搬 A 的 60+ hook。先接入 `event` hook,在 `session.error` 上做最简 model-fallback——失败时切备用模型重试一次。这是投入产出比最高的一步:嵌入式审查任务跑一半因 API 限流失败,自动切备用模型比重跑整个会话省时得多。

### P1 — tool.execute.before/after 守卫

A 的 `tool-execute-before.ts` 做:null 字节清洗(防 shell 注入)、纯 `sleep` 命令阻塞(防 background 死等)、`mcp_` 前缀修正、参数 schema 归一化。

**B 现状**:`lockie_list_agents` 工具调用零防护。目前工具简单风险低,但加 MCP 工具后(尤其 debugger-mcp 的写操作)必须有守卫。

**B 落地建议**:加两个空 hook 骨架,逐步填充。第一步只做 null 字节清洗 + 参数 schema 校验。借鉴难度低,单点收益明显。

### P1 — config zod schema 校验

A 的 `omo-config-core/schema/config.ts` 用 zod `OmoConfigSchema`(strict)+ agent/category/team/model-catalog 子 schema,启动即 `validatePluginConfig`。

**B 现状**:`config.ts` 用 jsonc-parser 解析 + 3 级优先级链,但**零校验**。坏配置(字段拼错、类型错)运行时才暴露,且报错信息是隐晦的 undefined 访问。

**B 落地建议**:B 已经用 zod(`lockieListAgentsTool` 的 args),给 config 加一个 `PluginConfigSchema`(agent overrides + mcp 两段)即可。这正好闭环规则 2(收窄 as 断言)——zod schema 解析后,`config.ts` 里那一堆 `as Record<string, AgentOverride>` 断言可以全删。**一箭双雕**。

### P2 — telemetry 本地诊断

A 的 `telemetry-core/diagnostics.ts` 写 `telemetry-diagnostics.jsonl`(7 天保留、256KB 截断、原子写),posthog 可选。

**B 现状**:全 `console.log`,无结构化日志、无保留策略、无 skill 路由命中率统计。这正是之前诊断的 P3"可观测性无反馈闭环"。

**B 落地建议**:抄 A 的 `diagnostics.ts` 单文件(约 150 行),落地结构化本地 jsonl 日志。不必上 posthog。有了它才能度量"哪些 skill 从没被触发""哪些关键词误匹配",给 extractKeywords 词表优化闭环。

### P2 — 集成 / 形状测试

A 有 `create-plugin-module-live-route.test`(真实路由)、`index.export-shape.test`(导出形状)、`bundle-size.test`/`bundle-purity.test`、`dependency-security.test`、`version-coherence.test`。

**B 现状**:只有 5 个 unit 文件。这正是之前诊断的 P3"测试金字塔倒置"。

**B 落地建议**:`export-shape`(验证导出的 hook/agent/skill 数量与形状)和 `dependency-security`(验证无已知漏洞依赖)两类对 B 立刻有用,写一次常年防回归。

### P3 — LSP/AST 代码理解(精简版)

A 的 `lsp-core` 提供 definitions/diagnostics/rename/symbols/workspace-edit,并有 `ast-grep-sg-provision` hook、`hashline-edit`。

**B 现状**:只靠 codegraph MCP(代码符号索引)。

**B 落地建议**:完整 LSP client 太重,且 B 是嵌入式垂直(用户代码可能是 C/Zephyr,LSP server 各异)。可只接 `ast-grep`(轻量、单二进制、支持多语言)做模式匹配——比如审查驱动代码时用 ast-grep 找"未检查返回值的 HAL 调用"模式。借鉴难度高,放后期。

---

## 2. B 反超 · 保持(1 项)

### config 懒加载(A 可向 B 借鉴)

B 的 `lockieListAgentsTool` 在 **tool-call 时**重读 config(`index.ts:51`:`const { overrides } = loadPluginConfig()`),让用户级 override 热生效——改了配置不用重启。

A 反而在 config handler 内**禁调 client API** 防死锁,导致配置变更后工具层读到的是旧值。

**这是 B 唯一反超的点,保持住**。B 的懒加载读法是对的,A 那边可以借鉴。这也说明:B 不是全盘落后,在个别设计上更灵活。

---

## 3. 不该照搬(5 项)

B 是嵌入式垂直单包,以下 A 的设计抄了反而是负担:

- **monorepo + 27 packages**:B 单包 8 个源文件,拆包收益为负。A 拆包是因为通用 harness 要支持多 harness 复用核心。
- **多 harness(Codex/SenPi/Pi)**:B 嵌入 OpenCode,无需 `[opencode]/[senpi]/[codex]` 分节与 `OmoHarnessId` 抽象。
- **原生平台二进制包**(darwin/linux/windows × arm64/x64/musl):B 纯 JS 无原生依赖,A 是因为捆绑了 ast-grep 等原生工具。
- **tmux 集成 + team-mode 全套**(mailbox/worktree/team-layout-tmux):B 的双管线不需要并行多成员编排,ship-review 串行足够。
- **config migration(journal/lock/transaction)**:事务化迁移为多版本升级设计,B v1.0 无历史包袱,过设计。
- **60+ hook 工厂**:多数是 Sisyphus/GPT-5.6 特化(如 `no-sisyphus-gpt`、`gpt-apply-patch-guard`),非通用。

---

## 4. 共同问题 · 可一起改进(3 项)

### skill 路由都偏启发式

B 是 80+ 硬编码关键词 + 评分(脆:新 skill 易遗漏,措辞变即失效);A 是把 skill 描述塞 system prompt 让 LLM 自选(贵:每次都过 LLM,且不可预测)。

**改进方向**:"关键词预筛 + LLM 兜底"混合——先用 B 的关键词匹配(快、免费),匹配不到或低置信度时再让 LLM 在候选 skill 里选。兼顾成本与准确率。

### 无 SLO / 延迟指标

两者都没有 skill/MCP 调用耗时分布。A 有 posthog 但偏业务事件。无法判断"哪个 skill 太慢""哪个 MCP 超时"。

**改进方向**:telemetry 里加 timing 字段(skill 触发→完成耗时、MCP 调用耗时)。

### MCP 失败静默降级

A 重连好一些但仍降级;B 仅启动期 `diagnoseMcpStatus` 检查存在性,运行时 MCP 挂了无感知。

**改进方向**:MCP 调用前 `tools/list` ping 做活性检测,失败时明确告知 AI"MCP X 不可用"而非静默降级。

---

## 5. 最该落地的三件套(工作量小、收益直接)

按投入产出比排序,B 应优先做这三项,它们都不引入 A 的复杂度:

| # | 改进 | 工作量 | 收益 | 闭环 |
|---|------|--------|------|------|
| 1 | config zod schema | 小(半天) | 坏配置启动即报,且**消除 config.ts 全部 as 断言** | 闭环规则 2 |
| 2 | tool.execute.before 守卫骨架 | 小(半天) | 工具调用防护,为 debugger-mcp 写操作铺路 | 为嵌入式 MCP 铺路 |
| 3 | event hook + 最简 model-fallback | 中(1-2 天) | API 失败自动切备用模型,审查任务不中断 | 提升韧性 |

三件套做完,B 在韧性、校验、防护上就基本追平 A 的关键能力,同时保持单包精简。telemetry 和集成测试作为 P2 滚动跟进,LSP/ast-grep 等用户量上来再考虑。

---

## 6. 参考文件索引(项目 A)

- 入口与 hook:`packages/omo-opencode/src/plugin-interface.ts`、`hooks/index.ts`
- event/韧性:`plugin/event.ts`、`plugin/tool-execute-before.ts`
- agent:`agents/builtin-agents.ts`
- config(zod + migration):`packages/omo-config-core/src/schema/config.ts`、`migration/`
- telemetry:`packages/telemetry-core/src/diagnostics.ts`
- team/delegate:`packages/team-core/src/config.ts`、`packages/delegate-core/src/retry-patterns.ts`
- LSP/MCP:`packages/lsp-core/src/tools/`、`packages/mcp-client-core/src/skill-mcp-manager/`
- skills loader:`packages/skills-loader-core/src/features/opencode-skill-loader/`
