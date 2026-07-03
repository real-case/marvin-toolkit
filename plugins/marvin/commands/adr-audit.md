---
description: Read-only lint of the whole ADR corpus — dangling references, numbering holes/duplicates, broken supersede pairs, placeholder residue, invalid statuses, stale index — with remediation guidance per finding.
---

# ADR Audit

Lint the decision-record corpus for consistency.

## Arguments

- `$ARGUMENTS` — Optional: focus (e.g. "supersede pairs", "errors only")

## Instructions

**Read `skills/adr-audit/SKILL.md`** and follow its full workflow (steps 1–3).

Pass `$ARGUMENTS` as the focus if provided.

## Examples

| Command                  | Behavior                                        |
| ------------------------ | ----------------------------------------------- |
| `/adr-audit`             | Full corpus lint with remediation guidance      |
| `/adr-audit errors only` | Full lint; expand only on the failing findings  |
