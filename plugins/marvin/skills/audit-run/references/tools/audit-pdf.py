#!/usr/bin/env python3
"""Render an audit report Markdown file into a print-quality PDF.

Single source: the .md is the only input, and nothing is rewritten for the PDF.

Usage:
    python3 audit-pdf.py <report.md> [<output.pdf>]

Exit codes:
    0  the PDF was written
    2  no font with Cyrillic coverage was found (fall back to the HTML path)
    3  reportlab is not importable
    4  the input could not be read or parsed

Why the font check exists: ReportLab's built-in Type-1 fonts (Helvetica, Times) carry
no Cyrillic glyphs, so a Russian report rendered with them comes out as empty boxes and
the failure is silent. This script refuses to produce that PDF: it registers a real TTF
whose cmap it has verified, or it exits 2 so the caller can take the HTML route.
"""

import os
import re
import sys
import glob

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont, TTFontFile
    from reportlab.platypus import (
        BaseDocTemplate,
        Frame,
        KeepTogether,
        PageBreak,
        PageTemplate,
        Paragraph,
        Preformatted,
        Spacer,
        Table,
        TableStyle,
    )
    from reportlab.platypus.tableofcontents import TableOfContents
except ImportError as exc:  # pragma: no cover - environment probe
    sys.stderr.write("reportlab is not available: %s\n" % exc)
    sys.exit(3)

# ── fonts ────────────────────────────────────────────────────────────────────

FONT_DIRS = [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/usr/share/texmf/fonts",
    os.path.expanduser("~/.fonts"),
    os.path.expanduser("~/.local/share/fonts"),
    os.path.expanduser("~/Library/Fonts"),
    "/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "C:/Windows/Fonts",
]

# Ordered by preference. DejaVu and Liberation are the two the audit requirements name;
# Noto and FreeSans are the common substitutes on minimal images.
FACES = {
    "regular": ["DejaVuSans.ttf", "LiberationSans-Regular.ttf", "NotoSans-Regular.ttf",
                "FreeSans.ttf", "Arial Unicode.ttf", "Verdana.ttf"],
    "bold": ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "NotoSans-Bold.ttf",
             "FreeSansBold.ttf", "Verdana Bold.ttf"],
    "mono": ["DejaVuSansMono.ttf", "LiberationMono-Regular.ttf", "NotoSansMono-Regular.ttf",
             "FreeMono.ttf", "Consolas.ttf"],
    "monobold": ["DejaVuSansMono-Bold.ttf", "LiberationMono-Bold.ttf",
                 "NotoSansMono-Bold.ttf", "FreeMonoBold.ttf"],
}

CYRILLIC_PROBE = [0x0410, 0x042B, 0x0451]  # А, Ы, ё


def _matplotlib_font_dir():
    try:
        import matplotlib  # noqa: WPS433 - optional probe
    except Exception:
        return None
    return os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")


def _candidate_paths(filename):
    dirs = [d for d in FONT_DIRS if d and os.path.isdir(d)]
    extra = _matplotlib_font_dir()
    if extra and os.path.isdir(extra):
        dirs.insert(0, extra)
    for directory in dirs:
        yield os.path.join(directory, filename)
        for hit in glob.glob(os.path.join(directory, "**", filename), recursive=True):
            yield hit


def _has_cyrillic(path):
    try:
        face = TTFontFile(path)
    except Exception:
        return False
    cmap = getattr(face, "charToGlyph", {}) or {}
    return all(code in cmap for code in CYRILLIC_PROBE)


def find_face(names):
    for name in names:
        for path in _candidate_paths(name):
            if os.path.isfile(path) and _has_cyrillic(path):
                return path
    return None


