---
description: Summarise what a task delivered — acceptance criteria vs verification, commits, lessons, and links — for a spec under .marvin/task/.
---

# Task summary

Aggregate a "what was done" summary for a spec-pipeline task.

## Arguments

- `$ARGUMENTS` — Optional: the spec slug to summarise. When omitted, the most recent spec is used.

## Instructions

Invoke the `summary` MCP tool from the `marvin` server. Pass `$ARGUMENTS` as `slug` when
provided; otherwise call it with no arguments. Present the returned summary as-is — acceptance
criteria with their proof outcome, verification gates, commits on the branch, captured lessons,
and the artifact links — without preamble.

The per-criterion outcome is conservative: "pass" only when verification passed and the
criterion has a real (test/command) oracle; otherwise "unknown".
