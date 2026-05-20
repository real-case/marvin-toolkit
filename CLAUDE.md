# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Marvin is a Claude Code plugin marketplace. Each pack is a self-contained plugin that ships an **MCP server** (per ADR-0002), plus auto-discovered `SKILL.md` files and short markdown slash commands under `commands/`. There is no eject/scaffold step — packs work as installed by `/plugin install`.

## Architecture

Each pack delivers **one MCP server**, plus `skills/<name>/SKILL.md`, markdown slash commands under `commands/`, and `agents/*.md` files (all three auto-loaded by Claude Code on `/plugin install`):

```
plugins/<pack>/
├── .claude-plugin/plugin.json
├── .mcp.json                          # registers the pack server
├── CHANGELOG.md
├── skills/<name>/SKILL.md             # source of truth for prompt bodies
├── commands/<name>.md                 # short /mn.* slash entries
├── agents/*.md                        # optional, Claude Code subagents
└── mcp/server/
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts
    ├── src/
    │   ├── server.ts                  # entry: registers prompts + tools
    │   ├── prompts/
    │   │   └── index.ts               # prompt metadata, ref skills by name
    │   ├── tools/                     # deterministic operations (optional)
    │   └── lib/                       # pack-local helpers
    └── dist/server.js                 # COMMITTED build artefact
```

### Three doors, one room

The same `SKILL.md` is reached through **three independent entry points**:

1. **Claude Code auto-discovery.** Skills live under `plugins/<pack>/skills/<name>/SKILL.md`. Their YAML frontmatter (`description`, optional `disable-model-invocation`) is what Claude Code matches against user prose like "сделай коммит" — the skill loads automatically.
2. **Short markdown slash commands.** Each `plugins/<pack>/commands/<name>.md` is a thin Claude Code slash command that instructs the model to read its matching `SKILL.md` and pass `$ARGUMENTS`. Users see them as `/mn.*` (e.g. `/mn.commit`, `/mn.sec.scan`, `/mn.taskmaster-start`).
3. **MCP slash commands.** Each prompt entry in `plugins/<pack>/mcp/server/src/prompts/index.ts` declares `skill: "<dir-name>"`. At request time, the server reads the corresponding `SKILL.md`, strips its frontmatter, and returns the prose as a prompt body. Users see the prompt in the slash menu as `/<server>:<name>` (e.g. `/marvin-core:commit`).

All three doors lead to the same prose. Editing `SKILL.md` updates all three paths without requiring a server rebuild (the file is read at runtime by doors 2 and 3, and by door 1 on next auto-discovery).

### Instrument types

- **Skills** (`plugins/<pack>/skills/<name>/SKILL.md`) — Markdown with frontmatter. Source of truth for workflow content.
- **Markdown commands** (`plugins/<pack>/commands/<name>.md`) — Short `/mn.*` slash wrappers with frontmatter `description` and a body that delegates to the matching skill. Optional `$ARGUMENTS` placeholder.
- **MCP prompts** — Thin server-side registration that exposes a skill (or, for marvin-tasks-pack, an inline body) under `/<server>:<name>`.
- **MCP tools** — Deterministic TypeScript invoked from prompts or by the model. Each tool declares a zod input schema. Used where determinism matters (git ops, file CRUD, validation).
- **Agents** (`plugins/<pack>/agents/*.md`) — Claude Code subagents with constrained tool access. Picked up automatically on `/plugin install`.

> Exception: **marvin-tasks-pack** has no `skills/` or `commands/` directories. Its 13 prompts are thin tool-invocation wrappers registered only as MCP prompts (`/marvin-tasks:*`).

### Server keys and slash prefixes

| Pack | Server key | Slash prefix |
|------|-----------|--------------|
| marvin-core-pack | `marvin-core` | `/marvin-core:*` |
| marvin-security-pack | `marvin-sec` | `/marvin-sec:*` |
| marvin-taskmaster-pack | `marvin-tm` | `/marvin-tm:*` |
| marvin-tasks-pack | `marvin-tasks` | `/marvin-tasks:*` |

## Shared library

`packages/marvin-mcp-shared/` provides:

