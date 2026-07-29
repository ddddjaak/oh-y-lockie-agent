"""
Preprocess markdown before pandoc conversion:
1. Remove heading numbers (1.1, 1.1.1, etc.) to avoid duplicate numbering with template
2. Convert mermaid code blocks to images

Usage: python preprocess_markdown.py input.md [output.md]
"""
import sys
import re
import os
import subprocess
import tempfile
import hashlib

# Mermaid image settings
# scale: 1-3, higher = clearer but slower (1=10s/img, 2=6s/img, 3=10s/img)
MERMAID_WIDTH = 1200     # Image width in pixels
MERMAID_HEIGHT = 800     # Image height in pixels
MERMAID_SCALE = 2.0      # Scale factor (1.0-3.0)

def remove_heading_numbers(content):
    """Remove arabic numbering from headings like '## 1.1 Title' -> '## Title'"""
    # Match heading lines with numbers like: # 1., ## 1.1, ### 1.1.1, etc.
    # Only remove leading numbers, preserve Chinese numbers (一、二、三)
    pattern = r'^(#{1,6}\s+)(\d+\.)+\s+'
    result = re.sub(pattern, r'\1', content, flags=re.MULTILINE)
    return result

def extract_mermaid_blocks(content):
    """Extract mermaid code blocks and return list of (start, end, code) tuples."""
    blocks = []
    pattern = r'```mermaid\s*\n(.*?)```'
    for match in re.finditer(pattern, content, re.DOTALL):
        blocks.append({
            'start': match.start(),
            'end': match.end(),
            'code': match.group(1).strip(),
            'full_match': match.group(0)
        })
    return blocks

def convert_mermaid_to_image(code, output_dir, width=MERMAID_WIDTH, height=MERMAID_HEIGHT, scale=MERMAID_SCALE):
    """Convert mermaid code to PNG image using mermaid-py."""
    try:
        from mermaid import Mermaid
    except ImportError:
        print(f"  Warning: mermaid-py not installed. Run: pip install mermaid-py")
        return None

    # Generate unique filename based on code content and settings
    settings_hash = hashlib.md5(f"{width}{height}{scale}".encode()).hexdigest()[:6]
    code_hash = hashlib.md5(code.encode()).hexdigest()[:12]
    png_file = os.path.join(output_dir, f"mermaid_{code_hash}_{settings_hash}.png")

    # Check if already converted
    if os.path.exists(png_file) and os.path.getsize(png_file) > 100:
        # Return with forward slashes for pandoc compatibility
        return png_file.replace('\\', '/')

    try:
        m = Mermaid(code, width=width, height=height, scale=scale)
        m.to_png(png_file)

        if os.path.exists(png_file) and os.path.getsize(png_file) > 100:
            # Convert backslashes to forward slashes for pandoc compatibility
            return png_file.replace('\\', '/')
        else:
            print(f"  Warning: mermaid conversion returned empty image")
            return None
    except Exception as e:
        print(f"  Warning: mermaid conversion failed: {str(e)[:100]}")
        return None

def process_mermaid_blocks(content, output_dir):
    """Find and convert all mermaid blocks to images."""
    blocks = extract_mermaid_blocks(content)
    if not blocks:
        return content

    print(f"Found {len(blocks)} mermaid diagram(s)")

    # Process blocks in reverse order to maintain positions
    for block in reversed(blocks):
        png_path = convert_mermaid_to_image(block['code'], output_dir)
        if png_path and os.path.exists(png_path):
            # Replace mermaid block with image reference
            img_ref = f"![mermaid diagram]({png_path})"
            content = content[:block['start']] + img_ref + content[block['end']:]
            print(f"  Converted mermaid block to: {os.path.basename(png_path)}")
        else:
            print(f"  Skipped mermaid block (conversion failed)")

    return content

def main():
    if len(sys.argv) < 2:
        print("Usage: python preprocess_markdown.py input.md [output.md]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else input_path

    # Create temp directory for mermaid images - use absolute path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    skill_dir = os.path.dirname(script_dir)
    mermaid_dir = os.path.join(skill_dir, 'mermaid_images')
    os.makedirs(mermaid_dir, exist_ok=True)
    # Ensure absolute path with proper separators
    mermaid_dir = os.path.abspath(mermaid_dir)
    print(f"Mermaid images dir: {mermaid_dir}")

    print(f"Reading: {input_path}")
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Step 1: Remove heading numbers
    content = remove_heading_numbers(content)
    print("Removed heading numbers")

    # Step 1.5: Replace --- horizontal rules to avoid pandoc YAML parse error
    # pandoc 3.x may interpret --- as YAML metadata block delimiters
    content = re.sub(r'^\-\-\-$', '***', content, flags=re.MULTILINE)

    # Step 2: Convert mermaid blocks to images
    content = process_mermaid_blocks(content, mermaid_dir)

    # Write output
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Saved: {output_path}")

if __name__ == '__main__':
    main()
