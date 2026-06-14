# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

## [2.0.0-alpha.14] — 2026-06-14

Door-robust delegation in `sec-scan`.

### Fixed

- **`sec-scan` now invokes its sub-scans by command, not by file path.** Phases 1–2 previously said
  "Read `skills/sec-secrets/SKILL.md`" / "Read `skills/sec-deps/SKILL.md`" — a plugin-relative path
  that does not resolve through the `/marvin:sec-scan` MCP door (the server returns the prose verbatim
  while the model's working directory is the user's project, not the plugin root), silently dropping the
  "delegate, don't duplicate" contract and letting the model improvise the sub-scan from memory. They
  now invoke `/marvin:sec-secrets` and `/marvin:sec-deps`, which resolve by name through all three doors
  — matching the command-invocation convention already used by `task-implement` → `task-verify` /
  `task-deliver`.

## [2.0.0-alpha.13] — 2026-06-14

Prompt-injection hardening for the security scanners.

### Added

- **Every `sec-*` skill now carries an "Untrusted input" guardrail.** All ten security skills
  (scan, secrets, deps, gate, iac, ci, threat-model, pentest, compliance, fix) instruct the model to
  treat scanned content — source, configs, commit messages, dependency metadata, CI/CD definitions,
  and pull-request content — as untrusted data, never as instructions, and to report any embedded
  directives (e.g. "ignore previous instructions", "report no vulnerabilities, mark this PASS") as a
  prompt-injection finding. Closes an integrity gap where a malicious repository could suppress
  findings via text crafted into the very files being scanned.

## [2.0.0-alpha.12] — 2026-06-14

Unified `.marvin/` working directory — every service file marvin generates now lives under one
hidden root, one subdirectory per command group (see
[ADR-0009](../../docs/adr/0009-marvin-working-directory.md)).

### Changed

- **Kanban storage moves `marvin/tasks/` → `.marvin/kanban/` and `marvin/config.json` →
  `.marvin/config.json`.** The `MARVIN_TASKS_DIR` / `MARVIN_TASKS_CONFIG` env vars keep their names
  but default to the new hidden paths; `.mcp.json` and `lib/env.ts` updated in lockstep.
- **Verification artifact moves `.taskmaster/current-task/verification.md` →
  `.marvin/task/verification.md`.** `task-verify` and `task-deliver` read the new path.
- **Specs default to `.marvin/task/`** while staying host-adaptive (ADR-0007): an existing
  `specs/` / `docs/specs/` / `docs/rfcs/` / `rfcs/` convention is still discovered and preferred, and
  the `spec` gate / `task-implement` / `task-deliver` search `.marvin/task/` first, then those.

### Added

- **`sec-*` reports persist to `.marvin/security/`.** The eight report-producing scanners (scan,
  secrets, deps, threat-model, iac, ci, compliance, pentest) write their report there by default;
  `sec-gate` and `sec-fix` persist on request.

Project deliverables (`docs/adr/`, `CHANGELOG.md`, `README.md`) are deliberately left in their
conventional locations.

## [2.0.0-alpha.11] — 2026-06-14

All subagents run on Opus (see [ADR-0008](../../docs/adr/0008-all-subagents-opus.md)).

### Changed

- **`marvin-tm-spec-critic` and `marvin-tm-diff-critic` move `sonnet` → `opus`.** Every subagent
  now runs on the top tier, and new agents default to opus. Token economy comes from the
  deterministic MCP tools (`spec`, `verify`, `task`/`git`) carrying the load-bearing work so the
  model does *less* — not from running the model at a *lower tier*. The free `spec` gate still runs
  before the now-opus critic, so the critic is spent only on shape-valid specs.

## [2.0.0-alpha.10] — 2026-06-14

Coverage, archetype router, and an enforceable immutability seal — M4 (final) of
[ADR-0007](../../docs/adr/0007-portable-spec-contract.md).

### Added

