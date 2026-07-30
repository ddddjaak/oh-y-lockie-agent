# TypeScript 编码规范 — oh-y-lockie-agent(治本版)

> 基于 2026-07-30 对 `src/` 全量代码审查沉淀。每条规则都来自真实发现,每条都可自动化验收。
> 目标:把 AGENTS.md 里"约定写得很好但落地没守住"的 gap,用可执行规则堵死。

**版本:** 1.0.0 | **适用范围:** `src/` 下所有 `.ts` 文件 + `scripts/` 下 `.mjs` 文件

---

## 如何使用本文档

- **写代码前**:扫一眼第 1-7 条,它们是高频踩坑点
- **提 PR 前**:对照 `pr-review-checklist.md` 逐条勾选
- **新增规则**:发现新的反复出现问题 → 在本文档追加规则 + 对应 checklist 项,二者同步

---

## 1. 错误处理:禁止静默 catch

### 规则
`catch` 块**至少**要做以下之一,不得为空:
- 记录错误上下文(`console.error` + 文件名 + 操作描述)
- 重新抛出(`throw err` 或包装后抛出)
- 返回明确的失败默认值并注释说明为什么安全降级

### 为什么
AGENTS.md 第 510 行明文禁止 `catch(e) {}`。空 catch 让 skill/agent 加载失败时**完全无法排查**——插件"看起来能用"但功能静默丢失,这是最危险的失败模式。

### 反例(当前代码中存在)
```ts
// src/index.ts:29 — getPkgVersion
try {
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
  return pkg.version || "unknown";
} catch {
  return "unknown";  // 静默吞错:package.json 损坏时无任何线索
}

// src/skills.ts:151 — buildSkillTable
try {
  const content = readFileSync(skillPath, "utf-8");
  // ...
} catch {
  return null;  // 静默吞错:某个 skill 解析失败时,整个 skill 从索引消失,无人知晓
}
```

### 正例
```ts
// getPkgVersion — 失败可降级,但要留痕
try {
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
  return pkg.version || "unknown";
} catch (err) {
  console.error("[oh-y-lockie-agent] failed to read package.json version:", err);
  return "unknown";
}

// buildSkillTable — 单个 skill 失败不应影响其他,但必须记录是哪个
try {
  const content = readFileSync(skillPath, "utf-8");
  const fm = parseFrontmatter(content);
  if (!fm) {
    console.warn(`[oh-y-lockie-agent] skill ${d.name}: frontmatter missing, skipped`);
    return null;
  }
  return { name: fm.name, description: fm.description, keywords: extractKeywords(fm.description) };
} catch (err) {
  console.error(`[oh-y-lockie-agent] skill ${d.name}: failed to load:`, err);
  return null;
}
```

### 验收(自动化)
```bash
# CI 中执行:任何空 catch 块直接 fail
grep -rnE "catch\s*(\([^)]*\))?\s*\{\s*\}" src/ && echo "FAIL: empty catch block found" && exit 1 || echo "OK"
```

---

## 2. 类型断言:限制 `as` 的使用

### 规则
- **禁止** `as any` / `as unknown as T`(双重断言)
- `as` 断言必须**就近注释**说明为什么这里安全(用 `// safe because ...`)
- 优先用**类型守卫**(type guard)/ **泛型** / **zod 运行时校验** 替代断言
- 对外部 SDK 返回的 `unknown` / `Record<string, unknown>`,优先用 zod schema 解析,而非 `as`

### 为什么
当前代码 15+ 处 `as` 断言,大部分集中在 `config.ts` / `mcp.ts` / `index.ts` 解析 JSONC 配置时。`as` 会让 TypeScript 的类型保护**形同虚设**——配置文件结构变了,编译不报错,运行时才崩。

### 反例
```ts
// src/index.ts:101 — 绕过 SDK 类型,且无注释
const target = cfg.agent as Record<string, unknown>;

// src/config.ts:81 — JSONC 解析结果直接断言,结构错误时运行时崩
let overrides: Record<string, AgentOverride> =
  (defaultCfg?.agent as Record<string, AgentOverride>) || {};
```

