# 嵌入式 MCP 选型与实现规划

> 目标:为 oh-y-lockie-agent 补齐嵌入式硬件工具层,让 AI 能碰 datasheet / SVD / 调试器 / 串口 / 设备树。
> 当前 4 个 MCP(codegraph/context7/memory/sequential-thinking)全是软件通用层,无一个碰硬件。
> 版本:1.0.0 | 日期:2026-07-31

## 1. 总体策略

### 1.1 为什么需要嵌入式专用 MCP

嵌入式开发的核心循环是 **读手册 → 查寄存器 → 调试 → 看日志**,每一步当前都缺工具。AI 只能看代码,看不到:寄存器位定义(SVD)、运行时寄存器值(调试器)、设备实际输出(串口)、硬件拓扑(设备树)、厂商文档(datasheet/app note)。

通用 MCP(context7 查库文档、codegraph 查代码符号)解决不了这些——它们的服务端没有嵌入式硬件数据。

### 1.2 技术栈统一决策:Python

这是最关键的架构决策,必须先定。

| 维度 | Node.js(与插件同栈) | Python(嵌入式生态) |
|------|---------------------|---------------------|
| SVD 解析 | 无成熟库,需造轮子或 XML 解析 | `cmsis-svd` / `pyocd.svd` 成熟 |
| 调试器 | 无对标 pyOCD 的库 | `pyocd` 是事实标准(CMSIS-DAP/ST-Link/J-Link) |
| 串口 | `serialport` 成熟 | `pyserial` 成熟 |
| 设备树 | 弱,需 cpp 预处理 | `dt-schema` / `dts-parser` |
| PDF/向量 | 有库但碎片化 | `pdfplumber`/`chromadb`/`sentence-transformers` 全栈 |
| MCP 协议 | stdio JSON,语言无关 | 同左,OpenCode 对 server 语言透明 |

**决策:5 个 MCP server 全用 Python。** 理由:
1. `debugger-mcp` 和 `serial-mcp` **必须**用 Python(pyoCD/pyserial 无 Node 对标),混合栈比统一栈维护成本高
2. `svd-mcp` 用 `cmsis-svd` 比 Node 造轮子省 2-3 周且更稳
3. MCP 协议语言无关,Python server 对 OpenCode 透明,与插件 TS 栈零耦合
4. 嵌入式团队通常已有 Python 能力(pyOCD/pytest/Ceedling 都是 Python)

**代价**:团队要维护 Python MCP server。但这比在 Node 里重造 pyOCD 的 binding 现实得多。

### 1.3 与现有插件的集成

5 个新 MCP 加入 `config/mcp-servers.json`(单源),与现有 4 个 MCP 共存。每个 Python server 是独立 stdio 进程,启动命令形如 `python -m mcp_servers.svd`。OpenCode config hook 已有的注入机制(`mcp.ts` / `postinstall.mjs`)无需改动——只是 JSON 多 5 个条目。

发布时 Python server 作为独立 pip 包或随插件 scripts/ 分发,由 setup 脚本安装依赖。

---

## 2. 五个 MCP 选型详解

### 2.1 svd-mcp(寄存器查询)— Phase 1,优先级最高

**价值**:嵌入式开发最高频查询是"某寄存器某位是什么"。当前只能翻 PDF(慢、易错)。SVD 是 ARM CMSIS 标准 XML,所有 Cortex-M 厂商提供,结构化、确定性强。

**选型**:
- 解析:`cmsis-svd`(纯 Python,解析 CMSIS-SVD XML)或 `pyocd.svd`(pyOCD 内置,更全)
- 推荐 **`cmsis-svd`**(轻量,无硬件依赖,CI 可测;`pyocd.svd` 拖入整个 pyOCD)
- 缓存:解析结果内存缓存(SVD 文件几 MB,解析 1-2s,缓存后续 <10ms)

**MCP 工具接口**:
```
svd.load(svd_path: str) → handle          # 加载 SVD,返回上下文 handle
svd.list_peripherals(handle) → [Peripheral]
svd.get_register(handle, peripheral, register) → Register{addr, reset, fields}
svd.get_field(handle, peripheral, register, field) → Field{offset, width, desc}
svd.search(handle, name: str) → [match]    # 模糊搜,"USART1 CR1" / "CR1" / "USART"
```

