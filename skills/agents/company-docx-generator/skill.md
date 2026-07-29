---
name: company-docx-generator
description: |
  将 Markdown 文档转换为符合公司规范的 Word (.docx) 文档。使用公司标准模板作为参考文档，
  自动继承模板的样式、页眉、页脚、Logo、文档编号。去除标题序号避免重复，
  将mermaid图表转换为图片，为表格添加专业样式，代码块自动加边框，图片自动居中。
  当用户提到以下场景时触发此技能：
  - 导出 Word、生成 docx、markdown 转 word
  - 生成公司规范文档、公司格式文档
  - "导出Word格式"、"生成公司文档"、"按公司模板导出"
---

# Markdown → 公司规范 Word 文档生成

## 设计原则

**模板是唯一真相源**。页眉、页脚、Logo、文档编号、版本号全部由模板提供，
脚本不修改这些内容。脚本只做模板做不到的事情：去重标题编号、字体修正、表格着色、代码边框、图片居中、TOC 定位。

## 功能特性

8 步流水线自动完成：

| 步骤 | 脚本 | 功能 |
|------|------|------|
| 1 | `preprocess_markdown.py` | 去标题序号（避免与模板自动编号重复）、`---`→`***`、mermaid→PNG |
| 2 | pandoc | `--reference-doc` 继承模板样式/页眉/页脚/Logo，`--resource-path` 解析图片 |
| 3 | `insert_toc.py` | 在 `## 目录` 标题后插入 Word TOC 域（非封面位置） |
| 4 | `setup_docx.py` | 字体修正（正文 TNR + 等线，代码 Consolas） |
| 5 | `style_tables.py` | 表格边框/着色 + 列宽自适应 |
| 6 | `wrap_code_blocks.py` | 代码块→带边框灰底单格表格 |
| 7 | `center_images.py` | 所有图片自动居中 |
| 8 | `style_cover_page.py` | 封面标题格式化（`<cover-title>` 转宋体小初居中） |

## 前置检查（必须首先执行）

```bash
pandoc --version          # >= 3.1
python -c "import docx; print('OK')"   # python-docx
```

## 交互式工作流

当客户说"生成公司文档"时，按以下顺序执行：

### Step 1: 询问模板

**必须先问**：

> 请提供贵公司的参考/模板 docx 文件路径，我会用它来生成文档。
> 模板里的页眉、页脚、Logo、文档编号会自动带入生成的文档。

### Step 2: 执行转换

收到客户模板路径后，用环境变量指定模板路径，运行流水线：

```bash
COMPANY_TEMPLATE=<客户模板.docx> \
python scripts/convert.py input.md output.docx
```

## Markdown 写作约定

### 1. 文档标题（封面 vs 正文）

- 第一行写 `<cover-title>文档标题</cover-title>` → 封面标题（宋体小初居中）
- 第二个 `# 文档标题`（H1）→ 正文标题（用于 TOC 锚点定位）
- **封面标题和正文标题文字应不同**，避免视觉重复

示例：
```markdown
<cover-title>Edge BMC KeyE 模组量产测试方案</cover-title>

# 量产测试方案

> **文件编号:** FM-RD-117 | **版本:** A01 | ...
```

### 2. 版本管理

在封面后添加表格：
```markdown
## 文件版本管制记录
| 版本 | 作者 | 文件更新历史 | 生效日期 | 审核 |
|------|------|-------------|----------|------|
| A01 | — | 初版发布 | 2025-11-07 | — |
```

### 3. 目录

在版本记录后添加 `## 目录` 标题，脚本自动在其后插入 Word TOC 域。
```markdown
## 目录

## 1. 目的
...
```
打开文档后 `Ctrl+A` → `F9` 刷新目录。

### 4. 标题编号

- **不要在 Markdown 标题中手写编号**（如 `## 1. 目的`）
- `preprocess_markdown.py` 会自动去掉手动编号
- 模板的自动编号会统一添加，避免重复

### 5. 图片

- **只用 `![描述](路径)` 一行**，不要另加 `**图 X — ...**` 标题行
- pandoc 将 alt 文本作为图片描述/题注
- 图片自动居中对齐
- 图片放在 markdown 同级或子级 `images/` 目录

正确写法：
```markdown
![图1 — 待测物 DUT](./images/fig01-dut.png)
```

错误写法（会导致双重描述）：
```markdown
**图 1 — 待测物 DUT**
![图1 DUT](./images/fig01-dut.png)
```

### 6. 代码块

使用 ```` ``` ```` 围栏代码块 → Consolas 等宽字 + 带边框灰底

### 7. 表格

标准 Markdown 表格 → 深蓝表头 + 交替行色 + 列宽自适应

## 表格样式

| 元素 | 默认值 |
|------|--------|
| 表头背景 | `#2F5496` 深蓝 |
| 表头文字 | `#FFFFFF` 白 |
| 奇数行 | `#D6E4F0` 浅蓝 |
| 偶数行 | `#FFFFFF` 白 |
| 边框 | `#808080` 0.5pt |

## 代码块样式

| 元素 | 默认值 |
|------|--------|
| 背景 | `#F5F5F5` 浅灰 |
| 边框 | `#808080` 0.5pt |
| 字体 | Consolas |

## 自定义

编辑各脚本顶部的常量：

**字体** (`setup_docx.py`)：
```python
FONT_EN = "Times New Roman"
FONT_CN = "等线"
FONT_CODE = "Consolas"
```

**表格配色** (`style_tables.py`)：
```python
HEADER_BG = "2F5496"
ODD_BG = "D6E4F0"
```

**代码块** (`wrap_code_blocks.py`)：
```python
CELL_BG = "F5F5F5"
```

**TOC 标题匹配** (`insert_toc.py`)：
```python
TOC_HEADINGS = ['目录', 'Table of Contents']
```

## 故障排除

| 问题 | 原因 | 解决 |
|------|------|------|
| pandoc: Permission denied | 输出文件正被 Word 打开 | 关闭 Word 或换输出文件名 |
| 目录显示占位文字 | TOC 字段未刷新 | Word 中 Ctrl+A → F9 |
| 代码字体不是等宽 | style_tables.py 覆盖了 | 已修复：跳过 Source Code |
| 表格列宽不合理 | 未自动调整 | 已修复：按内容比例分配 |
| 标题序号重复 | Markdown 有序号 + 模板自动编号 | preprocess 已去序号；不要在 md 中手写编号 |
| 图片不显示 | pandoc 找不到图片路径 | 确保图片路径相对于 md 文件可解析；使用 `./images/` 子目录 |
| 图片左对齐 | 旧版流水线未居中 | 已修复：`center_images.py` 自动处理 |
| 图片有双重描述 | md 中同时写了 `**图X**` 和 `![图X]` | 只保留 `![描述](路径)` 一行 |
| 封面和正文标题重复 | `<cover-title>` 和 `# 标题` 文字相同 | 封面标题用完整名称，H1 用简短版 |
| TOC 插在封面标题前 | 旧版 `style_cover_page` 行为 | 已修复：`insert_toc.py` 改插在 `## 目录` 标题后 |
