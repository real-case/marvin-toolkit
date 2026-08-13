---
description: Start work on a task — route the request to the command that fits it, or, where a spec is warranted, gather context, analyze codebase, explore solution variants, and produce an immutable spec (Phase 1 of the task pipeline)
---

# Start

Begin work on a task. This is Phase 1 of the task pipeline: it routes the request first, and where a spec is warranted it runs a structured dialogue that ends with one ready for implementation.

`/task-start` is the entry point for new work. Item 1 is where it decides; items 2–8 run only on the paths that continue to intake:
1. Routes the request (Step 0) — hands it to the command that fits, or continues to intake
2. Parses your input (free text, tracker reference, or file path)
3. Gathers codebase context (reads `CLAUDE.md`, `README.md`, recent history)
4. Asks domain-specific clarifying questions
5. For features: maps affected files, generates 3–5 solution variants, helps you choose
6. For bugs: helps establish reproduction, performs root-cause analysis, defines regression test
7. Runs the tool-backed Definition-of-Ready gate, then a red-team critic pass
8. Writes the final spec to `.marvin/task/<slug>.md`

Where a spec is written, run `/task-implement` next to execute it. Paths A and B end at the command they route to.

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
