---
description: Run project quality gates (tests, lint, type-check, build) with automatic stack detection. Creates the verification.md artifact.
---

# Verify

Run project quality gates and record results.

## Arguments

- `$ARGUMENTS` — Optional: pipeline context (`feature`, `bug`, `refactor`) or `baseline` for pre-refactor capture

## Instructions

**Read `skills/task-verify/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the pipeline context if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/task-verify` | Run all quality gates, report results |
| `/task-verify feature` | Run with feature pipeline checks (new tests required) |
| `/task-verify refactor` | Run with refactor pipeline checks (compare against baseline) |
| `/task-verify baseline` | Capture pre-refactor test state |
