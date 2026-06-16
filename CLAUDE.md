# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Marvin is a Claude Code plugin marketplace that ships **one plugin** (`marvin`) backed by a
**single MCP server** (per ADR-0003). The plugin exposes the whole development lifecycle —
core dev tools, a spec-driven task pipeline, security scanners, and a lightweight kanban
tracker — under one slash prefix `/marvin:`. There is no eject/scaffold step; the plugin
works as installed by `/plugin install`.

> Until 2026-06 the toolkit was four independently-installable packs each with its own
> server (`/marvin-core:*`, `/marvin-sec:*`, `/marvin-tm:*`, `/marvin-tasks:*`). ADR-0003
> consolidated them into one plugin/one server so every command shares the `/marvin:` prefix.
> See `docs/adr/0003-single-plugin-consolidation.md`.

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
└── mcp/server/
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts
    ├── src/
    │   ├── server.ts                 # entry: name "marvin"; registers prompts + tools
    │   ├── prompts/
    │   │   └── index.ts              # 38 prompt entries (skill-backed + inline kanban)
    │   ├── tools/                    # MCP tools: kanban task / git / help + verify, spec (task pipeline)
    │   ├── storage/ flows/ lib/      # kanban persistence + helpers
    └── dist/server.js                # COMMITTED build artefact
```

### Working directory (`.marvin/`)

Every **service file** marvin generates lives under a single hidden `.marvin/` directory at the
project root, one subdirectory per command group (ADR-0009):

| Path | Written by | Contents |
|------|-----------|----------|
| `.marvin/task/` | `task-*` pipeline | spec `<slug>.md` files + the current `verification.md` |
| `.marvin/security/` | `sec-*` scanners | scan / threat-model / compliance / pentest reports |
| `.marvin/kanban/` | `kanban-*` tracker | task `.md` board (the `MARVIN_TASKS_DIR` default) |
| `.marvin/config.json` | `kanban-*` tracker, `verify` | `base_branch`, `tracker_url_template`, and `verify` gate overrides (`gates`, ADR-0011) — the `MARVIN_TASKS_CONFIG` default |

Spec location stays **host-adaptive** (ADR-0007): `.marvin/task/` is the default, but an existing
host convention (`specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`) is preferred when present, and
`task-implement` / `task-deliver` / the `spec` gate search `.marvin/task/` first, then those. The
`MARVIN_TASKS_*` env vars in `.mcp.json` can repoint the kanban paths. Project **deliverables** are
deliberately *not* swept in — ADRs stay under `docs/adr/`, `CHANGELOG.md` and `README.md` at the root.

### Command naming scheme

Commands are `/marvin:<group>-<command>`; singletons stay bare. Groups:

| Group | Source | Examples |
|-------|--------|----------|
| _(bare)_ | core dev tools | `/marvin:commit`, `/marvin:debug`, `/marvin:adr`, `/marvin:changelog`, `/marvin:readme`, `/marvin:migration-plan`, `/marvin:explain`, `/marvin:docs-search` |
| `pr-*` | core PR ops | `/marvin:pr-create`, `/marvin:pr-review` |
| `task-*` | spec pipeline (taskmaster) | `/marvin:task-start`, `/marvin:task-implement`, `/marvin:task-verify`, `/marvin:task-deliver`, `/marvin:task-fix-pr` |
| `sec-*` | security scanners | `/marvin:sec-scan`, `/marvin:sec-secrets`, `/marvin:sec-deps`, `/marvin:sec-gate`, `/marvin:sec-threat-model`, `/marvin:sec-iac`, `/marvin:sec-ci`, `/marvin:sec-fix`, `/marvin:sec-compliance`, `/marvin:sec-pentest` |
| `kanban-*` | lightweight task tracker | `/marvin:kanban-menu`, `/marvin:kanban-bug`, `/marvin:kanban-feature`, `/marvin:kanban-chore`, `/marvin:kanban-spike`, `/marvin:kanban-start`, `/marvin:kanban-review`, `/marvin:kanban-done`, `/marvin:kanban-list`, `/marvin:kanban-status`, `/marvin:kanban-help`, `/marvin:kanban-commit`, `/marvin:kanban-create-pr` |

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
- **MCP tools** — Deterministic TypeScript invoked from prompts or by the model. Each tool declares a zod input schema. Used where determinism matters: the kanban `task`/`git`/`help` tools (file CRUD, git ops, dashboards), `verify` — the task pipeline's quality-gate runner (concurrent gates, single merge point, config-first gate resolution from `.marvin/config.json`, writes `verification.md`; see ADR-0004/0011) — and `spec`, the tool-backed Definition-of-Ready gate for `/marvin:task-start` (parses and zod-validates the `spec-contract` YAML block fail-closed — schema, file-path existence, the AC⇄files⇄tests traceability triple, typed oracles; see ADR-0005/0006/0007).
- **Agents** (`plugins/marvin/agents/*.md`) — Claude Code subagents with constrained tool access. Picked up automatically on `/plugin install`.

> The `kanban-*` group has **no `skills/` or `commands/` entries**. Its 13 prompts are thin tool-invocation wrappers (inline `body:`) that call the `task`/`git`/`help` MCP tools. There is no standalone workflow prose to duplicate into a skill.

### Server key and slash prefix

| Plugin | Server key | Slash prefix |
|--------|-----------|--------------|
| marvin | `marvin` | `/marvin:*` |

## Shared library

`packages/marvin-mcp-shared/` provides:

- typed `PromptDef` / `ToolDef` interfaces and `defineTool` helper
- `runPackServer({ name, version, promptsDir, packRoot, build })` — the standard server entry
- `elicit(server, message, zodSchema)` — typed MCP elicitation wrapper
- `resolvePromptBody`, `promptsDirFromMeta`, `packRootFromMeta`, `interpolateArgs` — body loaders

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

# Local plugin validation
claude plugin validate .
```

CI (`.github/workflows/validate-plugins.yml`) runs the same checks plus ESLint, Prettier, and a stdio smoke-test that sends `initialize` to the server and verifies a valid response (`serverInfo.name == "marvin"`).

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

## Key files

- `.claude-plugin/marketplace.json` — marketplace manifest (single `marvin` plugin)
- `plugins/marvin/.claude-plugin/plugin.json` — plugin manifest
- `plugins/marvin/.mcp.json` — MCP server registration (the slash prefix lives here)
- `plugins/marvin/mcp/server/src/prompts/index.ts` — the 38 prompt registrations
- `packages/marvin-mcp-shared/` — shared TypeScript library consumed by the server
- `docs/adr/0003-single-plugin-consolidation.md` — current architecture decision
- `docs/adr/0004-tool-backed-verification.md` — `verify` gate moved from prose to a tool
- `docs/adr/0005-tool-backed-dor.md` — Definition-of-Ready moved from prose to the `spec` tool
- `docs/adr/0009-marvin-working-directory.md` — the unified `.marvin/` working-directory convention
- `docs/adr/0010-mcp-door-resource-resolution.md` — the MCP door resolves `skills/...` resource paths; per-resource delegation convention
- `docs/adr/0002-mcp-first-architecture.md` — superseded; the prior four-pack design
- `scripts/lint-manifests.mjs` — manifest + structure linter
- `scripts/verify-dist.mjs` — committed-dist freshness guard
- `.github/workflows/validate-plugins.yml` — CI pipeline
