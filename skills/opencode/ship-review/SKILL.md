---
name: ship-review
description: Pre-ship multi-perspective review that orchestrates code, security, and test perspectives into a single go/no-go verdict. Use when the user says 发布前审查, ship review, 上线审查, 发布就绪, pre-ship review, go/no-go, 上线前评审. 覆盖：代码评审、安全审计、测试覆盖、发布决策。三视角汇总发布结论，替代已移除的 /ship 命令。
---

# Ship Review

> 发布前三视角审查：代码正确性 + 安全性 + 测试覆盖 → 汇总 go/no-go 决策。
> 这是 v2.0.0 移除 `/ship` command 后的 skill 层入口。原 `/ship` 的并行 fan-out 由 OpenCode 运行时提供；本 skill 在单会话内**依次**完成三视角审查并汇总——是降级但可用的替代，不依赖已移除的 command 层。

## When to Use

- 变更即将合并到发布分支前的最终把关
- 用户说「发布前审查」「上线前过一遍」「ship review」「这个能发了吗」
- 需要一个明确的 GO / CONDITIONAL GO / NO-GO 结论，而非单视角意见

## When NOT to Use

- 单视角深度审查 → 直接用 `code-review-and-quality` / `security-and-hardening` / `test-driven-development`
- 设计阶段的多视角对抗审查 → 用 `design-review`（四视角，面向设计制品）
- 发布流程本身（OTA、灰度、回滚） → 用 `shipping-and-launch`

## Workflow

依次执行三个视角，每个视角产出结构化发现，最后汇总。**不要跳过任一视角**——发布审查的价值在于三视角交叉覆盖。

### 1. Code Perspective（代码正确性 + 可读性 + 架构）

对照 `code-review-and-quality` skill 的五维度（正确性 / 可读性 / 架构 / 安全 / 性能），聚焦**本次变更 diff**：

- 变更是否做了规格/任务要求的事？边界条件（null / empty / 错误路径）处理了吗？
- 有没有引入循环依赖、破坏模块边界、错误的抽象层级？
- 命名一致吗？控制流能不解释就读懂吗？

产出：`### Code Perspective` 段，Critical / Important / Suggestion 分级。

### 2. Security Perspective（安全审计）

对照 `security-and-hardening` skill，聚焦**本次变更引入的风险面**：

- 输入校验、注入向量、鉴权边界
- 密钥/凭证是否进了代码或日志
- 新依赖的已知漏洞
- （嵌入式场景）安全启动、OTA 完整性、调试口锁定是否受影响

产出：`### Security Perspective` 段，按 Critical / High / Medium / Low 分级。

### 3. Test Perspective（测试覆盖 + 可测试性）

对照 `test-driven-development` skill，聚焦**变更的测试保障**：

- 变更的行为有测试覆盖吗？测的是行为还是实现细节？
- 错误路径、边界条件有测吗？
- 有没有"测了但永远不失败"的废测试？
- 变更是否降低了可测试性（隐藏依赖、不可注入的副作用）？

产出：`### Test Perspective` 段，列出覆盖缺口和可测试性倒退。

### 4. Merge & Verdict

汇总三视角，给出发布决策：

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

1. **三视角必须都跑**——跳过安全视角的发布审查等于没审。即使变更"看起来不涉及安全"，也要显式确认而非默认跳过。
2. **Decision 必须明确**——GO / CONDITIONAL GO / NO-GO 三选一，不要给"看起来还行"这种模糊结论。
3. **Critical = NO-GO**——任一视角有 Critical 级问题，Decision 自动 NO-GO，不得降级为 CONDITIONAL GO。
4. **聚焦本次 diff**——发布审查审的是"这次要发的变更"，不是整个代码库的全量审查。全量审查用 `code-static-review`。
5. **每个 Blocking Issue 必须可执行**——写明 file:line 和修复方向，不要"建议加强安全性"这种废话。
6. **诚实标注降级**——本 skill 是串行三视角，不是原 `/ship` 的并行 fan-out。如果某视角需要更深的独立调查，在报告中标注"建议后续单独触发 X skill 深入"，不要假装一次审查能覆盖一切。

## Composition

- **触发：** 自然语言「发布前审查」「ship review」「上线审查」「发布就绪」
- **不调用其他 persona：** 三视角由本 skill 在当前会话内依次完成，不委托 `code-reviewer` / `security-auditor` / `test-engineer` subagent（orchestration belongs to skills, not personas）。
- **与 design-review 的区别：** design-review 审设计制品（架构/规格），四视角；ship-review 审即将发布的变更 diff，三视角。一个在 Design 阶段，一个在 Ship 阶段。