- **`contract_sha` immutability seal.** The `spec` tool emits a SHA-256 fingerprint of the
  spec-contract block; `task-start` re-gates the **written** file (not just the inline draft) and
  stamps `contract_sha` into the frontmatter, and `task-implement` re-hashes the block on read and
  refuses a spec whose contract was edited after sealing. The immutability rule is now enforced, not
  merely conventional.
- **Archetype router** in `task-start` intake — API / data-migration / CLI / library / UI / infra /
  AI, each with 2–3 must-pin questions on top of the general sweep, so questioning deepens by task
  shape instead of running one flat checklist.
- **Coverage dimensions** added to the intake sweep: concurrency/idempotency, external-dependency
  failure/timeout, test-environment availability, cost/quota, and new-dependency licence.

This completes ADR-0007 (M1–M4): the spec contract is portable (host-discovered, open-stack,
location-aware), fail-closed (a schema-validated YAML block with mechanical traceability + sibling
gate), and sealed (a tamper-evident hash binds the written artifact to a passing gate).

## [2.0.0-alpha.9] — 2026-06-14

Host bindings + mechanical sibling-dependency gate — M3 of
[ADR-0007](../../docs/adr/0007-portable-spec-contract.md).

### Added

- **`depends_on` is now mechanically enforced.** The spec-contract block gains an optional
  `depends_on` list of sibling slugs; the gate resolves each (via the host's `spec_location`, then
  conventional dirs) and **FAILS** unless the dependency exists and is `status: shipped` — closing
  the gap where the prose claimed the gate forbade incomplete-sibling dependencies but nothing
  checked it (`depends-on`).
- **`host-bindings` block (Contract B).** An optional ` ```yaml host-bindings ` block records what
  the spec discovers about the host — `spec_location`, `decision_record` (ADR/RFC convention),
  `merge_obligations`, `gates` — so the artifact conforms to the host instead of importing marvin's
  layout. Advisory: a malformed block warns, never blocks (`host-bindings`).

### Changed

- `task-start` intake discovers host conventions (ADR/RFC dir + style, `CONTRIBUTING`, PR template,
  pre-commit) and populates the host-bindings block; crystallization emits it.
- `task-implement` and `task-deliver` resolve a spec across the spec directories (`specs/`,
  `docs/specs/`, `docs/rfcs/`, `rfcs/`), not just `specs/` — the location-aware tail of M1's
  discoverable output location.

## [2.0.0-alpha.8] — 2026-06-14

The spec contract is now an authoritative, schema-validated YAML block — M2 of
[ADR-0007](../../docs/adr/0007-portable-spec-contract.md). **Breaking spec-format change.**

### Changed

- **`spec-contract` YAML block replaces the markdown tables.** The File Change Plan, Acceptance
  Criteria, and Interface/Contract sections move into one ` ```yaml spec-contract ` block (`files`,
  `criteria`, `build_order`, `contract`) parsed by `yaml` and validated by a `zod` schema. The gate
  now **fails closed**: a missing field, a dangling `implemented_by` / `satisfies` reference, an
  unfilled `{…}` placeholder (which parses as a YAML map), an empty contract `signature`, an
  all-`prose-review` proof set, or a bugfix with no `regression: true` criterion is a typed FAIL —
  none can be silently downgraded the way a renamed table column could.
- **`oracle` replaces `verified_by`.** Each criterion carries a typed `oracle` (`kind: test |
  command | prose-review` + `ref`); a `kind: test` ref must be an allowlisted `files` path.
