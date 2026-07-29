#!/usr/bin/env python3
"""
layout_engine.py — LLM-driven layout engine for company-pptx-generator 2.0

Three modes:
  --prompt     Output the LLM prompt (Claude reads this, generates layout JSON)
  --validate   Validate a layout JSON against the schema
  (default)    Try LLM generation; fall back to fallback_engine.py on failure

Usage:
  python layout_engine.py slides_parsed.json template_analysis.json --prompt > prompt.md
  python layout_engine.py --validate layout.json
  python layout_engine.py slides_parsed.json template_analysis.json -o layout.json
"""

import sys, os, json, argparse, subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ── EMU Reference Table (included in LLM prompt) ────────────────────────────

EMU_REFERENCE = """
## EMU Coordinate Reference

| Reference | EMU | Inches | cm |
|-----------|-----|--------|-----|
| Standard slide width | 12,192,000 | 13.33" | 33.87 |
| Standard slide height | 6,858,000 | 7.5" | 19.05 |
| 1 inch | 914,400 | 1" | 2.54 |
| 1 cm | 360,000 | 0.394" | 1.0 |
| 1 pt (font) | 12,700 | — | — |
| Typical content left | ~618,606 | 0.68" | 1.72 |
| Typical content width | ~10,954,788 | 11.98" | 30.43 |
| Typical title area | top=137,041 height=649,407 | 0.15"-0.86" | 0.38-2.18 |
| Safe bottom margin | leave >= 200,000 EMU (0.22") | | |
"""

LAYOUT_CONSTRAINTS = """
## Layout Constraints (MUST follow)

1. **No overflow**: element (top + height) < slide_height (6,858,000 EMU) minus 200,000 bottom margin
2. **No overlap**: elements must not overlap vertically (element[i].top + element[i].height + spacing < element[i+1].top)
3. **Minimum font size**: 8pt for any visible text
4. **Table font**: 10pt for most tables, 9pt if table has >= 10 rows
5. **Code font**: 9pt, Consolas or similar monospace
6. **Mermaid images**: preserve aspect ratio (width_px / height_px from input). Scale to fit content width, max 80% of available height.
7. **Title**: use template placeholder_idx=0 always. Font size 24pt.
8. **Spacing between elements**: 30,000-50,000 EMU (0.03-0.05")
"""

OUTPUT_FORMAT = """
## Output Format

Return a JSON object matching this exact structure. NO explanation, NO markdown fences, ONLY the JSON object:

```json
{
  "version": "2.0",
  "source": "llm",
  "slides": [
    {
      "slide_number": "7",
      "layout_idx": 3,
      "elements": [
        {"type": "title", "placeholder_idx": 0, "text": "...", "font_size_pt": 24},
        {"type": "table", "left_emu": 618606, "top_emu": 950000,
         "width_emu": 10954788, "height_emu": 5300000, "font_size_pt": 10,
         "rows": 9, "cols": 3,
         "data": [["H1","H2","H3"], ["R1","R2","R3"]],
         "header_bg": "2F5496", "header_text": "FFFFFF",
         "row_alt_1": "D6E4F0", "row_alt_2": "FFFFFF"}
      ],
      "overflow_check": "pass"
    }
  ]
}
```

Element types: "title", "text", "bullets", "table", "code", "mermaid_image"
All coordinates in EMU (int). All colors as 6-char hex without # prefix.
"""


# ── Prompt Construction ─────────────────────────────────────────────────────

