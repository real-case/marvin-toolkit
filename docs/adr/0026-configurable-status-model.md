# ADR 0026 — Configurable status model: statuses are project data, roles stay closed

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-07-02                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (`.marvin/config.json`), [ADR-0024](0024-mcp-apps-widget-architecture.md) (shared data contracts), [ADR-0025](0025-kanban-board-only.md) (board-only kanban group), `packages/marvin-mcp-shared/src/contracts/` |

## Context

The kanban board's status vocabulary — `todo | wip | review | done | blocked` —
was a closed enum hard-coded in four layers at once: the storage schema
(frontmatter validation), the transition logic in the `task` tool, the
renderers (list table, dashboard counters), and the ADR-0024 widget contracts.
That closure had three consequences:

1. **Real tracker workflows cannot be represented.** A team whose Jira/Azure
   DevOps/YouTrack board runs `Backlog → In Progress → In Review → QA → Done`
   has no way to mirror those states; the future tracker connectors (deferred
   work) would have nothing to write a remote workflow into.
2. **Even the built-in vocabulary was only partly reachable** — no action set
   `blocked`, and there were no reverse transitions (audit finding 5).
3. **The lifecycle commands conflated two ideas** — *which column a card is in*
   (presentation, tracker-specific) and *what stage of the lifecycle it is at*
   (what `start`/`review`/`done` actually need to know).

Two adjacent defects lived in the same code and were cheapest to fix while it
was open: an empty candidate list reported "Cancelled — no changes made" as if
the user had aborted (finding 8), and `runStart`'s preselected-id path skipped
both the todo filter and the empty-todo check (finding 14). Separately,
`base_branch` defaulted to `dev` with no detection, breaking first runs on
main-based repos (the auto-detection half of finding 4).

This must land **before** the ADR-0024 widget stage: once widgets consume
`TaskListPayload` and `DashboardState`, reshaping `status` and `counts` becomes
a coordinated migration instead of a pre-consumer cut.

## Decision

**Statuses become per-project configuration; lifecycle semantics stay a closed
set of roles.** `.marvin/config.json` gains a `statuses` array; each entry
carries a `key` (stored in task frontmatter), a `role` (one of
`todo | wip | review | done | blocked`), and an optional `tracker_status` (the
exact remote workflow name — filled manually today, by a connector later):

```jsonc
{
  "statuses": [
    { "key": "backlog", "role": "todo" },
    { "key": "in-progress", "role": "wip", "tracker_status": "In Progress" },
    { "key": "code-review", "role": "review", "tracker_status": "In Review" },
    { "key": "qa", "role": "review", "tracker_status": "QA" },
    { "key": "done", "role": "done", "tracker_status": "Done" },
    { "key": "blocked", "role": "blocked" }
  ]
}
```

1. **Defaults preserve existing boards.** With no configuration the set is five
   statuses whose key equals the role, so pre-ADR-0026 task files parse
   unchanged. The roles `todo`, `wip`, and `done` must each have at least one
   status; `review` and `blocked` are optional. Keys must be unique; an invalid
   `statuses` section fails schema validation and the whole config falls back
   to defaults with a dashboard warning (the existing malformed-config path).
2. **Frontmatter stores the key; membership is validated at read time.** The
   static status enum in `TaskFrontmatter` becomes a string; `readAllTasks`
   checks each file's status against the configured set and routes unknown
   keys through the existing malformed-file channel with an explicit reason —
   never silently dropped, never silently accepted.
3. **Lifecycle commands are role-driven.** `create`, `start`, `review`, and
   `done` target the **first configured status of their role** (configuration
   order); candidate filters select by role, so e.g. `done` can pick up a task
   from any wip- or review-role status. `review` with no review-role status
   configured explains itself and points at `move`.
4. **A generic `move` action reaches every configured status** — the door to
   states the lifecycle verbs don't cover (`blocked`, a second review-role
   status like `qa`, reverse transitions). Task resolution mirrors the other
   actions: explicit `taskId`, else the current branch's task, else a picker.
5. **Contracts change shape (breaking, pre-widget).** `TaskCard.status` becomes
   `{ key, role }`; `TaskListPayload.counts` and `DashboardState.kanban_counts`
   become open per-key records (every configured key present, even at 0) with a
   closed per-role roll-up (`role_counts` / `kanban_role_counts`); the
   dashboard's `config` carries the configured `statuses` so widgets can label
   and order the keys. The render order everywhere is role priority
   (`wip, review, todo, blocked, done`), configuration order within a role.
6. **Honest answers while the code is open.** Empty candidate sets answer "no
   tasks in a …-role status" instead of "Cancelled" (finding 8), and
   `runStart`'s preselected-id path applies the same role filter as the picker
   (finding 14).
7. **`base_branch` auto-detects from `origin/HEAD`** when no config file
   exists (finding 4's detection half); a config file, once present, always
   wins, and the schema default (`dev`) stays the last resort.

## Consequences

- **Breaking — contract shapes.** Anything reading `TaskCard.status` as a bare
  enum or `counts` as a five-key record must move to `{ key, role }` and the
  open-record + roll-up pair. No widgets exist yet — that is the point of
  landing WP2 before the widget stage; the structured-content tests are the
  reference consumers. Plugin version bumps 0.2.0 → 0.3.0.
- Tracker connectors get their interface: a connector reads the remote
  workflow and writes `statuses[]` (with `tracker_status` as the mapping key
  for future two-way sync). Both stay deferred work.
- The role invariants make the lifecycle total: every board has somewhere to
  create into (`todo`), start into (`wip`), and finish into (`done`), while
  `review`/`blocked` degrade gracefully.
- Unknown statuses surface per file through the malformed channel, so a
  mistyped key or a half-migrated board degrades one card at a time, never the
  whole list.
- The `task` type vocabulary (`bug/feature/chore/spike`) deliberately stays
  closed — the same key/role pattern applies if that ever changes.
