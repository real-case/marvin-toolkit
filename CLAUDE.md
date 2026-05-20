# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Marvin is a Claude Code plugin marketplace. Each pack is a self-contained plugin that ships an **MCP server** (per ADR-0002). Skills, slash-commands, and tools are exposed by that server — there are no SKILL.md files, no `commands/<name>.md` shims, and no eject/scaffold step.

## Architecture

Each pack delivers **one MCP server**, plus `skills/<name>/SKILL.md` and `agents/*.md` files (both auto-discovered by Claude Code on `/plugin install`):

```
plugins/<pack>/
├── .claude-plugin/plugin.json
├── .mcp.json                          # registers the pack server
├── CHANGELOG.md
├── skills/<name>/SKILL.md             # source of truth for prompt bodies
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

### Two doors, one room

The same `SKILL.md` is used by **two independent entry points**:

1. **Claude Code auto-discovery.** Skills live under `plugins/<pack>/skills/<name>/SKILL.md`. Their YAML frontmatter (`description`, optional `disable-model-invocation`) is what Claude Code matches against user prose like "сделай коммит" — the skill loads automatically.
2. **MCP slash commands.** Each prompt entry in `plugins/<pack>/mcp/server/src/prompts/index.ts` declares `skill: "<dir-name>"`. At request time, the server reads the corresponding `SKILL.md`, strips its frontmatter, and returns the prose as a prompt body. Users see the prompt in the slash menu as `/<server>:<name>`.

Both doors lead to the same prose. Editing `SKILL.md` updates both without requiring a server rebuild (the file is read at runtime).

### Instrument types

- **Skills** (`plugins/<pack>/skills/<name>/SKILL.md`) — Markdown with frontmatter. Source of truth for workflow content.
- **MCP prompts** — Thin server-side registration that exposes a skill (or, for marvin-tasks-pack, an inline body) under `/<server>:<name>`.
- **MCP tools** — Deterministic TypeScript invoked from prompts or by the model. Each tool declares a zod input schema. Used where determinism matters (git ops, file CRUD, validation).
- **Agents** (`plugins/<pack>/agents/*.md`) — Claude Code subagents with constrained tool access. Picked up automatically on `/plugin install`.

> Exception: **marvin-tasks-pack** has no `skills/` directory. Its 13 prompts are thin tool-invocation wrappers with inline `body:` text — there is no standalone workflow content to share.

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

The canonical path is **skill-backed** — same content, two doors:

1. Create `plugins/<pack>/skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`). The `description` is the auto-discovery trigger Claude Code matches in chat.
2. Add an entry to `plugins/<pack>/mcp/server/src/prompts/index.ts`:
   ```ts
   {
     name: "<slash-name>",         // becomes /<server>:<slash-name>
     description: "...",           // short, slash-menu blurb
     skill: "<skill-name>",        // points to skills/<skill-name>/SKILL.md
   }
   ```
3. Run `npm run build` inside the pack server to refresh `dist/server.js`.
4. Commit `src/`, `dist/`, and the new `SKILL.md` together — CI verifies dist is in sync and that SKILL.md has valid frontmatter.
5. Bump the pack version in `plugin.json` and `marketplace.json`.

For prompts with **no skill** (e.g. thin tool wrappers in marvin-tasks-pack), use `body: "..."` inline. Skip step 1.

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
