---
description: Marvin dashboard — project state, dependency status, and the full command index, optionally filtered to one group (core/pr/task/sec/kanban).
---

# Help

Show the marvin dashboard: project state, kanban counters, git/dependency status, and the
full command index derived from the prompt registry.

## Arguments

- `$ARGUMENTS` — Optional: a group to filter the command index to — `core`, `pr`, `task`, `sec`, or `kanban`.

## Instructions

Invoke the `help` MCP tool from the `marvin` server. Pass `$ARGUMENTS` as `section` when it
names a group; otherwise call it with no arguments. Present the dashboard as-is, without preamble.
