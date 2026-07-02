---
description: Whole-project structural refactoring audit — architecture map, churn×size hotspots, dependency tangles, dead-code candidates. Read-only; produces a numbered findings register under .marvin/refactor/.
---

# Refactoring Audit

Run a whole-project structural audit and produce a findings register.

## Arguments

- `$ARGUMENTS` — Optional: focus hint or report slug (e.g. "the storage layer" or "pre-cleanup")

## Instructions

**Read `skills/refactor-audit/SKILL.md`** and follow its full workflow (Phases 1–5 plus the closing board offer).

Pass `$ARGUMENTS` as the focus hint if provided.

## Examples

| Command                              | Behavior                                           |
| ------------------------------------ | -------------------------------------------------- |
| `/refactor-audit`                    | Full structural audit of the whole project         |
| `/refactor-audit storage layer`      | Full audit with a deeper look at the storage layer |
| `/refactor-audit pre-cleanup`        | Full audit; report slug hints at the occasion      |