### 正例
```ts
// 方案 A:用 zod 在边界解析(推荐)
import { z } from "zod";

const AgentOverrideSchema = z.object({
  model: z.string().optional(),
  disable: z.boolean().optional(),
});
const PluginConfigSchema = z.object({
  agent: z.record(z.string(), AgentOverrideSchema).optional(),
  mcp: z.record(z.string(), z.unknown()).optional(),
});

function loadJsoncFile(filePath: string): z.infer<typeof PluginConfigSchema> | null {
  // ... parse ...
  const result = PluginConfigSchema.safeParse(parse(raw, errors));
  if (!result.success) {
    console.error(`[oh-y-lockie-agent] config schema invalid in ${filePath}:`, result.error);
    return null;
  }
  return result.data;
}

// 方案 B:若不引入 zod,至少要注释 + 局部收窄
const target = cfg.agent as Record<string, unknown>;  // safe: OpenCode SDK 的 Config.agent 是 open map,我们只注入不读取
```

### 验收
```bash
# 统计 as 断言数量,环比上升需在 PR 中说明理由
grep -rnE "\bas\s+(any|unknown\b|Record<)" src/ | wc -l
# 硬性禁止双重断言
grep -rnE "as\s+unknown\s+as\s+" src/ && echo "FAIL: double assertion found" && exit 1 || echo "OK"
```

---

## 3. 工厂模式:静态属性用显式 registry,不挂函数

### 规则
不要用 `Object.assign(fn, { mode, defaultModel })` 把静态属性挂在函数上。改用**显式 registry 对象**:

```ts
type AgentDef = {
  factory: (model: string) => AgentConfig;
  mode: "primary" | "subagent";
  defaultModel: string;
  category: "primary" | "design" | "review" | "domain" | "quality";  // 见规则 4
};
```

### 为什么
当前 `definitions.ts` 用 `Object.assign` 挂 `mode` 到工厂函数上,导致 `buildAgent` 里必须写:
```ts
const base = factory(model) as AgentConfig & { mode?: AgentFactory["mode"] };
```
这是规则 2 说的"为了绕过类型而断言"。根因是 TS 无法静态推断挂在函数上的属性。改成显式对象后,类型自然流通,断言消失。

### 反例(当前)
```ts
export const architect: AgentFactory = Object.assign(
  (model: string): AgentConfig => ({ model, prompt: loadPrompt("architect.md"), /* ... */ }),
  { mode: "primary" as const, defaultModel: "ddddjaak/mimo-v2.5" },
);

// index.ts 里被迫断言
const base = factory(model) as AgentConfig & { mode?: AgentFactory["mode"] };
if (base.mode === undefined) base.mode = factory.mode;
```

### 正例
```ts
// definitions.ts
export const architect: AgentDef = {
  factory: (model) => ({
    model,
    prompt: loadPrompt("architect.md"),
    description: "SE 系统架构师 ...",
    color: "#4CAF50",
    temperature: 0.2,
  }),
  mode: "primary",
  defaultModel: "ddddjaak/mimo-v2.5",
  category: "primary",
};

// index.ts — 无需断言
export function buildAgent(def: AgentDef, model: string): AgentConfig {
  return { ...def.factory(model), mode: def.mode };
}
```

### 验收
```bash
# Object.assign 挂函数静态属性的模式应消失
grep -rn "Object.assign" src/agents/ && echo "WARN: review Object.assign usage in agents/" || echo "OK"
```

---

## 4. 分类与路由:用显式字段,不靠字符串 includes 反推

### 规则
- agent 的 category **显式声明**在定义里(见规则 3 的 `category` 字段)
- **禁止**用 `description.includes("领域")` 这种字符串匹配反推分类
- skill 路由关键词如需维护大词表,词表必须**可被 skill 自身声明**,而非集中在匹配引擎里硬编码

### 为什么
`buildAgentCategoryMap`(src/agents/index.ts:129)当前用 `description.includes("代码")` 等关键词分类。问题:任何人改了 agent 的 description 措辞,分类就错了,且**编译不报错、运行时不报错**,只在 `lockie_list_agents` 工具返回时悄悄错位。

### 反例(当前)
```ts
const desc = (factory(factory.defaultModel).description || "").toLowerCase();
if (desc.includes("领域") || desc.includes("合规")) {
  domain.push(name);
} else if (desc.includes("代码") || desc.includes("安全审计") || desc.includes("架构审查")) {
  review.push(name);
}
// ... 改 description 即误分类,无任何告警
```

