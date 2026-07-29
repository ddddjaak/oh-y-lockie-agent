#!/usr/bin/env python3
"""
Render Mermaid diagrams in slide data to PNG images.

Usage: python render_mermaid.py slides.json [mermaid_images_dir]

Reads the JSON from parse_slides.py, finds all mermaid blocks,
renders them to PNG, and updates the JSON with image paths AND native dimensions.

Enhanced for 2.0: injects width_px/height_px into each mermaid element
so layout_engine can compute correct EMU coordinates.
"""

import sys
import os
import json
import hashlib

# Mermaid image settings
MERMAID_WIDTH = 1280
MERMAID_HEIGHT = 720
MERMAID_SCALE = 2.0


def get_image_dimensions(png_path):
    """Read PNG dimensions using PIL. Returns (width_px, height_px) or (None, None)."""
    try:
        from PIL import Image
        img = Image.open(png_path)
        return img.size  # (width, height)
    except Exception:
        return None, None


def render_mermaid(code, output_dir, width=MERMAID_WIDTH, height=MERMAID_HEIGHT, scale=MERMAID_SCALE):
    """Render mermaid code to PNG. Returns (path, width_px, height_px) or (None, None, None)."""
    try:
        from mermaid import Mermaid
    except ImportError:
        print("  Warning: mermaid-py not installed. Run: pip install mermaid-py")
        return None, None, None

    # Generate unique filename
    code_hash = hashlib.md5(code.encode()).hexdigest()[:12]
    png_file = os.path.join(output_dir, f"mermaid_{code_hash}.png")

    # Skip if already rendered (check dimensions too)
    if os.path.exists(png_file) and os.path.getsize(png_file) > 100:
        w, h = get_image_dimensions(png_file)
        if w and h:
            return png_file, w, h

    try:
        m = Mermaid(code, width=width, height=height, scale=scale)
        m.to_png(png_file)

        if os.path.exists(png_file) and os.path.getsize(png_file) > 100:
            w, h = get_image_dimensions(png_file)
            return png_file, w, h
        else:
            print("  Warning: mermaid returned empty image")
            return None, None, None
    except Exception as e:
        print(f"  Warning: mermaid render failed: {str(e)[:100]}")
        return None, None, None


def main():
    if len(sys.argv) < 2:
        print("Usage: python render_mermaid.py slides.json [mermaid_images_dir]")
        sys.exit(1)

    slides_json = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else 'mermaid_images'
    os.makedirs(output_dir, exist_ok=True)

    with open(slides_json, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Support both old format (flat array) and new format ({meta, slides})
    if isinstance(data, list):
        slides = data
    else:
        slides = data.get('slides', [])

    total = 0
    rendered = 0

    for slide in slides:
        for elem in slide.get('elements', []):
            if elem.get('type') == 'mermaid':
                total += 1
                png_path, width_px, height_px = render_mermaid(elem['code'], output_dir)

                if png_path:
                    # Inject image path and dimensions
                    elem['image_path'] = png_path
                    elem['width_px'] = width_px
                    elem['height_px'] = height_px
                    rendered += 1
                    print(f"  Rendered: {os.path.basename(png_path)} ({width_px}x{height_px}px)")
                else:
                    print(f"  Skipped mermaid block in Slide {slide['number']}")

    # Save updated JSON (preserve original format: dict or list)
    output_data = data if isinstance(data, dict) else slides
    with open(slides_json, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"[render_mermaid] {rendered}/{total} mermaid diagrams rendered")


if __name__ == '__main__':
    main()
