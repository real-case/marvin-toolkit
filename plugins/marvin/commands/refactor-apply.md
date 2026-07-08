---
description: Execute exactly one behaviour-preserving refactoring step under hard rails — verify green before and after, coverage required (pin-down test offered first), lessons consulted, rollback on red. Mutates code, one step at a time.
---

# Refactoring Apply

Execute one refactoring step from a plan or a findings register, under the ADR-0029 hard rails.

## Arguments

- `$ARGUMENTS` — Optional: the step or finding (e.g. `step 2`, `002-smells-api.md#F4`); defaults to the first pending step of the newest plan

## Instructions

**Read `skills/refactor-apply/SKILL.md`** and follow its protocol (Rails 0–6, in order — no skipping).

Pass `$ARGUMENTS` as the step selection if provided.

## Examples

| Command                              | Behavior                                          |
| ------------------------------------ | ------------------------------------------------- |
| `/refactor-apply`                    | Apply the first pending step of the newest plan   |
| `/refactor-apply step 3`             | Apply step 3 of the newest plan                   |
| `/refactor-apply 002-smells-api.md#F4` | Apply finding F4 straight from a register       |
