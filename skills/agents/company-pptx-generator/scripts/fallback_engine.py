#!/usr/bin/env python3
"""
fallback_engine.py — Rule-based layout engine for company-pptx-generator 2.0

Extracted from create_pptx.py's decision logic. Takes parsed slides +
template analysis, outputs layout_decisions.json in the same format as
the LLM layout_engine.py. This is the safety net when LLM fails.

Usage: python fallback_engine.py <slides_parsed.json> <template_analysis.json> [output.json]
"""

import sys, os, json

from pptx.util import Inches, Pt, Emu

# ── Default styling constants (overridden by template_analysis when available) ──
DEFAULTS = {
    "font_cn": "微软雅黑",
    "font_en": "Arial",
    "font_code": "Cascadia Code",
    "header_bg": "0F2B46",
    "header_text": "FFFFFF",
    "row_alt_1": "F1F5F9",
    "row_alt_2": "FFFFFF",
    "title_size": 24,
    "body_size": 13,
    "bullet_size": 13,
    "table_header_size": 11,
    "table_cell_size": 10,
    "code_size": 9,
}

# Template layout name → layout_idx mapping (filled from template_analysis)
# Fallback: hardcoded if template_analysis unavailable
LAYOUT_NAMES_CN = [
    "封面", "目录", "节标题幻灯片", "标题和内容", "两栏内容",
    "比较", "图表", "3图文组合", "仅标题", "空白页", "结尾页",
]

SLIDE_TYPE_TO_LAYOUT = {
    "cover":       ["封面", "Title Slide"],
    "section":     ["节标题幻灯片", "Section Header"],
    "content":     ["标题和内容", "Title and Content", "标题与内容"],
    "comparison":  ["比较", "Comparison"],
    "chart":       ["图表", "Title and Content"],
    "code":        ["标题和内容", "Title and Content"],
    "end":         ["仅标题", "封面", "Title Slide"],  # prefer layouts with title placeholder
}

# ── Layout matching ──────────────────────────────────────────────────────────

def build_layout_index(template_analysis):
    """Build a mapping from layout name → idx from template_analysis."""
    idx_map = {}
    layouts = template_analysis.get("layouts", []) if template_analysis else []
    for lo in layouts:
        idx_map[lo["name"]] = lo["idx"]
    return idx_map


def find_layout_idx(slide_type, layout_index):
    """Find the best layout index for a slide type."""
    candidates = SLIDE_TYPE_TO_LAYOUT.get(slide_type, ["标题和内容"])
    for name in candidates:
        if name in layout_index:
            return layout_index[name]

    # Fallback: any layout with 标题 in name
    for name, idx in layout_index.items():
        if "标题" in name or "content" in name.lower():
            return idx

    # Last resort
    return list(layout_index.values())[0] if layout_index else 0


def get_content_area(template_analysis):
    """Extract content area info from template analysis."""
    ca = template_analysis.get("content_area", {}) if template_analysis else {}
    slide_w = template_analysis.get("slide_width_emu", 12192000) if template_analysis else 12192000
    slide_h = template_analysis.get("slide_height_emu", 6858000) if template_analysis else 6858000

    return {
        "left_emu": ca.get("left_emu", 618606),
        "top_emu": ca.get("top_emu", 137041 + 649407 + 200000),  # title_bottom + gap
        "width_emu": ca.get("width_emu", 10954788),
        "available_height_emu": ca.get("height_emu", 4803867),
        "title_bottom_emu": ca.get("title_bottom_emu", 786448),
        "slide_width_emu": slide_w,
        "slide_height_emu": slide_h,
    }


# ── Height estimation (from create_pptx.py) ─────────────────────────────────

