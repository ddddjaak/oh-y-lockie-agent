#!/usr/bin/env python3
"""
preview_html.py — Generate self-contained HTML preview of PPTX slides from layout JSON.

Reads layout_decisions.json (same format used by create_pptx.py) and generates a
self-contained HTML file showing all slides as absolutely-positioned previews.

Usage:
    python preview_html.py <layout.json> [output.html] [--watch <source.md>]

The --watch flag monitors the source .md file, re-runs the full pipeline
(parse_slides -> render_mermaid -> fallback_engine) on change, and regenerates
the HTML. The browser auto-reloads via meta-refresh.

EMU-to-px conversion: html_px = emu / 9525 * 1.5
  - Slide width:  12192000 EMU -> 1920px
  - Slide height:  6858000 EMU -> 1080px
"""

import sys
import os
import json
import time
import shutil
import argparse
import subprocess
import tempfile

# ── Constants ─────────────────────────────────────────────────────────────────

SLIDE_WIDTH_EMU  = 12192000
SLIDE_HEIGHT_EMU =  6858000
SLIDE_WIDTH_PX   = 1920
SLIDE_HEIGHT_PX  = 1080
EMU_PER_PX_96DPI = 9525     # 914400 EMU/inch / 96 DPI
PREVIEW_SCALE    = 1.5      # so 12192000/9525*1.5 = 1920, 6858000/9525*1.5 = 1080


def emu_to_px(emu):
    """Convert EMU to HTML pixels at preview scale (1920x1080)."""
    return emu / EMU_PER_PX_96DPI * PREVIEW_SCALE


# ═══════════════════════════════════════════════════════════════════════════════
# HTML generation
# ═══════════════════════════════════════════════════════════════════════════════

def generate_html(layout_json_path, output_path):
    """Read layout JSON and write a self-contained HTML preview file.

    Args:
        layout_json_path: Path to layout_decisions.json
        output_path:      Output HTML file path
    """
    with open(layout_json_path, 'r', encoding='utf-8') as f:
        layout = json.load(f)

    slides = layout.get('slides', [])
    if not slides:
        print("[preview_html] WARN: No slides in layout JSON")
        return

    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    html = _build_full_html(slides, skill_dir)

    # Atomic write: temp file first, then rename
    out_dir = os.path.dirname(output_path) or '.'
    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.html', dir=out_dir)
    try:
        with os.fdopen(tmp_fd, 'w', encoding='utf-8') as f:
            f.write(html)
        if os.path.exists(output_path):
            os.unlink(output_path)
        shutil.move(tmp_path, output_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise

    print(f"[preview_html] {len(slides)} slides -> {os.path.abspath(output_path)}")


def _build_full_html(slides, skill_dir):
    """Compose the complete HTML document."""
    parts = []

    parts.append(_html_head())

    # Slide containers
    max_bottom_info = []
    for i, slide in enumerate(slides):
        slide_html, info = _build_slide_div(slide, i, len(slides), skill_dir)
        parts.append(slide_html)
        max_bottom_info.append(info)

    # Navigation bar
    parts.append(_nav_bar())

    # Inline script
    parts.append(_inline_script(len(slides)))

    parts.append('</body>\n</html>')
    return '\n'.join(parts)


# ── HTML head ─────────────────────────────────────────────────────────────────

def _html_head():
    return '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="2" id="meta-refresh">
<title>PPTX Preview</title>
<style>
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: #e8e8e8; color: #333;
  overflow: hidden; height: 100vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
#viewport {
  position: relative; overflow: hidden;
  box-shadow: 0 4px 24px rgba(0,0,0,0.3);
  background: #fff; flex-shrink: 0;
}
.slide-container {
  position: absolute; top:0; left:0;
  width: 1920px; height: 1080px;
  transform-origin: 0 0;
  display: none; background: #fff;
}
.slide-container.active { display: block; }

/* ── Element base ── */
.slide-el {
  position: absolute; overflow: hidden;
}

/* ── Title ── */
.slide-title {
  position: absolute;
  font-size: 28px; font-weight: bold;
  color: #1a1a1a; padding: 4px 0;
}

