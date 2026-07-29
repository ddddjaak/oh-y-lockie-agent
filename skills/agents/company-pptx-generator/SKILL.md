---
name: company-pptx-generator
description: |
  Convert Markdown slide documents to company-standard PowerPoint (.pptx) files with LLM-driven layout.
  Dual output: PPTX (formal delivery) + HTML (browser preview with hot-reload).
  Auto-analyzes company template for layouts, theme colors, and font schemes via dual-channel extraction.
  Supports Mermaid diagrams auto-rendered to PNG with intelligent sizing.
  Trigger when user mentions:
  - Generate PPTX, export PPT, markdown to PowerPoint, create presentation
  - Generate company-standard PPT, use template to make PPT
  - "generate PPT" "export as PPTX" "make slides" "create deck"
  - Training materials, technical sharing, presentation slides
  - Dual output (PPTX + handouts)
  Also use this skill when user asks to "preview slides" or "hot-reload slides".
---

# Markdown → Company-Standard PPTX + HTML Preview (v2.0)

## Design Principles

**Template is the single source of truth.** Colors, fonts, layouts, and placeholders
are all extracted from the template via dual-channel analysis (python-pptx API + raw XML).
Scripts only do what the template cannot: parse Markdown structure, render Mermaid charts,
make layout decisions, and position content.

**LLM drives layout decisions.** An LLM (Claude) receives template analysis + content summaries
and outputs precise EMU coordinates for every element on every slide. Falls back to a
rule-based engine if LLM is unavailable. The PPTX renderer is a pure executor — it never
makes positioning decisions.

## 6-Step Pipeline

```
[1] parse_slides.py          Parse Markdown → slides_parsed.json
[2] analyze_template.py      Extract template → template_analysis.json  (parallel with 1)
[3] render_mermaid.py        Render diagrams → PNG + inject dimensions
[4] layout_engine.py         LLM layout → layout_decisions.json
                             (falls back to fallback_engine.py on failure)
[5] create_pptx.py           Render PPTX from layout JSON (pure executor)
[6] preview_html.py          Render HTML preview from layout JSON
```

## Quick Start

```bash
# One-click conversion
COMPANY_TEMPLATE=E:/培训模板.pptx \
python scripts/convert.py docs/slides.md output.pptx

# With flags
python scripts/convert.py input.md output.pptx --skip-layout   # Use fallback only
python scripts/convert.py input.md --preview-only               # HTML only, no PPTX
python scripts/convert.py input.md output.pptx --keep-temp      # Keep intermediate JSON
```

## Individual Script Usage

```bash
# Step 1: Parse slides (supports YAML frontmatter for slide_type hints)
python scripts/parse_slides.py input.md slides_parsed.json

# Step 2: Analyze template (dual-channel: python-pptx + XML)
python scripts/analyze_template.py template.pptx template_analysis.json

# Step 3: Render mermaid diagrams (injects image dimensions)
python scripts/render_mermaid.py slides_parsed.json mermaid_images/

# Step 4: Generate layout (output LLM prompt, then validate)
python scripts/layout_engine.py slides_parsed.json template_analysis.json --prompt > prompt.md
# ... Claude reads prompt.md, generates layout JSON ...
python scripts/layout_engine.py --validate layout_decisions.json

# Or use fallback directly:
python scripts/fallback_engine.py slides_parsed.json template_analysis.json layout.json

# Step 5: Generate PPTX
python scripts/create_pptx.py layout_decisions.json output.pptx template.pptx

# Step 6: Generate HTML preview (with hot-reload)
python scripts/preview_html.py layout_decisions.json preview.html --watch input.md
```

## LLM-Driven Layout (the key innovation)

### How it works

1. `layout_engine.py --prompt` outputs a detailed prompt containing:
   - Template analysis (slide dimensions, available layouts, theme colors, font scheme)
   - EMU coordinate reference table
   - All slide content summaries (type, stats, element counts)
   - Layout constraints (no overflow, minimum font sizes, spacing rules)

2. Claude reads the prompt and generates a `layout_decisions.json` with exact EMU
   coordinates for every element on every slide.

3. `layout_engine.py --validate` checks the JSON structure before rendering.

4. If LLM fails or produces invalid JSON, `fallback_engine.py` takes over with
   rule-based layout (3-pass height estimation + proportional scaling).

### Token budget (for planning)
- 36 slides: ~15K input tokens (template + content summaries) + ~20K output tokens
- Complex slides (tables with 10+ rows) increase output proportionally
- Split into 2-3 batches if output exceeds model limits

## Markdown Format

