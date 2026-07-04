# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Marvin is a Claude Code plugin marketplace that ships **one plugin** (`marvin`) backed by a
**single MCP server** (per ADR-0001). The plugin exposes the whole development lifecycle —
core dev tools, a spec-driven task pipeline, security scanners, and a lightweight kanban
tracker — under one slash prefix `/marvin:`. There is no eject/scaffold step; the plugin
works as installed by `/plugin install`.

> Until 2026-06 the toolkit was four independently-installable packs each with its own
> server (`/marvin-core:*`, `/marvin-sec:*`, `/marvin-tm:*`, `/marvin-tasks:*`). ADR-0001
> consolidated them into one plugin/one server so every command shares the `/marvin:` prefix.
> See `docs/adr/0001-single-plugin-consolidation.md`.

## Architecture

The single plugin delivers **one MCP server**, plus `skills/<name>/SKILL.md`, markdown slash
commands under `commands/`, and `agents/*.md` files (all auto-loaded by Claude Code on
`/plugin install`):

```
plugins/marvin/
├── .claude-plugin/plugin.json        # name: "marvin"
├── .mcp.json                         # registers server key "marvin" (+ context7, gitmcp; MARVIN_TASKS_* default to .marvin/kanban + .marvin/config.json)
├── CHANGELOG.md
├── skills/<command>/SKILL.md         # source of truth for prompt bodies (dir name == command)
├── commands/<command>.md             # short markdown slash entries
├── agents/*.md                       # Claude Code subagents
├── widgets/*.html                    # COMMITTED self-contained MCP Apps widget documents (built by packages/marvin-widgets; served as ui:// resources, ADR-0024)
└── mcp/server/
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts
    ├── src/
    │   ├── server.ts                 # entry: name "marvin"; registers prompts + tools + widget resources
    │   ├── prompts/
    │   │   └── index.ts              # 55 prompt entries (skill-backed + inline kanban)
    │   ├── tools/                    # 10 MCP tools: kanban task / help + dashboard (toolbox state), verify, spec, lessons, summary, handoff (task pipeline), adr (decision lifecycle), audit (sec-* structured findings)
    │   ├── resources/widgets.ts      # buildWidgetResources(packRoot): ui:// widget ResourceDefs (no ext-apps import; server stays SDK-free)
    │   ├── storage/ flows/ lib/      # kanban persistence + helpers
    └── dist/server.js                # COMMITTED build artefact
```

### Working directory (`.marvin/`)

Every **service file** marvin generates lives under a single hidden `.marvin/` directory at the
project root, one subdirectory per command group (ADR-0007):

| Path | Written by | Contents |
|------|-----------|----------|
| `.marvin/task/` | `task-*` pipeline | spec `<NNN>-<slug>.md` files (numeric-prefixed so the dir sorts by creation order; `slug` stays the identity) + the current `verification.md` |
| `.marvin/security/` | `sec-*` scanners | scan / threat-model / compliance / pentest reports |
| `.marvin/refactor/` | `refactor-*` family | numbered findings-register reports `NNN-audit-<slug>.md` / `NNN-smells-<slug>.md` (`F<n>` id, severity, effort, evidence, direction — ADR-0029) + sequenced step plans `NNN-plan-<slug>.md` (one shared number sequence) |
| `.marvin/kanban/` | `kanban-*` tracker | task `.md` board (the `MARVIN_TASKS_DIR` default) |
| `.marvin/memory/` | `lessons` tool (`marvin-debugger`, `task-deliver`) | team-shared lessons-learned: `MEMORY.md` index + typed lesson files (ADR-0021) |
| `.marvin/handoff/` | `handoff` | session-continuation handoff docs `<NNN>-<slug>.md` (numeric-prefixed, creation order) |
| `.marvin/usage/` | usage-log middleware (`runPackServer`) | **local, never-committed** telemetry: `events.jsonl` — one JSONL event `{ts, kind, name}` per prompt-get / tool-call — plus a self-written `.gitignore` = `*` so nothing here reaches git; size-capped with rotation to `events.jsonl.1`; read only by `/marvin:dashboard`. Kill-switch `usage.enabled: false`; fail-open (ADR-0030) |
| `.marvin/config.json` | `kanban-*` tracker, `verify` | `base_branch` (auto-detected from `origin/HEAD` when absent), `tracker_url_template`, optional `branch_template`, the board's `statuses` vocabulary (`{key, role, tracker_status?}`, ADR-0026), `verify` gate overrides (`gates`, ADR-0009), and the `usage` telemetry kill-switch (`{enabled}`, ADR-0030) — the `MARVIN_TASKS_CONFIG` default, shown/edited via `/marvin:kanban-config` (the `task` tool's `config` action; foreign keys survive the read-modify-write) |

