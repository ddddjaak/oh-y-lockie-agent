# PR Review Checklist — oh-y-lockie-agent

> 提 PR 前自检 + Reviewer 审查时对照。两层:Layer A 工程实践 / Layer B 嵌入式领域语义建模。
> 每条 checkbox 附**判定标准**——能答"是/否"才算可勾选,模糊的就标 ❓ 提问。

**版本:** 1.0.0 | **配套文档:** [typescript-coding-standards.md](./typescript-coding-standards.md)

---

## 使用方式

1. **作者提 PR 时**:完成 Layer A 全部勾选,Layer B 按改动范围勾选
2. **Reviewer 审查时**:逐条核验作者勾选,重点看 Layer A 第 1/3/6 项 + Layer B 第 2/4 项
3. 任何一条标 ❓ 而非 ✅,必须在 PR 描述里说明原因,Reviewer 决定是否阻塞合并

---

## Layer A — TypeScript 插件工程实践

> 对应 `typescript-coding-standards.md` 的 7 条规则。这是**所有 PR 必过**的门槛。

### A1. 错误处理(对应规则 1)

- [ ] **本次改动没有新增空 catch 块**
  - 判定:`grep -rnE "catch\s*(\([^)]*\))?\s*\{\s*\}" src/` 在改动文件中无新增命中
- [ ] **新增的 catch 块至少做了以下之一:记录上下文 / 重抛 / 注释说明降级理由**
  - 判定:肉眼读每个新增 catch,能说出"失败时会发生什么"

### A2. 类型安全(对应规则 2)

- [ ] **没有新增 `as any` 或 `as unknown as T` 双重断言**
  - 判定:`grep -rnE "as\s+unknown\s+as\s+|as\s+any\b" src/` 无新增
- [ ] **新增的 `as` 单断言有就近注释(`// safe because ...`)**
  - 判定:每个新增 `as` 上方/同行有注释说明为何安全
- [ ] **解析外部数据(JSONC/SDK 返回)时,优先用了 zod 或类型守卫,而非直接断言**
  - 判定:新增的 `JSON.parse` / `parse()` 结果是否经过 schema 校验

### A3. 工厂与注册(对应规则 3)

- [ ] **没有新增 `Object.assign(fn, {...})` 挂静态属性到函数的模式**
  - 判定:`grep -rn "Object.assign" src/agents/` 无新增
- [ ] **新增 agent 走显式 `AgentDef` 对象定义(含 factory / mode / defaultModel / category)**
  - 判定:新增 agent 在 `definitions.ts` 中类型完整

### A4. 分类与路由(对应规则 4)

- [ ] **没有用 `description.includes(...)` 反推 agent 分类或 skill 路由**
  - 判定:`grep -n "includes(" src/agents/index.ts src/skills.ts` 改动行无新增此类逻辑
- [ ] **新增/修改 agent 时,category 字段已显式声明,不依赖 description 措辞**
  - 判定:新增 agent 在 `agentSources` 中有 `category` 字段

### A5. 配置单源(对应规则 5)

- [ ] **本次改动没有在 `.ts` 和 `.mjs` 中重复定义同一常量**
  - 判定:涉及 MCP/agent 名单/模型 ID 等共享常量时,只改了一处真相源
- [ ] **若新增跨 TS/mjs 共享的常量,已抽到 `config/*.jsonc` 共享**
  - 判定:新增常量文件路径在 `config/` 下,两边 import 同一文件

### A6. 测试(对应规则 6)⭐ 重点

- [ ] **改动覆盖了对应的测试文件(co-located `*.test.ts`)**
  - 判定:改 `src/X.ts` → 有 `src/__tests__/X.test.ts` 或对应测试更新
- [ ] **若改动涉及 `src/index.ts` 的 hook,新增/更新了 `index.test.ts`**
  - 判定:`config` / `chat.message` / `experimental.chat.system.transform` 三个 hook 任一改动,测试必须跟上
- [ ] **`npm test` 全绿,且 `npx tsc --noEmit` 零错误**
  - 判定:CI 绿;本地 `npm test && npx tsc --noEmit` 退出码 0
- [ ] **测试覆盖了正常路径 + 至少一个边界(空输入/缺字段/失败路径)**
  - 判定:新增测试函数中至少一个 `it("... null/empty/missing ...")`

### A7. Frontmatter(对应规则 7)

- [ ] **新增/修改的 `agents/*.md` 含 `name` + `description` + `mode` 三个字段**
  - 判定:`for f in agents/*.md; do grep -q "^name:" "$f" && grep -q "^description:" "$f" && grep -q "^mode:" "$f"; done` 全过
- [ ] **新增/修改的 `skills/**/SKILL.md` 含 `name` + `description`**
  - 判定:同上,skills 目录
- [ ] **`name` 字段是 kebab-case 且与所在目录名一致**
  - 判定:`name: peripheral-driver-design` 对应目录 `skills/opencode/peripheral-driver-design/`

### A8. 文档一致性

- [ ] **改动若影响 AGENTS.md 中描述的结构(如 agent 数量、目录树),已同步更新 AGENTS.md**
  - 判定:AGENTS.md 的"项目结构""Agent 目录"等章节与实际一致
- [ ] **改动若影响对外行为(如 hook 触发条件、MCP 列表),已在 README.md 同步**
  - 判定:README 的"包含内容""MCP 注入机制"等章节与代码一致

---

## Layer B — 嵌入式领域语义建模

> 这个项目是"为嵌入式开发提供 AI 编排的 TS 插件"。Layer B 审查的不是嵌入式 C 代码本身(那是 `references/` 的事),而是**TS 插件对嵌入式领域的建模是否语义正确**。
>
> 适用场景:改动涉及 `agents/*.md` prompt / `skills/**/SKILL.md` / `extractKeywords` 词表 / `SKILL_ROUTE_TABLE` 路由表 / 任何描述嵌入式概念的字符串。

