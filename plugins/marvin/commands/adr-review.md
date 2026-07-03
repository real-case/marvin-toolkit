---
description: Deep review of one proposed ADR — section validation, codebase grounding, formal auto-fixes, verdict READY_FOR_ACCEPTANCE or a defect list. Never sets accepted.
---

# ADR Review

Review one proposed decision record before ratification.

## Arguments

- `$ARGUMENTS` — Optional: the record to review — a number (`31`, `0031`) or a title fragment

## Instructions

**Read `skills/adr-review/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` as the target record if provided.

## Examples

| Command                    | Behavior                                          |
| -------------------------- | ------------------------------------------------- |
| `/adr-review`              | List proposed records and ask which one to review |
| `/adr-review 31`           | Review ADR-0031                                   |
| `/adr-review widget layer` | Review the proposed record matching the title     |