Spec location stays **host-adaptive** (ADR-0005): `.marvin/task/` is the default, but an existing
host convention (`specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`) is preferred when present, and
`task-implement` / `task-deliver` / the `spec` gate search `.marvin/task/` first, then those. The
`MARVIN_TASKS_*` env vars in `.mcp.json` can repoint the kanban paths. Project **deliverables** are
deliberately *not* swept in — ADRs stay under `docs/adr/`, `CHANGELOG.md` and `README.md` at the root.

### Command naming scheme

Commands are `/marvin:<group>-<command>`; singletons stay bare. Groups:

| Group | Source | Examples |
|-------|--------|----------|
| _(bare)_ | core dev tools | `/marvin:commit`, `/marvin:debug`, `/marvin:adr`, `/marvin:changelog`, `/marvin:readme`, `/marvin:migration-plan`, `/marvin:explain`, `/marvin:docs-search`, `/marvin:handoff`, `/marvin:dashboard` |
| `adr-*` | ADR lifecycle around the bare `/marvin:adr` create (ADR-0027; accept/supersede/sync are human-run via `disable-model-invocation`) | `/marvin:adr-review`, `/marvin:adr-accept`, `/marvin:adr-audit`, `/marvin:adr-coverage`, `/marvin:adr-supersede`, `/marvin:adr-sync` |
| `pr-*` | core PR ops (full PR lifecycle) | `/marvin:pr-create`, `/marvin:pr-review`, `/marvin:pr-resolve`, `/marvin:pr-merge` |
| `task-*` | spec pipeline (taskmaster) | `/marvin:task-start`, `/marvin:task-implement`, `/marvin:task-verify`, `/marvin:task-deliver` |
| `sec-*` | security scanners | `/marvin:sec-scan`, `/marvin:sec-secrets`, `/marvin:sec-deps`, `/marvin:sec-gate`, `/marvin:sec-threat-model`, `/marvin:sec-iac`, `/marvin:sec-ci`, `/marvin:sec-fix`, `/marvin:sec-compliance`, `/marvin:sec-pentest`, `/marvin:sec-report` |
| `refactor-*` | code-health family, read → plan → apply (ADR-0029) | `/marvin:refactor-audit`, `/marvin:refactor-smells`, `/marvin:refactor-plan`, `/marvin:refactor-apply` |
| `kanban-*` | lightweight task tracker (board-only, ADR-0025) | `/marvin:kanban-menu`, `/marvin:kanban-bug`, `/marvin:kanban-feature`, `/marvin:kanban-chore`, `/marvin:kanban-spike`, `/marvin:kanban-start`, `/marvin:kanban-review`, `/marvin:kanban-done`, `/marvin:kanban-list`, `/marvin:kanban-status`, `/marvin:kanban-config`, `/marvin:kanban-help` |

`task-*` (heavyweight spec pipeline) and `kanban-*` (quick tracker) are intentionally
distinct domains — keep them separate.

### Three doors, one room

The same `SKILL.md` is reached through **three independent entry points**:

