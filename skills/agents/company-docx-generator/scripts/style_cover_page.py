"""
Format cover page and insert auto-generated TOC.

Cover (page 1): title as body text, 微软雅黑 36pt, centered
Page 2: version management table
Page 3: auto-generated TOC (Word TOC field)
Page 4+: content

Usage: python style_cover_page.py input.docx [output.docx]
"""
import sys
from docx import Document
from docx.shared import Pt, Inches, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml, OxmlElement
from lxml import etree


def format_cover_title(doc):
    """Find first paragraph and format as 微软雅黑 36pt centered body text."""
    body = doc.element.body
    first_p = None
    for elem in body:
        if elem.tag == qn('w:p'):
            first_p = elem
            break

    if first_p is None:
        print("  WARNING: No paragraph found for cover title")
        return

    pPr = first_p.find(qn('w:pPr'))
    if pPr is None:
        pPr = parse_xml('<w:pPr %s/>' % nsdecls("w"))
        first_p.insert(0, pPr)

    # Remove numbering
    numPr = pPr.find(qn('w:numPr'))
    if numPr is not None:
        pPr.remove(numPr)

    # Remove style (make it body text)
    pStyle = pPr.find(qn('w:pStyle'))
    if pStyle is not None:
        pPr.remove(pStyle)

    # Center alignment
    jc = pPr.find(qn('w:jc'))
    if jc is None:
        jc = parse_xml('<w:jc %s w:val="center"/>' % nsdecls("w"))
        pPr.append(jc)
    else:
        jc.set(qn('w:val'), 'center')

    # Vertical spacing
    spacing = pPr.find(qn('w:spacing'))
    if spacing is None:
        spacing = parse_xml('<w:spacing %s w:before="3600" w:after="200"/>' % nsdecls("w"))
        pPr.append(spacing)
    else:
        spacing.set(qn('w:before'), '3600')

    # Format all runs: 微软雅黑 36pt, not bold
    for run_elem in first_p.iterchildren(qn('w:r')):
        rPr = run_elem.find(qn('w:rPr'))
        if rPr is None:
            rPr = parse_xml('<w:rPr %s/>' % nsdecls("w"))
            run_elem.insert(0, rPr)

        for tag in ['w:b', 'w:bCs']:
            b = rPr.find(qn(tag))
            if b is not None:
                rPr.remove(b)

        rFonts = rPr.find(qn('w:rFonts'))
        if rFonts is None:
            rFonts = parse_xml('<w:rFonts %s/>' % nsdecls("w"))
            rPr.insert(0, rFonts)
        for attr in ['w:asciiTheme', 'w:hAnsiTheme', 'w:eastAsiaTheme', 'w:cstheme']:
            if rFonts.get(qn(attr)):
                del rFonts.attrib[qn(attr)]
        rFonts.set(qn('w:ascii'), '微软雅黑')
        rFonts.set(qn('w:hAnsi'), '微软雅黑')
        rFonts.set(qn('w:eastAsia'), '微软雅黑')
        rFonts.set(qn('w:cs'), '微软雅黑')

        for tag in ['w:sz', 'w:szCs']:
            sz = rPr.find(qn(tag))
            if sz is None:
                sz = parse_xml('<%s %s w:val="72"/>' % (tag, nsdecls("w")))
                rPr.append(sz)
            else:
                sz.set(qn('w:val'), '72')

    print("  Cover title: 微软雅黑 36pt centered")


def _make_page_break():
    p = parse_xml(
        '<w:p %s><w:r><w:br w:type="page"/></w:r></w:p>' % nsdecls("w")
    )
    return p


def _make_toc():
    """Create TOC heading + TOC field."""
    toc_heading = parse_xml(
        '<w:p %s>'
        '  <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
        '  <w:r>'
        '    <w:rPr>'
        '      <w:rFonts %s w:ascii="微软雅黑" w:hAnsi="微软雅黑" w:eastAsia="微软雅黑"/>'
        '      <w:sz w:val="44"/><w:szCs w:val="44"/>'
        '    </w:rPr>'
        '    <w:t>目录</w:t>'
        '  </w:r>'
        '</w:p>' % (nsdecls("w"), nsdecls("w"))
    )
    toc_field = parse_xml(
        '<w:p %s>'
        '  <w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        '  <w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z </w:instrText></w:r>'
        '  <w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        '  <w:r><w:t>(Ctrl+A then F9 to update TOC)</w:t></w:r>'
        '  <w:r><w:fldChar w:fldCharType="end"/></w:r>'
        '</w:p>' % nsdecls("w")
    )
    return [toc_heading, toc_field]


def _find_h1_ids(doc):
    """Find style IDs used for Heading 1."""
    ids = set()
    for style in doc.styles:
        if style.type is not None and 'PARAGRAPH' in str(style.type):
            name = (style.name or '').lower()
            if name == 'heading 1':
                ids.add(style.style_id)
    return ids if ids else {'1', '2', '4', 'Heading1'}


def insert_toc_before_content(doc):
    """Insert page break + TOC before first H1 content heading."""
    body = doc.element.body
    h1_ids = _find_h1_ids(doc)
    print("  Heading 1 IDs: %s" % h1_ids)

    first_h1 = None
    first_h1_idx = None
    for i, elem in enumerate(body):
        if elem.tag == qn('w:p'):
            pPr = elem.find(qn('w:pPr'))
            if pPr is not None:
                pStyle = pPr.find(qn('w:pStyle'))
                if pStyle is not None and pStyle.get(qn('w:val')) in h1_ids:
                    first_h1 = elem
                    first_h1_idx = i
                    break

    if first_h1 is None:
        print("  WARNING: No H1 found, cannot insert TOC")
        return

    # Remove empty paragraphs and separators before H1
    elements_to_remove = []
    for j in range(first_h1_idx - 1, max(first_h1_idx - 10, -1), -1):
        prev = list(body)[j]
        if prev.tag == qn('w:p'):
            texts = [t.text or '' for t in prev.iter(qn('w:t'))]
            full_text = ''.join(texts).strip()
            if not full_text or len(full_text) < 3:
                elements_to_remove.append(prev)
            else:
                break
        elif prev.tag == qn('w:tbl'):
            break

    for el in elements_to_remove:
        body.remove(el)

    first_h1_idx = list(body).index(first_h1)

    # Insert: page break + TOC heading + TOC field + page break
    body.insert(first_h1_idx, _make_page_break())
    for j, toc_el in enumerate(_make_toc()):
        body.insert(first_h1_idx + 1 + j, toc_el)
    body.insert(first_h1_idx + 1 + len(_make_toc()), _make_page_break())

    print("  TOC inserted before first H1")


def main():
    if len(sys.argv) < 2:
        print("Usage: python style_cover_page.py input.docx [output.docx]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else input_path

    print("Formatting cover page and inserting TOC...")
    doc = Document(input_path)
    format_cover_title(doc)
    insert_toc_before_content(doc)
    doc.save(output_path)
    print("Saved: %s" % output_path)


if __name__ == "__main__":
    main()