def build_prompt(slides_data, template_analysis):
    """Construct the LLM prompt for layout decisions."""
    slides = slides_data.get("slides", []) if isinstance(slides_data, dict) else slides_data

    # Template summary
    tw = template_analysis.get("slide_width_emu", 12192000) if template_analysis else 12192000
    th = template_analysis.get("slide_height_emu", 6858000) if template_analysis else 6858000
    ca = template_analysis.get("content_area", {}) if template_analysis else {}
    layouts = template_analysis.get("layouts", []) if template_analysis else []
    colors = template_analysis.get("theme_colors", {}) if template_analysis else {}
    fonts = template_analysis.get("font_scheme", {}) if template_analysis else {}

    prompt = f"""You are a PPTX layout expert. Your job is to decide exact element positions (in EMU coordinates) for each slide.

## Template Information

- Slide size: {tw} x {th} EMU ({tw/914400:.1f}" x {th/914400:.1f}")
- Content area: left={ca.get('left_emu', 618606)}, top≈{ca.get('top_emu', 1373095)}, width={ca.get('width_emu', 10954788)}, available height≈{ca.get('height_emu', 4803867)} EMU
- Title bottom: {ca.get('title_bottom_emu', 786448)} EMU (place elements below this)

### Available Layouts (use layout_idx)
"""
    for lo in layouts[:12]:  # Top 12 layouts
        ph_summary = ", ".join(
            f"ph[{p.get('idx','?')}]={p.get('type','?')}({p.get('left_emu','?')},{p.get('top_emu','?')},{p.get('width_emu','?')}x{p.get('height_emu','?')})"
            for p in lo.get("placeholders", [])[:5]
        )
        prompt += f"  [{lo['idx']}] \"{lo['name']}\": {ph_summary}\n"

    # Theme colors
    if colors:
        non_name = {k: v for k, v in colors.items() if k != "name"}
        prompt += f"\n### Theme Colors\n{json.dumps(non_name)}\n"

    # Font scheme
    if fonts:
        major = fonts.get("majorFont", {})
        minor = fonts.get("minorFont", {})
        prompt += f"\n### Font Scheme\n- Headings (majorFont): {major.get('latin', '?')}\n- Body (minorFont): {minor.get('latin', '?')}\n"

    prompt += EMU_REFERENCE
    prompt += LAYOUT_CONSTRAINTS

    # Slides summary
    prompt += f"\n## Slides to Layout ({len(slides)} slides)\n\n"
    prompt += "For each slide, decide: layout_idx, element positions (left_emu, top_emu, width_emu, height_emu), font_size_pt.\n\n"

    for slide in slides:
        sn = slide.get("number", "?")
        st = slide.get("slide_type", "content")
        title = slide.get("title", "")
        stats = slide.get("stats", {})
        elements = slide.get("elements", [])

        # Compact slide summary
        elem_summary = []
        for e in elements:
            et = e.get("type", "?")
            if et == "table":
                elem_summary.append(f"table({e.get('rows', '?')}r×{e.get('cols','?')}c, {e.get('char_count', stats.get('table_chars', '?'))}chars)")
            elif et == "code":
                elem_summary.append(f"code({e.get('line_count', '?')}lines, {e.get('language','')})")
            elif et == "mermaid":
                elem_summary.append(f"mermaid({e.get('width_px','?')}×{e.get('height_px','?')}px)")
            elif et == "bullets":
                elem_summary.append(f"bullets({e.get('count', len(e.get('items',[])))}items)")
            elif et == "text":
                text = e.get("text", "")
                elem_summary.append(f"text({len(text)}chars)")
            elif et == "numbered":
                elem_summary.append(f"numbered({e.get('count', len(e.get('items',[])))}items)")
            elif et == "quote":
                pass  # speaker notes, skip
            elif et == "heading":
                elem_summary.append(f"heading")

        prompt += f"### Slide {sn} [{st}] — {title}\n"
        prompt += f"Content: {', '.join(elem_summary) if elem_summary else '(empty)'}\n"
        prompt += f"Stats: {json.dumps({k:v for k,v in stats.items() if v})}\n\n"

    prompt += OUTPUT_FORMAT
    prompt += "\n\nNow output the complete layout JSON for ALL slides. ONE JSON object, no markdown fences, no explanation.\n"

    return prompt


# ── Schema Validation ───────────────────────────────────────────────────────