1. **Claude Code auto-discovery.** Skills live under `plugins/marvin/skills/<command>/SKILL.md`. Their YAML frontmatter (`name`, `description`, optional `disable-model-invocation`) is what Claude Code matches against user prose like "сделай коммит" — the skill loads automatically. The `name` matches the directory and the command.
2. **Markdown slash commands.** Each `plugins/marvin/commands/<command>.md` is a thin Claude Code slash command that instructs the model to read its matching `SKILL.md` and pass `$ARGUMENTS`. Surfaces as `/<command>` (e.g. `/commit`, `/sec-scan`, `/task-start`).
3. **MCP slash commands.** Each prompt entry in `plugins/marvin/mcp/server/src/prompts/index.ts` declares `skill: "<command>"`. At request time the server reads the corresponding `SKILL.md`, strips its frontmatter, and returns the prose as a prompt body. Surfaces as `/marvin:<command>` (e.g. `/marvin:commit`).

All three doors lead to the same prose. Editing `SKILL.md` updates all three paths without a server rebuild (doors 2 and 3 read it at runtime; door 1 on next auto-discovery).

### Instrument types

- **Skills** (`plugins/marvin/skills/<command>/SKILL.md`) — Markdown with frontmatter. Source of truth for workflow content. Dir name, `name:`, and command all match.
- **Markdown commands** (`plugins/marvin/commands/<command>.md`) — Short slash wrappers with frontmatter `description` and a body that delegates to the matching skill. Optional `$ARGUMENTS` placeholder.
- **MCP prompts** — Thin server-side registration that exposes a skill (or, for the `kanban-*` group, an inline `body:`) under `/marvin:<command>`.
- **MCP tools** — Deterministic TypeScript invoked from prompts or by the model. Each tool declares a zod input schema. Used where determinism matters: the kanban `task`/`help` tools (file CRUD, role-driven transitions over the configured status set plus a generic `move` — ADR-0026, PR-URL capture via `link-pr` — ADR-0025, the `config` action that shows/edits `.marvin/config.json` fail-closed, dashboards), `verify` — the task pipeline's quality-gate runner (concurrent gates, single merge point, config-first gate resolution from `.marvin/config.json`, writes `verification.md`; see ADR-0002/0009) — and `spec`, the tool-backed Definition-of-Ready gate for `/marvin:task-start` (parses and zod-validates the `spec-contract` YAML block fail-closed — schema, file-path existence, the AC⇄files⇄tests traceability triple, typed oracles; see ADR-0003/0004/0005). `lessons` is the tool-backed lessons-learned store (`.marvin/memory/`: `add`/`search` typed lessons captured at delivery and by `marvin-debugger`, recalled at `task-start` intake; see ADR-0021). `adr` owns the decision-record lifecycle mechanics (ADR-0027): host-adaptive corpus resolution, a dual-style parser, `next | list | index | audit` reads, and the fail-closed mutating pair — gate-checked `accept`, paired-link `supersede` — surfaced by the `adr-*` skills, whose accept/supersede/sync entries are human-run. `dashboard` renders the whole-toolbox state report (ADR-0030): kanban/config/git plus artifact inventories with freshness, lessons stats, the ADR corpus by status, and the local usage summary when `.marvin/usage/events.jsonl` exists — emitting the extended `DashboardState` contract alongside the text. Three read-side helpers round out the ten tools: `summary` aggregates a finished task's criteria, gates, commits, lessons and links into a delivery digest (`/marvin:task-summary`), `handoff` lists the session-continuation docs under `.marvin/handoff/` (`/marvin:handoff-list`), and `audit` recovers the typed `audit-report` blocks the `sec-*` scanners write under `.marvin/security/` and returns them as an `AuditListPayload` (`/marvin:sec-report`; ADR-0024 #7 Tier-2).
- **Agents** (`plugins/marvin/agents/*.md`) — Claude Code subagents, auto-loaded on `/plugin install`. The read-only / read-mostly agents (`marvin-auditor`, `marvin-refactor-auditor`, `marvin-guide`, `marvin-tm-writer`, the two `marvin-tm-*-critic`s, and `marvin-debugger`) pin their access with a `tools:` frontmatter allowlist — a subagent that omits `tools:` inherits *every* tool, so the allowlist is what actually enforces the read-only contract. Code-writing agents (`marvin-tm-executor`, `marvin-tm-review-fixer`) and `marvin-researcher` deliberately omit `tools:` and inherit the full toolset.

> The `kanban-*` group has **no `skills/` or `commands/` entries**. Its 12 prompts are thin tool-invocation wrappers (inline `body:`) that call the `task`/`help` MCP tools. There is no standalone workflow prose to duplicate into a skill. Git operations on board tasks live in the kanban-aware `commit`/`pr-create` skills (ADR-0025).

### Server key and slash prefix

| Plugin | Server key | Slash prefix |
|--------|-----------|--------------|
| marvin | `marvin` | `/marvin:*` |

### MCP Apps widget layer (ADR-0024)

Rich MCP hosts can render a tool's `structuredContent` in a sandboxed `ui://` iframe. Marvin's
widgets live in a dedicated browser workspace and are wired to tools without pulling any browser SDK
into the server bundle:

- **`packages/marvin-widgets/`** — the React + `@modelcontextprotocol/ext-apps` browser bundle. Vite
  + `vite-plugin-singlefile` build each widget to **one self-contained HTML** file (a strict host CSP
  blocks external hosts) written to the committed `plugins/marvin/widgets/<name>.html`. A `<ListDetail>`
  primitive and a 3-type link model (`links.ts`, over the shared `LinkRef`) are the reusable foundation;
  a `mock-host` util (a fake ext-apps host over an in-memory transport) drives the real handshake in
  vitest and Storybook without a real iframe.
- **The server stays ext-apps/React free.** `src/resources/widgets.ts` returns `ResourceDef[]` for the
  `ui://marvin/<name>.html` documents (mimeType `text/html;profile=mcp-app`), served through the shared
  `registerResource` (NOT ext-apps' `registerAppResource`); its `read` loads the committed HTML from
  `packRoot` at request time (ADR-0008). The `task` tool binds its widget with a plain
  `meta.ui.resourceUri` object literal — so `tsup` never bundles ext-apps/React into `dist/server.js`.
- **The terminal fallback is unchanged.** `_meta` is additive; a text-only host ignores it and renders
  the tool's `content` exactly as before.
- **`scripts/verify-widgets.mjs`** guards the committed HTML like `verify-dist` guards `dist/`: it
  rebuilds `@marvin-toolkit/mcp-shared` then `@marvin-toolkit/widgets`, hash-compares each committed
  `plugins/marvin/widgets/*.html` against the fresh build, and asserts each file is self-contained.

The first widget is `task-list` (a `<ListDetail>` over `TaskListPayload`); the remaining widgets are
follow-up specs reusing this foundation.

## Shared library

`packages/marvin-mcp-shared/` provides:

- typed `PromptDef` / `ToolDef` interfaces and `defineTool` helper
- `runPackServer({ name, version, promptsDir, packRoot, build, onInvoke? })` — the standard server entry. The optional `onInvoke(event)` middleware hook fires once per prompt-get and per tool-call with `{ kind, name }`, *before* the handler runs; it is fire-and-forget and fail-open (throws and rejected promises are swallowed), leaving dispatch byte-for-byte unchanged. marvin wires it to the `.marvin/usage/` log (ADR-0030); the shared library stays project-agnostic.
- `elicit(server, message, zodSchema)` + `canElicit(server)` — typed MCP elicitation wrapper with client-capability detection (tools degrade to instructive errors on hosts without elicitation)
- `resolvePromptBody`, `promptsDirFromMeta`, `packRootFromMeta`, `interpolateArgs` — body loaders
- `contracts/` — zod data contracts for the planned MCP Apps widget family (`LinkRef`, `TaskCard`, `TaskSummary`, `AuditReport`, `DashboardState`, …); one schema per artifact block, reused across storage / gates / `structuredContent` / widget props (ADR-0024). Data-only — no runtime effect until a tool imports a schema.

The server bundles the shared lib via `tsup` (`noExternal: [/^@marvin-toolkit\//, ...]`) into a single self-contained `dist/server.js`.

## Validation

```shell
# Lint manifests + structure
node scripts/lint-manifests.mjs

# Build the server
npm run build

# Test
npm run test

# Verify committed dist/ is in sync with source
node scripts/verify-dist.mjs

# Verify committed widget HTML is in sync + self-contained (ADR-0024)
node scripts/verify-widgets.mjs

# Local plugin validation
claude plugin validate .
```

CI (`.github/workflows/validate-plugins.yml`) runs the same checks plus ESLint, Prettier, and a stdio smoke-test that sends `initialize` to the server and verifies a valid response (`serverInfo.name == "marvin"`).

### Manually driving a tool

To exercise a tool over stdio without a rich MCP host (the same JSON-RPC
conversation the e2e tests drive), use the dev driver after `npm run build`:

```shell
node scripts/mcp-call.mjs --list                              # enumerate registered tools
node scripts/mcp-call.mjs handoff '{"action":"list"}'         # call a tool; prints text + structuredContent
MARVIN_HANDOFF_DIR=/tmp/fix node scripts/mcp-call.mjs handoff '{"action":"list"}'   # point storage at a fixture
node scripts/mcp-call.mjs task '{"action":"create","type":"bug"}' --accept '{"title":"demo"}'  # drive an elicitation
```

## Adding a new prompt

The canonical path is **skill-backed** — same content, three doors:

1. Create `plugins/marvin/skills/<command>/SKILL.md` with YAML frontmatter (`name` matching the directory, `description`). The `description` is the auto-discovery trigger Claude Code matches in chat. Follow the `<group>-<command>` naming scheme.
2. Optionally create `plugins/marvin/commands/<command>.md` with frontmatter `description` and a body that instructs Claude to read `skills/<command>/SKILL.md` and pass `$ARGUMENTS`. Use existing `commit.md` / `sec-scan.md` as templates.
3. Add an entry to `plugins/marvin/mcp/server/src/prompts/index.ts`:
   ```ts
   {
     name: "<command>",            // becomes /marvin:<command>
     description: "...",           // short, slash-menu blurb
     skill: "<command>",           // points to skills/<command>/SKILL.md
   }
   ```
4. Run `npm run build` inside `plugins/marvin/mcp/server` to refresh `dist/server.js`.
5. Commit `src/`, `dist/`, and the new `SKILL.md` (+ optional command file) together — CI verifies dist is in sync and that SKILL.md / commands have valid frontmatter.
6. Bump the plugin version in `plugin.json` and `marketplace.json`.

For prompts with **no skill** (thin tool wrappers like the `kanban-*` group), use `body: "..."` inline. Skip steps 1 and 2.

## Adding a new MCP tool

1. Create `plugins/marvin/mcp/server/src/tools/<name>.ts` with a `defineTool({...})` export.
2. Wire it into `src/server.ts` (the `build` factory returns it under `tools`).
3. Tool input schemas use `zod`. Use `elicit(server, message, schema)` for interactive forms inside handlers.
4. Rebuild and commit `dist/`.

## Adding a new agent

1. Create `plugins/marvin/agents/<agent-name>.md` with YAML frontmatter containing `description`.
2. Specify available tools and domain constraints in the body.
3. Bump the plugin version.

## Version bumping

The plugin has one version. Bump `plugins/marvin/.claude-plugin/plugin.json`, mirror it to the matching entry in `.claude-plugin/marketplace.json`, and bump the server `package.json`. The top-level `metadata.version` is independent — bump it when the marketplace manifest schema or plugin list changes.

- **Patch** — prompt body tweaks, bug fixes
- **Minor** — new prompts, tools, or agents
- **Major** — breaking changes (server key rename, prompt name removal/rename, schema break)

## Branching & releases

Two long-lived branches (ADR-0019): **`dev`** is the integration branch and the base for all
work; **`main`** is release-only. Cut topic branches (`feat/*`, `fix/*`, `chore/*`, `docs/*`,
`sec/*`) off `dev` and open every PR **into `dev`** — never commit directly to `dev` or `main`.
A release is a `dev → main` promotion PR followed by a `vX.Y.Z` tag on `main`, which
`.github/workflows/release.yml` turns into a GitHub Release (ADR-0014).

## Key files

- `.claude-plugin/marketplace.json` — marketplace manifest (single `marvin` plugin)
- `plugins/marvin/.claude-plugin/plugin.json` — plugin manifest
- `plugins/marvin/.mcp.json` — MCP server registration (the slash prefix lives here)
- `plugins/marvin/mcp/server/src/prompts/index.ts` — the 55 prompt registrations
- `packages/marvin-mcp-shared/` — shared TypeScript library consumed by the server
- `docs/adr/0001-single-plugin-consolidation.md` — current architecture decision
- `docs/adr/0002-tool-backed-verification.md` — `verify` gate moved from prose to a tool
- `docs/adr/0003-tool-backed-dor.md` — Definition-of-Ready moved from prose to the `spec` tool
- `docs/adr/0007-marvin-working-directory.md` — the unified `.marvin/` working-directory convention
- `docs/adr/0008-mcp-door-resource-resolution.md` — the MCP door resolves `skills/...` resource paths; per-resource delegation convention
- `docs/adr/0013-self-contained-server-bundle.md` — why `dist/server.js` is bundled and committed
- `docs/adr/0014-distribution-release-model.md` — git-tag → GitHub Release; no npm publish
- `docs/adr/0020-debugger-agent.md` — root-cause analysis as the `marvin-debugger` agent
- `docs/adr/0021-lessons-feedback-loop.md` — the tool-backed `.marvin/memory/` lessons feedback loop
- `docs/adr/0023-pr-command-family.md` — the unified `pr-*` PR lifecycle (create / review / resolve / merge)
- `docs/adr/0024-mcp-apps-widget-architecture.md` — MCP Apps widget layer: data-first staging + shared `contracts/` data schemas
- `docs/adr/0025-kanban-board-only.md` — kanban goes board-only; git ops fold into the `commit`/`pr-create` skills, `link-pr` captures the PR URL
- `docs/adr/0026-configurable-status-model.md` — statuses are project data (`.marvin/config.json` `statuses`), lifecycle commands are role-driven, contracts carry `{key, role}` + role roll-ups
- `docs/adr/0027-tool-backed-adr-lifecycle.md` — the `adr` tool + `adr-*` surface: host-adaptive corpus, dual-style parser, human-gated accept/supersede/sync
- `docs/adr/0028-lessons-hygiene-and-recall-expansion.md` — lessons v2: `stats`/`prune` hygiene surface, near-duplicate guard on `add`, wider recall/capture wiring
- `docs/adr/0029-refactoring-command-family.md` — the `refactor-*` family: read → plan → apply split, findings registers under `.marvin/refactor/`, verify-gated apply rails
- `docs/adr/0030-toolbox-dashboard-and-usage-log.md` — the `dashboard` tool (whole-toolbox report, extended `DashboardState`) + the local self-ignoring `.marvin/usage/` events log (implemented by WP7)
- `packages/marvin-widgets/` — the React browser workspace for MCP Apps `ui://` widgets (ADR-0024); builds committed self-contained HTML to `plugins/marvin/widgets/`
- `plugins/marvin/mcp/server/src/resources/widgets.ts` — server-side `ui://` widget `ResourceDef`s (no ext-apps import)
- `scripts/lint-manifests.mjs` — manifest + structure linter
- `scripts/verify-dist.mjs` — committed-dist freshness guard
- `scripts/verify-widgets.mjs` — committed widget-HTML freshness + self-contained guard (ADR-0024)
- `.github/workflows/validate-plugins.yml` — CI pipeline