**风险与降级**:
- ⚠️ ESP32 无 SVD(用 IDF 自有 headers);RISC-V 无 SVD 标准。→ `svd.load` 失败时提示"该芯片无 SVD,改用 datasheet-mcp 查寄存器"
- ⚠️ 厂商 SVD 质量参差(命名不规范、缺 description)。→ 搜索时支持别名映射表
- ✅ 无硬件依赖、无安全风险、可 CI 测(用公开 SVD 样本)

**验收**:加载 STM32F4 SVD,查 `USART1.CR1.TE` 返回正确偏移/宽度/描述;<200ms(缓存后)。

### 2.2 serial-mcp(串口控制台)— Phase 2

**价值**:嵌入式调试第二大信息源是 UART 日志。让 AI 读设备日志、发命令,是 HIL 自动化和"看设备说什么"的基础。

**选型**:
- `pyserial`(事实标准,跨平台)
- 无候选争议

**MCP 工具接口**:
```
serial.list_ports() → [Port{name, hwid}]
serial.open(port: str, baudrate: int) → handle
serial.read(handle, timeout_ms: int) → bytes
serial.readline(handle, timeout_ms: int) → str   # 读一行(日志逐行)
serial.write(handle, data: bytes) → int
serial.close(handle)
```

**风险与降级**:
- ⚠️ 串口被占用(其他终端连着)。→ `open` 失败明确报"port busy",AI 可提示用户关闭其他终端
- ⚠️ 跨平台端口名(COM3 vs /dev/ttyUSB0)。→ `list_ports` 返回统一结构,AI 不硬编码
- ⚠️ `write` 可能触发设备动作。→ MCP 层不加确认(让 AI/用户层决定),但 log 所有 write

**验收**:`list_ports` 列出 USB-串口;打开 115200,发 "AT\r\n",读回响应。

### 2.3 debugger-mcp(调试器接口)— Phase 3,价值最高风险也最高

**价值**:让 AI 读寄存器**实际值**、读内存、设断点——嵌入式调试杀手级能力。当前 AI 只看代码,看不到运行时状态。这是把 AI 从"代码助手"升级到"调试搭档"的关键。

**选型**:
- `pyOCD`(Python API 直接调用,支持 CMSIS-DAP/ST-Link/J-Link,内置 SVD 解析)
- OpenOCD(通过 telnet/管道,但解析复杂,不推荐作 MCP 后端)
- 推荐 **pyOCD**(API 干净,无需 telnet 解析;且自带 SVD,可与 svd-mcp 共享上下文)

**MCP 工具接口**:
```
dbg.connect(target: str, probe: str) → handle   # "stm32f4", "CMSIS-DAP"
dbg.read_register(handle, name: str) → int       # 名字走 SVD 解析,"USART1 CR1"
dbg.write_register(handle, name: str, value: int)
dbg.read_memory(handle, addr: int, size: int) → bytes
dbg.write_memory(handle, addr: int, data: bytes)
dbg.halt(handle) / dbg.resume(handle) / dbg.step(handle)
dbg.set_breakpoint(handle, addr: int) / dbg.remove_breakpoint(handle, addr: int)
```

**安全层(强制)**:
- 所有 `write_*` / `set_breakpoint` / `halt` 操作,MCP server 记录审计日志(时间、操作、目标)
- **不在 MCP 层加确认弹窗**(会破坏自动化),但 AI agent prompt 必须声明"写操作前向用户确认意图"——这放在 `debugging-and-error-recovery` skill 的指引里
- 连接超时自动断开(防 AI 忘了 close,设备一直被占)

**风险与降级**:
- 🔴 硬件依赖:需物理调试器 + 目标板。CI 只能 mock(pyOCD 有 mock backend)。→ 集成测试用 mock,真机测试手动
- 🔴 写操作可能损坏设备(写 flash 保护位等)。→ write_register/write_memory 默认 dry-run 模式,显式 `confirm=true` 才执行
- ⚠️ USB 权限:Windows 驱动、Linux udev 规则、macOS 需签名。→ setup 脚本检测并提示
- ⚠️ pyOCD 不支持所有芯片(主要 Cortex-M)。RISC-V/ESP32 用 OpenOCD 或 esptool。→ connect 失败时提示替代

**验收**:连接 STM32F4,halt,读 `R0` 值,resume;mock 模式下全流程可测。

### 2.4 device-tree-mcp(Device Tree)— Phase 4

**价值**:Zephyr/Linux 嵌入式用 dts 描述硬件拓扑。项目已有 `device-tree` skill 但无工具支撑。AI 现在只能"讲"dts,不能"查"。

