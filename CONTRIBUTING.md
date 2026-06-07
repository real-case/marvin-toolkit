# Contributing to Marvin

Thanks for your interest in improving Marvin. This guide covers the local setup,
the validation gates your change must pass, and how the repository is laid out.

## Prerequisites

- Node.js `>= 20`
- npm (the repo is an npm workspaces monorepo)

```shell
git clone https://github.com/real-case/marvin-toolkit
cd marvin-toolkit
npm ci
```

## Repository layout

Marvin is a single Claude Code plugin shipping one MCP server plus
auto-discovered skills, markdown slash commands, and agents:

```
plugins/marvin/
├── .claude-plugin/plugin.json     # plugin manifest
├── .mcp.json                      # registers the "marvin" MCP server
├── skills/<command>/SKILL.md      # source of truth for prompt bodies
├── commands/<command>.md          # short /<command> slash wrappers
├── agents/*.md                    # Claude Code subagents
└── mcp/server/                    # TypeScript MCP server (bundled to dist/server.js)
```

Every command is `/marvin:<group>-<command>` (singletons bare). The shared TypeScript
library lives in [`packages/marvin-mcp-shared`](./packages/marvin-mcp-shared).
Architectural rationale is recorded in [`docs/adr/`](./docs/adr/) — start with
[ADR-0003](./docs/adr/0003-single-plugin-consolidation.md).

See [CLAUDE.md](./CLAUDE.md) for the full architecture reference, including the
"three doors, one room" model and step-by-step recipes for adding prompts,
tools, and agents.

## Quality gates

Every change must pass the same checks CI runs. Run them locally before pushing:

```shell
npm run lint              # ESLint (TypeScript source)
npm run format:check      # Prettier (run `npm run format` to auto-fix)
npm run lint:manifests    # marketplace + plugin manifest structure
npm run build             # build every workspace
npm run test              # Node.js native test suites
npm run verify-dist       # committed dist/server.js matches a fresh build
```

`dist/server.js` is a **committed build artefact** — after changing any MCP
server source, rebuild and commit `dist/` together with `src/`. CI rejects a
stale `dist/` via `verify-dist.mjs`.

## Submitting a change

1. Create a branch for your change.
2. Make your edits under `plugins/marvin/` (or `packages/` for the shared library).
3. If you touched the MCP server, rebuild it (`npm run build`) and commit `dist/`.
4. Bump the plugin's `plugin.json` version and mirror it in
   `.claude-plugin/marketplace.json` (see versioning below).
5. Run the full quality-gate suite above.
6. Open a PR. CI lints manifests, builds, tests, smoke-tests the MCP server,
   and verifies `dist/` is in sync.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) — e.g.
`feat(core): add migration-plan prompt`, `fix(kanban): handle missing config`.

## Versioning

The plugin carries one version. Bump `plugins/marvin/.claude-plugin/plugin.json`,
mirror it into the `.claude-plugin/marketplace.json` entry, and bump the server
`package.json`.

- **Patch** — prompt body tweaks, bug fixes
- **Minor** — new prompts, tools, or agents
- **Major** — breaking changes (server-key rename, prompt removal, schema break)

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