def validate_layout(layout_json):
    """Validate layout JSON structure. Returns (is_valid, errors_list)."""
    errors = []

    if not isinstance(layout_json, dict):
        return False, ["Root must be a JSON object"]

    if layout_json.get("version") != "2.0":
        errors.append("version must be '2.0'")

    slides = layout_json.get("slides", [])
    if not isinstance(slides, list):
        return False, ["'slides' must be an array"]

    valid_types = {"title", "text", "bullets", "table", "code", "mermaid_image"}

    for i, slide in enumerate(slides):
        sn = slide.get("slide_number", f"index_{i}")
        prefix = f"Slide {sn}"

        if "layout_idx" not in slide:
            errors.append(f"{prefix}: missing layout_idx")

        if "overflow_check" not in slide:
            errors.append(f"{prefix}: missing overflow_check")
        elif slide["overflow_check"] not in ("pass", "fail"):
            errors.append(f"{prefix}: overflow_check must be 'pass' or 'fail'")

        for j, elem in enumerate(slide.get("elements", [])):
            ep = f"{prefix}, element[{j}]"
            etype = elem.get("type")

            if etype not in valid_types:
                errors.append(f"{ep}: unknown type '{etype}'")
                continue

            if etype == "title":
                if "placeholder_idx" not in elem:
                    errors.append(f"{ep}: title requires placeholder_idx")

            elif etype in ("text", "bullets", "code"):
                for coord in ("left_emu", "top_emu", "width_emu", "height_emu"):
                    if coord not in elem:
                        errors.append(f"{ep}: {etype} requires {coord}")

            elif etype == "table":
                for coord in ("left_emu", "top_emu", "width_emu", "height_emu"):
                    if coord not in elem:
                        errors.append(f"{ep}: table requires {coord}")
                if "rows" not in elem or "cols" not in elem:
                    errors.append(f"{ep}: table requires rows and cols")
                if "data" not in elem:
                    errors.append(f"{ep}: table requires data array")

            elif etype == "mermaid_image":
                for coord in ("left_emu", "top_emu", "width_emu", "height_emu"):
                    if coord not in elem:
                        errors.append(f"{ep}: mermaid_image requires {coord}")
                if "image_path" not in elem:
                    errors.append(f"{ep}: mermaid_image requires image_path")

            # Check font_size_pt range
            if "font_size_pt" in elem:
                fs = elem["font_size_pt"]
                if not (8 <= fs <= 44):
                    errors.append(f"{ep}: font_size_pt {fs} out of range [8, 44]")

    return len(errors) == 0, errors


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="LLM Layout Engine for company-pptx-generator 2.0")
    parser.add_argument("slides", nargs="?", help="Path to slides_parsed.json")
    parser.add_argument("template", nargs="?", help="Path to template_analysis.json")
    parser.add_argument("-o", "--output", help="Output path for layout_decisions.json")
    parser.add_argument("--prompt", action="store_true", help="Output the LLM prompt to stdout")
    parser.add_argument("--validate", help="Validate an existing layout JSON file")
    parser.add_argument("--fallback", action="store_true", help="Skip LLM, use fallback_engine directly")
    args = parser.parse_args()

    # --validate mode
    if args.validate:
        with open(args.validate, 'r', encoding='utf-8') as f:
            layout = json.load(f)
        valid, errors = validate_layout(layout)
        if valid:
            print(f"[layout_engine] Validation PASSED: {len(layout.get('slides', []))} slides")
        else:
            print(f"[layout_engine] Validation FAILED ({len(errors)} errors):")
            for e in errors[:20]:
                print(f"  - {e}")
        sys.exit(0 if valid else 1)

    # Need slides + template for other modes
    if not args.slides:
        parser.print_help()
        sys.exit(1)

    with open(args.slides, 'r', encoding='utf-8') as f:
        slides_data = json.load(f)

    template_analysis = {}
    if args.template and os.path.exists(args.template):
        with open(args.template, 'r', encoding='utf-8') as f:
            template_analysis = json.load(f)

    # --prompt mode: output the prompt for Claude to read
    if args.prompt:
        prompt = build_prompt(slides_data, template_analysis)
        print(prompt)
        sys.exit(0)

    # Default mode: try LLM, fallback on failure
    # For now, always use fallback (LLM integration via session Claude is manual)
    if args.fallback:
        print("[layout_engine] Using fallback_engine (--fallback flag)")
    else:
        print("[layout_engine] LLM mode not yet automated. Use:")
        print("  1. python layout_engine.py ... --prompt > prompt.md")
        print("  2. Ask Claude to read prompt.md and generate layout JSON")
        print("  3. python layout_engine.py --validate layout.json")
        print("  Falling back to fallback_engine...")

    # Invoke fallback_engine.py
    fallback_script = os.path.join(SCRIPT_DIR, "fallback_engine.py")
    output_path = args.output or "layout_decisions.json"

    cmd = [
        sys.executable, fallback_script,
        args.slides,
        args.template or "",
        output_path,
    ]
    subprocess.run(cmd, check=True)


if __name__ == '__main__':
    main()
