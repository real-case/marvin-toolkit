---
description: Execute a ready spec interactively in the current session — implements the spec, self-tests, and hands off for verify + deliver
---

# Run

Execute a spec that has passed the Definition-of-Ready gate. Runs interactively in the current session (not headless, not in a worktree) so you can watch, intervene, and course-correct.

Pair with:
- `/mn.taskmaster-start` to produce the spec
- `/mn.taskmaster-verify` to run full quality gates after implementation
- `/mn.taskmaster-deliver` to commit and open a PR
- `scripts/dispatch.sh` if you prefer headless execution across multiple specs

## Arguments

- `$ARGUMENTS` — spec file path (`specs/<slug>.md`) or slug (`<slug>`). If omitted, the skill resolves which spec to run per its spec-resolution policy.

## Instructions

**Read `skills/mn.taskmaster-run/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the spec reference if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/mn.taskmaster-run` | Resolves the current task's spec and executes it |
| `/mn.taskmaster-run specs/add-health-check.md` | Executes the given spec |
| `/mn.taskmaster-run add-health-check` | Resolves slug to `specs/add-health-check.md` and executes |