**选型**:
- 解析:`dt-schema`(Python,验证)/ `dts-parser`;或 `libfdt`(C binding)
- 难点:dts 的 `#include` 和 `#define` 需 C 预处理,纯解析器处理不了
- 推荐:**先用 `dtc`(设备树编译器)预处理为 dtb,再用 `libfdt`/`pylibfdt` 解析**。绕开自己写预处理器
- 验证(against bindings):后置,用 `dt-schema`,受众窄

**MCP 工具接口**:
```
dts.load(dts_path: str) → handle              # 内部 dtc 预处理 + 解析
dts.get_node(handle, path: str) → Node         # "/soc/uart@40013800"
dts.list_compatible(handle, compat: str) → [Node]   # 按 compatible 查
dts.get_property(handle, node, prop) → Value
dts.list_aliases(handle) → {alias: path}
```

**风险与降级**:
- ⚠️ 依赖 `dtc` 系统二进制(Zephyr/Linux 开发机通常有,但非保证)。→ `load` 检测 dtc 缺失时降级为"纯文本解析,不展开 include"(功能受限但可用)
- ⚠️ Zephyr 的 overlay 机制叠加复杂。→ Phase 4 只处理单 dts,overlay 后置

**验收**:加载 Zephyr sample dts,查 `/soc/uart@40013800` 的 `compatible` 和 `status`。

### 2.5 datasheet-mcp(PDF 文档检索)— Phase 5,最复杂

**价值**:覆盖 app note / errata / 电气特性曲线等 SVD 抓不到的非结构化内容。但 svd-mcp 已覆盖大部分"查寄存器"需求,datasheet-mcp 价值递减,放最后。

**选型(混合架构)**:
- PDF 解析:`pdfplumber`(表格抽取好)/ `pymupdf`(快)
- 表格抽取:`pdfplumber` 自带 / `camelot`
- 向量库:`chromadb`(本地,无需服务端)或 `lancedb`
- Embedding:`sentence-transformers`(本地,`all-MiniLM-L6-v2` 小快)或 API(OpenAI 等)
- 推荐 **`pdfplumber` + `chromadb` + `sentence-transformers`**(全本地,无外部 API 依赖)

**混合架构(关键)**:
```
PDF → 分段
  ├─ 表格 → 结构化抽取(JSON)→ 精确查询(寄存器表/引脚表/电气表)
  ├─ 文本 → chunk + embedding → 向量检索(app note/errata 描述)
  └─ 图像 → (后置,多模态 embedding)→ 原理图/时序图

查询路由:
  "USART1 CR1 第 3 位" → 优先转 svd-mcp(精确)
  "最大工作温度" → 表格精确查
  "如何配置低功耗" → 向量检索
```

**MCP 工具接口**:
```
ds.load(pdf_path: str) → handle                 # 解析 + 索引(耗时,后台)
ds.search(handle, query: str) → [Chunk{page, text, score}]   # 向量检索
ds.query_table(handle, keyword: str) → [Table{page, rows}]   # 表格精确查
ds.get_page(handle, page: int) → {text, tables}  # 取某页
```

**风险与降级**:
- 🔴 PDF 质量参差(扫描版需 OCR)。→ 检测扫描版提示"需 OCR,当前不支持",而非静默失败
- ⚠️ embedding 模型 ~80MB,首次下载慢。→ setup 脚本预下载,或文档标注
- ⚠️ 向量库存储(每 datasheet 索引几十 MB)。→ 支持卸载 index,按需重建
- ⚠️ 查询路由准度。→ Phase 5 先做"全向量检索",路由层后置优化

**验收**:加载 STM32F4 RM(节选),搜"RTC 唤醒"返回相关页;查"USART CR1"表格返回寄存器位定义。

---

## 3. 实现路线(依赖驱动)

```
Phase 1: svd-mcp        ──┐
  (无依赖,奠基)          │
                           ├──→ Phase 3: debugger-mcp
Phase 2: serial-mcp     ──┘  (依赖 svd 解析寄存器名;可与 serial 协同看日志)
  (独立可用)

Phase 4: device-tree-mcp     (独立,受众窄)
  (独立)

Phase 5: datasheet-mcp       (独立,但 svd 已覆盖大部分寄存器查询,优先级降)
  (依赖最重,最后)
```

