---
description: Marvin dashboard — project state, dependency status, and the full command index, optionally filtered to one group (core/adr/pr/task/sec/refactor/track).
---

# Help

Show the marvin dashboard: project state, board counters, git/dependency status, and the
full command index derived from the prompt registry.

## Arguments

- `$ARGUMENTS` — Optional: a group to filter the command index to — `core`, `adr`, `pr`, `task`, `sec`, `refactor`, or `track`.

## Instructions

Invoke the `help` MCP tool from the `marvin` server. Pass `$ARGUMENTS` as `section` when it
names a group; otherwise call it with no arguments. Present the dashboard as-is, without preamble.
