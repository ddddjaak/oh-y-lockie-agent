# 团队技术能力提升 — 交付总览

> 交付日期: 2026-07-30 ~ 2026-07-31 | 交付者: Senior Developer(高级开发工程师)
> 两阶段交付:① 诊断 + 规范沉淀 ② 按规范修复代码

## 阶段一:诊断 + 规范(2026-07-30)

对 `src/` 全量源码做代码质量审查,沉淀两份团队可复用资产:

| 文件 | 用途 |
|------|------|
| `docs/typescript-coding-standards.md` | TS 编码规范(治本版),7 条规则,每条含反例/正例/自动化验收脚本 |
| `docs/pr-review-checklist.md` | PR Review Checklist,双层:A 工程实践 / B 嵌入式领域语义建模 |

核心诊断:团队架构分层与文档基础扎实(8/10),问题在执行层未兑现 AGENTS.md 约定。2 个 P1(空 catch 违反自家规范、核心 hook 零测试)+ 3 个 P2(as 断言、字符串 includes 分类、MCP 两处重复)。

## 阶段二:按规范修复(2026-07-31,本阶段)

用户指示"架构优先,TS 角度,嵌入式技能语义放后面"。按规则 1-7 逐项修复,全部通过自动化验收。

### 修复清单

| 规则 | 修复内容 | 验收 |
|------|---------|------|
| R1 空 catch | `index.ts:29` getPkgVersion + `skills.ts:151` buildSkillTable 两处空 catch 改为带 console.error 上下文 | OK |
| R2 as 断言 | 消除 `as unknown as` 双重断言(index.test.ts 夹具);架构相关的 as 全部加 `// safe because` 注释 | OK |
| R3 工厂 registry | `definitions.ts` 16 个 agent 从 `Object.assign(fn,{})` 改为显式 `AgentDef` 对象;`buildAgent` 消除 `as AgentConfig & {mode?}` 断言 | OK |
| R4 分类显式化 | `buildAgentCategoryMap` 从 `description.includes` 反推改为 `def.category` 显式字段;改 description 不再误分类 | OK |
| R5 MCP 单源 | 抽 `config/mcp-servers.json` 单一真相源;`mcp.ts` 与 `postinstall.mjs` 都读它,消除两处硬编码 | OK |
| R6 hook 测试 | 新增 `src/__tests__/index.test.ts`,9 个测试覆盖 config 注入/chat.message 路由/system.transform 三大 hook | OK |
| R7 frontmatter | 补全 11 个 agent .md 的 `name` 字段(原仅 5 个有,现 16/16 齐全) | OK |

### 架构改造核心(规则 3+4)

这是本轮最大的结构改造。旧设计把 `mode`/`defaultModel` 用 `Object.assign` 挂在工厂函数上,TS 无法静态推断,迫使 `buildAgent` 写 `factory(model) as AgentConfig & { mode? }` 断言。新设计用显式 `AgentDef` 对象:

```ts
interface AgentDef {
  factory: (model: string) => AgentConfig;
  mode: AgentMode;
  defaultModel: string;
  category: AgentCategory;  // 新增,替代 description.includes 反推
}
```

`mode` 自然流通无需断言,`category` 显式声明与 description 解耦。同步更新 `agents.test.ts` 适配新 API,并新增 categorization 测试。

### 验证结果

- **tsc --noEmit**: 0 errors
- **vitest**: 5 test files, 59 tests, all passed(原 50 + 新增 9 个 hook 测试)
- **7 条规则验收脚本**: 全部 OK(R3 仅注释引用旧模式名,属设计说明)

### 未覆盖(明确范围)

- **嵌入式领域语义(Layer B)**:按用户指示放后面,本轮未触碰 agent prompt 的嵌入式措辞、skill 路由词表的领域准确性
- **zod 引入**:规则 2 的彻底方案(用 zod 替代 as 断言)需团队评估新依赖,本轮以"加注释"达到最低要求
- **`.mcp.json`**:Claude Code 格式,与 OpenCode 格式不同,本轮保留未合并(在规范文档标注需手动与 `config/mcp-servers.json` 保持一致)
- **extractKeywords 硬编码词表**:skills.ts:91-114 的 80+ 术语数组,属 Layer B 领域语义,本轮未动

## 阶段三:P1 架构遗漏修复(2026-07-31,第三轮)

用户要求修复资深视角诊断的 P1(可靠性 + 编排回退)。

### P1-2 可靠性:原子写用户配置

`postinstall.mjs` 与 `mcp.ts` 直接 `writeFileSync` 覆盖用户 `opencode.json`,写一半中断会损坏配置。改为 `atomicWriteJson`:写 `.tmp` → `copyFileSync` 备份 `.bak` → `renameSync` 原子替换。Node rename 在两平台都原子替换目标。

`mcp.ts` 的 `atomicWriteJson` 已 export,`mcp.test.ts` 直接测契约(2 测试):写内容正确、`.bak` 留原始、`.tmp` 不残留、新文件无 `.bak` 不崩溃。

> 踩坑:最初用 `vi.spyOn(os,"homedir")` 间接测 `injectMcpToOpenCodeConfig`,但 ESM 命名导入绑定无法被 spyOn 拦截,读到真实 opencode.json(postinstall 已注入 MCP)。改为直接测 `atomicWriteJson` 契约,绕开 homedir mock 的脆弱性。

### P1-1 编排回退:fan-out 死链接 + 能力入口

v2.0.0 移除 command 层时丢了多 agent 并行 fan-out(`/ship`)。调查发现 `system-architect.md` 已做正确迁移(指向 `design-review` skill),但 `code-reviewer` / `security-auditor` / `test-engineer` 3 个 agent 仍引用已删的 `/ship` `/review` `/test`。

修复:
- 3 个 agent 的 Composition 段死链接 → 指向对应 skill(`code-review-and-quality` / `security-and-hardening` / `test-driven-development`),fan-out 指向新建 `ship-review` skill
- 新建 `skills/opencode/ship-review/SKILL.md`:发布前三视角审查(代码+安全+测试)→ go/no-go 汇总。诚实标注是串行三视角(非原 `/ship` 并行 fan-out,那需 OpenCode 运行时支持,插件层无法恢复)
- `SKILL_ROUTE_TABLE` 加路由条目(发布前审查/ship review/上线审查 → ship-review)

### 验证

- `tsc --noEmit`: 0 errors
- `vitest`: 5 files, 61 tests all passed(阶段二的 59 + 新增 2 个 atomicWriteJson)
- skill index: 56 skills loaded(原 55 + ship-review)

## 后续建议

1. **Layer B 嵌入式语义**:用户指示"放后面",可作为下一轮工作 — 审查 agent prompt 措辞准确性、skill 路由词表领域覆盖
2. **zod 评估**:若团队接受新依赖,可彻底消除 config/mcp 的 as 断言(规则 2 进阶)
3. **`.mcp.json` 生成脚本**:加 npm script 从 `config/mcp-servers.json` 生成 Claude Code 格式,消除第三处手动维护
4. **CI 接入**:把 `docs/typescript-coding-standards.md` 末尾的 7 个验收 grep 脚本接入 CI,防止回归
5. **P2 残留死链接**:`doubt-driven-development` skill 的 `/review` 概念引用、`references/orchestration-patterns.md` 的 `/ship` 模式描述 — 概念/文档引用非功能死链接,本轮未动
6. **嵌入式 MCP / RAG**:用户提的两大能力缺口(datasheet/SVD/debugger/serial MCP + 文档检索 RAG)— 是更大的工程,建议单独规划