### 正例
```ts
// 分类在定义期就定死,与 description 解耦
export const agentSources: Record<string, AgentDef> = {
  architect: { ...defs.architect, category: "primary" },
  "code-reviewer": { ...defs.codeReviewer, category: "review" },
  "fw-domain-expert": { ...defs.fwDomainExpert, category: "domain" },
  // ...
};

export function buildAgentCategoryMap(overrides = {}): AgentCategoryMap {
  const map: AgentCategoryMap = { primary: [], design: [], review: [], domain: [], quality: [] };
  for (const [name, def] of Object.entries(agentSources)) {
    if (overrides[name]?.disable) continue;
    map[def.category].push(name);  // 显式,不会因措辞变化而错位
  }
  return map;
}
```

### 验收
```bash
# buildAgentCategoryMap 内不应有 .includes( 调用
grep -n "includes(" src/agents/index.ts && echo "FAIL: string-match categorization detected" && exit 1 || echo "OK"
```

---

## 5. 配置与常量:单一来源(SSOT)

### 规则
跨文件共享的常量(尤其是 MCP 服务器定义、agent 名单、模型 ID)**只能有一个真相源**:
- TS 模块之间:用 `export const` 共享
- TS 与 `.mjs` 脚本之间:把常量抽到一份 `.json` 文件,两边各自 `import`/`require`

### 为什么
当前 `mcp.ts` 的 `CANONICAL_MCP_SERVERS` 与 `scripts/postinstall.mjs` 的 `MCP_COMMANDS` 各维护一份,4 个 MCP 的命令定义重复。一旦只改一处(比如 context7 升级换包名),另一处静默漂移,postinstall 注入的命令和运行时诊断的命令不一致——极难排查。

### 反例(当前)
```ts
// src/mcp.ts — 维护一份
export const CANONICAL_MCP_SERVERS = {
  codegraph: { type: "local", command: ["codegraph", "serve", "--mcp"], enabled: true },
  // ...
};
```
```js
// scripts/postinstall.mjs — 又维护一份
const MCP_COMMANDS = {
  codegraph: ["codegraph", "serve", "--mcp"],
  // ...
};
```

### 正例
```jsonc
// config/mcp-servers.jsonc — 单一真相源
{
  "codegraph": { "type": "local", "command": ["codegraph", "serve", "--mcp"], "enabled": true },
  "context7": { "type": "local", "command": ["npx", "-y", "@upstash/context7-mcp"], "enabled": true },
  "memory": { "type": "local", "command": ["npx", "-y", "@modelcontextprotocol/server-memory"], "enabled": true },
  "sequential-thinking": { "type": "local", "command": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], "enabled": true }
}
```
```ts
// src/mcp.ts
import mcpRaw from "../config/mcp-servers.jsonc" assert { type: "json" };
export const CANONICAL_MCP_SERVERS = mcpRaw as Record<string, McpServerDef>;
```
```js
// scripts/postinstall.mjs
import { readFileSync } from "node:fs";
const mcpServers = JSON.parse(readFileSync(new URL("../config/mcp-servers.jsonc", import.meta.url), "utf-8"));
// postinstall 不能 import TS,但能读 JSON —— 共享同一份文件
```

### 验收
```bash
# MCP 命令定义不应在 .ts 和 .mjs 中各出现一次
ts_count=$(grep -rl "context7-mcp" src/ | wc -l)
mjs_count=$(grep -rl "context7-mcp" scripts/ | wc -l)
[ "$ts_count" -gt 0 ] && [ "$mjs_count" -gt 0 ] && echo "FAIL: duplicate MCP definition" || echo "OK"
```

---

## 6. 测试:核心运行时逻辑必须有单测

### 规则
- `src/index.ts` 中的**所有 hook**(config / chat.message / experimental.chat.system.transform / dispose)**必须有对应单测**
- 测试文件 co-located:`src/__tests__/<module>.test.ts`
- hook 测试要覆盖:正常路径 + 边界(空输入/缺字段)+ 副作用(是否修改了不该修改的字段)
- 测试覆盖率门槛:`src/` 整体行覆盖率 ≥ 80%,hook 相关分支 ≥ 90%

### 为什么
AGENTS.md 自己说"TypeScript 编译通过≠插件能工作"。但当前 `index.ts` 三个核心 hook 零测试——config 注入逻辑改一行,可能让所有 agent 失效,而 `npm test` 全绿。这是项目最大的质量盲区。