def register_fonts():
    """Register a Cyrillic-capable family, or return None."""
    regular = find_face(FACES["regular"])
    if not regular:
        return None
    bold = find_face(FACES["bold"]) or regular
    mono = find_face(FACES["mono"]) or regular
    monobold = find_face(FACES["monobold"]) or mono
    pdfmetrics.registerFont(TTFont("AuditSans", regular))
    pdfmetrics.registerFont(TTFont("AuditSans-Bold", bold))
    pdfmetrics.registerFont(TTFont("AuditMono", mono))
    pdfmetrics.registerFont(TTFont("AuditMono-Bold", monobold))
    pdfmetrics.registerFontFamily(
        "AuditSans", normal="AuditSans", bold="AuditSans-Bold",
        italic="AuditSans", boldItalic="AuditSans-Bold",
    )
    return {"regular": regular, "bold": bold, "mono": mono}


# ── markdown subset ──────────────────────────────────────────────────────────

INLINE_CODE = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
CHECKBOX = re.compile(r"^\[[ xX]\]\s*")


def escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inline(text):
    """Escape, then re-introduce the inline markup ReportLab understands."""
    out = escape(text)
    out = LINK.sub(r"\1", out)
    out = BOLD.sub(r"<b>\1</b>", out)
    out = INLINE_CODE.sub(r'<font face="AuditMono" size="8.5">\1</font>', out)
    return out


def parse_frontmatter(lines):
    """Return (meta dict, remaining lines). Absent frontmatter yields ({}, lines)."""
    if not lines or lines[0].strip() != "---":
        return {}, lines
    meta, i = {}, 1
    while i < len(lines) and lines[i].strip() != "---":
        match = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", lines[i])
        if match:
            meta[match.group(1)] = match.group(2).strip().strip('"')
        i += 1
    return meta, lines[i + 1:]


def blocks(lines):
    """Yield (kind, payload) blocks from the markdown subset the contract uses."""
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            body, i = [], i + 1
            while i < n and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            yield ("code", (lang, "\n".join(body)))
            continue

        heading = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if heading:
            yield ("h%d" % len(heading.group(1)), heading.group(2))
            i += 1
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c or "-") for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                yield ("table", rows)
            continue

        if re.match(r"^([-*+]|\d+\.)\s+", stripped):
            items = []
            while i < n and re.match(r"^([-*+]|\d+\.)\s+", lines[i].strip()):
                items.append(re.sub(r"^([-*+]|\d+\.)\s+", "", lines[i].strip()))
                i += 1
            yield ("list", items)
            continue

        if stripped.startswith(">"):
            quote = []
            while i < n and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip(">").strip())
                i += 1
            yield ("quote", " ".join(quote))
            continue

        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            yield ("rule", None)
            i += 1
            continue

        para = []
        while i < n and lines[i].strip() and not re.match(
            r"^(#{1,4}\s|\||```|>|[-*+]\s|\d+\.\s)", lines[i].strip()
        ):
            para.append(lines[i].strip())
            i += 1
        if para:
            yield ("p", " ".join(para))


# ── document ─────────────────────────────────────────────────────────────────

INK = colors.HexColor("#16181d")
MUTED = colors.HexColor("#5b6270")
LINE = colors.HexColor("#d5d9e0")
PANEL = colors.HexColor("#f2f4f7")

