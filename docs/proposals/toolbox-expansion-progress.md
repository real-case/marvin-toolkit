# Toolbox Expansion — Progress

This document tracks the execution of the [toolbox expansion plan](./toolbox-expansion.md).
The plan holds the design and scope and stays stable; this file is the living record. Each
work package runs in its own session: read the plan and this record, execute the WP checklist
on a `feat/toolbox-wp<N>-<slug>` branch, pass the gates, and update this file **in the same
PR** — status board row, checklist ticks, a dated log entry. When every checklist item of a
package is ticked, flip its status to Done.

Status values: **Not started · In progress · Blocked · Done**.

## Status board

| WP | Title                        | Status      | Branch | PR | ADR | Version | Notes |
| -- | ---------------------------- | ----------- | ------ | -- | --- | ------- | ----- |
| 1  | `adr` MCP tool and contract  | Not started | —      | —  | ADR-0027 | 0.7.0  | |
| 2  | ADR command surface          | Not started | —      | —  | —   | 0.8.0  | release cut candidate after merge |
| 3  | Lessons v2                   | Not started | —      | —  | ADR-0028 | 0.9.0  | independent of WP1–2 |
| 4  | Refactoring read side        | Not started | —      | —  | ADR-0029 | 0.10.0 | independent of WP1–3 |
| 5  | Refactoring plan and apply   | Not started | —      | —  | —   | 0.11.0 | needs WP4 |
| 6  | Dashboard                    | Not started | —      | —  | ADR-0030 | 0.12.0 | wants WP3 + WP5 landed |
| 7  | Usage telemetry              | Not started | —      | —  | —   | 0.13.0 | needs WP6 |
| 8  | Consolidation and release    | Not started | —      | —  | —   | —      | promotion `dev → main` with a **merge commit** + tag |

## Milestones

- [ ] WP1–WP2 merged: ADR lifecycle complete through all three doors (registry 48)
- [ ] Optional release cut after WP2
- [ ] WP3 merged: lessons loop widened, `/marvin:lessons` live (registry 49)
- [ ] WP4–WP5 merged: refactoring family complete (registry 53)
- [ ] WP6–WP7 merged: dashboard + usage telemetry live (registry 54, tools 9)
- [ ] WP8: docs consolidated, release tagged and published

## WP1 — `adr` MCP tool and contract

- [ ] ADR-0027 authored (tool-backed ADR lifecycle; host-adaptive corpus; human gates) and linked from `README.md` + `docs/README.md`
- [ ] Corpus module (`storage/` or `lib/`): dir resolution (config `adr.dir` → detect `docs/adr/` / `docs/decisions/` / `adr/` → default `docs/adr/`)
- [ ] Tolerant parser: table-style **and** heading-style headers → `{number, slug, title, status, date, supersedes, superseded_by, path}`
- [ ] `tools/adr.ts`: `next | list | index | audit | accept | supersede`; mutating pair validates fail-closed; wired in `server.ts`
- [ ] `accept` readiness gate: no `{...}` placeholders, required sections present, `NNNN` links resolve
- [ ] `supersede`: creates/links the new record, flips old status only — never edits old content
- [ ] `index`: regenerates corpus index between managed markers
- [ ] `adr` config block honored via the fail-closed config path (foreign keys survive)
- [ ] `AdrRecord` in `packages/marvin-mcp-shared/src/contracts/adr.ts`, exported from index; `structuredContent` emitted
- [ ] Unit tests: both header styles, every audit lint class, accept-gate refusals; e2e over the stdio driver
- [ ] Version 0.7.0 (plugin + marketplace + server manifests); `dist/` rebuilt; gates green

## WP2 — ADR command surface

- [ ] `skills/adr/SKILL.md` reworked: tool-backed numbering/path/index; `disable-model-invocation` dropped; drafts land `proposed`
- [ ] New skills + `commands/*.md`: `adr-review`, `adr-accept`, `adr-audit`, `adr-coverage`, `adr-supersede`, `adr-sync`
- [ ] `disable-model-invocation: true` on `adr-accept`, `adr-supersede`, `adr-sync`
- [ ] `adr-review`: template validation, formal auto-fix, verdict `READY_FOR_ACCEPTANCE`, never sets `accepted`
- [ ] `adr-sync`: accepted-only digest into a marker-managed CLAUDE.md block; diff shown before writing
- [ ] Six prompt registry entries (42 → 48), `skill:`-backed
- [ ] Docs: `docs/commands.md` rows + total count, plugin README, CLAUDE.md command table
- [ ] Tests/lints green (incl. `lint:manifests` frontmatter checks); version 0.8.0; `dist/` rebuilt

