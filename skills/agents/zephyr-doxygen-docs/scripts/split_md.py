"""
Split a Markdown file into Doxygen \\page files by chapter boundaries.

Usage:
    python split_md.py <input.md> <output_dir> [--project-name "Name"] [--single-page]

Detects lines starting with '# ' (H1) as chapter boundaries. Everything before
the first H1 becomes the mainpage frontmatter. Each chapter gets its own .md
file with a \\page header. A mainpage.md with \\subpage links is generated.

Options:
    --project-name     Override the project name shown on the mainpage
    --single-page      Treat entire file as one page (no splitting)
"""
import sys
import os
import re
import argparse


def slugify(text):
    """Create a Doxygen-safe page ID from a title."""
    # Keep alphanumeric and Chinese chars, replace spaces with underscore
    s = re.sub(r'[^\w\u4e00-\u9fff]', '_', text, flags=re.UNICODE)
    s = re.sub(r'_+', '_', s).strip('_')
    return s or 'chapter'


def split_md(input_path, output_dir, project_name=None, single_page=False):
    os.makedirs(output_dir, exist_ok=True)

    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.split('\n')

    # Find H1 chapter boundaries
    boundaries = []
    for i, line in enumerate(lines):
        if re.match(r'^# ', line):
            boundaries.append((i, line.strip()))

    if not boundaries or single_page:
        # Treat entire file as one page
        page_id = "main_content"
        cleaned = content.strip()
        if project_name:
            cleaned = f"\\page {page_id} {project_name}\n\n{cleaned}"
        else:
            cleaned = f"\\page {page_id} Documentation\n\n{cleaned}"
        out_path = os.path.join(output_dir, f"{page_id}.md")
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(cleaned)

        mainpage = "\\mainpage\n\n"
        if project_name:
            mainpage += f"# {project_name}\n\n"
        mainpage += f"\\subpage {page_id}\n"
        with open(os.path.join(output_dir, 'mainpage.md'), 'w', encoding='utf-8') as f:
            f.write(mainpage)
        return [page_id]

    # Extract frontmatter (before first H1)
    frontmatter_lines = lines[:boundaries[0][0]]
    frontmatter_text = '\n'.join(frontmatter_lines).strip()

    # Create chapter files
    chapters = []
    for idx, (start, title_line) in enumerate(boundaries):
        title = title_line[2:].strip()
        page_id = f"ch{idx + 1}_{slugify(title)[:40]}"

        end = boundaries[idx + 1][0] if idx + 1 < len(boundaries) else len(lines)
        chapter_lines = lines[start:end]
        chapter_text = '\n'.join(chapter_lines).strip()

        # Wrap with \page header
        output = f"\\page {page_id} {title}\n\n{chapter_text}\n"
        out_path = os.path.join(output_dir, f"{page_id}.md")
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(output)

        chapters.append((page_id, title))
        print(f"  Created: {out_path} ({len(chapter_lines)} lines)")

    # Create mainpage.md
    mainpage_parts = ["\\mainpage\n"]
    if project_name:
        mainpage_parts.append(f"# {project_name}\n")
    if frontmatter_text:
        mainpage_parts.append(frontmatter_text)
        mainpage_parts.append("\n")
    mainpage_parts.append("## 文档目录\n\n")
    for page_id, title in chapters:
        mainpage_parts.append(f"\\subpage {page_id}\n")
    mainpage_parts.append("")

    mainpage_path = os.path.join(output_dir, 'mainpage.md')
    with open(mainpage_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(mainpage_parts))
    print(f"  Created: {mainpage_path}")

    return [c[0] for c in chapters]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Split MD into Doxygen pages')
    parser.add_argument('input', help='Input markdown file')
    parser.add_argument('output_dir', help='Output directory for page files')
    parser.add_argument('--project-name', default=None, help='Project name for mainpage')
    parser.add_argument('--single-page', action='store_true', help='Do not split, one page')
    args = parser.parse_args()

    page_ids = split_md(args.input, args.output_dir, args.project_name, args.single_page)
    print(f"\nDone. {len(page_ids)} pages created in {args.output_dir}/")
