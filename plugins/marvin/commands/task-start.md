---
description: Start work on a task — gather context, analyze codebase, explore solution variants, and produce an immutable spec (Phase 1 of the task pipeline)
---

# Start

Begin work on a task. This is Phase 1 of the task pipeline — a structured dialogue that ends with a spec ready for implementation.

`/task-start` is the entry point for new work. It:
1. Parses your input (free text, tracker reference, or file path)
2. Gathers codebase context (reads `CLAUDE.md`, `README.md`, recent history)
3. Asks domain-specific clarifying questions
4. For features: maps affected files, generates 3–5 solution variants, helps you choose
5. For bugs: helps establish reproduction, performs root-cause analysis, defines regression test
6. Runs the tool-backed Definition-of-Ready gate, then a red-team critic pass
7. Writes the final spec to `.marvin/task/<slug>.md`

After this, run `/task-implement` to execute the spec interactively.

## Arguments

- `$ARGUMENTS` — task description (free text), tracker reference (`#42`, `PROJ-123`, URL), or file path. If omitted, the skill will ask what you want to build or fix.

## Instructions

**Read `skills/task-start/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the initial task description if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/task-start` | Starts interactive dialogue, asks what to build or fix |
| `/task-start Add pagination to search results` | Starts feature flow with given description |
| `/task-start Fix: TypeError in auth middleware` | Starts bugfix flow |
| `/task-start #42` | Fetches GitHub issue #42 and starts appropriate flow |
