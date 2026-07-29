---
name: zephyr-doxygen-docs
description: >
  Convert any Markdown document into a Zephyr-style multi-page Doxygen documentation site.
  Use this skill whenever the user wants to turn a markdown file into Doxygen HTML output,
  create Zephyr/ReadTheDocs-styled documentation, split a long markdown into Doxygen
  "Related Pages", or generate a Doxygen site from any .md (or .docx) document. Triggers
  on phrases like "make this into Doxygen", "convert MD to Doxygen", "generate Doxygen docs",
  "Zephyr-style documentation", "split into Doxygen pages", or any request involving
  markdown + Doxygen + HTML documentation.
---

# Zephyr-Style Doxygen Documentation Generator

You are a senior Zephyr documentation architect. Your task is to convert a user-provided Markdown document into a Doxygen-compilable multi-page documentation site styled to match the Zephyr Project's official documentation theme.

## Overview

The transformation pipeline is:

1. **Prepare** - If source is .docx, extract images first
2. **Split** - Scan .md for `# ` H1 chapter boundaries, split into separate page files
3. **Mainpage** - Generate `mainpage.md` with `\subpage` navigation
4. **Configure** - Generate a Doxyfile with Zephyr-style settings
5. **Style** - Copy the bundled Zephyr CSS into the workspace
6. **Build** - Run `doxygen Doxyfile` and report results

## Step-by-Step Workflow

### Step 1: Understand the input

Ask the user (or infer from context) these parameters. If unclear, use sensible defaults:

- **Project name**: shown in browser title and page headings
- **Project version**: optional version string (e.g., "V0.1", "3.7.0 LTS")
- **Project brief**: one-line description for the title bar
- **Logo path**: optional path to a logo image (PNG, max ~28px height recommended)
- **Image directories**: where to find images referenced in the .md
- **Output directory**: where to place the generated Doxygen site (default: `doxygen_output/`)

### Step 2: If source is .docx, extract images

If the input is a `.docx` file, first extract embedded images:

```bash
python -c "import zipfile; z=zipfile.ZipFile('input.docx'); [z.extract(m,'media/') for m in z.namelist() if 'media/' in m]"
```

Then convert .docx to .md:

```bash
pandoc input.docx -t markdown -o output.md
```

Note the `media/` directory as an image path for the Doxyfile.

### Step 3: Split the Markdown

Use the bundled `scripts/split_md.py` script. It detects lines starting with `# ` as chapter boundaries, extracts each chapter into its own `.md` file with a `\page` header, and generates a `mainpage.md` with `\subpage` links.

```bash
python <skill-base>/scripts/split_md.py <input.md> <pages-output-dir> --project-name "Your Project"
```

Options:
- `--project-name "Name"` — sets the H1 on the main page
- `--single-page` — don't split, keep as one page

What this creates in `<pages-output-dir>/`:

```
pages/
├── mainpage.md          ← \mainpage + \subpage links for all chapters
├── ch1_xxx.md           ← \page ch1_xxx 第一章标题
├── ch2_xxx.md           ← \page ch2_xxx 第二章标题
└── ...
```

Each chapter file starts with:
```markdown
\page chX_slug 章节标题

# 章节标题
...content...
```

The mainpage.md starts with:
```markdown
\mainpage
# Project Name
...frontmatter (abstract, version, scope)...

## 文档目录
\subpage ch1_xxx
\subpage ch2_xxx
```

### Step 4: Configure Doxygen

Use the bundled `scripts/configure_doxygen.py` script to generate the Doxyfile and copy the Zephyr CSS:

```bash
python <skill-base>/scripts/configure_doxygen.py <workspace-dir> <pages-dir> \
  --project-name "Project Name" \
  --project-version "V0.1" \
  --project-brief "Brief description" \
  --logo "path/to/logo.png" \
  --images "media/" "other/images/"
```

This will:
1. Create `<workspace-dir>/Doxyfile` with all settings configured
2. Copy the Zephyr CSS to `<workspace-dir>/doxygen_custom.css`
3. Set output directory to `<workspace-dir>/doxygen_output/`

Key Doxyfile settings it applies:

| Setting | Value | Why |
|---------|-------|-----|
| GENERATE_TREEVIEW | YES | Left sidebar navigation (Zephyr style) |
| DISABLE_INDEX | YES | Hide top tab bar (cleaner look) |
| GENERATE_LATEX | NO | Don't waste time on PDF build |
| SHOW_FILES / SHOW_NAMESPACES | NO | Hide irrelevant sections for doc-only projects |
| HTML_COLORSTYLE | LIGHT | White background |
| OUTPUT_LANGUAGE | Chinese | Chinese UI labels |

### Step 5: Handle logo display

The Zephyr CSS hides the project name/brief text in the title bar and shows only the logo (left-aligned). Behavior depends on whether a logo is provided:

- **Logo provided**: logo appears in the blue top bar, left side. The bar is ~36px tall.
- **No logo**: the blue bar collapses to nearly invisible — this is fine for minimal docs.

If the user wants to show a project title *instead of* a logo, or *alongside* it, customize the CSS. The relevant CSS rule is:
```css
#projectname, #projectbrief, #projectnumber, #projectalign { display: none; }
```
Remove or modify those selectors to show text.

### Step 6: Build

```bash
cd <workspace-dir>
doxygen Doxyfile
```

The HTML output lands in `<workspace-dir>/doxygen_output/html/`. Open `index.html` to view.

### Step 7: Report

After building, tell the user:
- Output location: `<workspace-dir>/doxygen_output/html/index.html`
- Number of pages created
- Any Doxygen warnings that might need attention

## Bundled Resources

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/split_md.py` | Split .md into Doxygen \page files by chapter |
| `scripts/configure_doxygen.py` | Generate Doxyfile + copy Zephyr CSS |

### Assets

| Asset | Purpose |
|-------|---------|
| `assets/zephyr.css` | Zephyr/ReadTheDocs-inspired CSS for Doxygen HTML output |

## Customization Guidance

### Changing colors
Edit the `:root` block in `doxygen_custom.css`:
```css
:root {
  --zephyr-blue: #3D578C;   /* Banner background */
  --zephyr-link: #2980B9;   /* Link color */
  --sidebar-bg: #f8f8f8;    /* Sidebar background */
  --text-color: #404040;    /* Body text */
}
```

### Showing project name in the banner
Remove these lines from the CSS:
```css
#projectname, #projectbrief, #projectnumber, #projectalign { display: none; }
```

### Adding admonitions (notes/warnings)
Add this to the CSS:
```css
div.note {
  border-left: 4px solid #2980B9;
  background: #e7f2fa;
  padding: 0.8em 1.2em;
}
```
Then use `<div class="note">...</div>` in your markdown.

## Common Issues

1. **"Doxygen not found"** — Install: `choco install doxygen.portable` (Windows) or `sudo apt install doxygen` (Linux)
2. **Images not rendering** — Add image directories with `--images` flag
3. **Chinese characters garbled** — Ensure .md files are UTF-8 encoded. Doxygen handles this correctly.
4. **Too many warnings** — Set `WARN_IF_UNDOCUMENTED = NO` (already done by default)
5. **Chapter split is wrong** — Run `split_md.py` with `--single-page` to keep everything as one page, then manually split
