#!/usr/bin/env python3
"""
One-click conversion: Markdown slides -> Company-standard PowerPoint (.pptx) + HTML preview.

company-pptx-generator 2.0 pipeline:
  1. parse_slides.py         — Parse markdown → slides_parsed.json
  2. analyze_template.py     — Extract template → template_analysis.json (parallel with 1)
  3. render_mermaid.py       — Render diagrams → PNG + inject dimensions
  4. layout_engine.py        — LLM layout decisions → layout_decisions.json
                               (falls back to fallback_engine.py on failure)
  5. create_pptx.py          — Render PPTX from layout JSON
  6. preview_html.py         — Render HTML preview from layout JSON

Usage:
  python convert.py input.md [output.pptx] [template.pptx]

Flags:
  --skip-layout     Skip LLM layout, use fallback_engine directly
  --preview-only    Only generate HTML preview, no PPTX
  --keep-temp       Keep intermediate JSON files for debugging
  --no-preview      Skip HTML preview generation

Environment:
  COMPANY_TEMPLATE  Path to company template pptx (fallback if not in CLI args)
"""

import sys
import os
import subprocess
import tempfile
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)


def main():
    args = sys.argv[1:]

    # Parse flags
    skip_layout = "--skip-layout" in args
    preview_only = "--preview-only" in args
    keep_temp = "--keep-temp" in args
    no_preview = "--no-preview" in args

    # Remove flags from positional args
    positional = [a for a in args if not a.startswith("--")]

    if len(positional) < 1:
        print("Usage: python convert.py input.md [output.pptx] [template.pptx]")
        print("Flags: --skip-layout --preview-only --keep-temp --no-preview")
        sys.exit(1)

    input_md = positional[0]
    if not os.path.exists(input_md):
        print(f"[convert] ERROR: Input file not found: {input_md}")
        sys.exit(1)

    # Output paths
    if len(positional) > 1:
        output_pptx = positional[1]
    else:
        base = os.path.splitext(os.path.basename(input_md))[0]
        output_pptx = os.path.join(os.path.dirname(input_md) or '.', base + '.pptx')

    output_html = output_pptx.rsplit('.', 1)[0] + '.html'

    # Template: CLI arg > env var
    template_path = None
    if len(positional) > 2:
        template_path = positional[2]
    else:
        env_template = os.environ.get("COMPANY_TEMPLATE", "")
        if env_template and os.path.exists(env_template):
            template_path = env_template

    # Temp directory for intermediate files
    tmpdir = tempfile.mkdtemp(prefix="pptx_gen_")
    slides_json = os.path.join(tmpdir, "slides_parsed.json")
    template_json = os.path.join(tmpdir, "template_analysis.json")
    layout_json = os.path.join(tmpdir, "layout_decisions.json")
    mermaid_dir = os.path.join(SKILL_DIR, "mermaid_images")
    os.makedirs(mermaid_dir, exist_ok=True)

    start_time = time.time()

    try:
        # ── Step 1+2: Parse slides + Analyze template (PARALLEL) ─────────
        print("[convert] [1/6] Parsing slides...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, "parse_slides.py"),
            input_md, slides_json,
        ], check=True)

        print("[convert] [2/6] Analyzing template...")
        if template_path:
            subprocess.run([
                sys.executable,
                os.path.join(SCRIPT_DIR, "analyze_template.py"),
                template_path, template_json,
            ], check=True)
        else:
            print("[convert]   No template provided, using defaults")
            # Create minimal template_analysis with defaults
            import json
            with open(template_json, 'w', encoding='utf-8') as f:
                json.dump({
                    "slide_width_emu": 12192000,
                    "slide_height_emu": 6858000,
                    "layouts": [],
                    "content_area": {},
                }, f)

        # ── Step 3: Render Mermaid ──────────────────────────────────────
        print("[convert] [3/6] Rendering Mermaid diagrams...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, "render_mermaid.py"),
            slides_json, mermaid_dir,
        ], check=True)

        # ── Step 4: Layout Engine ───────────────────────────────────────
        layout_cmd = [
            sys.executable,
            os.path.join(SCRIPT_DIR, "layout_engine.py"),
            slides_json, template_json,
            "-o", layout_json,
        ]
        if skip_layout:
            layout_cmd.append("--fallback")
            print("[convert] [4/6] Layout (fallback engine)...")
        else:
            print("[convert] [4/6] Layout (LLM + fallback)...")

        subprocess.run(layout_cmd, check=True)

        # ── Step 5: Generate PPTX ───────────────────────────────────────
        if not preview_only:
            print("[convert] [5/6] Generating PPTX...")
            pptx_cmd = [
                sys.executable,
                os.path.join(SCRIPT_DIR, "create_pptx.py"),
                layout_json, output_pptx,
            ]
            if template_path:
                pptx_cmd.append(template_path)
            subprocess.run(pptx_cmd, check=True)
            print(f"[convert]   PPTX saved: {output_pptx}")
        else:
            print("[convert] [5/6] Skipped (--preview-only)")

        # ── Step 6: Generate HTML Preview ───────────────────────────────
        if not no_preview:
            print("[convert] [6/6] Generating HTML preview...")
            preview_cmd = [
                sys.executable,
                os.path.join(SCRIPT_DIR, "preview_html.py"),
                layout_json, output_html,
            ]
            subprocess.run(preview_cmd, check=True)
            print(f"[convert]   HTML saved: {output_html}")
        else:
            print("[convert] [6/6] Skipped (--no-preview)")

        elapsed = time.time() - start_time
        print(f"\n[convert] Done in {elapsed:.1f}s")
        if not preview_only:
            print(f"[convert] PPTX: {output_pptx}")
        if not no_preview:
            print(f"[convert] HTML: {output_html}")

        # Keep temp files for debugging
        if keep_temp:
            print(f"[convert] Temp files kept at: {tmpdir}")
            print(f"  slides_parsed.json:  {slides_json}")
            print(f"  template_analysis.json: {template_json}")
            print(f"  layout_decisions.json:  {layout_json}")

    except subprocess.CalledProcessError as e:
        print(f"[convert] ERROR at step: {e}")
        if keep_temp:
            print(f"[convert] Temp files for debugging: {tmpdir}")
        sys.exit(1)
    finally:
        if not keep_temp:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == '__main__':
    main()