/* ── Text ── */
.slide-text {
  position: absolute;
  font-size: 16px; line-height: 1.5;
  color: #333; word-wrap: break-word;
  overflow: hidden;
}

/* ── Bullets ── */
.slide-bullets {
  position: absolute;
  font-size: 16px; line-height: 1.6;
  color: #333; overflow: hidden;
}
.slide-bullets ul {
  margin: 0; padding-left: 20px;
  list-style-type: disc;
}
.slide-bullets li {
  padding-left: 4px;
  line-height: 1.6;
}

/* ── Table ── */
.slide-table-wrap {
  position: absolute; overflow: hidden;
}
.slide-table {
  width: 100%; border-collapse: collapse;
  font-size: 13px; table-layout: fixed;
}
.slide-table thead th {
  background: #2F5496; color: #fff;
  font-weight: bold; padding: 6px 8px;
  text-align: center; border: 1px solid #1a3a6e;
}
.slide-table tbody td {
  padding: 4px 8px; border: 1px solid #ccc;
}
.slide-table tbody tr:nth-child(odd) td  { background: #D6E4F0; }
.slide-table tbody tr:nth-child(even) td { background: #fff; }

/* ── Code ── */
.slide-code-wrap {
  position: absolute; overflow: hidden;
}
.slide-code {
  background: #F5F5F5; border: 1px solid #BFBFBF;
  font-family: "Consolas", "Courier New", monospace;
  font-size: 13px; padding: 8px 12px; margin: 0;
  white-space: pre-wrap; word-break: break-all;
  width: 100%; height: 100%; overflow: hidden;
  line-height: 1.4;
}

/* ── Mermaid image ── */
.slide-mermaid {
  position: absolute; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: #fafafa; border: 1px solid #e0e0e0;
}
.slide-mermaid img {
  max-width: 100%; max-height: 100%;
  object-fit: contain;
}

/* ── Overflow warning ── */
.overflow-warning {
  border: 2px dashed red !important;
}

/* ── Per-slide info bar ── */
.slide-info {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 26px;
  background: #f0f0f0; border-top: 1px solid #ddd;
  font-size: 11px; line-height: 26px;
  padding: 0 12px; color: #888;
  display: flex; justify-content: space-between;
  font-family: "Consolas", "Courier New", monospace;
}
.slide-info .overflow-label {
  color: #d00; font-weight: bold;
}

/* ── Navigation bar ── */
#nav-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 16px; background: #333; color: #fff;
  font-size: 13px; width: 100%; min-height: 36px;
  flex-shrink: 0;
}
#nav-bar button {
  background: #555; color: #fff; border: none;
  padding: 4px 14px; cursor: pointer;
  border-radius: 3px; font-size: 12px;
}
#nav-bar button:hover { background: #777; }
#nav-bar button:disabled { opacity: 0.35; cursor: default; }
#nav-bar .counter { margin: 0 4px; font-variant-numeric: tabular-nums; }
#nav-bar .hint { font-size: 10px; color: #aaa; }
</style>
</head>
<body>
<div id="viewport">\n'''


# ── Slide builder ─────────────────────────────────────────────────────────────

def _build_slide_div(slide, index, total, skill_dir):
    """Build a single <div class="slide-container">."""
    slide_num = slide.get('slide_number', str(index + 1))
    elements = slide.get('elements', [])
    overflow = slide.get('overflow_check', 'pass')

    # Extract title text for info bar
    title_text = ''
    for e in elements:
        if e.get('type') == 'title':
            title_text = e.get('text', '')
            break

    # Compute maximum bottom among all elements
    max_bottom_emu = 0
    for e in elements:
        etype = e.get('type', '')
        if etype == 'title':
            continue  # placeholder-based, not counted
        top = e.get('top_emu', 0)
        h = e.get('height_emu', 0)
        bottom = top + h
        if bottom > max_bottom_emu:
            max_bottom_emu = bottom

    max_bottom_px = emu_to_px(max_bottom_emu)
    max_bottom_str = f"{max_bottom_px:.0f}px" if max_bottom_emu > 0 else "N/A"
    overflow_label = ' | <span class="overflow-label">OVERFLOW</span>' if overflow == 'fail' else ''

    parts = []
    active = ' active' if index == 0 else ''
    parts.append(f'<div class="slide-container{active}" id="slide-{index}" data-index="{index}">')

    for e in elements:
        parts.append(_build_element_html(e, skill_dir))

    # Info bar
    parts.append(
        f'<div class="slide-info">'
        f'<span>Slide {_esc(str(slide_num))} &mdash; {_esc(title_text)}</span>'
        f'<span>Max bottom: {max_bottom_str} / Slide height: {SLIDE_HEIGHT_PX}px{overflow_label}</span>'
        f'</div>'
    )

    parts.append('</div>')
    return '\n'.join(parts), (slide_num, title_text, max_bottom_str, overflow)


# ── Element builders ──────────────────────────────────────────────────────────

def _build_element_html(e, skill_dir):
    """Dispatch to the appropriate element builder by type."""
    etype = e.get('type', '')
    if etype == 'title':
        return _build_title(e)
    elif etype == 'text':
        return _build_text(e)
    elif etype == 'bullets':
        return _build_bullets(e)
    elif etype == 'table':
        return _build_table(e)
    elif etype == 'code':
        return _build_code(e)
    elif etype == 'mermaid_image':
        return _build_mermaid(e, skill_dir)
    else:
        return f'<!-- Unknown element type: {_esc(etype)} -->'


def _element_style(e):
    """Build a common CSS style string for a positioned element.

    Returns (style_string, has_overflow) where has_overflow means
    top + height exceeds slide_height_emu.
    """
    left_px = emu_to_px(e.get('left_emu', 0))
    top_px  = emu_to_px(e.get('top_emu', 0))
    w_px    = emu_to_px(e.get('width_emu', 0))
    h_px    = emu_to_px(e.get('height_emu', 0))
    fs      = e.get('font_size_pt', None)

    style = f'left:{left_px:.1f}px; top:{top_px:.1f}px; width:{w_px:.1f}px; height:{h_px:.1f}px;'
    if fs is not None:
        style += f' font-size:{fs}px;'

    bottom_emu = e.get('top_emu', 0) + e.get('height_emu', 0)
    has_overflow = bottom_emu > SLIDE_HEIGHT_EMU

    return style, has_overflow


def _wrap_positioned(class_name, e, inner_html, has_overflow=False):
    """Wrap inner HTML in an absolutely-positioned div.

    Overflow re-checked from element coordinates.
    """
    style, overflow = _element_style(e)
    has_overflow = has_overflow or overflow
    cls = class_name + (' overflow-warning' if has_overflow else '')
    return f'<div class="{cls}" style="{style}">{inner_html}</div>'


def _build_title(e):
    """Build a title element.

    Title elements use placeholder_idx in the PPTX; for HTML preview we
    position them at the coordinates specified, or a default title location.
    """
    text = _esc(e.get('text', ''))
    fs = e.get('font_size_pt', 24)

    # Use EMU positions if available, otherwise default title position
    left_emu = e.get('left_emu', 618606)
    top_emu  = e.get('top_emu', 137041)    # typical title top
    w_emu    = e.get('width_emu', 10954788)
    # h_emu not strictly needed for title (rendered at natural height)

    left_px = emu_to_px(left_emu)
    top_px  = emu_to_px(top_emu) if top_emu > 0 else 22.0
    w_px    = emu_to_px(w_emu)

    style = (f'left:{left_px:.1f}px; top:{top_px:.1f}px; '
             f'width:{w_px:.1f}px; font-size:{fs}px;')

    overflow = False
    if 'height_emu' in e:
        bottom = e.get('top_emu', 0) + e['height_emu']
        overflow = bottom > SLIDE_HEIGHT_EMU

    cls = 'slide-title' + (' overflow-warning' if overflow else '')
    return f'<div class="{cls}" style="{style}">{text}</div>'


def _build_text(e):
    text = _esc(e.get('text', ''))
    # Convert newlines to <br>
    html = text.replace('\n', '<br>')
    return _wrap_positioned('slide-text', e, html)


def _build_bullets(e):
    items = e.get('items', [])
    li_html = '\n'.join(f'<li>{_esc(item)}</li>' for item in items)
    inner = f'<ul>\n{li_html}\n</ul>'
    return _wrap_positioned('slide-bullets', e, inner)


def _build_table(e):
    data = e.get('data', [])
    if not data or len(data) < 1:
        return '<!-- empty table -->'

    header_bg   = '#' + (e.get('header_bg', '2F5496'))
    header_text = '#' + (e.get('header_text', 'FFFFFF'))
    alt_1       = '#' + (e.get('row_alt_1', 'D6E4F0'))
    alt_2       = '#' + (e.get('row_alt_2', 'FFFFFF'))

    headers = data[0]
    rows = data[1:] if len(data) > 1 else []

    thead = '<thead><tr>' + ''.join(
        f'<th>{_esc(str(h))}</th>' for h in headers
    ) + '</tr></thead>'

    tbody_rows = []
    for ri, row in enumerate(rows):
        bg = alt_1 if ri % 2 == 0 else alt_2
        cells = ''.join(f'<td>{_esc(str(c))}</td>' for c in row)
        tbody_rows.append(f'<tr style="background:{bg}">{cells}</tr>')
    tbody = '<tbody>\n' + '\n'.join(tbody_rows) + '\n</tbody>'

    table_html = f'<table class="slide-table">{thead}{tbody}</table>'
    return _wrap_positioned('slide-table-wrap', e, table_html)


def _build_code(e):
    code = _esc(e.get('code', ''))
    lang = e.get('language', '')
    fs = e.get('font_size_pt', 9)
    font = e.get('font_name', 'Consolas')

    style = f'font-family:"{font}",monospace; font-size:{fs}px;'
    inner = (f'<pre class="slide-code" style="{style}">'
             f'<code class="language-{_esc(lang)}">{code}</code>'
             f'</pre>')
    return _wrap_positioned('slide-code-wrap', e, inner)


def _build_mermaid(e, skill_dir):
    image_path = e.get('image_path', '')
    img_src = ''
    alt = 'Mermaid diagram'

    if image_path:
        # image_path may be absolute or relative; resolve relative to skill dir
        if os.path.isabs(image_path):
            abs_path = os.path.normpath(image_path)
        else:
            abs_path = os.path.normpath(os.path.join(skill_dir, image_path))
        # file:// URL for local images
        img_src = 'file:///' + abs_path.replace('\\', '/')
        alt = os.path.basename(image_path)
    else:
        # Placeholder
        inner = ('<div style="display:flex;align-items:center;justify-content:center;'
                 'width:100%;height:100%;color:#999;font-size:14px;">'
                 '[Mermaid image not found]</div>')
        return _wrap_positioned('slide-mermaid', e, inner)

    err_msg = _esc('[Image not found: ' + alt + ']')
    inner = (
        f'<img src="{img_src}" alt="{_esc(alt)}" '
        f'onerror="var p=this.parentElement;p.innerHTML='
        f'&quot;&lt;div style=display:flex;align-items:center;justify-content:center;'
        f'width:100%;height:100%;color:#c00;font-size:12px&gt;'
        f'{err_msg}&lt;/div&gt;&quot;">'
    )

    return _wrap_positioned('slide-mermaid', e, inner)


def _esc(text):
    """Escape HTML special characters."""
    if not isinstance(text, str):
        text = str(text)
    return (text.replace('&', '&amp;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                .replace('"', '&quot;'))


# ── Navigation bar ────────────────────────────────────────────────────────────

def _nav_bar():
    return '''</div><!-- /#viewport -->