### 反例(当前)
```
src/__tests__/
  config.test.ts    ✅
  skills.test.ts    ✅
  mcp.test.ts       ✅
  (agents/__tests__/agents.test.ts ✅)
  index.test.ts     ❌  ← 插件入口、三个 hook,零测试
```

### 正例(需补)
```ts
// src/__tests__/index.test.ts
import { describe, it, expect, vi } from "vitest";

describe("config hook", () => {
  it("injects built-in agents without clobbering user-defined ones", async () => {
    const cfg = { agent: { "my-custom": { model: "x" } } } as any;
    // ... 调用 config hook ...
    expect(cfg.agent["architect"]).toBeDefined();
    expect(cfg.agent["my-custom"]).toEqual({ model: "x" });  // 用户定义未被覆盖
  });

  it("applies disable overrides for built-in explore/general", async () => {
    // ...
  });
});

describe("chat.message hook", () => {
  it("prepends SKILL_ROUTE instruction when keyword matches", async () => {
    // ...
  });

  it("does not route for non-lockie agents", async () => {
    // ...
  });
});
```

### 验收
```bash
# 1. index.test.ts 必须存在
test -f src/__tests__/index.test.ts || echo "FAIL: index.ts has no test file"
# 2. 覆盖率门槛
npm test -- --coverage --coverage.thresholds.lines=80
```

---

## 7. Frontmatter 一致性:agent 与 skill 的元数据缺一不可

### 规则
所有 `agents/*.md` 和 `skills/**/SKILL.md` 的 frontmatter 必须包含:
- `name`(kebab-case,与文件名一致)
- `description`(一句话,含触发关键词)
- agent 文件额外必须有 `mode: primary | subagent`

### 为什么
`parseFrontmatter`(src/skills.ts:34)要求 `name` 和 `description` 同时存在,否则返回 null。当前 `agents/fw-domain-expert.md` 的 frontmatter **缺 `name:` 字段**(只有 description + mode)。虽然 agent prompt 走 `loadPrompt()` 不经过 parseFrontmatter,但这种不一致是定时炸弹——一旦未来复用 parseFrontmatter 给 agent 建索引,fw-domain-expert 就会静默消失。

### 反例(当前)
```yaml
# agents/fw-domain-expert.md — 缺 name
---
description: Firmware domain expert that reviews SE artifacts ...
mode: subagent
---
```

### 正例
```yaml
# agents/fw-domain-expert.md
---
name: fw-domain-expert
description: Firmware domain expert that reviews SE artifacts ...
mode: subagent
---
```

### 验收
```bash
# 所有 agents/*.md 必须有 name + description + mode 三个字段
for f in agents/*.md; do
  grep -q "^name:" "$f" || echo "FAIL: $f missing name"
  grep -q "^description:" "$f" || echo "FAIL: $f missing description"
  grep -q "^mode:" "$f" || echo "FAIL: $f missing mode"
done
```

---

## 规则速查表

| # | 规则 | 一句话 | 自动化验收 |
|---|------|--------|-----------|
| 1 | 禁止空 catch | catch 块至少留痕或重抛 | grep 空块 |
| 2 | 限制 as 断言 | 禁双重断言,单断言需注释 | grep `as unknown as` |
| 3 | 工厂用显式 registry | 不挂函数静态属性 | grep Object.assign in agents/ |
| 4 | 分类用显式字段 | 不靠 includes 反推 | grep includes in index.ts |
| 5 | 常量单源 | TS 与 mjs 共享 JSON | grep 重复定义 |
| 6 | hook 必须有单测 | index.ts 不能裸奔 | test -f index.test.ts |
| 7 | frontmatter 完整 | name+description+mode | for-loop grep |

---

## 落地节奏建议

不要试图一次改完。建议按风险倒序:

1. **本周**:规则 1(空 catch)+ 规则 7(frontmatter)——改动小、风险低、立竿见影
2. **下周**:规则 6(补 index.test.ts)——补测试是后续重构的安全网,必须先有
3. **本月**:规则 3 + 规则 4(工厂重构 + 分类显式化)——有了测试保护再动结构
4. **滚动**:规则 2 + 规则 5——边开发边收窄,新代码必须遵守,旧代码接触时顺手改

---

## 维护

- 发现新的反复出现问题 → 在本文档追加规则 + 在 `pr-review-checklist.md` 加对应项
- 规则变更需在 PR 中说明动机,并更新验收脚本
- 每次规则新增/修改后,同步更新本文件版本号