## WP3 — Lessons v2

- [ ] ADR-0028 authored (recall/capture expansion + hygiene) and linked from both README indexes
- [ ] `lessons` tool: `stats` action (counts by type/tag) and `prune` action (stale candidates; delete by slug behind confirmation)
- [ ] `add` near-duplicate guard: search-before-write, warn instead of double-writing
- [ ] `/marvin:lessons` inline prompt (48 → 49): search / add / stats / prune from chat
- [ ] Recall wiring: `task-implement` pre-flight, `sec-fix` intake
- [ ] Search-first step in `marvin-tm-executor` and `marvin-tm-review-fixer`
- [ ] Capture wiring: `task-fix-pr` retrospective with anti-boilerplate guards
- [ ] Tests: new actions unit + e2e, dedup cases; version 0.9.0; `dist/` rebuilt

## WP4 — Refactoring read side

- [ ] ADR-0029 authored (whole `refactor-*` family incl. plan/apply rails) and linked from both README indexes
- [ ] Skills + commands + prompts: `refactor-audit`, `refactor-smells` (49 → 51)
- [ ] `agents/marvin-refactor-auditor.md` with read-only `tools:` allowlist (Read, Glob, Grep, Bash)
- [ ] Findings register format defined (`F<n>`, severity, effort, evidence, direction); reports to `.marvin/refactor/NNN-<slug>.md`
- [ ] `.marvin/refactor/` added to the ADR-0007 working-dir table (CLAUDE.md + architecture docs)
- [ ] Audit closes by offering to file findings as kanban chores via the `task` tool
- [ ] `RefactorFinding` contract in shared contracts, exported
- [ ] Docs rows + count; version 0.10.0; `dist/` rebuilt; gates green

## WP5 — Refactoring plan and apply

- [ ] Skills + commands + prompts: `refactor-plan`, `refactor-apply` (51 → 53)
- [ ] `refactor-plan`: findings → sequenced, risk-annotated `.marvin/refactor/NNN-plan-<slug>.md`; oversized items routed to `task-start`
- [ ] `refactor-apply`: one finding at a time; `verify` green before and after; refuses on uncovered code (offers pin-down test first)
- [ ] Lessons wiring: search before apply, capture after when warranted
- [ ] Docs rows + count; version 0.11.0; `dist/` rebuilt; gates green

## WP6 — Dashboard

- [ ] ADR-0030 authored (dashboard + usage-log design) and linked from both README indexes
- [ ] `tools/dashboard.ts`: kanban/config/git aggregation (reuse `help` computation), artifact inventories (`task` specs + `verification.md` freshness, `security` + age, `refactor`, `handoff`), `lessons stats`, ADR corpus by status
- [ ] `DashboardState` contract extended (adr / security / refactor / usage sections)
- [ ] Sectioned terminal text renderer; `structuredContent` alongside; zero-state degradation on fresh projects
- [ ] `dashboard` inline prompt (53 → 54)
- [ ] Tests: aggregation over fixtures, e2e, empty-project case; version 0.12.0; `dist/` rebuilt

## WP7 — Usage telemetry

- [ ] `runPackServer` middleware: one JSONL event (`ts`, `kind`, `name`) per prompt-get / tool-call → `.marvin/usage/events.jsonl`
- [ ] Self-ignoring dir (`.marvin/usage/.gitignore` = `*`); size cap + rotation
- [ ] `usage.enabled` kill-switch in `.marvin/config.json`; logger errors never break a tool call
- [ ] Dashboard usage section: top commands, last-used, event count + window
- [ ] Docs privacy note (local-only, never committed, how to disable)
- [ ] Tests: events on tool call, kill-switch, rotation; version 0.13.0; `dist/` rebuilt

## WP8 — Consolidation and release

- [ ] Docs sweep: `docs/commands.md` final table + count, `docs/architecture.md`, plugin README, root README, CLAUDE.md
- [ ] `lint:docs`, `lint:manifests`, `verify-dist`, `smoke`, full test run green
- [ ] CHANGELOG roll-up for the 0.7.0 → 0.13.0 line
- [ ] Promotion PR `dev → main` merged with a **merge commit**; tag pushed; GitHub Release published
- [ ] This record closed out (plan Status → Implemented, final registry counts recorded)

## Log

- **2026-07-02** — Plan authored and filed together with this record (WP0, `docs/toolbox-expansion-plan` branch). Inventory confirmed: lessons loop already shipped per ADR-0021 (this plan extends it); `adr` skill is create-only; `DashboardState` contract exists; next ADR number is 0027. Registry today: 42 prompts, 7 tools, 9 agents.
