---
name: ship-review
description: Pre-ship multi-perspective review that orchestrates code, security, and test perspectives into a single go/no-go verdict. Use when the user says 发布前审查, ship review, 上线审查, 发布就绪, pre-ship review, go/no-go, 上线前评审. 覆盖：代码评审、安全审计、测试覆盖、发布决策。三视角并行 fan-out 到 code-reviewer / security-auditor / test-engineer 三个 subagent，汇总发布结论，替代已移除的 /ship 命令。
---

# Ship Review

> 发布前三视角审查：代码正确性 + 安全性 + 测试覆盖 → 汇总 go/no-go 决策。
> 通过 `task` 工具把三视角**并行委托**给 `code-reviewer` / `security-auditor` / `test-engineer`
> 三个 subagent（fresh context，结论相互独立），主会话只负责发起与汇总。原 `/ship` 的
> 并行 fan-out 由此恢复；若 `task` 工具不可用（受限环境），才退回单会话依次执行并如实标注降级。

## When to Use

- 变更即将合并到发布分支前的最终把关
- 用户说「发布前审查」「上线前过一遍」「ship review」「这个能发了吗」
- 需要一个明确的 GO / CONDITIONAL GO / NO-GO 结论，而非单视角意见

## When NOT to Use

- 单视角深度审查 → 直接用 `code-review-and-quality` / `security-and-hardening` / `test-driven-development`
- 设计阶段的多视角对抗审查 → 用 `design-review`（四视角，面向设计制品）
- 发布流程本身（OTA、灰度、回滚） → 用 `shipping-and-launch`

## Workflow

### 1. 并行 Fan-out（task 工具）

用 `task` 工具**并行**发起三个子任务，分别委托给：

| Subagent | 视角 | 交付物 |
|----------|------|--------|
| `code-reviewer` | 代码正确性 + 可读性 + 架构 | `### Code Perspective`（Critical / Important / Suggestion 分级） |
| `security-auditor` | 安全审计 | `### Security Perspective`（Critical / High / Medium / Low 分级） |
| `test-engineer` | 测试覆盖 + 可测试性 | `### Test Perspective`（覆盖缺口 + 可测试性倒退） |

每个任务使用结构化委托模板，CONTEXT 必须包含**本次变更的 diff 范围**：

```text
TASK: 对本次变更做[代码/安全/测试]视角审查
OUTCOME: 结构化发现，按[对应分级]列出，每个 Blocking 项给出 file:line 与修复方向
TOOLS: 允许 Read / Grep / Bash（只读、可编译可跑测试）
MUST: 聚焦本次 diff；只报告你能从证据支持的问题；无发现也要显式确认
MUST_NOT: 修改任何文件；臆测未见到的代码
CONTEXT: <本次变更范围 / diff 摘要 / 相关文件列表>
```

三个 subagent 是独立 fresh context，主会话**不要**替它们下结论，也不要提前把自己的判断喂给它们。

### 2. 汇总三份报告

拿到三份报告后交叉核对：同一问题被多个视角命中时合并；互相矛盾的结论需要主会话裁决并说明理由。

### 3. Merge & Verdict

汇总后给出发布决策：

```markdown
## Ship Review Verdict

**Decision:** GO | CONDITIONAL GO | NO-GO

**Code:** [n Critical / n Important]
**Security:** [n Critical / n High / n Medium]
**Test:** [覆盖缺口数] [可测试性问题数]

### Blocking Issues (must fix before ship)
- [视角] [issue] [file:line]

### Conditions (for CONDITIONAL GO)
- [必须在发布后 N 天内修复的项]

### What's Done Well
- [至少一条正面观察——发布审查也要肯定做对的事]
```

## Rules

1. **三视角必须都跑**——跳过安全视角的发布审查等于没审。即使变更"看起来不涉及安全"，也要让 `security-auditor` 显式确认而非默认跳过。
2. **Decision 必须明确**——GO / CONDITIONAL GO / NO-GO 三选一，不要给"看起来还行"这种模糊结论。
3. **Critical = NO-GO**——任一视角有 Critical 级问题，Decision 自动 NO-GO，不得降级为 CONDITIONAL GO。
4. **聚焦本次 diff**——发布审查审的是"这次要发的变更"，不是整个代码库的全量审查。全量审查用 `code-static-review`。
5. **每个 Blocking Issue 必须可执行**——写明 file:line 和修复方向，不要"建议加强安全性"这种废话。
6. **降级要诚实标注**——`task` 工具可用时必须 fan-out；若确实不可用（受限环境），退回单会话依次完成三视角，并在报告中标注"本次为单会话降级执行，结论未经 fresh-context 独立复核"。

## Composition

- **触发：** 自然语言「发布前审查」「ship review」「上线审查」「发布就绪」「go/no-go」
- **编排：** 主会话用 `task` 工具并行委托 `code-reviewer` / `security-auditor` / `test-engineer`（fresh context），汇总后给出 go/no-go。插件路由表与 fan-out 检测与本 skill 一致，不冲突。
- **与 design-review 的区别：** design-review 审设计制品（架构/规格），四视角；ship-review 审即将发布的变更 diff，三视角。一个在 Design 阶段，一个在 Ship 阶段。
