---
description: Browse the project lessons-learned store under .marvin/memory — search lessons, add one, show counts by type/tag, or prune stale and duplicate entries.
---

# Lessons

The human door to the team-shared lessons-learned store under `.marvin/memory/` (ADR-0028).

## Arguments

- `$ARGUMENTS` — Optional: what to do — search terms, a lesson to record, `stats`, or `prune`.

## Instructions

Invoke the `lessons` MCP tool from the `marvin` server. Map the user's ask onto `action`:

- `"search"` — pass `query` keywords and/or `type` ∈ bug-pattern | gotcha | convention | pitfall |
  process; no query returns the most recent.
- `"add"` — pass `type`, a one-line `title`, a 2–4 sentence `body`, optional comma-separated `tags`
  and `source`. On a near-duplicate warning either extend the named lesson or, if the user insists,
  retry with `force: true`.
- `"stats"` — counts by type and tag.
- `"prune"` — no `slug` lists stale/duplicate candidates; with `slug` it deletes that lesson.
  Confirmation is asked via a form, or pass `confirm: true` once the user has approved.

With nothing to go on, default to `"search"` with no query. Do not add preamble — just call the
tool and present its result.