### B1. Agent prompt 的嵌入式语义准确性

- [ ] **agent prompt 中引用的嵌入式术语与行业通用含义一致**
  - 判定:如 `boot-bringup-specialist.md` 提到 "Boot ROM 验证" —— Boot ROM 是芯片固化 ROM 里的启动代码,不是 bootloader;措辞不能混用
- [ ] **agent 描述的 RTOS 概念(任务/信号量/队列/优先级反转)用法正确**
  - 判定:对照 fw-domain-expert.md 的"RTOS & Concurrency"章节,术语不冲突
- [ ] **涉及的寄存器/内存/时序描述符合 ARM Cortex-M / RISC-V 通用模型**
  - 判定:如 MPU 区域编号、HardFault 状态位、PLL 配置字段名符合 CMSIS 习惯

### B2. Skill 路由词表的领域覆盖 ⭐ 重点

- [ ] **新增 skill 的 description 含足够触发关键词,能被 `extractKeywords` 正确提取**
  - 判定:把 description 喂给 `extractKeywords()`,返回的关键词集合非空且语义相关
- [ ] **`extractKeywords` 的硬编码词表(skills.ts:91-114)新增术语时,术语在嵌入式领域真实存在**
  - 判定:新增词如 "TrustZone-M" / "MPU" / "PMP"(RISC-V)对应真实硬件特性,非生造
- [ ] **`SKILL_ROUTE_TABLE`(skills.ts:204+)的路由条目与实际 skill 一一对应**
  - 判定:表格里每一行"加载 Skill"列的 name,在 `skills/opencode/` 下能找到对应目录
- [ ] **路由表未覆盖的常见嵌入式意图(如"看门狗""低功耗""DFU")已评估是否需要新增条目**
  - 判定:本次改动若涉及领域词,检查了"用户可能怎么说但当前路由不到"的情况

### B3. 嵌入式安全语义(插件层)

> 注意:固件自身的安全 checklist 见 `references/security-checklist.md`,这里只审插件对安全的建模。

- [ ] **`security-auditor` agent 的审查范围与 `references/security-checklist.md` 不冲突不遗漏**
  - 判定:agent prompt 的 5 个维度(Input/Auth/Data/Infra/3rd-party)与 reference 的 7 个章节能对应或互补
- [ ] **涉及安全启动/OTA/密钥管理的 skill 描述,没有淡化"生产环境必须"的语气**
  - 判定:如 bootloader-design skill 不会说"可选启用安全启动",而是"生产环境必须"

### B4. SE/AE 双管线路由的语义一致性

- [ ] **改动若新增 skill,已明确归属 SE 管线(Define→Design→Document→Verify→Validate)或 AE 管线(Concept→Spec→Plan→Code→Test→Review→Ship)**
  - 判定:在 `SKILL_ROUTE_TABLE` 中归入正确的 ### 小节
- [ ] **跨管线 skill(如 `code-review-and-quality` 既服务 SE 又服务 AE)在路由表中只出现一次,描述说明双管线适用**
  - 判定:无重复条目;description 含"SE/AE 通用"类说明

### B5. 领域 agent 的模型分配合理性

- [ ] **重型任务(安全审计/时序分析/电源架构/内存映射)用 Pro 模型(`ddddjaak/mimo-v2.5-pro`)**
  - 判定:对照 `definitions.ts` 的 `defaultModel`,重型 agent 不是标准模型
- [ ] **标准任务(寄存器生成/固件架构/领域专家)用标准模型**
  - 判定:非重型 agent 不占 Pro 配额
- [ ] **新增 agent 的模型分配有书面理由(在 PR 描述或 definitions.ts 注释中)**
  - 判定:能回答"为什么这个 agent 需要更强推理能力"

---

## 快速过滤:哪些 PR 需要过 Layer B?

| 改动范围 | Layer A | Layer B |
|---------|---------|---------|
| 纯 `src/*.ts` 逻辑(config/skills/mcp/agents 注册) | ✅ 全过 | B2(若改 extractKeywords 或路由表) |
| `agents/*.md` prompt | A7、A8 | ✅ 全过 |
| `skills/**/SKILL.md` | A7、A8 | B1、B2、B4 |
| `references/*.md` | A8 | 不适用(参考文档自审) |
| `scripts/*.mjs` | A5、A6 | 不适用 |
| `config/*.jsonc` | A5 | B5(若改 agent model 映射) |
| 文档(README/AGENTS) | A8 | 不适用 |

---

## Reviewer 决议模板

```markdown
## Review 决议

**Verdict:** APPROVE | REQUEST CHANGES | NEEDS DISCUSSION

**Layer A 通过项:** x/8
**Layer B 通过项:** x/5(若适用)

**阻塞项(P1,必须改):**
- [A6] index.ts 改了 config hook 但未补测试

**建议项(P2,建议改):**
- [A2] config.ts:81 的 as 断言缺注释

**亮点:**
- [B2] 新增 skill 的 description 触发词设计合理,路由测试覆盖完整
```

---

## 常见误用提醒

1. **不要把 Layer A 当摆设**——A6(测试)是最常被跳过也最致命的一项
2. **Layer B 不是"懂嵌入式才能审"**——B2/B4 是文档一致性检查,任何 reviewer 都能做;B1/B3/B5 才需要领域知识,可交领域专家
3. **❓ 不等于 ✅**——不确定就标问号并提问,不要为了过 checklist 而假勾选
4. **本 checklist 是活的**——发现新的反复出现问题,在对应 Layer 追加条目,并更新版本号
