"""
Wrap consecutive Source Code paragraphs in single-cell bordered tables.
Creates a visual "code box" effect in the docx output.

Usage: python wrap_code_blocks.py input.docx [output.docx]
"""
import sys
from docx import Document
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml, OxmlElement
from lxml import etree
import copy

BORDER_COLOR = "CBD5E1"
BORDER_SIZE = "6"
CELL_BG = "F1F5F9"  # Slate-50 background for code blocks
CODE_FONT_SIZE = "16"  # 8pt in half-points — small enough for long lines


def _make_table():
    """Create an empty bordered table element."""
    tbl = parse_xml(
        '<w:tbl %s>'
        '  <w:tblPr>'
        '    <w:tblW w:w="5000" w:type="pct"/>'
        '    <w:tblBorders>'
        '      <w:top w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '      <w:left w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '      <w:bottom w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '      <w:right w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '      <w:insideH w:val="single" w:sz="0" w:space="0" w:color="auto"/>'
        '      <w:insideV w:val="single" w:sz="0" w:space="0" w:color="auto"/>'
        '    </w:tblBorders>'
        '  </w:tblPr>'
        '  <w:tblGrid>'
        '    <w:gridCol w:w="9000"/>'
        '  </w:tblGrid>'
        '</w:tbl>' % tuple([nsdecls("w")] + [BORDER_SIZE, BORDER_COLOR] * 4)
    )
    return tbl


def _make_cell():
    """Create a table cell with borders and light background."""
    tc = parse_xml(
        '<w:tc %s>'
        '  <w:tcPr>'
        '    <w:tcW w:w="9000" w:type="dxa"/>'
        '    <w:tcBorders>'
        '      <w:top w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '      <w:left w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '      <w:bottom w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '      <w:right w:val="single" w:sz="%s" w:space="0" w:color="%s"/>'
        '    </w:tcBorders>'
        '    <w:shd w:val="clear" w:color="auto" w:fill="%s"/>'
        '  </w:tcPr>'
        '</w:tc>' % tuple([nsdecls("w")] + [BORDER_SIZE, BORDER_COLOR] * 4 + [CELL_BG])
    )
    return tc


def _is_code_paragraph(p):
    """Check if a paragraph has Source Code style."""
    return p.style and p.style.name == 'Source Code'


def _force_code_linebreak(p_elem):
    """Allow line breaks at any character in code paragraphs — prevents overflow."""
    pPr = p_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = parse_xml('<w:pPr %s/>' % nsdecls("w"))
        p_elem.insert(0, pPr)

    # Disable "keep lines together" (allow page breaks within code block)
    keepLines = pPr.find(qn('w:keepLines'))
    if keepLines is not None:
        pPr.remove(keepLines)

    # Set smaller font for code in the run properties
    for r_elem in p_elem.iterchildren(qn('w:r')):
        rPr = r_elem.find(qn('w:rPr'))
        if rPr is None:
            rPr = parse_xml('<w:rPr %s/>' % nsdecls("w"))
            r_elem.insert(0, rPr)
        sz = rPr.find(qn('w:sz'))
        if sz is None:
            sz = parse_xml('<w:sz %s w:val="%s"/>' % (nsdecls("w"), CODE_FONT_SIZE))
            rPr.append(sz)
        # Don't override existing font size if set
        szCs = rPr.find(qn('w:szCs'))
        if szCs is None:
            szCs = parse_xml('<w:szCs %s w:val="%s"/>' % (nsdecls("w"), CODE_FONT_SIZE))
            rPr.append(szCs)


def wrap_code_blocks(doc):
    """Find consecutive Source Code paragraphs and wrap each group in a bordered table."""
    body = doc.element.body
    paragraphs = list(body.iterchildren(qn('w:p')))
    tables = list(body.iterchildren(qn('w:tbl')))

    # Build a list of all block-level elements in order
    # We'll process groups of consecutive Source Code paragraphs
    all_blocks = list(body)
    i = 0
    wrapped_count = 0

    while i < len(all_blocks):
        elem = all_blocks[i]
        # Check if this is a paragraph with Source Code style
        if elem.tag == qn('w:p'):
            pPr = elem.find(qn('w:pPr'))
            if pPr is not None:
                pStyle = pPr.find(qn('w:pStyle'))
                if pStyle is not None and pStyle.get(qn('w:val')) == 'SourceCode':
                    # Start of a code block group
                    code_group = []
                    j = i
                    while j < len(all_blocks):
                        e = all_blocks[j]
                        if e.tag == qn('w:p'):
                            e_pPr = e.find(qn('w:pPr'))
                            if e_pPr is not None:
                                e_pStyle = e_pPr.find(qn('w:pStyle'))
                                if e_pStyle is not None and e_pStyle.get(qn('w:val')) == 'SourceCode':
                                    code_group.append(e)
                                    j += 1
                                    continue
                        # Empty paragraphs (just <w:p/> or with only whitespace)
                        if e.tag == qn('w:p'):
                            texts = [t.text or '' for t in e.iter(qn('w:t'))]
                            if not any(t.strip() for t in texts):
                                # Check if next is also Source Code
                                if j + 1 < len(all_blocks):
                                    next_e = all_blocks[j + 1]
                                    if next_e.tag == qn('w:p'):
                                        next_pPr = next_e.find(qn('w:pPr'))
                                        if next_pPr is not None:
                                            next_pStyle = next_pPr.find(qn('w:pStyle'))
                                            if next_pStyle is not None and next_pStyle.get(qn('w:val')) == 'SourceCode':
                                                # Empty line between code — include it
                                                code_group.append(e)
                                                j += 1
                                                continue
                        break

                    if code_group:
                        # Find insertion point BEFORE moving paragraphs
                        insert_index = list(body).index(code_group[0])

                        # Create a table wrapping these code paragraphs
                        tbl = _make_table()
                        tr = parse_xml('<w:tr %s/>' % nsdecls("w"))
                        tc = _make_cell()

                        # Move all code paragraphs into the cell
                        for code_p in code_group:
                            tc.append(code_p)  # lxml moves the element

                        tr.append(tc)
                        tbl.append(tr)

                        # Insert table at the saved position
                        body.insert(insert_index, tbl)

                        # Apply line breaking to all code paragraphs in the cell
                        for code_p in code_group:
                            _force_code_linebreak(code_p)

                        # Re-read all_blocks since body changed
                        all_blocks = list(body)
                        wrapped_count += 1
                        i = 0  # Restart scanning
                        continue

        i += 1

    return wrapped_count


def main():
    if len(sys.argv) < 2:
        print("Usage: python wrap_code_blocks.py input.docx [output.docx]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else input_path

    print("Wrapping Source Code paragraphs in bordered tables...")
    doc = Document(input_path)

    wrapped = wrap_code_blocks(doc)
    print("  Wrapped %d code block(s)" % wrapped)

    doc.save(output_path)
    print("Saved: %s" % output_path)


if __name__ == "__main__":
    main()
