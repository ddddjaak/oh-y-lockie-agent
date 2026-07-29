#!/usr/bin/env python3
"""
Parse markdown slide document into structured JSON data.

Usage: python parse_slides.py input.md [output.json]

Input format:
  ## Slide N — Title (each is one slide)
  Supports optional YAML frontmatter between slides:
    ---
    slide_type: comparison
    layout_hint: table-first
    ---
  Supports slide numbers with suffixes: ## Slide 4b — Title

Output: JSON with meta + slides array, each with content stats and semantic type.
"""

import sys
import re
import json
import yaml


# ── YAML Frontmatter ────────────────────────────────────────────────────────

def extract_frontmatter(content):
    """
    Extract YAML frontmatter from the beginning of slide content.
    Returns (frontmatter_dict, remaining_content).
    Returns ({}, content) if no frontmatter found.
    """
    lines = content.strip().split('\n')
    if not lines or lines[0].strip() != '---':
        return {}, content

    # Find closing ---
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end_idx = i
            break

    if end_idx is None:
        return {}, content

    yaml_text = '\n'.join(lines[1:end_idx])
    remaining = '\n'.join(lines[end_idx + 1:])

    try:
        fm = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError:
        fm = {}

    return fm, remaining


# ── Content Statistics ──────────────────────────────────────────────────────

def compute_stats(elements):
    """Compute content statistics for LLM layout decisions."""
    stats = {
        "total_chars": 0,
        "table_rows": 0,
        "table_cols": 0,
        "code_lines": 0,
        "mermaid_count": 0,
        "bullet_items": 0,
        "numbered_items": 0,
        "text_blocks": 0,
        "quote_blocks": 0,
    }

    for elem in elements:
        etype = elem.get("type", "")

        if etype == "table":
            md = elem.get("markdown", "")
            rows = [r for r in md.strip().split('\n') if '|' in r]
            stats["table_rows"] = max(stats["table_rows"], len(rows) - 1)  # minus separator
            # Count columns from header row
            if rows:
                header_cells = [c for c in rows[0].split('|') if c.strip()]
                stats["table_cols"] = max(stats["table_cols"], len(header_cells))
            stats["total_chars"] += len(md)

        elif etype == "code":
            code = elem.get("code", "")
            stats["code_lines"] += code.count('\n') + 1 if code else 0
            stats["total_chars"] += len(code)

        elif etype == "mermaid":
            code = elem.get("code", "")
            stats["mermaid_count"] += 1
            stats["total_chars"] += len(code)

        elif etype == "bullets":
            items = elem.get("items", [])
            stats["bullet_items"] += len(items)
            stats["total_chars"] += sum(len(item) for item in items)

        elif etype == "numbered":
            items = elem.get("items", [])
            stats["numbered_items"] += len(items)
            stats["total_chars"] += sum(len(item) for item in items)

        elif etype == "text":
            text = elem.get("text", "")
            stats["text_blocks"] += 1
            stats["total_chars"] += len(text)

        elif etype == "quote":
            text = elem.get("text", "")
            stats["quote_blocks"] += 1
            stats["total_chars"] += len(text)

        elif etype == "heading":
            stats["total_chars"] += len(elem.get("text", ""))

    return stats


# ── Slide Type Inference ────────────────────────────────────────────────────

def infer_slide_type(slide_num_str, slide_index, total_slides, elements, part_title):
    """
    Auto-infer slide_type from content when no frontmatter.
    Priority: elements content > position (first/last) > default
    """
    has_table = any(e["type"] == "table" for e in elements)
    has_mermaid = any(e["type"] == "mermaid" for e in elements)
    has_code = any(e["type"] == "code" for e in elements)
    has_bullets = any(e["type"] == "bullets" for e in elements)
    has_quote = any(e["type"] == "quote" for e in elements)
    element_count = len(elements)

    # Position-based: use list index, not slide number
    # (slide numbers may have suffixes like 4b, so len(matches) isn't the last slide number)
    if slide_index == 0:
        return "cover"
    if slide_index >= total_slides - 1:
        return "end"

    # Section divider: has Part header, very few elements
    if part_title and not has_table and not has_mermaid and not has_code:
        return "section"

    # Content-based (priority order)
    if has_table:
        return "comparison"
    if has_mermaid and not has_table:
        return "chart"
    if has_code and not has_table and not has_mermaid:
        return "code"
    if has_bullets and element_count <= 3:
        return "content"

    # Default
    return "content"


# ── Element Parser (unchanged from original, with minor enhancements) ───────

