---
description: Turn selected refactoring findings into a sequenced, risk-annotated plan under .marvin/refactor/ — small steps stay inline, oversized items are routed to the task pipeline. Changes no code.
---

# Refactoring Plan

Turn findings from `.marvin/refactor/` registers into an ordered plan of small, behaviour-preserving steps.

## Arguments

- `$ARGUMENTS` — Optional: register file(s) and/or finding ids (e.g. `001-audit-core.md F1 F3`); defaults to the most recent register

## Instructions

**Read `skills/refactor-plan/SKILL.md`** and follow its full workflow (Phases 1–4 plus the closing hand-off offers).

Pass `$ARGUMENTS` as the finding selection if provided.

## Examples

| Command                                | Behavior                                            |
| -------------------------------------- | --------------------------------------------------- |
| `/refactor-plan`                       | Plan from the most recent findings register         |
| `/refactor-plan 001-audit-core.md F1 F3` | Plan exactly F1 and F3 from the audit register    |
| `/refactor-plan the smells report`     | Plan from the latest smells register                |
