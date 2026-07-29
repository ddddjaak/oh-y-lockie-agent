---
name: markdown-to-docx
description: |
  Convert Markdown documents to Word (.docx) with company template styling and
  professional table formatting. Use this whenever the user wants to export
  markdown as Word, generate .docx from .md, apply table borders/shading to a
  docx, convert documents with pandoc, or mentions "导出Word", "生成docx",
  "markdown转word", "表格边框", "表格底纹". Also trigger when the user talks
  about pandoc document conversion or needs alternating row colors and header
  styling in Word tables.
---

# Markdown → Word 文档生成

将 Markdown 文档通过 pandoc 转换为 Word (.docx)，并自动为表格添加专业样式（表头深蓝底纹、数据行交替色、单元格边框）。

## 前置检查

执行转换前，先确认依赖可用：

```bash
pandoc --version          # 需 ≥ 3.1
python -c "import docx; print('OK')"   # 需 python-docx 已安装
```

任一检查失败时的处理：
- **pandoc 未安装**：引导用户访问 https://pandoc.org/installing.html 或 `winget install --id JohnMacFarlane.Pandoc`
- **python-docx 未安装**：`pip install python-docx`

## 转换流程

### 可选：预处理 — 去除标题序号

如果 Markdown 中的标题带有序号（如 `## 1.1 概述`），可以在 pandoc 转换前用 sed 去除：

```bash
sed -E -i -e 's/^(#+ )([0-9]+\.)+ /\1/' input.md
```

这只会删除阿拉伯数字序号（`1.`、`1.1.`、`1.1.1.` 等），保留中文序号（一、二、三）和非标题的编号列表。

### 第 1 步：pandoc 转换

```bash
pandoc <输入文件.md> -o <输出文件.docx> --reference-doc=<模板路径.docx>
```

**要点**：
- `--reference-doc` 从模板继承字体、标题大小、页边距等样式。如果用户没有模板，省略此参数即可使用 pandoc 内置默认样式。
- **如果输出文件正被 Word 打开，pandoc 会报 Permission denied 错误。** 先关闭 Word 中的该文件，或用不同的输出文件名。
- pandoc 会自动为 Markdown 表格的表头行添加 `<w:tblHeader/>` OOXML 标记——后续脚本靠这个标记可靠地识别表头。

### 第 2 步：表格后处理

运行本 skill 自带的 `style_tables.py` 脚本：

```bash
python <skill目录>/scripts/style_tables.py <输出文件.docx>
```

也可以输出到新文件：

```bash
python <skill目录>/scripts/style_tables.py input.docx output.docx
```

## 表格样式效果

| 元素 | 样式 | 默认值 |
|------|------|--------|
| 表头行背景 | 深蓝色 | `#2F5496` |
| 表头行文字 | 白色 | `#FFFFFF` |
| 奇数数据行 | 浅蓝底纹 | `#D6E4F0` |
| 偶数数据行 | 白底 | `#FFFFFF` |
| 单元格边框 | 灰色, 0.5pt | `#808080` |

## 自定义表格配色

编辑 `scripts/style_tables.py` 顶部的常量（颜色值为 RRGGBB 十六进制，不含 `#`）：

```python
HEADER_BG = "2F5496"      # 表头背景色
HEADER_FG = "FFFFFF"      # 表头文字色
ODD_BG = "D6E4F0"         # 奇数行背景色
EVEN_BG = "FFFFFF"        # 偶数行背景色
BORDER_COLOR = "808080"   # 边框颜色
BORDER_SIZE = "4"         # 边框粗细 (1/8 pt 为单位, 4 = 0.5pt)
```

## 表头识别逻辑

脚本用两种方法识别表头行（只要任一匹配）：

1. **OOXML `<w:tblHeader/>` 标记**（优先）：pandoc 在转换 Markdown 表格时自动添加，是最可靠的方式。
2. **粗体文本检测**（回退）：如果第一行超过 50% 的单元格包含加粗文字，则判定为表头。

## 故障排除

| 问题 | 原因 | 解决 |
|------|------|------|
| pandoc: Permission denied | 输出文件正被 Word 打开 | 关闭 Word 或换输出文件名 |
| 表头未被识别 | Markdown 表格缺少 `\|---|---\|` 分隔行 | 确保表格有正确的表头分隔行；或在 Markdown 中将表头文字加粗 `**文字**` 作为回退 |
| 模板文件找不到 | `--reference-doc` 路径错误 | 确认模板文件存在；如无模板可省略此参数 |
| ImportError: No module named docx | python-docx 未安装 | `pip install python-docx` |