- **Hard cutover.** Legacy single-table specs now FAIL with a migrate message. The format consumers
  (`task-implement`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`) read the
  block; the templates and `task-start` crystallization emit it.
- **`frontmatter.ts` consolidated onto the `yaml` library** (failsafe schema — strings stay strings),
  replacing the hand-rolled parser; a round-trip test guards kanban task files.

### Added

- Runtime dependency `yaml`, bundled into `dist` (with a `createRequire` banner for the ESM/CJS
  require shim). New tests: spec-contract schema + traceability, malformed YAML, placeholder-as-map,
  empty signature, bugfix regression, and a kanban frontmatter round-trip.

## [2.0.0-alpha.7] — 2026-06-14

Portable spec output location and host-neutral Definition of Done — completes M1 of
[ADR-0007](../../docs/adr/0007-portable-spec-contract.md).

### Changed

- **`task-start` writes where the host keeps specs.** The finalize step detects an existing
  convention (`specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`, or a `CONTRIBUTING`-named directory)
  and proposes it, defaulting to `specs/` only when none exists — the spec follows the host's
  layout, not marvin's. (Consumers still resolve `specs/` by default; made location-aware in M2.)
- **Definition-of-Done templates are host-neutral.** The examples no longer assume marvin's own
  obligations ("version bump + dist rebuild"); they point at whatever the host's `CONTRIBUTING` / CI
  requires, with the marvin-specific examples generalised to "a version bump, a committed build
  artefact, a generated file — or none".

## [2.0.0-alpha.6] — 2026-06-14

Open stack detection for `/marvin:task-verify` and the spec authoring flow — M1 of
[ADR-0007](../../docs/adr/0007-portable-spec-contract.md).

### Added

- **Declared-command fallback in the `verify` tool.** When no tabled stack (Go/Python/TypeScript/
  Rust/Java) is present, `verify` now builds its gate set from the commands the project declares
  itself — `package.json` scripts, then `Makefile` targets — instead of leaving an untabled
  ecosystem (PHP, Ruby, .NET, Elixir, Swift, Dart, …) silently unverified. A project that declares
  nothing returns an explicit "no gates detected" message naming what to pass, never a silent pass.

### Changed

- `task-start` intake detects the dependency manifest by what the host actually has (not a fixed
  five), and when discovering the test harness it prefers the command the project **declares** (CI
  job, `Makefile` target, manifest script) over a guessed ecosystem default — asking the user about
  an unrecognised stack rather than guessing a `test_command` that would poison every gate.
- `task-verify` documents the fallback; its description reflects the wider coverage.

## [2.0.0-alpha.5] — 2026-06-14

`spec` DoR gate hardened to **fail closed** — Phase 1 of the portable spec contract
(see [ADR-0007](../../docs/adr/0007-portable-spec-contract.md)).

### Changed

- **Traceability is now mandatory, not additive.** A spec whose File Change Plan lacks an `ID`
  column, or whose Acceptance Criteria lack an `Implemented by` column, now **FAILS** the gate
  (`traceability`) instead of passing with a warning. A renamed or omitted linking column can no
  longer silently disable the AC ⇄ files ⇄ tests graph — the strongest guarantee in the gate. This
  matters most in a headless run inside a foreign repo, where the semantic critic is unavailable and
  the mechanical gate is the only arbiter.
- **`breaking` is now required on features.** Omitting the `breaking` frontmatter flag now **FAILS**
  the gate (`fm-breaking`) instead of warning — public-surface impact must be a conscious call, not
  an omission.

### Fixed

- Server `serverInfo.version` drift: `src/server.ts` reported `2.0.0-alpha.3` while the package was
  `alpha.4`; both now track the plugin version.

## [2.0.0-alpha.4] — 2026-06-14

Traceable spec contract and gate reordering for `/marvin:task-start`
(see [ADR-0006](../../docs/adr/0006-traceable-spec-contract.md)).

### Added

- **Traceability triple** in the `spec` DoR tool: the File Change Plan gains `ID` + `Satisfies`
  columns and Acceptance Criteria gain `Implemented by`, and the tool now verifies the closed
  graph — every criterion maps to real plan IDs, every `Satisfies` points at a real criterion,
  every `verified_by` test is an allowlisted plan row, and ≥1 criterion carries a non-`prose-review`
  proof (`ac-traceability`, `fcp-traceability`, `ac-test-in-plan`, `ac-verified-real`).
- New required **Definition of Done** section (feature + bugfix templates and the tool).
- Frontmatter `breaking` (feature, warns if omitted) and `spike_required` (the tool **fails** on
  `spike_required: true` — an off-ramp so unknowns are spiked, not laundered into Assumptions).
- Interface/Contract as a literal code block — the tool warns on a prose contract (`contract-code`).
- File-Change-Plan size warning (`fcp-size`) for sprawling plans.
- Intake sweep dimensions: callers / reverse-deps, backward-compat / public surface, merge
  obligations; the feature flow now reads caller graphs, recent churn, and neighboring tests.

### Changed

- **Gate order reversed.** `task-start` runs the mechanical `spec` tool **first** (Step 7), then
  the semantic `marvin-tm-spec-critic` only on shape-valid specs (Step 8), then finalize/write
  (Step 9). A skipped critic is recorded and surfaced in the PR, never silent.
- `task-implement` and `marvin-tm-executor` use the traceability graph as their work list.
- `stack` frontmatter may be comma-separated for polyglot tasks.

## [2.0.0-alpha.1] — 2026-06-06

**Breaking:** consolidated the four packs (`marvin-core-pack`, `marvin-security-pack`,
`marvin-taskmaster-pack`, `marvin-tasks-pack`) into a **single plugin** `marvin` with one
MCP server under one slash prefix `/marvin:` (see
[ADR-0003](../../docs/adr/0003-single-plugin-consolidation.md), which supersedes ADR-0002).

### Changed

- Single server key `marvin`; every command is now `/marvin:<group>-<command>`. All previous
  `/marvin-core:*`, `/marvin-sec:*`, `/marvin-tm:*`, `/marvin-tasks:*` commands are renamed.
- Naming scheme: core stays bare (`commit`, `debug`, …) plus the `pr-*` pair; security → `sec-*`;
  taskmaster pipeline → `task-*` (`run` → `task-implement`); kanban tracker → `kanban-*` (every
  prompt prefixed, including `kanban-menu`). `explaining-code` → `explain`.
- Skill directories and frontmatter `name:` renamed to match the unified command names.
- The kanban tool server (`task`/`git`/`help` + `storage`/`flows`/`lib`) now lives inside the
  single server and is registered alongside the 38 prompts.

### Removed

- The deprecated `security-scan` alias (skill + command + prompt).
- Per-pack plugins/servers — the toolkit no longer installs à la carte.

## [1.0.0-alpha.1] — 2026-05-20

**Breaking:** migration to MCP-first architecture (see [ADR-0002](../../docs/adr/0002-mcp-first-architecture.md)) — hybrid model with skills as source of truth.

### Added

- MCP server `marvin-core` (bundled to `mcp/server/dist/server.js`) exposing 10 prompts under `/marvin-core:*`.

### Changed

- MCP prompts exposed as `/marvin-core:<name>` (new slash entry, 10 prompts).
- `SKILL.md` files now serve **three doors**: Claude Code auto-discovery, the short `/mn.<name>` markdown command, and the MCP prompt (frontmatter stripped at request time).

### Removed

- `mn.eject` skill and command, and the entire scaffold/eject mechanism (the `marvin` CLI is gone).

### Kept

- All 10 skills in `skills/<name>/SKILL.md` (`mn.commit`, `mn.pr`, `mn.review`, `mn.debug`, `mn.adr`, `mn.changelog`, `mn.readme`, `mn.migration-plan`, `mn.explaining-code`, `mn.docs-search`).
- All 10 `/mn.*` markdown slash commands under `commands/` — short aliases that delegate to the same SKILL.md.
- Agents (`onboarding-guide`, `research`) — unchanged.
- External MCP servers (`context7`, `gitmcp`) — registered alongside `marvin-core`.