| Phase | MCP | 工期估算 | 依赖 | 可 CI 测 | 价值 |
|-------|-----|---------|------|---------|------|
| 1 | svd-mcp | 1-2 周 | 无 | ✅ 全可测 | 高(高频查询) |
| 2 | serial-mcp | 1 周 | 无(硬件轻) | ⚠️ 需串口 | 高(日志) |
| 3 | debugger-mcp | 3-4 周 | svd-mcp + 硬件 | ⚠️ mock only | 最高(运行时) |
| 4 | device-tree-mcp | 2 周 | dtc 二进制 | ✅ 样本 dts | 中(Zephyr 用户) |
| 5 | datasheet-mcp | 4-6 周 | embedding 模型 | ✅ 样本 PDF | 中(svd 已覆盖大半) |

**为什么 svd 第一**:① 无硬件依赖,可 CI 测,降低交付风险;② debugger-mcp 依赖它解析寄存器名;③ 价值高频;④ 技术最稳(XML 解析成熟)。

**为什么 debugger 第三而非第一**:价值最高,但风险也最高(硬件依赖、写操作安全、难测)。先用 svd/serial 验证 MCP 工程模式跑通,再啃硬骨头。

---

## 4. 跨 TS/Python 单源与发布

### 4.1 config/mcp-servers.json 扩展

5 个 Python MCP 加入单源 JSON,与现有 4 个共存:
```json
{
  "codegraph": ["codegraph", "serve", "--mcp"],
  "context7": ["npx", "-y", "@upstash/context7-mcp"],
  "memory": ["npx", "-y", "@modelcontextprotocol/server-memory"],
  "sequential-thinking": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
  "svd": ["python", "-m", "mcp_servers.svd"],
  "serial": ["python", "-m", "mcp_servers.serial"],
  "debugger": ["python", "-m", "mcp_servers.debugger"],
  "device-tree": ["python", "-m", "mcp_servers.device_tree"],
  "datasheet": ["python", "-m", "mcp_servers.datasheet"]
}
```

现有的 `mcp.ts` / `postinstall.mjs` 原子写 + 单源机制**无需改动**——只是 JSON 多 5 条。

### 4.2 Python server 打包与依赖安装

- Python server 独立 pip 包(`oh-y-lockie-mcp-servers`),或随插件 `scripts/mcp-servers/` 目录分发
- setup 脚本检测 Python 环境,`pip install -r requirements.txt` 安装 `cmsis-svd`/`pyserial`/`pyocd`/`pdfplumber`/`chromadb` 等
- `diagnoseMcpStatus` 扩展:不只检查 opencode.json 配置存在,还检查命令真能跑(`python --version`、关键库可 import)

---

## 5. 风险矩阵

| 风险 | 影响 | Phase | 缓解 |
|------|------|-------|------|
| Python 环境缺失 | 5 个 MCP 全不可用 | 全局 | setup 脚本检测 + 文档;fallback 到现有 4 个 MCP |
| ESP32/RISC-V 无 SVD | svd-mcp 不可用 | 1 | 降级提示用 datasheet-mcp;ESP32 用 idf headers 解析(后置) |
| 调试器写操作损坏设备 | 设备 brick | 3 | dry-run 默认 + 审计日志 + agent prompt 确认层 |
| USB 权限 | debugger 连不上 | 3 | setup 检测 udev/驱动,给修复指引 |
| PDF 扫描版 | datasheet-mcp 静默失败 | 5 | 显式检测 + 提示 OCR,不静默 |
| embedding 模型体积 | 首次慢 | 5 | 预下载 + 可选 API 模式 |
| 团队 Python 维护成本 | 长期负担 | 全局 | 统一 Python 栈(已决策);CI 覆盖降低维护负担 |

---

## 6. 验收标准(每个 MCP)

每个 MCP 交付时必须满足:
1. **MCP server 可独立启动**(`python -m mcp_servers.X`),stdio JSON-RPC 响应正常
2. **加入 config/mcp-servers.json 单源**,OpenCode 重启后 `diagnoseMcpStatus` 显示 configured
3. **至少 3 个 MCP tool 有集成测试**(用样本数据,debugger 用 mock backend)
4. **README 段落**:用途、依赖、安装、降级条件
5. **对应 skill 更新**:如 svd-mcp 上线后,`register-map` skill 增加"优先用 svd-mcp 查询"指引

---

## 7. 关键决策待确认

1. **Python server 分发方式**:独立 pip 包 vs 随插件 scripts/ 分发?(影响发布流程)
2. **debugger-mcp 安全层**:dry-run 默认是否过于保守?团队是否接受"写操作需 AI 显式 confirm=true"?
3. **datasheet-mcp embedding**:本地 sentence-transformers(隐私好但慢)vs API(快但需密钥)?团队倾向?
4. **ESP32/RISC-V 支持**:是否纳入 Phase 1(需额外做 header 解析),还是后置?
