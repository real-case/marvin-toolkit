# Release procedure — `.md` and `.pdf`

Every audit delivers two artefacts and presents both. This file is the whole procedure.

## 1. Single source

The `.md` is written first and is the only source. The PDF is **rendered** from it. Content is
never rewritten, shortened or re-ordered for the PDF, and the two may not differ in substance.
The check of §5 exists to make that enforceable rather than aspirational.

## 2. Naming

```
{{OUTPUT_DIR}}/A-XX-<slug>.md
{{OUTPUT_DIR}}/A-XX-<slug>.pdf
```

`<slug>` is the audit's short kebab-case name from `skills/audit-run/references/audit-index.md`
(`A-05-static-analysis`, `A-14-security`). Both files share it exactly. `OUTPUT_DIR` defaults to
`.marvin/audit/` under the audited repository; create it if absent.

A re-run of the same audit **overwrites** both files. When the previous run must be kept for
comparison, the caller passes an `OUTPUT_DIR` that separates them (a dated subdirectory); the
audit does not invent a versioning scheme of its own.

## 3. Cyrillic is a hard requirement, not a nicety

ReportLab's built-in fonts (Helvetica, Times, Courier) contain **no Cyrillic glyphs**. A Russian
report rendered with them comes out as empty boxes, and nothing reports the failure — the file is
produced, it is the right size, and it is unreadable. Any generator used here must therefore
register a real TrueType font whose Cyrillic coverage has been checked, or refuse to produce the
file. The shipped generator does exactly that: it probes `А`, `Ы` and `ё` in the font's character
map before registering it, and exits with status 2 rather than emitting boxes.

## 4. Generating

### 4.1 Locate the generator

The two scripts ship with the plugin at
`skills/audit-run/references/tools/audit-pdf.py` and
`skills/audit-run/references/tools/audit-verify.py`.

Resolve them on disk first — they run in place, with no copy:

```bash
find "$HOME/.claude" "${CLAUDE_PLUGIN_ROOT:-/nonexistent}" \
     -path '*/audit-run/references/tools/audit-pdf.py' 2>/dev/null | head -1
```

If nothing is found, read both files through the `skills/…` path (it resolves through all three
entry points — chat and `/<command>` natively, `/marvin:<command>` via the server's plugin-root
preamble, ADR-0008) and write them **verbatim** into a temporary directory outside the audited
repository. Never write tooling into the project being audited.

### 4.2 Run it

```bash
python3 <tools>/audit-pdf.py "{{OUTPUT_DIR}}/A-XX-<slug>.md"
```

It prints the output path and the font file it registered. Exit codes: `0` written, `2` no
Cyrillic-capable font found, `3` reportlab missing, `4` bad input.

`reportlab` is often absent. Do **not** install it into the audited project. Ask the user once,
then create a throwaway environment outside the repository:

```bash
python3 -m venv "${TMPDIR:-/tmp}/marvin-audit-venv"
"${TMPDIR:-/tmp}/marvin-audit-venv/bin/pip" install -q reportlab pypdf
"${TMPDIR:-/tmp}/marvin-audit-venv/bin/python" <tools>/audit-pdf.py "<report>.md"
```

If the user declines the install, or the machine has no network, go to §4.3.

### 4.3 Fallback chain

Take the first one that is available, and **record in the report which one produced the PDF** —
the fallbacks differ in what they can put in the footer.

1. **pandoc + xelatex** — full control, needs a TeX install:

   ```bash
   pandoc "<report>.md" -o "<report>.pdf" --pdf-engine=xelatex --toc --number-sections \
     -V mainfont="DejaVu Sans" -V monofont="DejaVu Sans Mono" -V geometry:margin=20mm \
     -V header-includes='\usepackage{fancyhdr}\pagestyle{fancy}\fancyfoot[L]{A-XX · YYYY-MM-DD}\fancyfoot[R]{\thepage}'
   ```

2. **WeasyPrint** from HTML — the only HTML route that supports `@page` margin boxes, so the
   `A-XX · date` footer and the page counter survive:

   ```bash
   pandoc "<report>.md" -s -o "<report>.html" --toc
   weasyprint "<report>.html" "<report>.pdf" -s footer.css
   ```

   with `@page { size: A4; margin: 20mm; @bottom-left { content: "A-XX · YYYY-MM-DD" } @bottom-right { content: counter(page) } }`.

3. **Headless Chrome** — widely available, but its footer template is generic; note in the
   report that the footer does not carry the audit id.

   ```bash
   chrome --headless --disable-gpu --print-to-pdf="<report>.pdf" "<report>.html"
   ```

4. **HTML only.** When no PDF route exists, produce the print-ready HTML (`/marvin:report-export`
   fills the shipped template) and say **explicitly, in the session and in the report's
   appendices, that no PDF was produced and why**. Never claim a PDF that does not exist, and
   never present the `.html` under a `.pdf` name.

## 5. Readability requirements

Whatever produced the file, it must have all of these. The shipped generator produces them; a
fallback that cannot is recorded as a deviation.

- a title page carrying the frontmatter metadata — repository, commit, date, depth, coverage,
  confidence, tools
- a table of contents with page numbers
- a running footer with the audit id and the date, and a page number on every page
- a monospaced face for code blocks and commands, on a tinted panel
- tables that fit the text column: cells wrap, columns are proportioned to content, and nothing
  is clipped at the right margin
- long commands hard-wrapped rather than running off the page

## 6. Verification, and what it proves

```bash
python3 <tools>/audit-verify.py "<report>.md" "<report>.pdf"
```

It compares three id sets — the `### F-AXX-NN` headings in the prose, the ids inside the
`json findings` block, and the ids extracted from the rendered PDF — and additionally checks that
every register entry carries all eleven required fields.

The relations it enforces are deliberately not all equality:

- prose ids **equal** register ids. A finding described but not registered is invisible to
  `audit-summary`; a finding registered but not described has no evidence.
- every prose id **appears in** the PDF. A finding lost to a layout bug or a truncated build is
  caught here.
- the PDF carries **no id of this audit** that the prose does not file. Ids of *other* audits are
  expected in the PDF — the `Зависимости` field cross-references them — so equality in that
  direction would fail on every correct report.

Exit `0` passes. Exit `1` is a release failure: fix the report and regenerate, do not present the
pair. Exit `3` means no text extractor is installed (`poppler-utils`, `pypdf` or `pdfminer.six`);
install one in the throwaway environment, or record in the appendices that the PDF check could
not be run — an unverified PDF is delivered as unverified, never as verified.

## 7. Record and present

Print the verifier's output in the session, and add one line to the report's *Приложения*:

```
Выпуск: audit-pdf.py (шрифт /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf), 12 стр.;
сверка идентификаторов .md ↔ реестр ↔ .pdf — пройдена (2 находки).
```

Then present **both files** to the user by path, attaching them if the host supports it. The
audit is not finished until both artefacts exist and both have been shown.