def estimate_chars_per_line(font_size_pt, content_width_emu):
    """Estimate how many CJK characters fit per line at given font size and width.

    CJK character ≈ 1em wide. At 10pt, 1em ≈ 10pt ≈ 127000 EMU.
    content_width is in EMU. Returns approximate chars per line.
    """
    char_width_emu = font_size_pt * 12700  # 1pt ≈ 12700 EMU
    if char_width_emu <= 0:
        return 60
    return max(1, content_width_emu // char_width_emu)


def estimate_element_height(elem, content_width_emu=10954788):
    """Estimate height in EMU for a single element.

    Uses content area width for accurate line wrapping calculation.
    """
    etype = elem.get("type", "")

    if etype == "text":
        text = elem.get("text", "")
        font_size = elem.get("font_size_pt", DEFAULTS["body_size"])
        cpl = estimate_chars_per_line(font_size, content_width_emu)
        n_lines = sum(max(1, -(-len(ln) // cpl)) for ln in text.split('\n'))
        line_height_emu = int(Pt(font_size + 4))  # ~1.4x line spacing
        return n_lines * line_height_emu + int(Inches(0.08))

    elif etype == "bullets":
        n = elem.get("count", len(elem.get("items", [])))
        font_size = elem.get("font_size_pt", DEFAULTS["bullet_size"])
        line_height_emu = int(Pt(font_size + 5))
        return n * line_height_emu + int(Inches(0.08))

    elif etype == "numbered":
        n = elem.get("count", len(elem.get("items", [])))
        font_size = elem.get("font_size_pt", DEFAULTS["bullet_size"])
        line_height_emu = int(Pt(font_size + 5))
        return n * line_height_emu + int(Inches(0.08))

    elif etype == "heading":
        return int(Inches(0.4))

    elif etype == "table":
        rows = elem.get("rows", 1)
        font_size = elem.get("font_size_pt", DEFAULTS["table_cell_size"])
        # Each row: font_size + padding. Add header row.
        row_height_emu = int(Pt(font_size + 8))  # font + cell padding
        return row_height_emu * (rows + 1) + int(Inches(0.05))

    elif etype == "code":
        lines = elem.get("line_count", elem.get("code", "").count('\n') + 1)
        font_size = elem.get("font_size_pt", DEFAULTS["code_size"])
        line_height_emu = int(Pt(font_size + 3))
        return line_height_emu * lines + int(Inches(0.10))

    elif etype == "mermaid":
        MERMAID_SCALE = 2.0
        w_px = elem.get("width_px", 2560) / MERMAID_SCALE
        h_px = elem.get("height_px", 1440) / MERMAID_SCALE
        P2E = 914400 / 96
        img_h_emu = int(h_px * P2E)
        content_w = content_width_emu
        img_w_emu = int(w_px * P2E)
        if img_w_emu > content_w * 0.9:
            ratio = (content_w * 0.9) / img_w_emu
            img_h_emu = int(img_h_emu * ratio)
        return img_h_emu

    elif etype == "quote":
        return 0

    else:
        return 0


def scale_elements(estimates, total_available_emu, spacing_emu):
    """Scale down element heights proportionally to fit within bounds.
    Returns list of (element, height_emu, font_size_override_or_None).

    When an element is scaled down significantly, reduces font size to match.
    """
    MARGIN = int(Inches(0.1))  # 0.1" bottom margin
    MIN_FONT = 9  # smallest readable font size for projection

    total_est = sum(h for _, h in estimates) + spacing_emu * max(0, len(estimates) - 1)
    if total_est <= total_available_emu:
        return [(e, h, None) for e, h in estimates]

    deficit = total_est - total_available_emu + MARGIN
    working = [[e, h, None] for e, h in estimates]  # mutable working copy

    # Scale-down priority: text/bullets → code → table → mermaid (most resistant)
    for scale_types, min_h_emu, can_shrink_font in [
        (("text", "bullets", "numbered", "heading"), int(Inches(0.08)), True),
        (("code",), int(Inches(0.12)), False),
        (("table",), int(Inches(0.6)), True),
        (("mermaid",), int(Inches(2.8)), False),
    ]:
        if deficit <= 0:
            break
        for i, work in enumerate(working):
            etype = work[0].get("type", "")
            est_h = work[1]
            if etype not in scale_types:
                continue
            if est_h <= min_h_emu:
                continue
            reduction = min(deficit, est_h - min_h_emu)
            new_h = est_h - reduction

            # Compute font override if scaled down > 20%
            font_override = None
            if can_shrink_font and reduction > est_h * 0.2:
                scale_ratio = new_h / est_h
                orig_font = work[0].get("font_size_pt", DEFAULTS["body_size"])
                new_font = max(MIN_FONT, int(orig_font * scale_ratio))
                if new_font < orig_font:
                    font_override = new_font

            working[i] = [work[0], new_h, font_override]
            deficit -= reduction
            if deficit <= 0:
                break

    # Convert working list back to tuples
    result = [(w[0], w[1], w[2]) for w in working]
    return result


# ── Main layout generation ──────────────────────────────────────────────────

def generate_layout(slides_data, template_analysis):
    """Generate layout_decisions.json from parsed slides + template analysis."""
    slides = slides_data.get("slides", []) if isinstance(slides_data, dict) else slides_data
    layout_index = build_layout_index(template_analysis)
    content_area = get_content_area(template_analysis)

    spacing_emu = int(Inches(0.03))
    layout_slides = []

    for slide in slides:
        slide_type = slide.get("slide_type", "content")
        slide_num = slide.get("number", "?")
        title = slide.get("title", "")
        part = slide.get("part", "")
        elements = slide.get("elements", [])

        # Build full title text
        full_title = f"{part} — {title}" if part else title

        # Find layout
        layout_idx = find_layout_idx(slide_type, layout_index)

        # Build elements
        layout_elements = []

        # Title (always uses placeholder 0)
        layout_elements.append({
            "type": "title",
            "placeholder_idx": 0,
            "text": full_title,
            "font_size_pt": DEFAULTS["title_size"],
        })

        # Body elements — estimate heights, scale, then position
        body_elements = [e for e in elements if e.get("type") not in ("quote",)]
        estimates = [(e, estimate_element_height(e, content_area["width_emu"])) for e in body_elements]
        scaled = scale_elements(estimates, content_area["available_height_emu"], spacing_emu)

        # Position elements
        y = content_area["top_emu"]
        for elem, height_emu, font_override in scaled:
            etype = elem.get("type", "")
            if height_emu <= 0:
                continue

            spec = {
                "left_emu": content_area["left_emu"],
                "top_emu": y,
                "width_emu": content_area["width_emu"],
                "height_emu": height_emu,
            }

            if etype == "text":
                spec["type"] = "text"
                spec["text"] = elem.get("text", "")
                spec["font_size_pt"] = font_override if font_override else DEFAULTS["body_size"]

            elif etype == "bullets":
                spec["type"] = "bullets"
                spec["items"] = elem.get("items", [])
                spec["font_size_pt"] = font_override if font_override else DEFAULTS["bullet_size"]

            elif etype == "numbered":
                spec["type"] = "bullets"
                spec["items"] = elem.get("items", [])
                spec["font_size_pt"] = font_override if font_override else DEFAULTS["bullet_size"]

            elif etype == "heading":
                spec["type"] = "text"
                spec["text"] = elem.get("text", "")
                spec["font_size_pt"] = font_override if font_override else 14

            elif etype == "table":
                spec["type"] = "table"
                md = elem.get("markdown", "")
                spec["rows"], spec["cols"], spec["data"] = parse_table_md(md)
                spec["font_size_pt"] = font_override if font_override else DEFAULTS["table_cell_size"]
                spec["header_bg"] = DEFAULTS["header_bg"]
                spec["header_text"] = DEFAULTS["header_text"]
                spec["row_alt_1"] = DEFAULTS["row_alt_1"]
                spec["row_alt_2"] = DEFAULTS["row_alt_2"]

            elif etype == "code":
                spec["type"] = "code"
                spec["code"] = elem.get("code", "")
                spec["language"] = elem.get("language", "")
                spec["font_size_pt"] = DEFAULTS["code_size"]
                spec["font_name"] = DEFAULTS["font_code"]

            elif etype == "mermaid":
                spec["type"] = "mermaid_image"
                spec["image_path"] = elem.get("image_path", "")

            else:
                continue

            layout_elements.append(spec)
            y += height_emu + spacing_emu

        # Overflow check
        overflow = "fail" if y > content_area["slide_height_emu"] else "pass"

        layout_slides.append({
            "slide_number": str(slide_num),
            "layout_idx": layout_idx,
            "elements": layout_elements,
            "overflow_check": overflow,
        })

    return {
        "version": "2.0",
        "source": "fallback",
        "slides": layout_slides,
    }


def parse_table_md(markdown):
    """Parse markdown table into (rows, cols, data)."""
    lines = [l.strip() for l in markdown.strip().split('\n') if l.strip() and '|' in l]
    if len(lines) < 2:
        return 0, 0, []

    # Header
    headers = [c.strip() for c in lines[0].split('|') if c.strip()]
    cols = len(headers)

    # Data rows (skip separator)
    data = [headers]
    for line in lines[1:]:
        if '---' in line:
            continue
        cells = [c.strip() for c in line.split('|') if c.strip()]
        while len(cells) < cols:
            cells.append("")
        data.append(cells[:cols])

    return len(data) - 1, cols, data


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(f"Usage: python {sys.argv[0]} <slides_parsed.json> [template_analysis.json] [output.json]")
        sys.exit(1)

    slides_path = sys.argv[1]
    template_path = sys.argv[2] if len(sys.argv) > 2 else None
    output_path = sys.argv[3] if len(sys.argv) > 3 else None

    with open(slides_path, 'r', encoding='utf-8') as f:
        slides_data = json.load(f)

    template_analysis = None
    if template_path and os.path.exists(template_path):
        with open(template_path, 'r', encoding='utf-8') as f:
            template_analysis = json.load(f)

    layout = generate_layout(slides_data, template_analysis)

    json_str = json.dumps(layout, ensure_ascii=False, indent=2)

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(json_str)
        print(f"[fallback_engine] {len(layout['slides'])} slides -> {output_path}")
    else:
        print(json_str)


if __name__ == '__main__':
    main()
