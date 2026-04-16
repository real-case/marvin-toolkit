---
description: Co-create an immutable, testable spec through structured dialogue (feature or bugfix flow with solution variants, VISION.md integration, and Definition of Ready gate)
---

# Spec Create

Interactive spec co-creation — Phase 1 of the task pipeline.

## Arguments

- `$ARGUMENTS` — task description (free text), tracker reference (`#42`, `PROJ-123`, URL), or file path. If omitted, the skill will ask what you want to build or fix.

## Instructions

**Read `skills/mn.spec-create/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the initial task description if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/mn.spec-create` | Starts interactive dialogue, asks what to build or fix |
| `/mn.spec-create Add pagination to search results` | Starts feature flow with given description |
| `/mn.spec-create Fix: TypeError in auth middleware` | Starts bugfix flow |
| `/mn.spec-create #42` | Fetches GitHub issue #42 and starts appropriate flow |
| `/mn.spec-create Refactor: extract validation into shared module` | Starts feature flow (refactoring uses feature flow) |
