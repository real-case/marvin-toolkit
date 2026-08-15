---
description: Read-only lint of the whole spec corpus under .marvin/task — duplicate numbers, numbering holes, slug collisions, dangling depends_on references, unsealed specs, invalid statuses, unidentified files — with remediation guidance per finding.
---

# Task Audit

Lint the spec corpus for consistency.

## Arguments

- `$ARGUMENTS` — Optional: focus (e.g. "unsealed specs", "errors only")

## Instructions

**Read `skills/task-audit/SKILL.md`** and follow its full workflow (steps 1–3).

Pass `$ARGUMENTS` as the focus if provided.

## Examples

| Command                    | Behavior                                        |
| -------------------------- | ----------------------------------------------- |
| `/task-audit`              | Full corpus lint with remediation guidance      |
| `/task-audit errors only`  | Full lint; expand only on the failing findings  |
