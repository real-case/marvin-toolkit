# ADR 0031 — Rename the `kanban-*` command group to `track-*`

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed**                                                |
| Date          | 2026-07-16                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (`.marvin/` layout), [ADR-0024](0024-mcp-apps-widget-architecture.md) (shared contracts), [ADR-0025](0025-kanban-board-only.md) (board-only scope), [ADR-0026](0026-configurable-status-model.md) (configurable statuses) |

## Context

The lightweight task tracker has carried the `kanban-*` prefix since it was a standalone
pack. The name over-promises a methodology: nothing in the group is kanban-specific — no
WIP limits, no flow metrics, no pull discipline. What the group actually does is *track
work*: board cards with configurable, role-driven statuses (ADR-0026) that mirror whatever
external tracker the team uses (`tracker_id`, `tracker_url_template`, `tracker_status`).
A team on Scrum, on a plain issue queue, or on no methodology at all gets the same value,
but the `kanban-*` prefix suggests the tool takes a side.

Two secondary naming warts reinforced the mismatch:

1. The storage directory `.marvin/kanban/` bakes the methodology into on-disk layout
   (ADR-0007 names service directories after their command group).
2. The `DashboardState` contract fields `kanban_counts` / `kanban_role_counts` leak the
   prefix into the shared widget data layer (ADR-0024).

## Decision

**The command group is renamed `track-*`; the *thing* the commands manage is called the
(task) board.** Concretely:

1. **Prompts.** All 14 prompts rename mechanically: `kanban-menu` → `track-menu`,
   `kanban-bug` → `track-bug`, … `kanban-help` → `track-help`. The group key in the
   registry (`GROUP_PREFIXES` / `GROUP_ORDER`), the `help` tool's `section` filter, and
   the widget fixtures all use `track`.
2. **Vocabulary split.** `track` names the command group; `board` names the artifact.
   Prose that said "kanban board" now says "task board" / "the board"; "kanban-aware"
   skills are "board-aware". The `dashboard` tool's report section is `board`
   (`## Board`), and the contract fields become `board_counts` / `board_role_counts`
   (with `boardCounts()` / `BoardCounts` on the computation side).
3. **Storage.** The `MARVIN_TASKS_DIR` default moves from `.marvin/kanban/` to
   `.marvin/track/` (archive: `.marvin/track/archive/`), keeping ADR-0007's
   one-directory-per-group rule intact. No compatibility fallback is added — the tracker
   is pre-1.0 and the migration is a single `mv`.
4. **History stays.** Accepted ADRs (0025, 0026, …), `docs/proposals/`, and existing
   CHANGELOG entries are immutable records and keep the old name. This ADR is the bridge:
   references to "the kanban group" in accepted records mean today's `track-*` group.

### Alternatives considered

- **Keep `kanban-*`** — rejected: the group is tracker-integration-shaped, not
  methodology-shaped, and the name misleads non-kanban teams.
- **`board-*` as the prefix** — closest runner-up; rejected because the group's
  distinguishing feature is *tracking* work (statuses mirroring an external tracker),
  and `track` reads as a verb in command position (`/marvin:track-start`).
- **Compatibility aliases for the old prompt names** — rejected: two names for one
  command contradicts the one-room/three-doors doctrine and doubles the registry for a
  pre-1.0 rename.

## Consequences

- **Breaking (pre-1.0 minor, v0.6.0):** the 14 `/marvin:kanban-*` slash commands are now
  `/marvin:track-*`; `DashboardState.kanban_counts` / `kanban_role_counts` are now
  `board_counts` / `board_role_counts`; boards default to `.marvin/track/`.
- **Migration:** existing projects run `mv .marvin/kanban .marvin/track` (or set
  `MARVIN_TASKS_DIR`). Nothing else changes — file format, config, and statuses are
  untouched.
- The command surface stops implying a methodology; docs describe a "task board" that
  mirrors the team's tracker.
- `track-tracker` (the tracker-link-out list) is an awkward mechanical result of the
  rename; [ADR-0032](0032-track-surface-reduction.md) resolves it by folding the tracked
  view into `/marvin:track-list` as part of the surface reduction.