def parse_slide_content(content):
    """Parse a slide's markdown content into structured elements."""
    elements = []
    lines = content.strip().split('\n')
    i = 0

    while i < len(lines):
        line = lines[i]

        # Skip empty lines
        if not line.strip():
            i += 1
            continue

        # Code block
        if line.strip().startswith('```'):
            lang = line.strip()[3:].strip()
            if lang == 'mermaid':
                mermaid_lines = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith('```'):
                    mermaid_lines.append(lines[i])
                    i += 1
                i += 1  # skip closing ```
                code_text = '\n'.join(mermaid_lines).strip()
                elements.append({
                    'type': 'mermaid',
                    'code': code_text,
                    'char_count': len(code_text),
                })
            else:
                code_lines = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith('```'):
                    code_lines.append(lines[i])
                    i += 1
                i += 1  # skip closing ```
                code_text = '\n'.join(code_lines).strip()
                elements.append({
                    'type': 'code',
                    'language': lang,
                    'code': code_text,
                    'line_count': code_text.count('\n') + 1 if code_text else 0,
                    'char_count': len(code_text),
                })
            continue

        # Table
        if '|' in line and i + 1 < len(lines) and '---' in lines[i + 1]:
            table_lines = []
            while i < len(lines) and '|' in lines[i]:
                table_lines.append(lines[i])
                i += 1
            md = '\n'.join(table_lines)
            # Count rows (exclude separator line)
            data_rows = [r for r in table_lines if '---' not in r.replace('|', '').replace(' ', '').replace('-', '') or r == table_lines[0]]
            elements.append({
                'type': 'table',
                'markdown': md,
                'rows': len([r for r in table_lines if '|' in r]) - 1,  # minus separator
            })
            continue

        # Bullet list
        if line.strip().startswith('- ') or line.strip().startswith('* '):
            items = []
            while i < len(lines) and (lines[i].strip().startswith('- ') or lines[i].strip().startswith('* ')):
                items.append(lines[i].strip()[2:].strip())
                i += 1
            elements.append({
                'type': 'bullets',
                'items': items,
                'count': len(items),
            })
            continue

        # Numbered list
        if re.match(r'^\d+\.\s', line.strip()):
            items = []
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i].strip()):
                items.append(re.sub(r'^\d+\.\s+', '', lines[i].strip()))
                i += 1
            elements.append({
                'type': 'numbered',
                'items': items,
                'count': len(items),
            })
            continue

        # Heading (sub-heading within slide)
        if line.startswith('###'):
            elements.append({
                'type': 'heading',
                'level': 3,
                'text': line.lstrip('#').strip(),
            })
            i += 1
            continue

        # Blockquote (speaker notes)
        if line.strip().startswith('>'):
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                quote_lines.append(lines[i].strip().lstrip('>').strip())
                i += 1
            elements.append({
                'type': 'quote',
                'text': '\n'.join(quote_lines),
            })
            continue

        # Horizontal rule
        if line.strip() in ('---', '***', '___'):
            i += 1
            continue

        # Regular text
        text_lines = []
        while (i < len(lines) and lines[i].strip() and
               not lines[i].strip().startswith(('```', '|', '- ', '* ', '###', '>', '---', '***'))):
            text_lines.append(lines[i].strip())
            i += 1
        if text_lines:
            text = '\n'.join(text_lines)
            elements.append({
                'type': 'text',
                'text': text,
                'line_count': len(text_lines),
                'char_count': len(text),
            })

    return elements


# ── Main Parser ─────────────────────────────────────────────────────────────

def parse_slides_file(filepath):
    """Parse a markdown file into a list of slides with semantic metadata."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract document title from first line (H1)
    title_match = re.match(r'^#\s+(.+)$', content.strip(), re.MULTILINE)
    doc_title = title_match.group(1).strip() if title_match else None

    # Split by slide headers: ## Slide N — Title (support suffixes like 4b)
    slide_pattern = r'^## Slide\s+(\d+[a-z]?)\s*[—–-]\s*(.+)$'
    matches = list(re.finditer(slide_pattern, content, re.MULTILINE))

    if not matches:
        print("[parse_slides] WARN: No slides found matching '## Slide N — Title'")
        return {"meta": {"title": doc_title, "total_slides": 0}, "slides": []}

    slides = []
    for idx, match in enumerate(matches):
        slide_num_str = match.group(1)
        slide_title = match.group(2).strip()

        # Slide number: try int first, keep string for suffixed numbers (4b, 16b)
        try:
            slide_num = int(slide_num_str)
        except ValueError:
            slide_num = slide_num_str

        # Get slide content (from after this header to before next header)
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(content)
        slide_content = content[start:end]

        # Extract YAML frontmatter
        frontmatter, slide_content = extract_frontmatter(slide_content)

        # Capture Part headers (## Part N: Title or # Part N: Title)
        part_match = re.search(r'^#+\s*Part\s+\d+[：:]\s*(.+)$', slide_content, re.MULTILINE)
        part_title = part_match.group(1).strip() if part_match else None

        # Remove Part headers from content
        if part_match:
            slide_content = slide_content[:part_match.start()] + slide_content[part_match.end():]

        # Parse elements
        elements = parse_slide_content(slide_content)

        # Compute stats
        stats = compute_stats(elements)

        # Determine slide_type
        total = len(matches)
        slide_type = frontmatter.get("slide_type") or infer_slide_type(
            slide_num_str, idx, total, elements, part_title
        )
        layout_hint = frontmatter.get("layout_hint")

        slides.append({
            "number": slide_num_str,
            "title": slide_title,
            "part": part_title,
            "slide_type": slide_type,
            "layout_hint": layout_hint,
            "elements": elements,
            "stats": stats,
        })

    return {
        "meta": {
            "title": doc_title,
            "total_slides": len(slides),
        },
        "slides": slides,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python parse_slides.py input.md [output.json]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    result = parse_slides_file(input_path)

    json_str = json.dumps(result, ensure_ascii=False, indent=2)

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(json_str)
        print(f"[parse_slides] {result['meta']['total_slides']} slides -> {output_path}")
    else:
        print(json_str)


if __name__ == '__main__':
    main()
