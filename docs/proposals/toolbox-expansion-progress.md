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
| 1  | `adr` MCP tool and contract  | Done | `feat/toolbox-wp1-adr-tool` | [#71](https://github.com/real-case/marvin-toolkit/pull/71) | ADR-0027 | 0.9.0 | landed third — re-bumped 0.7.0 → 0.9.0 at rebase; tools 7 → 8 |
| 2  | ADR command surface          | Not started | —      | —  | —   | 0.8.0  | release cut candidate after merge |
| 3  | Lessons v2                   | Done | `feat/toolbox-wp3-lessons-v2` | [#70](https://github.com/real-case/marvin-toolkit/pull/70) | ADR-0028 | 0.8.0 | landed second — re-bumped 0.7.0 → 0.8.0 at rebase per the parallel rule; registry 44 → 45 |
| 4  | Refactoring read side        | Done        | `feat/toolbox-wp4-refactor-read` | [#69](https://github.com/real-case/marvin-toolkit/pull/69) | ADR-0029 | 0.7.0 | wave 1 off `dev`@0.6.0 — registry 42 → 44 on branch; landed first (squash `9c3bc4f`) |
| 5  | Refactoring plan and apply   | Not started | —      | —  | —   | 0.11.0 | needs WP4 |
| 6  | Dashboard                    | Not started | —      | —  | ADR-0030 | 0.12.0 | wants WP3 + WP5 landed |
| 7  | Usage telemetry              | Not started | —      | —  | —   | 0.13.0 | needs WP6 |
| 8  | Consolidation and release    | Not started | —      | —  | —   | —      | promotion `dev → main` with a **merge commit** + tag |

_Version values are serial-order targets; under [parallel execution](#parallel-execution)
the actual version is assigned at landing._

## Milestones

- [ ] WP1–WP2 merged: ADR lifecycle complete through all three doors (registry 48)
- [ ] Optional release cut after WP2
- [x] WP3 merged: lessons loop widened, `/marvin:lessons` live (serial target said registry 49; actual after wave 1: 45)
- [ ] WP4–WP5 merged: refactoring family complete (registry 53)
- [ ] WP6–WP7 merged: dashboard + usage telemetry live (registry 54, tools 9)
- [ ] WP8: docs consolidated, release tagged and published

## Parallel execution

The three tracks are content-independent and may run **concurrently in separate child
sessions**: **(WP1 → WP2)**, **(WP3)**, **(WP4 → WP5)**. The tail **WP6 → WP7 → WP8** stays
strictly sequential — WP6 consumes WP1's corpus parser, WP3's `lessons stats`, and the
`.marvin/refactor/` inventory from WP4–5; ADR-0030 is authored in WP6 and implemented in
WP7. Note that WP5 does **not** depend on WP3: its lessons wiring uses `add`/`search`,
which ship with ADR-0021 already.

| Wave | WPs             | Entry condition                            |
| ---- | --------------- | ------------------------------------------ |
| 1    | WP1 ∥ WP3 ∥ WP4 | plan merged                                |
| 2    | WP2 ∥ WP5       | WP1 merged (for WP2); WP4 merged (for WP5) |
| 3    | WP6             | WP2 + WP3 + WP5 merged                     |
| 4    | WP7             | WP6 merged                                 |
| 5    | WP8             | everything merged                          |

Landing rules for concurrent PRs — they share `dist/server.js`, the prompt registry, the
docs tables, and the version manifests:

- **Worktree isolation.** Each child session works in its own worktree branched off a
  fresh `dev`; never share a working copy.
- **Second-lander rule for `dist/`.** A conflict on `dist/server.js` between two
  server-touching PRs is guaranteed and must never be hand-merged: rebase onto `dev`, keep
  your own `src/`, regenerate `dist/` with `npm run build`, re-run the gates (the kanban
  WP5 precedent).
- **Versions and registry counts are assigned at landing, not at branch time.** The
  Version column in the status board is the serial-order target; the actual bump is the
  next minor over whatever `dev` holds at rebase time, and the `docs/commands.md` total is
  recounted from the actual registry. Record the real version in the status-board row when
  the PR lands.
- **Append conflicts** (`prompts/index.ts`, `docs/commands.md`, README/CLAUDE.md rows) are
  trivial — resolve on rebase.
- **ADR numbers do not collide.** 0027–0030 are reserved per WP by the plan regardless of
  landing order.
- **Release cut.** The optional post-WP2 cut ships whatever else has already landed
  (acceptable — all changes are additive); alternatively skip it and release once after
  WP8.

## WP1 — `adr` MCP tool and contract

- [x] ADR-0027 authored (tool-backed ADR lifecycle; host-adaptive corpus; human gates) and linked from `README.md` + `docs/README.md`
- [x] Corpus module (`storage/` or `lib/`): dir resolution (config `adr.dir` → detect `docs/adr/` / `docs/decisions/` / `adr/` → default `docs/adr/`)
- [x] Tolerant parser: table-style **and** heading-style headers → `{number, slug, title, status, date, supersedes, superseded_by, path}`
- [x] `tools/adr.ts`: `next | list | index | audit | accept | supersede`; mutating pair validates fail-closed; wired in `server.ts`
- [x] `accept` readiness gate: no `{...}` placeholders, required sections present, `NNNN` links resolve
- [x] `supersede`: creates/links the new record, flips old status only — never edits old content
- [x] `index`: regenerates corpus index between managed markers
- [x] `adr` config block honored via the fail-closed config path (foreign keys survive)
- [x] `AdrRecord` in `packages/marvin-mcp-shared/src/contracts/adr.ts`, exported from index; `structuredContent` emitted
- [x] Unit tests: both header styles, every audit lint class, accept-gate refusals; e2e over the stdio driver
- [x] Version 0.7.0 (plugin + marketplace + server manifests); `dist/` rebuilt; gates green

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

- [x] ADR-0028 authored (recall/capture expansion + hygiene) and linked from both README indexes
- [x] `lessons` tool: `stats` action (counts by type/tag, `structuredContent` per the new shared `LessonsStats` contract) and `prune` action (stale candidates; delete by slug behind confirmation — elicitation or `confirm: true`; file + MEMORY.md index line removed together)
- [x] `add` near-duplicate guard: search-before-write, warn instead of double-writing (`force: true` overrides)
- [x] `/marvin:lessons` inline prompt: search / add / stats / prune from chat — 42 → 43 on this branch (the plan's 48 → 49 assumed WP1–2 landed first; recount at landing)
- [x] Recall wiring: `task-implement` pre-flight, `sec-fix` intake
- [x] Search-first step in `marvin-tm-executor` and `marvin-tm-review-fixer`
- [x] Capture wiring: retrospective with anti-boilerplate guards — wired into **`pr-resolve`**, not `task-fix-pr`: that command was renamed by ADR-0023 before this plan executed; correction recorded in ADR-0028
- [x] Tests: new actions unit + e2e, dedup cases (150/150 across workspaces); version **0.7.0** on the branch (serial target 0.9.0 — re-bumped at landing per the parallel rules); `dist/` rebuilt

## WP4 — Refactoring read side

- [x] ADR-0029 authored (whole `refactor-*` family incl. plan/apply rails) and linked from both README indexes
- [x] Skills + commands + prompts: `refactor-audit`, `refactor-smells` (49 → 51 serial target; **42 → 44 on the wave-1 branch**, recounted at landing)
- [x] `agents/marvin-refactor-auditor.md` with read-only `tools:` allowlist (Read, Glob, Grep, Bash)
- [x] Findings register format defined (`F<n>`, severity, effort, evidence, direction); reports to `.marvin/refactor/NNN-<slug>.md`
- [x] `.marvin/refactor/` added to the ADR-0007 working-dir table (CLAUDE.md + architecture docs)
- [x] Audit closes by offering to file findings as kanban chores via the `task` tool (smells scan too)
- [x] `RefactorFinding` contract in shared contracts, exported (+ unit test)
- [x] Docs rows + count; version 0.10.0 serial target → **0.7.0 on branch** (landing-time assignment); `dist/` rebuilt; gates green

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

- **2026-07-02** — **WP1 done** (`feat/toolbox-wp1-adr-tool`, PR #71): ADR-0027 authored and
  linked from both README indexes; `storage/adr.ts` corpus module (config → detection → default
  dir resolution; tolerant dual-style parser — table and MADR heading headers — with a
  per-file malformed channel); `tools/adr.ts` with `next | list | index | audit | accept |
  supersede` wired into `server.ts` (accept readiness gate fail-closed; supersede pairs links
  and flips status only; index maintains a marker-managed block; audit lints all six classes
  with error/warning severities); `AdrRecord` contract family in shared `contracts/`;
  `adr` config block (`dir`, `index_file`) on the fail-closed config path, foreign keys
  survive. 29 new stdio-driven tests (server suite 120 → 149, all green); audit runs clean on
  marvin's own 27-record corpus. Landed third — re-bumped 0.7.0 → **0.9.0** at rebase per the parallel rule; registry stays 45 (WP1 adds a tool, not prompts), tools 7 → 8.
- **2026-07-02** — **WP3 done** (PR [#70](https://github.com/real-case/marvin-toolkit/pull/70), `feat/toolbox-wp3-lessons-v2`; landed second — re-bumped 0.7.0 → **0.8.0** at rebase, registry recounted 44 → 45 per the parallel rule). ADR-0028 authored + linked. `lessons` tool: `stats` (+ shared `LessonsStats` contract), `prune` (candidate listing; slug-delete behind elicitation/`confirm: true`; file + MEMORY.md index line removed together), near-duplicate guard on `add` (`force: true` override). `/marvin:lessons` inline prompt. Recall wired into `task-implement`, `sec-fix`, `marvin-tm-executor`, `marvin-tm-review-fixer`; capture wired into **`pr-resolve`** — the plan's `task-fix-pr` was renamed by ADR-0023, correction recorded in the ADR and the checklist. 150/150 tests, all gates green.
- **2026-07-02** — **WP4 done** (wave 1, [#69](https://github.com/real-case/marvin-toolkit/pull/69), `feat/toolbox-wp4-refactor-read` off `dev`@0.6.0; landed first, squash `9c3bc4f`). ADR-0029 records the whole `refactor-*` family (read → plan → apply, register format, apply rails for WP5). Shipped: `refactor-audit` + `refactor-smells` skills/commands/prompts (registry 42 → 44 on branch — the 49 → 51 serial target assumed WP1–3 landed first; total recounted at landing per protocol), read-only `marvin-refactor-auditor` agent, `RefactorFinding` contract + test, `.marvin/refactor/` in both working-dir tables, changelog, version 0.7.0 (next minor over `dev`). No new MCP tool, per plan. Gates green: build, 141 tests, lint:manifests, verify-dist, lint:docs, smoke (44 prompts resolve).
- **2026-07-02** — Parallel-execution protocol added: three concurrent tracks (WP1→WP2 ∥ WP3 ∥ WP4→WP5), sequential tail WP6→WP7→WP8, second-lander `dist/` rule, landing-time version/count assignment.
- **2026-07-02** — Plan authored and filed together with this record (WP0, `docs/toolbox-expansion-plan` branch). Inventory confirmed: lessons loop already shipped per ADR-0021 (this plan extends it); `adr` skill is create-only; `DashboardState` contract exists; next ADR number is 0027. Registry today: 42 prompts, 7 tools, 9 agents.