STYLES = {
    "title": ParagraphStyle("title", fontName="AuditSans-Bold", fontSize=24, leading=29,
                            textColor=INK, spaceAfter=6),
    "subtitle": ParagraphStyle("subtitle", fontName="AuditSans", fontSize=13, leading=18,
                               textColor=MUTED, spaceAfter=18),
    "h1": ParagraphStyle("h1", fontName="AuditSans-Bold", fontSize=16, leading=20,
                         textColor=INK, spaceBefore=16, spaceAfter=7),
    "h2": ParagraphStyle("h2", fontName="AuditSans-Bold", fontSize=13, leading=17,
                         textColor=INK, spaceBefore=13, spaceAfter=6),
    "h3": ParagraphStyle("h3", fontName="AuditSans-Bold", fontSize=11, leading=15,
                         textColor=INK, spaceBefore=11, spaceAfter=4),
    "h4": ParagraphStyle("h4", fontName="AuditSans-Bold", fontSize=10, leading=14,
                         textColor=MUTED, spaceBefore=9, spaceAfter=3),
    "body": ParagraphStyle("body", fontName="AuditSans", fontSize=9.5, leading=14,
                           textColor=INK, spaceAfter=6),
    "cell": ParagraphStyle("cell", fontName="AuditSans", fontSize=8.5, leading=11.5,
                           textColor=INK),
    "cellhead": ParagraphStyle("cellhead", fontName="AuditSans-Bold", fontSize=8.5,
                               leading=11.5, textColor=INK),
    "item": ParagraphStyle("item", fontName="AuditSans", fontSize=9.5, leading=14,
                           textColor=INK, leftIndent=10, bulletIndent=2, spaceAfter=2),
    "quote": ParagraphStyle("quote", fontName="AuditSans", fontSize=9, leading=13,
                            textColor=MUTED, leftIndent=10, spaceAfter=6),
    "code": ParagraphStyle("code", fontName="AuditMono", fontSize=7.8, leading=10.4,
                           textColor=INK),
    "meta": ParagraphStyle("meta", fontName="AuditSans", fontSize=9, leading=14,
                           textColor=MUTED),
    # Deliberately not "h1": afterFlowable keys on the style name, so a heading
    # styled h1 would list the table of contents inside itself.
    "toctitle": ParagraphStyle("toctitle", fontName="AuditSans-Bold", fontSize=16,
                               leading=20, textColor=INK, spaceAfter=10),
}


