---
description: Aggregate the task-metrics series under .marvin/metrics/ — time, quality and rework per delivered task, with coverage — or show one task's record in full.
---

# Task metrics

Read the task-metrics series back: the three groups aggregated over every delivered task, or
one task's record in full.

## Arguments

- `$ARGUMENTS` — Optional: a spec slug to show that task's record in full, a task type
  (`feature` or `bugfix`) to narrow the aggregate, or a date (`YYYY-MM-DD`) to aggregate only
  the records rolled up since then. When omitted, the whole series is aggregated.

## Instructions

Invoke the `metrics` MCP tool from the `marvin` server with `action: "series"`. Pass a slug from
`$ARGUMENTS` as `slug`, a task type as `type`, a date as `since`; otherwise call it with
`action: "series"` alone. Present the returned report as-is — the coverage line first, since it
says how much of the shipped corpus the series covers, then the time, quality and rework groups
with their count, median, mean and maximum per metric — without preamble.

Every metric is computed only over the records where it was present: a task whose source was
absent is excluded from that metric's denominator, never counted as zero, and the `count` column
says how many tasks contributed.
