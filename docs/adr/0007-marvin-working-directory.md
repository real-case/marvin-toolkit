# ADR 0007 — Unified `.marvin/` working directory

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-14                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0005](0005-portable-spec-contract.md) (amended, not superseded), `plugins/marvin/.mcp.json`, `plugins/marvin/mcp/server/src/lib/env.ts`, `plugins/marvin/mcp/server/src/tools/verify.ts`, `plugins/marvin/mcp/server/src/tools/spec.ts`, `plugins/marvin/skills/task-*`, `plugins/marvin/skills/sec-*` |

## Context

Marvin's generated service files were scattered across the host tree under names accreted one
feature at a time: kanban tasks in `marvin/tasks/` + `marvin/config.json`, verification reports in
`.taskmaster/current-task/`, specs in `specs/`, and security scans persisted nowhere at all
(chat-only). Three different roots (`marvin/`, `.taskmaster/`, `specs/`) for one tool — plus a fourth
class, true project **deliverables** (`docs/adr/`, `CHANGELOG.md`, `README.md`) that marvin writes on
the host's behalf and which must stay where the host expects them.

The cost: a host repo accumulates marvin's bookkeeping in several visible top-level folders with no
single place to find, gitignore, or clean it; and one of the four groups (security) had no durable
artifact at all.

## Decision

**All marvin service files live under a single hidden `.marvin/` directory at the project root, one
subdirectory per command group.**

| Path | Group | Contents |
|------|-------|----------|
| `.marvin/task/` | `task-*` | spec `<slug>.md` files + the current `verification.md` |
| `.marvin/security/` | `sec-*` | scan / secrets / deps / threat-model / iac / ci / compliance / pentest reports |
| `.marvin/kanban/` | `kanban-*` | task `.md` board (`MARVIN_TASKS_DIR` default) |
| `.marvin/config.json` | `kanban-*` | tracker config (`MARVIN_TASKS_CONFIG` default) |

1. **Hidden, not visible.** `.marvin/` (dot-prefixed) replaces the old visible `marvin/` kanban root,
   so the bookkeeping sits beside `.git`/`.github` rather than cluttering the top level.
2. **Spec location stays host-adaptive (ADR-0005 amended, not reversed).** `.marvin/task/` becomes
   the default home, but an existing host convention (`specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`)
   is still discovered and preferred. The `spec` gate, `task-implement`, and `task-deliver` search
   `.marvin/task/` first, then those conventions, so either location resolves automatically.
3. **Security gains durable artifacts.** The eight report-producing `sec-*` skills now write their
   report to `.marvin/security/` by default; the two ephemeral ones (`sec-gate`, `sec-fix`) persist
   only on request.
4. **Deliverables are out of scope.** ADRs (`docs/adr/`), `CHANGELOG.md`, and `README.md` are
   consumed by humans and tooling at conventional locations and are deliberately *not* moved.
5. **Env override unchanged.** `MARVIN_TASKS_DIR` / `MARVIN_TASKS_CONFIG` keep their names (a stable
   contract) but default to `.marvin/kanban` / `.marvin/config.json`.

## Consequences

- One place to find, `.gitignore`, or archive everything marvin generates. Whether `.marvin/` is
  committed or ignored is left to the host owner (no `.gitignore` is shipped).
- **Migration:** existing projects with data in `marvin/tasks/`, `.taskmaster/current-task/`, or a
  bare `specs/` are not auto-migrated. The default paths move; specs under a recognised convention
  (including `specs/`) are still found by discovery, kanban data can be re-pointed with
  `MARVIN_TASKS_DIR` or moved to `.marvin/kanban/`, and a stale `.taskmaster/` can be deleted once its
  task ships.
- The env var name `MARVIN_TASKS_DIR` now points at a `kanban` directory — a minor name/path mismatch
  accepted to avoid breaking the existing env contract and its test.