class AuditDoc(BaseDocTemplate):
    """A4 with a running footer carrying the audit id, the date and the page number."""

    def __init__(self, path, footer_left, **kw):
        BaseDocTemplate.__init__(self, path, pagesize=A4,
                                 leftMargin=20 * mm, rightMargin=18 * mm,
                                 topMargin=18 * mm, bottomMargin=18 * mm, **kw)
        self.footer_left = footer_left
        frame = Frame(self.leftMargin, self.bottomMargin,
                      self.width, self.height, id="body")
        self.addPageTemplates([
            PageTemplate(id="plain", frames=[frame], onPage=self._decorate),
        ])

    def _decorate(self, canvas, doc):
        canvas.saveState()
        y = self.bottomMargin - 7 * mm
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(self.leftMargin, y + 4 * mm, self.leftMargin + self.width, y + 4 * mm)
        canvas.setFont("AuditSans", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(self.leftMargin, y, self.footer_left)
        canvas.drawRightString(self.leftMargin + self.width, y, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        style = flowable.style.name
        if style in ("h1", "h2", "h3"):
            level = {"h1": 0, "h2": 1, "h3": 2}[style]
            self.notify("TOCEntry", (level, flowable.getPlainText(), self.page))


def table_flowable(rows, width):
    header, body = rows[0], rows[1:]
    cols = max(len(r) for r in rows)
    weights = []
    for c in range(cols):
        longest = max((len(r[c]) if c < len(r) else 0) for r in rows)
        weights.append(max(longest, 6))
    total = float(sum(weights))
    widths = [max(18 * mm, width * (w / total)) for w in weights]
    overflow = sum(widths) - width
    if overflow > 0:  # give the excess back to the widest column
        widest = widths.index(max(widths))
        widths[widest] -= overflow

    def row_cells(row, style):
        cells = [Paragraph(inline(row[c]) if c < len(row) else "", style)
                 for c in range(cols)]
        return cells

    data = [row_cells(header, STYLES["cellhead"])]
    data += [row_cells(r, STYLES["cell"]) for r in body]
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PANEL),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def code_flowable(text, width):
    # Hard-wrap so a long command never runs off the page.
    limit = max(40, int(width / (7.8 * 0.6)))
    wrapped = []
    for raw in text.split("\n"):
        while len(raw) > limit:
            wrapped.append(raw[:limit])
            raw = raw[limit:]
        wrapped.append(raw)
    block = Preformatted("\n".join(wrapped), STYLES["code"])
    holder = Table([[block]], colWidths=[width], hAlign="LEFT")
    holder.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    return holder


TITLE_KEYS = [
    ("repo", "Репозиторий"), ("commit", "Коммит"), ("date", "Дата"),
    ("depth", "Глубина"), ("lang", "Язык"), ("coverage", "Покрытие"),
    ("confidence", "Достоверность"), ("tools", "Инструменты"),
    ("tools_unavailable", "Недоступные инструменты"), ("params_derived", "Выведенные параметры"),
]


def build(md_path, pdf_path):
    with open(md_path, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    meta, body = parse_frontmatter(lines)

    audit_id = meta.get("audit_id", "A-XX")
    audit_name = meta.get("audit_name", "Аудит")
    footer = "%s · %s · %s" % (audit_id, audit_name, meta.get("date", ""))

    doc = AuditDoc(pdf_path, footer, title="%s — %s" % (audit_id, audit_name),
                   author="marvin audit")
    width = doc.width
    story = []

    # Title page
    story.append(Spacer(1, 34 * mm))
    story.append(Paragraph(escape("%s — %s" % (audit_id, audit_name)), STYLES["title"]))
    story.append(Paragraph(escape(meta.get("repo", "")), STYLES["subtitle"]))
    rows = [[label, meta[key]] for key, label in TITLE_KEYS if meta.get(key)]
    if rows:
        story.append(table_flowable([["Поле", "Значение"]] + rows, width * 0.86))
    story.append(PageBreak())

    # Contents
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("toc0", fontName="AuditSans-Bold", fontSize=10.5, leading=17),
        ParagraphStyle("toc1", fontName="AuditSans", fontSize=9.5, leading=15, leftIndent=12),
        ParagraphStyle("toc2", fontName="AuditSans", fontSize=9, leading=14,
                       leftIndent=24, textColor=MUTED),
    ]
    story.append(Paragraph("Оглавление", STYLES["toctitle"]))
    story.append(toc)
    story.append(PageBreak())

    for kind, payload in blocks(body):
        if kind == "code":
            story.append(code_flowable(payload[1], width))
            story.append(Spacer(1, 6))
        elif kind == "table":
            story.append(table_flowable(payload, width))
            story.append(Spacer(1, 8))
        elif kind == "list":
            for item in payload:
                text = CHECKBOX.sub("", item)
                story.append(Paragraph(inline(text), STYLES["item"], bulletText="•"))
            story.append(Spacer(1, 4))
        elif kind == "quote":
            story.append(Paragraph(inline(payload), STYLES["quote"]))
        elif kind == "rule":
            story.append(Spacer(1, 8))
        elif kind in ("h1", "h2", "h3", "h4"):
            story.append(KeepTogether(Paragraph(inline(payload), STYLES[kind])))
        else:
            story.append(Paragraph(inline(payload), STYLES["body"]))

    doc.multiBuild(story)


def main():
    if len(sys.argv) < 2:
        sys.stderr.write(__doc__)
        return 4
    md_path = sys.argv[1]
    pdf_path = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(md_path)[0] + ".pdf"
    if not os.path.isfile(md_path):
        sys.stderr.write("no such report: %s\n" % md_path)
        return 4
    fonts = register_fonts()
    if not fonts:
        sys.stderr.write(
            "no TTF with Cyrillic coverage found in %s — "
            "install DejaVu or Liberation, or use the HTML fallback\n" % ", ".join(FONT_DIRS)
        )
        return 2
    build(md_path, pdf_path)
    sys.stdout.write("wrote %s\nfonts: %s\n" % (pdf_path, fonts["regular"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
