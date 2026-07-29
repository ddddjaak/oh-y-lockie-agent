# oh-y-lockie-agent

> 双主 Agent 协作框架 — 覆盖 SE（系统架构）与 AE（应用工程）两条开发管线。OpenCode 即插即用。

## 概述

`oh-y-lockie-agent` 提供**两个主 Agent**，共享同一套 **14 个专项 Subagent**、**21 个 Commands** 和 **60 个 Skills**（53 个 opencode 端 + 7 个 agents 端）：

| 主 Agent | 管线 | 适用场景 |
|----------|------|----------|
| **architect**（默认） | 需求分解 → 架构设计 → 规格撰写 → 审查 → 追溯 | 芯片系统设计、HW-SW 接口、跨部门评审 |
| **firmware** | 需求澄清 → 规格 → 规划 → 实现 → 测试 → 审查 → 发布 | 嵌入式固件开发、驱动编写、RTOS、调试 |

安装后默认启动 `architect`。切换只需将对应 agent 的 `mode` 改为 `"primary"`。

---

## 快速安装（推荐）

> 一行命令，零配置。脚本自动检测你已有的 provider 并完成全部安装。

**Windows：**
> PowerShell 7+ (pwsh) 用 `install.ps1`，系统自带 PowerShell 5.1 用 `install_bom.ps1`。
```powershell
# 自动选择版本
if ($PSVersionTable.PSVersion.Major -ge 6) { .\install.ps1 } else { .\install_bom.ps1 }
```

**Linux / macOS：**
```bash
bash install.sh
```

安装完成后**重启 OpenCode** 即可使用。

---

## 架构总览

```
  ┌─────────────────┐     ┌─────────────────┐
  │  Architect 🟢   │     │  Firmware 🔵    │
  │  SE 系统架构     │     │  AE 应用工程     │
  │  (默认 primary)  │     │  (Tab 切换)      │
  └───────┬─────────┘     └───────┬─────────┘
          │                       │
          └───────────┬───────────┘
                      │ 共享调度 (Task tool)
          ┌───────────┼───────────────┬───────────────────┐
          │           │               │                   │
   ┌──────▼──────┐ ┌──▼────────┐ ┌───▼───────────┐ ┌────▼──────────────┐
   │   审查维度    │ │  领域维度  │ │  质量保障维度   │ │    设计维度        │
   ├─────────────┤ ├───────────┤ ├───────────────┤ ├───────────────────┤
   │ code-reviewer│ │fw-expert  │ │ test-engineer  │ │ power-architect   │
   │ security-    │ │hw-expert  │ │ verification-  │ │ boot-bringup-     │
   │   auditor    │ │compliance │ │   engineer     │ │   specialist      │
   │ system-      │ │           │ │               │ │ memory-map-       │
   │   architect  │ │           │ │               │ │   specialist      │
   │              │ │           │ │               │ │ firmware-architect│
   │              │ │           │ │               │ │ timing-analyst    │
   │              │ │           │ │               │ │ register-map-     │
   │              │ │           │ │               │ │   generator       │
   └─────────────┘ └───────────┘ └───────────────┘ └───────────────────┘
```

---

## 包含内容

| 组件 | 数量 | 说明 |
|------|------|------|
| 主 Agents | 2 | Architect（SE 管线）+ Firmware（AE 管线） |
| Subagents | 14 | 专项 review/audit/design 子代理 |
| Commands | 21 | 斜杠命令（含 fan-out 并行编排） |
| Skills | 60 | 专业领域能力（53 opencode + 7 agents） |

### 主 Agent 对比

| | Architect (SE) | Firmware (AE) |
|---|---|---|
| **颜色** | 🟢 绿色 | 🔵 蓝色 |
| **管线** | Define→Design→Document→Verify→Validate | Concept→Spec→Plan→Code→Test→Review→Ship |
| **核心场景** | 芯片系统设计、架构评审、规格制定 | 嵌入式固件开发、驱动编写、RTOS 调试 |
| **默认** | ✅ primary | 备选 |

**切换方式：** 在 OpenCode 中按 **Tab** 键，即可在 Architect (SE) 和 Firmware (AE) 之间切换。

### Subagent 清单

