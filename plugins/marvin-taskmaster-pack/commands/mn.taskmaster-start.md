---
description: Start work on a task — gather context, analyze codebase, explore solution variants, and produce an immutable spec (Phase 1 of the task pipeline)
---

# Start

Begin work on a task. This is Phase 1 of the task pipeline — a structured dialogue that ends with a spec ready for implementation.

`/mn.taskmaster-start` is the entry point for new work. It:
1. Parses your input (free text, tracker reference, or file path)
2. Gathers codebase context (reads `CLAUDE.md`, `README.md`, recent history)
3. Asks domain-specific clarifying questions
4. For features: maps affected files, generates 3–5 solution variants, helps you choose
5. For bugs: helps establish reproduction, performs root-cause analysis, defines regression test
6. Runs a red-team critic pass, then the Definition-of-Ready gate
7. Writes the final spec to `specs/<slug>.md`

After this, run `/mn.taskmaster-run` to execute the spec interactively, or `scripts/dispatch.sh` to dispatch to headless agents.

## Arguments

- `$ARGUMENTS` — task description (free text), tracker reference (`#42`, `PROJ-123`, URL), or file path. If omitted, the skill will ask what you want to build or fix.

## Instructions

**Read `skills/mn.taskmaster-start/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the initial task description if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/mn.taskmaster-start` | Starts interactive dialogue, asks what to build or fix |
| `/mn.taskmaster-start Add pagination to search results` | Starts feature flow with given description |
| `/mn.taskmaster-start Fix: TypeError in auth middleware` | Starts bugfix flow |
| `/mn.taskmaster-start #42` | Fetches GitHub issue #42 and starts appropriate flow |
