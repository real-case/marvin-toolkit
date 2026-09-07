---
description: Plan a project audit programme — choose which of the twenty-two audits (A-01…A-22) this project needs, order them into waves by data dependency, and emit a paste-ready invocation per run. Read-only.
---

# Audit programme — planning

Decide which audits this project needs, in what order, and with which parameters.

## Arguments

- `$ARGUMENTS` — Optional: the goal ("due diligence before an acquisition"), a depth, a time budget, or the access available ("code + CI only")

## Instructions

**Read `skills/audit-plan/SKILL.md`** and follow its full workflow — survey, frame, select, order into waves, resolve the shared parameters once, write the plan, emit the invocations.

Pass `$ARGUMENTS` as the goal and constraints if provided.

## Examples

| Command                                       | Behavior                                                     |
| --------------------------------------------- | ------------------------------------------------------------ |
| `/audit-plan`                                  | Survey the project and propose a programme                    |
| `/audit-plan due diligence, code + CI only`    | Programme scoped to the access available                      |
| `/audit-plan нас беспокоит надёжность`         | Programme weighted toward the reliability and operations wave |
