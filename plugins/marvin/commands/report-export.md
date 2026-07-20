---
description: Export a generated .marvin/ report to PDF, print-ready HTML, or a Markdown digest, filled from the widget-theme print template. Optionally pass a report reference and format.
---

# Report Export

Export a report marvin generated under `.marvin/` as a shareable artifact.

## Arguments

- `$ARGUMENTS` — Optional: a report reference (path under `.marvin/`, title, `latest`) and/or a format (`pdf`, `html`, `md`). If omitted, the skill lists the reports and asks.

## Instructions

**Read `skills/report-export/SKILL.md`** and follow its full workflow (Steps 1–7).

Pass `$ARGUMENTS` as the report reference / format if provided.

## Examples

| Command                                             | Behavior                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| `/report-export`                                    | List reports, ask which + format, then export         |
| `/report-export latest pdf`                         | Export the newest report as print-ready HTML for PDF  |
| `/report-export .marvin/task/verification.md md`    | Export the verification report as a Markdown digest   |
