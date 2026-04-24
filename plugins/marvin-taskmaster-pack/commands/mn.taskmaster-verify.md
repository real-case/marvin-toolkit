---
description: Run project quality gates (tests, lint, type-check, build) with automatic stack detection. Creates the verification.md artifact.
---

# Verify

Run project quality gates and record results.

## Arguments

- `$ARGUMENTS` — Optional: pipeline context (`feature`, `bug`, `refactor`) or `baseline` for pre-refactor capture

## Instructions

**Read `skills/mn.taskmaster-verify/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the pipeline context if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/mn.taskmaster-verify` | Run all quality gates, report results |
| `/mn.taskmaster-verify feature` | Run with feature pipeline checks (new tests required) |
| `/mn.taskmaster-verify refactor` | Run with refactor pipeline checks (compare against baseline) |
| `/mn.taskmaster-verify baseline` | Capture pre-refactor test state |
