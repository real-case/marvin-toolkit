---
description: Execute a ready spec interactively in the current session — implements the spec, self-tests, and hands off for verify + deliver
---

# Run

Execute a spec that has passed the Definition-of-Ready gate. Runs interactively in the current session (not headless, not in a worktree) so you can watch, intervene, and course-correct.

Pair with:
- `/task-start` to produce the spec
- `/task-verify` to run full quality gates after implementation
- `/task-deliver` to commit and open a PR

## Arguments

- `$ARGUMENTS` — spec file path (`specs/<slug>.md`) or slug (`<slug>`). If omitted, the skill resolves which spec to run per its spec-resolution policy.

## Instructions

**Read `skills/task-implement/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the spec reference if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/task-implement` | Resolves the current task's spec and executes it |
| `/task-implement specs/add-health-check.md` | Executes the given spec |
| `/task-implement add-health-check` | Resolves slug to `specs/add-health-check.md` and executes |
