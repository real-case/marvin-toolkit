---
description: Marvin toolbox dashboard — task board, current work, recent handoffs, audit findings, artifact inventories with freshness, ADR corpus by status, lessons stats, and the local usage summary in one report.
---

# Dashboard

Show the whole-toolbox state report backed by the deterministic `dashboard` tool (ADR-0030). The
command index stays on `/marvin:help`; this aggregates the artifact, corpus and usage state.

## Arguments

- `$ARGUMENTS` — Optional: a section to filter the report to — `project`, `board`, `work`,
  `handoffs`, `audits`, `artifacts`, `adr`, `lessons`, `usage`, or `commands`.

## Instructions

Invoke the `dashboard` MCP tool from the `marvin` server. Pass `$ARGUMENTS` as `section` when it
names one of those sections; otherwise call it with no arguments. Present the report as-is; no
preamble.