### Slide Structure
```markdown
## Slide N — Title

(optional YAML frontmatter)
---
slide_type: comparison
layout_hint: table-first
---

Content here (tables, code, mermaid, bullets, text)...
```

### Semantic Frontmatter (optional)
| Field | Values | Description |
|-------|--------|-------------|
| `slide_type` | cover, section, content, comparison, chart, code, end | Override auto-detection |
| `layout_hint` | table-first, chart-first, text-only | Layout preference for mixed slides |

When frontmatter is absent, `parse_slides.py` auto-infers the type from content.

## Slide Types (auto-detected)

| Type | Detected by | Template Layout |
|------|-------------|-----------------|
| `cover` | First slide | 封面 (idx 0) |
| `section` | Has Part header, few elements | 节标题幻灯片 (idx 2) |
| `content` | Text + bullets, no complex elements | 标题和内容 (idx 3) |
| `comparison` | Contains table | 比较 (idx 5) or 标题和内容 (idx 3) |
| `chart` | Contains mermaid diagram | 图表 (idx 6) or 标题和内容 (idx 3) |
| `code` | Contains code blocks | 标题和内容 (idx 3) |
| `end` | Last slide | 结尾页 (idx 10) |

## Mermaid Diagram Support

Supported types: `pie`, `xychart-beta`, `graph LR/TD`, `stateDiagram-v2`, `sequenceDiagram`, `mindmap`

Rendered at 1280×720 with 2x scale → 2560×1440px PNG. Dimensions are injected into
slides_parsed.json so the layout engine can compute correct EMU extents.

### Mermaid Optimization Tips
- Set font size: `%%{init: {'themeVariables': {'fontSize': '18px'}}}%%`
- Simplify pie charts to 5 or fewer slices
- Remove `<br/>` tags from labels (they don't render well)

## Template Analysis

Dual-channel extraction:
- **Channel 1 (python-pptx)**: Slide layouts, placeholder positions/types/fonts
- **Channel 2 (XML direct read)**: Theme colors (clrScheme), font scheme (majorFont/minorFont),
  format scheme (fill/line/effect defaults)

This gives the layout engine accurate company branding data:
- Theme colors: accent1 (red), accent3 (gold), accent4 (blue), accent6 (dark blue)
- Fonts: majorFont = headings, minorFont = body text

## Table Styling

| Element | Default | Source |
|---------|---------|--------|
| Header background | `2F5496` dark blue | Configurable in layout JSON |
| Header text | `FFFFFF` white | Configurable |
| Odd rows | `D6E4F0` light blue | Configurable |
| Even rows | `FFFFFF` white | Configurable |
| Cell border | `#808080` 0.5pt | Built-in |

## Code Block Styling

| Element | Default |
|---------|---------|
| Background | `#F5F5F5` light gray |
| Border | `#BFBFBF` 0.5pt |
| Font | Consolas 9pt |

## HTML Preview

- 1920×1080px per slide, scaled to viewport
- Absolute positioning matching PPTX coordinates
- Red dashed border on overflow elements
- Hot-reload: `--watch` flag monitors .md changes, auto-regenerates
- Keyboard navigation: arrow keys, click buttons

## Project Structure

```
company-pptx-generator/
├── SKILL.md
├── scripts/
│   ├── convert.py              # Main pipeline (one-click)
│   ├── parse_slides.py         # Markdown parser (YAML + auto-inference)
│   ├── analyze_template.py     # Template analyzer (dual-channel)
│   ├── render_mermaid.py       # Mermaid → PNG + dimension injection
│   ├── layout_engine.py        # LLM layout engine (prompt + validate + fallback)
│   ├── fallback_engine.py      # Rule-based fallback layout
│   ├── create_pptx.py          # PPTX renderer (pure executor + validator)
│   ├── preview_html.py         # HTML preview + hot-reload
│   └── apply_template.py       # DEPRECATED (logic merged into analyze_template)
├── references/
│   └── layout-schema.md        # Layout JSON contract
└── mermaid_images/             # Rendered PNG cache
```

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| Template not found | Path with special chars (e.g., `%`) | Rename template to avoid `%` in path |
| Mermaid rendering fails | mermaid-py not installed | `pip install mermaid-py` |
| Table exceeds slide | LLM underestimated height | Use `--skip-layout` to force fallback engine |
| Chinese font wrong | Template font not installed | Install 微软雅黑 or change FONT_CN in create_pptx.py |
| Layout JSON validation fails | LLM produced malformed JSON | Re-run with `--prompt` and regenerate |
| Hot-reload not working | watchdog not installed | `pip install watchdog` (falls back to polling) |
