---
name: report-export
description: Export a generated .marvin/ report to PDF, standalone print-ready HTML, or a Markdown digest by filling the shipped print-quality template styled on the widget theme. Use when the user says "export the report", "export to PDF", "save the scan report as PDF", "report as Markdown", "make a shareable report", "/marvin:report-export", or after a scan/verification/handoff when they want to share the result outside the terminal. The export is generated in-session from the template — nothing renders server-side (ADR-0033).
---

# Report Export

Turn any report marvin generated under `.marvin/` — security scans, refactor registers and
plans, task specs, `verification.md`, handoffs — into a shareable artifact: a **Markdown
digest** or a **print-ready HTML** document (the PDF path). You fill the shipped template
yourself; the server ships no export code (template-only architecture, ADR-0033).

## Input

`$ARGUMENTS` — optional: a report reference (a path under `.marvin/`, a title, "latest",
"the security scan") and/or a format (`pdf`, `html`, `md`). Ask for whichever is missing.

## Workflow

### 1. Resolve the report

Invoke the `report` MCP tool from the `marvin` server (no arguments) — it lists every
generated report with its id (the project-relative source path), title, group, and age.

- If the user named a report (path, title, or "latest"), match it against that list.
- If the reference is ambiguous or absent, present the list and ask which one.
- If the `report` tool is unavailable, read the `.marvin/` families directly
  (`security/`, `refactor/`, `task/`, `handoff/`) and pick by filename/title.

Then **read the source file** — the export renders its full content, and the file's
`mtime` supplies the *Generated* timestamp.

### 2. Pick the format

- **`pdf`** — fill the HTML template; the user prints it to PDF (step 5).
- **`html`** — the same filled HTML document, as the final artifact.
- **`md`** — fill the Markdown digest skeleton.

If the user did not name one, ask — suggest `pdf` for sharing outside the repo.

### 3. Read the template

Read `skills/report-export/references/export-template.html` (for pdf/html) or
`skills/report-export/references/export-template.md` (for md) from the plugin. The
`skills/…` path resolves through all three doors — doors 1/2 natively, door 3 via the
server's plugin-root preamble (ADR-0008).

### 4. Fill it

Each template carries a `HOW TO FILL` comment, `data-mv` slots (HTML), and three
`mv:cookbook` sections. Keep **exactly one** cookbook section — the one matching the
report kind — delete the other two, and replace all SAMPLE content.

**Provenance (the `data-mv="meta"` header / the digest's blockquote)** — keep all five
labels, fill from real data:

| Label     | Value                                                                  |
| --------- | ---------------------------------------------------------------------- |
| Source    | the report's project-relative path (the `report` tool id)               |
| Command   | the producing command, e.g. `/marvin:sec-scan`                          |
| Generated | the source file's mtime, ISO-8601                                       |
| Exported  | now, ISO-8601                                                           |
| Marvin    | the plugin version (the `help` tool reports it; else from plugin.json)  |

**Body recipes by report kind:**

- **findings** (`sec-*` reports, refactor `audit`/`smells` registers) — a severity-count
  summary strip, then sections in order critical → high → medium → low → info, every
  finding fully expanded: id, title, severity badge, `file:line` chip, category, evidence
  in the mono block, remediation, links/fix-command as plain text.
- **checks** (`verification.md`, refactor plans) — the `n/m passed` summary line (green
  `mv-ok` only when nothing failed, red `mv-bad` otherwise), then the Check/Status/Note
  table with ✓ pass / ✗ fail / ○ pending rows.
- **document** (task specs, handoffs) — the source's markdown body (drop its YAML
  frontmatter): render it into the `.mv-doc` typography for HTML, or carry it over
  verbatim for the Markdown digest.

**Hard rules while filling:**

- **HTML-escape every interpolated value** (`&`, `<`, `>`, `"`, `'`) — report content
  (evidence especially) must never become live markup.
- **Keep the artifact self-contained**: no `<script>`, no `<link>`, no `@import`, no
  external `url(...)`, no remote images; every color stays a `.mvroot` token value.
- Do not restyle: the template's CSS **is** the design (locked to the widget theme by
  `export-template.test.ts`).

### 5. Write the export

Write the filled artifact to `.marvin/export/<group>-<source-basename>.<ext>` — e.g.
`.marvin/security/scan-report.md` + `pdf` → `.marvin/export/security-scan-report.html`.

- On first use create `.marvin/export/` **with a `.gitignore` containing `*`** (the
  `.marvin/usage/` convention): exports are derived, shareable artifacts, never
  versioned state.
- Re-exporting the same report overwrites — the export dir is a tray, not an archive.

### 6. The PDF step

For `pdf`, tell the user: open the written `.html` in any browser → **Print** → **Save
as PDF** (paper A4 — the template's `@page` rule sets margins; enable *background
graphics* so badges and tints print). If this session genuinely has a local means to
convert HTML to PDF and the user asks for it, you may use it — but never install
anything and never add a dependency for it; the print step is the supported path.

### 7. Report back

Show the written path, the format, and (for pdf) the print instructions in two lines.
Offer the natural next step — exporting another report or `/marvin:reports` to browse.
