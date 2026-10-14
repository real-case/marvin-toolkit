---
description: Run one audit of the A-01…A-22 programme and release it as .md plus .pdf with a machine-readable findings register. Strictly read-only on the audited repository.
---

# Project audit — one run

Execute a single audit end to end: resolve which audit was asked for, collect evidence under a declared budget, rank the findings, and release the report as `.md` plus `.pdf`.

## Arguments

- `$ARGUMENTS` — Optional: the audit (`A-07`, `тесты`, `dependencies`) and any parameter values (`DEPTH=deep`, a path to a prerequisite report, an output directory)

## Instructions

**Read `skills/audit-run/SKILL.md`** and follow its full workflow (Steps 0–8, the immediate-notification rule for a live secret, and the prohibitions).

Pass `$ARGUMENTS` as the audit selector and parameter values if provided. With no audit named, route the user to `/audit-plan` rather than choosing one for them.

## Examples

| Command                                  | Behavior                                                  |
| ----------------------------------------- | ---------------------------------------------------------- |
| `/audit-run A-14`                         | The security audit, at the default `standard` depth         |
| `/audit-run аудит зависимостей`           | A-03, resolved from the subject rather than the id          |
| `/audit-run A-04 DEPTH=deep`              | Repository-history analysis over the deep sampling budget   |
