---
description: Unified viewer over every generated .marvin/ report — security, refactor, task, handoff — newest first, with per-report freshness.
---

# Reports

The unified read side of every report marvin writes under `.marvin/` — security, refactor, task and
handoff — newest first, each with server-computed freshness.

## Arguments

- `$ARGUMENTS` — Optional: one report, given as a project-relative path under `.marvin/` or
  unambiguously by title (for example "the verification report").

## Instructions

Invoke the `report` MCP tool from the `marvin` server — the prompt is `reports`, the tool it calls
is `report`. When `$ARGUMENTS` names a specific report, pass its project-relative path as the
`selected` argument; otherwise call the tool with no arguments. Do not add preamble — just call the
tool and present its result.