<div id="nav-bar">
  <button id="btn-prev" onclick="nav(-1)">&laquo; Prev</button>
  <span class="counter">
    <span id="cur-idx">1</span> / <span id="total-n">1</span>
  </span>
  <button id="btn-next" onclick="nav(1)">Next &raquo;</button>
  <span style="flex:1"></span>
  <span class="hint">Arrow keys / scroll / click sides to navigate</span>
</div>\n'''


def _inline_script(total_slides):
    return f'''<script>
(function() {{
  var slides = document.querySelectorAll('.slide-container');
  var total  = slides.length;
  var cur    = 0;
  var vp     = document.getElementById('viewport');

  document.getElementById('total-n').textContent = total;

  function show(idx) {{
    if (idx < 0 || idx >= total) return;
    slides[cur].classList.remove('active');
    slides[idx].classList.add('active');
    cur = idx;
    document.getElementById('cur-idx').textContent = cur + 1;
    document.getElementById('btn-prev').disabled = (cur === 0);
    document.getElementById('btn-next').disabled = (cur === total - 1);
    resize();
  }}

  window.nav = function(dir) {{ show(cur + dir); }};

  function resize() {{
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var navH = document.getElementById('nav-bar').offsetHeight || 36;
    var ah = vh - navH - 20;
    var aw = vw - 20;
    var s  = Math.min(aw / 1920, ah / 1080, 1.0);
    vp.style.width  = (1920 * s) + 'px';
    vp.style.height = (1080 * s) + 'px';
    for (var i = 0; i < slides.length; i++) {{
      slides[i].style.transform = 'scale(' + s + ')';
    }}
  }}

  // Keyboard
  document.addEventListener('keydown', function(e) {{
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   {{ e.preventDefault(); nav(-1); }}
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {{ e.preventDefault(); nav(1); }}
    if (e.key === 'Home') {{ e.preventDefault(); show(0); }}
    if (e.key === 'End')  {{ e.preventDefault(); show(total - 1); }}
  }});

  // Scroll wheel on viewport
  vp.addEventListener('wheel', function(e) {{
    e.preventDefault();
    if (e.deltaY > 0) nav(1); else nav(-1);
  }}, {{ passive: false }});

  // Click left/right thirds of viewport
  vp.addEventListener('click', function(e) {{
    var rect = vp.getBoundingClientRect();
    var x = e.clientX - rect.left;
    if (x < rect.width / 3)       nav(-1);
    else if (x > rect.width*2/3)  nav(1);
  }});

  window.addEventListener('resize', resize);
  resize();
  show(0);
}})();
</script>'''


# ═══════════════════════════════════════════════════════════════════════════════
# Hot-reload (--watch mode)
# ═══════════════════════════════════════════════════════════════════════════════

def start_watch(source_md, output_html):
    """Watch source.md for changes; regenerate HTML on change.

    Detects changes via polling (mtime check every 2s) with 500ms debounce.
    If the watchdog library is installed, uses native filesystem events instead.
    """
    print(f"[preview_html] Watching {os.path.abspath(source_md)} for changes...")
    print(f"[preview_html] Output: {os.path.abspath(output_html)}")
    print(f"[preview_html] Press Ctrl+C to stop")

    # Try watchdog first
    try:
        import watchdog
        _watch_via_watchdog(source_md, output_html)
        return
    except ImportError:
        print("[preview_html] watchdog not installed, using polling fallback (2s interval)")

    _watch_via_polling(source_md, output_html)


def _watch_via_watchdog(source_md, output_html):
    """Use watchdog library for efficient filesystem monitoring."""
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler

    watch_dir = os.path.dirname(os.path.abspath(source_md)) or '.'
    watch_file = os.path.basename(source_md)

    last_rebuild = [0.0]  # mutable for closure
    pending_rebuild = [False]

    class Handler(FileSystemEventHandler):
        def on_modified(self, event):
            if os.path.basename(event.src_path) == watch_file:
                now = time.time()
                if now - last_rebuild[0] < 0.5:
                    pending_rebuild[0] = True
                    return
                last_rebuild[0] = now
                pending_rebuild[0] = False
                time.sleep(0.5)  # debounce
                if not pending_rebuild[0]:
                    print(f"[preview_html] Change detected, rebuilding...")
                    _rebuild_pipeline(source_md, output_html)

    observer = Observer()
    observer.schedule(Handler(), watch_dir, recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


def _watch_via_polling(source_md, output_html):
    """Poll file mtime every 2 seconds, with 500ms debounce."""
    last_mtime = 0.0
    last_rebuild_time = 0.0
    rebuild_pending = False

    while True:
        try:
            if not os.path.exists(source_md):
                time.sleep(2)
                continue
            current_mtime = os.path.getmtime(source_md)
        except OSError:
            time.sleep(2)
            continue

        if current_mtime != last_mtime:
            last_mtime = current_mtime
            now = time.time()
            if now - last_rebuild_time < 0.5:
                rebuild_pending = True
                time.sleep(2)
                continue

            last_rebuild_time = now
            rebuild_pending = False
            time.sleep(0.5)  # debounce wait

            if not rebuild_pending:
                print(f"[preview_html] Change detected in {os.path.basename(source_md)}, rebuilding...")
                _rebuild_pipeline(source_md, output_html)

        rebuild_pending = False
        time.sleep(2)


def _rebuild_pipeline(source_md, output_html):
    """Re-run the full pipeline: parse_slides -> render_mermaid -> fallback_engine.

    Writes the intermediate JSON files to a temp directory, then calls
    generate_html to produce the final HTML.
    """
    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scripts_dir = os.path.join(skill_dir, 'scripts')

    tmp_dir = tempfile.mkdtemp(prefix='preview_')
    try:
        slides_json = os.path.join(tmp_dir, 'slides.json')
        layout_json = os.path.join(tmp_dir, 'layout.json')

        # Step 1: parse_slides
        print("[preview_html]   [1/3] Parsing slides...")
        rc = subprocess.run(
            [sys.executable, os.path.join(scripts_dir, 'parse_slides.py'),
             source_md, slides_json],
            capture_output=True, text=True
        )
        if rc.returncode != 0:
            print(f"[preview_html]   ERROR: parse_slides failed")
            if rc.stderr.strip():
                print(f"[preview_html]   {rc.stderr.strip()[:300]}")
            return

        # Step 2: render_mermaid
        mermaid_dir = os.path.join(skill_dir, 'mermaid_images')
        print("[preview_html]   [2/3] Rendering mermaid diagrams...")
        rc = subprocess.run(
            [sys.executable, os.path.join(scripts_dir, 'render_mermaid.py'),
             slides_json, mermaid_dir],
            capture_output=True, text=True
        )
        # render_mermaid may print warnings; non-zero exit is unusual but
        # we continue anyway (images just won't appear)

        # Step 3: fallback_engine
        print("[preview_html]   [3/3] Generating layout...")
        rc = subprocess.run(
            [sys.executable, os.path.join(scripts_dir, 'fallback_engine.py'),
             slides_json, layout_json],
            capture_output=True, text=True
        )
        if rc.returncode != 0:
            print(f"[preview_html]   ERROR: fallback_engine failed")
            if rc.stderr.strip():
                print(f"[preview_html]   {rc.stderr.strip()[:300]}")
            return

        # Step 4: regenerate HTML
        generate_html(layout_json, output_html)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Generate HTML preview of PPTX slides from layout JSON'
    )
    parser.add_argument(
        'layout_json',
        help='Path to layout_decisions.json'
    )
    parser.add_argument(
        'output_html', nargs='?', default=None,
        help='Output HTML file path (default: preview.html in current directory)'
    )
    parser.add_argument(
        '--watch', metavar='SOURCE.md', default=None,
        help='Watch source markdown file and auto-regenerate on change'
    )
    args = parser.parse_args()

    layout_path = args.layout_json
    output_path = args.output_html or 'preview.html'

    if not os.path.exists(layout_path):
        print(f"[preview_html] ERROR: layout JSON not found: {layout_path}")
        sys.exit(1)

    generate_html(layout_path, output_path)

    if args.watch:
        if not os.path.exists(args.watch):
            print(f"[preview_html] ERROR: source file not found: {args.watch}")
            sys.exit(1)
        start_watch(args.watch, os.path.abspath(output_path))


if __name__ == '__main__':
    main()