- typed `PromptDef` / `ToolDef` interfaces and `defineTool` helper
- `runPackServer({ name, version, promptsDir, build })` — the standard server entry
- `elicit(server, message, zodSchema)` — typed MCP elicitation wrapper
- `resolvePromptBody`, `promptsDirFromMeta`, `interpolateArgs` — body loaders

Each pack server bundles the shared lib via `tsup` (`noExternal: [/^@marvin-toolkit\//, ...]`) into a single self-contained `dist/server.js`.

## Validation

```shell
# Lint manifests + structure
node scripts/lint-manifests.mjs

# Build all packs
npm run build

# Test all packs
npm run test

# Verify committed dist/ is in sync with source
node scripts/verify-dist.mjs

# Local plugin validation
claude plugin validate .
```

CI (`.github/workflows/validate-plugins.yml`) runs the same four checks plus a stdio smoke-test that sends `initialize` to each pack server and verifies a valid response.

## Adding a new prompt to an existing pack

The canonical path is **skill-backed** — same content, three doors:

1. Create `plugins/<pack>/skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`). The `description` is the auto-discovery trigger Claude Code matches in chat.
2. Optionally create `plugins/<pack>/commands/<command-name>.md` with frontmatter `description` and a body that instructs Claude to read the new SKILL.md and pass `$ARGUMENTS`. Use the existing `mn.commit.md` / `mn.sec.scan.md` as templates.
3. Add an entry to `plugins/<pack>/mcp/server/src/prompts/index.ts`:
   ```ts
   {
     name: "<slash-name>",         // becomes /<server>:<slash-name>
     description: "...",           // short, slash-menu blurb
     skill: "<skill-name>",        // points to skills/<skill-name>/SKILL.md
   }
   ```
4. Run `npm run build` inside the pack server to refresh `dist/server.js`.
5. Commit `src/`, `dist/`, and the new `SKILL.md` (+ optional command file) together — CI verifies dist is in sync and that SKILL.md / commands have valid frontmatter.
6. Bump the pack version in `plugin.json` and `marketplace.json`.

For prompts with **no skill** (e.g. thin tool wrappers in marvin-tasks-pack), use `body: "..."` inline. Skip step 1 and step 2.

## Adding a new MCP tool

1. Create `plugins/<pack>/mcp/server/src/tools/<name>.ts` with a `defineTool({...})` export.
2. Wire it into `src/server.ts` (the `build` factory returns it under `tools`).
3. Tool input schemas use `zod`. Use `elicit(server, message, schema)` for interactive forms inside handlers.
4. Rebuild and commit `dist/`.

## Adding a new agent

1. Create `plugins/<pack>/agents/<agent-name>.md` with YAML frontmatter containing `description`.
2. Specify available tools and domain constraints in the body.
3. Bump the pack version.

## Adding a new pack

1. Create `plugins/<pack>/.claude-plugin/plugin.json`.
2. Create `plugins/<pack>/.mcp.json` registering a server key matching `marvin-*`.
3. Scaffold `plugins/<pack>/mcp/server/` with the standard layout (copy from `marvin-tasks-pack` for the canonical reference).
4. Add the pack entry to `.claude-plugin/marketplace.json`.

## Version bumping

Each pack has its own version. Bump only the affected pack's `plugin.json` and mirror the new value to the matching entry in `.claude-plugin/marketplace.json`. The top-level `metadata.version` is independent — bump it only when the marketplace manifest schema or pack list changes.

- **Patch** — prompt body tweaks, bug fixes
- **Minor** — new prompts, tools, or agents
- **Major** — breaking changes (server key rename, prompt name removal, schema break)

## Key files

- `.claude-plugin/marketplace.json` — marketplace manifest, lists all packs
- `plugins/<pack>/.claude-plugin/plugin.json` — pack manifest
- `plugins/<pack>/.mcp.json` — MCP server registration (the slash prefix lives here)
- `packages/marvin-mcp-shared/` — shared TypeScript library consumed by every pack server
- `docs/adr/0002-mcp-first-architecture.md` — architectural decision for the current layout
- `scripts/lint-manifests.mjs` — manifest + structure linter
- `scripts/verify-dist.mjs` — committed-dist freshness guard
- `.github/workflows/validate-plugins.yml` — CI pipeline
