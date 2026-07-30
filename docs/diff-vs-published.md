# 差异对比：开发版 vs 已发布版

- **已发布版（基线）**：`C:\Users\yufan\oh-y-lockie-agent`（2.0.0，7/29 打包）
- **开发版（当前）**：`C:\Users\yufan\Documents\oh-y-lockie-agent-dev\oh-y-lockie-agent`（2.0.0，7/30）

> 结论：**范围完全一致**（2 主 Agent + 14 Subagent + 21 Command + 58 Skill = 51 opencode + 7 agents），开发版是一次**架构与打包层面的重构 + 跨平台修复**，不是功能增删。开发版构建通过、48 测试全绿。

---

## 1. 源码架构重构（最大变化）

| 维度 | 已发布版 | 开发版 |
|---|---|---|
| `src/` 结构 | 扁平：`config.ts` / `index.ts` / `skills.ts` | 模块化：`config.ts` + `mcp.ts` + `agents/`（definitions/index/prompts/types） |
| Agent 定义位置 | 写在 `config/oh-y-lockie-agent.jsonc`（含 color/description/mode/prompt_file/temperature） | **收归代码** `src/agents/definitions.ts`（工厂函数），jsonc 只保留用户可调项 |
| Agent 提示词 | `agents/*.md`（16 个，文件名两边一致） | 同样 16 个 `.md`，改由 `loadPrompt()` 从代码侧读取 |
| 测试文件 | `config.test.ts` / `skills.test.ts` | 新增 `mcp.test.ts` + `agents/__tests__/agents.test.ts` |

`config.ts` 被**瘦身**：移除了 `AgentDef` 接口、`configSearchPaths`、`mergeAgentConfigs`，以及 `getActiveAgentKeys`/`buildAgentCategoryMap`/`getAgentKeys`（迁到 `agents/` 模块）。现在只负责用户 `overrides`（model/disable）+ MCP 合并。
`index.ts` 改为：从 `./agents/index.js` 引入 agent；加载时调用 `diagnoseMcpStatus()` 打印 MCP 状态；用 `collectAgents(overrides)` 注入 agent，**不覆盖用户已在 opencode.json 里自定义的 agent**。

## 2. 配置文件 `config/oh-y-lockie-agent.jsonc`

- 已发布版：每个 agent 都是完整定义，且模型用占位 provider（`your-provider/qwen3.7-plus`、`deepseek-v4-pro`、`qwen3.6-flash`…）。
- 开发版：每个 agent 只保留 `model` 覆盖（真实模型 `ddddjaak/mimo-v2.5` / `mimo-v2.5-pro`），并加注释说明“定义已移入代码”。

## 3. Commands 重组（内容未变，仅归组）

- 已发布版：21 个 `.md` 平铺在 `commands/`。
- 开发版：`commands/ae/`（15 个）+ `commands/se/`（6 个）。`se-*` 命令去掉前缀移入 `se/`（如 `se-architecture.md` → `se/architecture.md`）。
- 两边名字集合等价（21 = 21），属纯重构。

## 4. MCP 配置跨平台修复

- 已发布版 jsonc 里 MCP 命令用 Windows 专属写法：`["cmd","/c","npx",...]`。
- 开发版改为跨平台 `["npx","-y",...]`，平台适配逻辑下沉到安装脚本。

## 5. 安装/卸载脚本重写（大幅减负）

| | 已发布版 postinstall | 开发版 postinstall |
|---|---|---|
| 复制内容 | agents/ + skills/ + references/ + AGENTS.md + jsonc 全量复制到 `~/.config/opencode/`（及 `.agents/`） | **只复制 `commands/`**（OpenCode 斜杠命令必需）；把 4 个 MCP 服务器注入 `opencode.json`（仅补缺失项） |
| 污染程度 | 高（复制大量文件到用户目录） | 低（agent/skill 由 config hook 从插件目录注入，无需复制） |

- 开发版 `preuninstall.mjs` 简化：只删 `commands/ae` + `commands/se` + 4 个插件 MCP 条目（不再硬编码一长串 agent/skill/command 名单）。
- 开发版**新增** `scripts/setup-mcp.mjs` + `npm run setup-mcp`，可手动把 MCP 服务器写入 `opencode.json`。

## 6. `package.json`

- `description`：`60Skill` → `58Skill(51 opencode + 7 agents)`（对齐真实数量）。
- `files`：新增 `.mcp.json`、`scripts/setup-mcp.mjs`。
- 新增脚本：`setup-mcp`。
- 依赖：`@opencode-ai/sdk` `^1.17.0` → `^1.18.9`（升级 SDK）。

## 7. 文档

- `AGENTS.md`：54 行 → **628 行**（操作手册大幅扩充，约 10×）。
- `README.md`：325 → 319 行（约 74 行有改动，反映新结构与 setup-mcp）。

## 8. 杂项清理

- 开发版删除了 `skills/agents/company-pptx-generator/scripts/__pycache__/*.pyc` 编译产物。
- 开发版在已发布版为空占位目录处补了真实内容：`company-pptx-generator/references/layout-schema.md`、`zephyr-doxygen-docs/assets/zephyr.css`。

---

## 一句话总结

开发版把“agent 定义写在 jsonc + 安装时复制文件”的旧模式，重构为“agent 定义在代码 + config hook 注入 + 安装只复制 commands/MCP”的轻量模式，顺带修了跨平台 MCP 写法、升级 SDK、扩充文档、清理产物。功能范围不变，工程健康度更高（构建通过、测试全绿）。
