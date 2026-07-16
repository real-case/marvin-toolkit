# ADR 0032 — Reduce the `track-*` surface to seven commands

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed**                                                |
| Date          | 2026-07-16                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0025](0025-kanban-board-only.md) (board-only scope), [ADR-0026](0026-configurable-status-model.md) (role-driven statuses), [ADR-0031](0031-track-command-group-rename.md) (group rename), [ADR-0024](0024-mcp-apps-widget-architecture.md) (one tool ⇄ one widget) |

## Context

The `track-*` group carried 14 slash commands, but its real complexity lives in **one
deterministic tool**: `task` with ten actions (`create / list / status / start / review /
done / move / link-pr / config / archive`), plus the read-only `task-detail` and `tracker`
tools. The 14 prompts are thin aliases over those actions — and the alias layer had grown
four ways to create a task (one per type, differing only in the `type` argument), two
aliases for role-driven status moves that `move` already generalises (ADR-0026), two
read-only aliases that are filters of the same board (`status`, `tracker`), and a help
alias duplicating `/marvin:help track`.

A task's lifecycle on the board reduces to *create → update (status) → archive*; assignees
and discussion deliberately stay in the team's external tracker (the board mirrors it via
`tracker_id` / `tracker_status`, it does not replace it). Fourteen entries in the slash
menu, five curated help-content maps × 14 rows, and matching docs/eval surface are a real
maintenance cost for what is alias sugar. At the same time, two commands are *not* mere
field updates and earn their names: `start` glues the board to git (picks a todo, creates
the branch from `branch_template`, marks WIP), and `link-pr` captures the PR URL
(ADR-0025) — the latter already lives in the menu and the board-aware `pr-create` skill
rather than as a slash command.

## Decision

**The prompt surface shrinks 14 → 7; the tools, their actions, and the widget bindings do
not change.** Routing intelligence moves into the prompt bodies (which instruct the
model), keeping determinism in the tools:

| Command | Backing | Absorbs |
|---------|---------|---------|
| `/marvin:track-menu` | `task` (interactive menu) | — (already fronts every action: `archive` in its picker, `link-pr` via argument mapping) |
| `/marvin:track-new` | `task action=create`, `type` as argument/form | `track-bug`, `track-feature`, `track-chore`, `track-spike` |
| `/marvin:track-list` | routes: `task action=list` (default), `task action=status` (WIP / current-branch view), `tracker` (tracked link-out view) | `track-status`, `track-tracker` |
| `/marvin:track-show` | `task-detail` | — |
| `/marvin:track-start` | `task action=start` | — (workflow command: todo → branch → WIP) |
| `/marvin:track-move` | `task action=move`; prefers role-driven `review` / `done` actions when the user names a lifecycle stage | `track-review`, `track-done` |
| `/marvin:track-config` | `task action=config` | — |

`track-help` is dropped without a successor — `/marvin:help track` is the same call.

Boundary decisions recorded with the reduction:

1. **No `delete`.** Removing finished work stays `archive` (ids remain reserved,
   history-safe on a git-tracked board); it stays reachable via `track-menu` and natural
   language rather than earning a slash command.
2. **No `comment` action.** Discussion belongs to the external tracker, same as
   assignees; the task's markdown body remains free-form for notes. An automatic local
   journal (commit / PR events appended to the task) is possible future work, not part of
   this decision.
3. **Widget bindings are untouched.** One tool binds one widget (ADR-0024), so the
   `tracker` tool keeps fronting the tracker-list widget; `/marvin:track-list` simply
   routes to it for the tracked view.

### Alternatives considered

- **Pure CRUD (`new` / `update` / `delete`)** — rejected: `start` is not a field update
  (it creates the git branch) and folding it into "update" hides the group's main
  workflow value; `delete` contradicts the reserved-id archive model.
- **Keep per-type create commands** — rejected: the type is one argument; chat-door
  triggering ("add a bug") is unaffected because the model passes `type` itself.
- **Add filter arguments to the `task` tool's `list` action** instead of prompt-level
  routing — rejected for now: it changes a tool input contract to duplicate views that
  `status` and `tracker` already serve, and would break the one-tool-one-widget binding
  for the tracked view.

## Consequences

- **Breaking (pre-1.0 minor, v0.7.0):** `/marvin:track-bug`, `-feature`, `-chore`,
  `-spike`, `-review`, `-done`, `-status`, `-tracker`, `-help` are gone. Replacements:
  `track-new` (type as argument), `track-move` (any status, role-driven stages included),
  `track-list` (WIP and tracked views), `/marvin:help track`. The registry drops from 57
  to 50 prompts; tools stay at 12.
- Chat-door phrasing is unaffected — natural language reaches the same tool actions; only
  typed slash aliases were removed.
- The curated help maps, widget fixtures, docs, and eval notes shrink accordingly; the
  drift guards (blurb/detail/phrase coverage tests) enforce the new set.
- If the routing bodies of `track-list` / `track-move` prove unreliable in practice, the
  fallback is explicit filter arguments on the `task` tool (the rejected alternative) —
  a tool-level change gated by its own decision record.
