# Layout Decisions JSON Schema

> company-pptx-generator 2.0 — layout_engine 和 create_pptx/preview_html 之间的契约

## 顶层结构

```json
{
  "version": "2.0",
  "generated_at": "ISO8601 timestamp",
  "slides": [
    { /* SlideSpec */ }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `version` | string | ✅ | 固定 `"2.0"` |
| `generated_at` | string | ❌ | 生成时间（ISO8601） |
| `source` | string | ❌ | 来源标识：`"llm"` 或 `"fallback"` |
| `slides` | array | ✅ | SlideSpec 数组，按 slide number 排序 |

---

## SlideSpec

```json
{
  "slide_number": "7",
  "layout_idx": 3,
  "layout_name": "标题和内容",
  "elements": [
    { /* ElementSpec */ }
  ],
  "overflow_check": "pass"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `slide_number` | string | ✅ | 对应 Markdown 中的 slide 编号（如 `"7"`, `"4b"`） |
| `layout_idx` | int | ✅ | 模板 layout 索引（0-based） |
| `layout_name` | string | ❌ | layout 名称（仅供调试） |
| `elements` | array | ✅ | ElementSpec 数组 |
| `overflow_check` | string | ✅ | `"pass"` 或 `"fail"` |
| `notes` | string | ❌ | LLM 的排版备注（仅供调试） |

**合法值域**：
- `layout_idx`：0-14（取决于模板，通常 0-14）
- `overflow_check`：`"pass"` 或 `"fail"`（fail 时该页回退 fallback_engine）

---

## ElementSpec — 通用字段

所有元素共有：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `type` | string | ✅ | 元素类型（见下表） |
| `left_emu` | int | ❌ | X 坐标（EMU），非 placeholder 元素必填 |
| `top_emu` | int | ❌ | Y 坐标（EMU），非 placeholder 元素必填 |
| `width_emu` | int | ❌ | 宽度（EMU） |
| `height_emu` | int | ❌ | 高度（EMU） |
| `font_size_pt` | float | ❌ | 字号（pt），默认 10 |
| `placeholder_idx` | int | ❌ | 模板占位符索引（title 元素专用） |

**坐标约束**：
- `left_emu` + `width_emu` ≤ `slide_width_emu`（12192000）
- `top_emu` + `height_emu` ≤ `slide_height_emu`（6858000）
- `font_size_pt`：8-44

---

## ElementSpec — 按类型

### title

使用模板占位符，只需指定占位符索引和文本。

```json
{
  "type": "title",
  "placeholder_idx": 0,
  "text": "C51 EC vs Zephyr EC：技术维度",
  "font_size_pt": 24
}
```

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `placeholder_idx` | ✅ | 模板标题占位符索引（通常为 0） |
| `text` | ✅ | 标题文本 |
| `font_size_pt` | ❌ | 默认使用模板占位符字号 |

### text

自由文本框。

```json
{
  "type": "text",
  "text": "正文内容...",
  "left_emu": 618606,
  "top_emu": 950000,
  "width_emu": 10954788,
  "height_emu": 914400,
  "font_size_pt": 12
}
```

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `text` | ✅ | 文本内容 |
| `left_emu`, `top_emu` | ✅ | 位置 |
| `width_emu`, `height_emu` | ✅ | 尺寸 |

### bullets

要点列表（自由文本框）。

```json
{
  "type": "bullets",
  "items": ["第一点", "第二点"],
  "left_emu": 618606,
  "top_emu": 950000,
  "width_emu": 10954788,
  "height_emu": 3000000,
  "font_size_pt": 12
}
```

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `items` | ✅ | 字符串数组 |
| `left_emu`, `top_emu` | ✅ | 位置 |
| `width_emu`, `height_emu` | ✅ | 尺寸 |

### table

```json
{
  "type": "table",
  "rows": 9,
  "cols": 3,
  "data": [["H1", "H2", "H3"], ["R1C1", "R1C2", "R1C3"]],
  "left_emu": 618606,
  "top_emu": 950000,
  "width_emu": 10954788,
  "height_emu": 5300000,
  "font_size_pt": 10,
  "header_bg": "2F5496",
  "header_text": "FFFFFF",
  "row_alt_1": "D6E4F0",
  "row_alt_2": "FFFFFF"
}
```

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `rows`, `cols` | ✅ | 行列数 |
| `data` | ✅ | 二维数组，第一行为表头 |
| `left_emu`, `top_emu` | ✅ | 位置 |
| `width_emu`, `height_emu` | ✅ | 尺寸 |
| `header_bg` | ❌ | 表头背景色（6 位 hex，无 `#`），默认 `2F5496` |
| `header_text` | ❌ | 表头文字色，默认 `FFFFFF` |
| `row_alt_1` | ❌ | 奇数行背景色，默认 `D6E4F0` |
| `row_alt_2` | ❌ | 偶数行背景色，默认 `FFFFFF` |

### code

代码块。

```json
{
  "type": "code",
  "code": "gpio_pin_set_dt(&led, 1);",
  "language": "c",
  "left_emu": 618606,
  "top_emu": 4500000,
  "width_emu": 10954788,
  "height_emu": 1200000,
  "font_size_pt": 9,
  "font_name": "Consolas"
}
```

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `code` | ✅ | 代码文本 |
| `language` | ❌ | 语言标识（`c`, `dts`, `kconfig` 等） |
| `font_name` | ❌ | 等宽字体，默认 `Consolas` |

### mermaid_image

Mermaid 图表图片。

```json
{
  "type": "mermaid_image",
  "image_path": "mermaid_images/mermaid_abc123.png",
  "left_emu": 1168606,
  "top_emu": 950000,
  "width_emu": 9848268,
  "height_emu": 4800000
}
```

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `image_path` | ✅ | PNG 文件路径（相对于 skill 目录） |
| `left_emu`, `top_emu` | ✅ | 位置 |
| `width_emu`, `height_emu` | ✅ | 尺寸（按图片宽高比从已知尺寸计算） |

---

## 颜色规范

- 统一使用 6 位 hex string，不含 `#` 前缀
- 合法值：`000000`-`FFFFFF`（大小写均可，推荐大写）

## 坐标参考

| 参考 | EMU | Inch |
|------|-----|------|
| Standard slide width | 12,192,000 | 13.33" |
| Standard slide height | 6,858,000 | 7.5" |
| 1 inch | 914,400 | 1" |
| 1 cm | 360,000 | 0.394" |
| 1 px (96 DPI) | 9,525 | 0.0104" |
| Typical content left | ~618,606 | 0.68" |
| Typical content width | ~10,954,788 | 11.98" |
| Typical title height | ~649,407 | 0.71" |
| Typical title bottom | ~786,448 | 0.86" |

---

## 完整示例

一个典型的对比表 slide：

```json
{
  "version": "2.0",
  "source": "llm",
  "slides": [
    {
      "slide_number": "7",
      "layout_idx": 3,
      "layout_name": "标题和内容",
      "elements": [
        {
          "type": "title",
          "placeholder_idx": 0,
          "text": "C51 EC vs Zephyr EC：技术维度",
          "font_size_pt": 24
        },
        {
          "type": "table",
          "rows": 9,
          "cols": 3,
          "data": [
            ["维度", "传统 C51 EC", "Zephyr EC"],
            ["CPU", "8 位 8051", "32 位 Cortex-M0"]
          ],
          "left_emu": 618606,
          "top_emu": 950000,
          "width_emu": 10954788,
          "height_emu": 5300000,
          "font_size_pt": 10,
          "header_bg": "2F5496",
          "header_text": "FFFFFF",
          "row_alt_1": "D6E4F0",
          "row_alt_2": "FFFFFF"
        }
      ],
      "overflow_check": "pass",
      "notes": "9 行对比表，10pt 字号。标题用模板占位符。表格底部 6250000 EMU，距 slide 底部 608000 EMU 余量。"
    }
  ]
}
```