| Subagent | 职责 |
|---|---|
| `code-reviewer` | 五维度代码审查（正确性/可读性/架构/安全/性能） |
| `security-auditor` | 漏洞检测、威胁建模、安全加固 |
| `system-architect` | 系统级架构一致性审查 |
| `test-engineer` | 测试策略、测试套件设计、覆盖率分析 |
| `verification-engineer` | 可测试性审查、追溯矩阵验证 |
| `fw-domain-expert` | 固件领域审查（驱动/RTOS/内存/中断） |
| `hw-domain-expert` | 硬件领域审查（引脚/电源/时钟/PCB） |
| `compliance-reviewer` | 合规审查（FCC/CE/UL/ISO 26262/IEC 61508） |
| `power-architect` | 电源架构设计（电源树、电压域、上电时序、电流预算） |
| `boot-bringup-specialist` | 启动与bring-up（启动序列、时钟初始化、内存测试、外设冒烟测试） |
| `memory-map-specialist` | 内存映射设计（Flash分区、SRAM分配、MPU配置、链接脚本） |
| `firmware-architect` | 固件架构设计（任务分解、IPC拓扑、HAL分层、状态机） |
| `timing-analyst` | 时序分析（时钟树、PLL配置、建立/保持时序、抖动预算） |
| `register-map-generator` | 寄存器映射生成（寄存器提取、地址验证、位域定义） |

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

---

## 目录结构

```
oh-y-lockie-agent/
├── README.md                     # 本文件
├── AGENTS.md                     # Agent 行为准则
├── manifest.json                 # 包元数据
├── install.ps1                   # Windows (pwsh) 一键安装脚本
├── install_bom.ps1               # Windows PowerShell 5.1 安装脚本
├── install.sh                    # Linux/macOS 一键安装脚本
├── uninstall.ps1                 # Windows 一键卸载脚本
├── uninstall.sh                  # Linux/macOS 一键卸载脚本
├── VERSION                       # 版本标识文件
│
├── agents/                       # → ~/.config/opencode/agents/
├── commands/                     # → ~/.config/opencode/commands/
│
├── skills/
│   ├── opencode/                 # → ~/.config/opencode/skills/
│   └── agents/                   # → ~/.agents/skills/
│
├── references/                   # → ~/.config/opencode/references/
└── config/
    └── opencode.json.template    # 参考模板
```

---

## 手动安装

如果你不想运行安装脚本，按以下步骤操作：

1. 将 `agents/` 下的 14 个 `.md` 文件复制到 `~/.config/opencode/agents/`
2. 将 `commands/` 下的 21 个 `.md` 文件复制到 `~/.config/opencode/commands/`
3. 将 `skills/opencode/` 下的所有子目录复制到 `~/.config/opencode/skills/`
4. 将 `skills/agents/` 下的所有子目录复制到 `~/.agents/skills/`
5. 将 `references/` 复制到 `~/.config/opencode/references/`
6. 将 `AGENTS.md` 复制到用户主目录
7. 编辑 `~/.config/opencode/opencode.json`，参考 `config/opencode.json.template` 添加 `agent` 和 `mcp` 节点（**不要改动已有的 `provider` 节点**）
8. 将 agent 文件和配置中的 `YOUR_PROVIDER` 全部替换为你的实际 provider 名称
9. 重启 OpenCode

---

## 模型说明

所有 agent 使用公司统一的模型：

| Agent | 模型 |
|---|---|
| Architect (SE) | qwen3.7-plus |
| Firmware (AE) | qwen3.7-plus |

| Subagent | 模型 |
|---|---|
| code-reviewer | deepseek-v4-pro |
| system-architect | qwen3.7-plus |
| security-auditor | glm-5.1 |
| test-engineer | qwen3.6-flash |
| verification-engineer | qwen3.6-flash |
| fw-domain-expert | deepseek-v4-pro |
| hw-domain-expert | qwen3.6-plus |
| compliance-reviewer | deepseek-v4-flash |
| power-architect | deepseek-v4-pro |
| boot-bringup-specialist | deepseek-v4-pro |
| memory-map-specialist | deepseek-v4-pro |
| firmware-architect | qwen3.7-plus |
| timing-analyst | deepseek-v4-pro |
| register-map-generator | qwen3.6-plus |

---

## 卸载

移除所有安装的 agents、commands、skills 和 references，恢复 opencode.json 备份。

**Windows：**
```powershell
# pwsh
.\uninstall.ps1
```

**Linux / macOS：**
```bash
bash uninstall.sh
```

卸载后需**重启 OpenCode** 使变更生效。

---

## 版本

- **插件版本**: 2.0.0
- **兼容 OpenCode**: >= 1.0

## 许可

MIT
