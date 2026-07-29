"""
One-click conversion: Markdown -> Company-standard Word document.

Usage: python convert.py input.md [output.docx]

Environment variables:
  COMPANY_TEMPLATE    Path to company template docx (default: assets/application_notes.docx)
"""
import sys
import os
import subprocess
import tempfile
import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
TEMPLATE_PATH = os.environ.get(
    "COMPANY_TEMPLATE",
    os.path.join(SKILL_DIR, 'assets', 'application_notes.docx')
)


def main():
    if len(sys.argv) < 2:
        print("Usage: python convert.py input.md [output.docx]")
        print("  COMPANY_TEMPLATE=/path/to/template.docx  (optional)")
        sys.exit(1)

    input_md = sys.argv[1]
    if not os.path.exists(input_md):
        print("Error: Input file not found: %s" % input_md)
        sys.exit(1)

    if len(sys.argv) > 2:
        output_docx = sys.argv[2]
    else:
        base = os.path.splitext(os.path.basename(input_md))[0]
        output_docx = os.path.join(os.path.dirname(input_md) or '.', base + '.docx')

    # Get the markdown's directory for image resource path resolution
    md_dir = os.path.dirname(os.path.abspath(input_md)) or '.'
    temp_md = tempfile.mktemp(suffix='.md')

    try:
        # Step 1: Preprocess — strip heading numbers (avoid duplicate with template auto-numbering),
        # convert --- to ***, handle mermaid blocks
        print("[1/8] Preprocessing markdown...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, 'preprocess_markdown.py'),
            input_md,
            temp_md
        ], check=True)

        # Step 2: pandoc — convert with template, resolve images from markdown directory
        print("[2/8] Converting to docx (template: %s)..." % os.path.basename(TEMPLATE_PATH))
        subprocess.run([
            'pandoc',
            temp_md,
            '-o', output_docx,
            '--reference-doc=%s' % TEMPLATE_PATH,
            '--resource-path=%s' % md_dir,
        ], check=True)

        # Step 3: Insert TOC after "目录" heading (instead of style_cover_page which inserts before H1)
        print("[3/8] Inserting TOC...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, 'insert_toc.py'),
            output_docx
        ], check=True)

        # Step 4: Apply fonts (EN=Arial, CN=微软雅黑, Code=Cascadia Code)
        print("[4/8] Applying fonts...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, 'setup_docx.py'),
            output_docx
        ], check=True)

        # Step 5: Style tables (dark blue header + alternating row colors)
        print("[5/8] Styling tables...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, 'style_tables.py'),
            output_docx
        ], check=True)

        # Step 6: Wrap code blocks (gray background + border)
        print("[6/8] Wrapping code blocks...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, 'wrap_code_blocks.py'),
            output_docx
        ], check=True)

        # Step 7: Center all images
        print("[7/8] Centering images...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, 'center_images.py'),
            output_docx
        ], check=True)

        # Step 8: Format cover title (微软雅黑 centered) if <cover-title> tag present
        print("[8/8] Formatting cover title...")
        subprocess.run([
            sys.executable,
            os.path.join(SCRIPT_DIR, 'style_cover_page.py'),
            output_docx
        ], check=True)

        print("\nDone: %s" % output_docx)

    except subprocess.CalledProcessError as e:
        print("Error during conversion: %s" % e)
        sys.exit(1)
    except FileNotFoundError as e:
        print("Error: %s" % e)
        print("Make sure pandoc is installed: https://pandoc.org/installing.html")
        sys.exit(1)
    finally:
        if os.path.exists(temp_md):
            os.remove(temp_md)


if __name__ == '__main__':
    main()
