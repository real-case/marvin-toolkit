---
description: Unified viewer over every generated .marvin/ report — security, refactor, task, handoff, critique — newest first, with per-report freshness.
---

# Reports

The unified read side of every report marvin writes under `.marvin/` — security, refactor, task,
handoff and critique — newest first, each with server-computed freshness.

## Arguments

- `$ARGUMENTS` — Optional: one report, given as a project-relative path under `.marvin/` or
  unambiguously by title (for example "the verification report").

## Instructions

Invoke the `report` MCP tool from the `marvin` server — the prompt is `reports`, the tool it calls
is `report`. When `$ARGUMENTS` names a specific report, pass its project-relative path as the
`selected` argument. If the user is asking what is new or what is still open since the last run,
pass `action: "triage"`; pass `snapshot: true` only when they explicitly ask to record the current
findings as the baseline. Otherwise call the tool with no arguments, which means `list`. Do not add
preamble — just call the tool and present its result.
