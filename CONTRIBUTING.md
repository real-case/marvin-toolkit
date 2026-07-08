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
[ADR-0001](./docs/adr/0001-single-plugin-consolidation.md).

See [CLAUDE.md](./CLAUDE.md) for the full architecture reference, including the
"three doors, one room" model and step-by-step recipes for adding prompts,
tools, and agents.

## Quality gates

Every change must pass the same checks CI runs. Run them locally before pushing:

```shell
npm run lint              # ESLint (TypeScript source)
npm run format:check      # Prettier (run `npm run format` to auto-fix)
npm run lint:manifests    # marketplace + plugin manifest structure
npm run lint:docs         # README/docs ADR coverage + working-dir paths
npm run build             # build every workspace
npm run test              # Node.js native test suites
npm run coverage          # tests with c8 coverage (text + lcov)
npm run verify-dist       # committed dist/server.js matches a fresh build
```

A [husky](https://typicode.github.io/husky/) pre-commit hook runs `lint-staged`
(Prettier + ESLint on staged files) automatically — it installs itself via the
`prepare` script when you run `npm ci`.

`dist/server.js` is a **committed build artefact** — after changing any MCP
server source, rebuild and commit `dist/` together with `src/`. CI rejects a
stale `dist/` via `verify-dist.mjs`.

## Submitting a change

`dev` is the integration branch and the base for all contributions; `main` is
release-only and advances solely through a `dev → main` promotion PR. Every
change lands through a pull request — no direct pushes to either branch
(see [ADR-0019](docs/adr/0019-branching-and-pr-flow.md)).

1. Branch off `dev` with a topic branch — `feat/…`, `fix/…`, `chore/…`,
   `docs/…`, or `sec/…`.
2. Make your edits under `plugins/marvin/` (or `packages/` for the shared library).
3. If you touched the MCP server, rebuild it (`npm run build`) and commit `dist/`.
4. Bump the version with `npm run sync-version <x.y.z>` (see versioning below).
5. Run the full quality-gate suite above.
6. Open a PR **into `dev`**. CI lints manifests, builds, tests, smoke-tests the
   MCP server, and verifies `dist/` is in sync.

Maintainers cut a release by promoting `dev → main` via PR and tagging `vX.Y.Z`
on `main`, which the release workflow turns into a GitHub Release
([ADR-0014](docs/adr/0014-distribution-release-model.md)).

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) — e.g.
`feat(core): add migration-plan prompt`, `fix(kanban): handle missing config`.

## Versioning

The whole repo shares one version. Bump it in one step with
`npm run sync-version <x.y.z>`, which propagates the version from
`plugins/marvin/.claude-plugin/plugin.json` to every workspace `package.json` and the
marketplace plugin entry; then run `npm run build` so the server picks it up. The
server's runtime `VERSION` is injected from its `package.json` at build time, and
`npm run lint:manifests` fails the build if any version drifts. The marketplace's
top-level `metadata.version` is independent — change it only when the manifest schema
or plugin list changes.

- **Patch** — prompt body tweaks, bug fixes
- **Minor** — new prompts, tools, or agents
- **Major** — breaking changes (server-key rename, prompt removal, schema break)

## Releasing

Marvin installs via the Claude Code marketplace (git), so a release is a tag plus a
GitHub Release — there is no npm publish.

1. Bump the version with `npm run sync-version <x.y.z>`, rebuild (`npm run build`),
   and update both changelogs (`plugins/marvin/CHANGELOG.md` for the plugin, root
   `CHANGELOG.md` for marketplace-level changes).
2. Tag and push: `git tag v<version> && git push origin v<version>`.
3. The [release workflow](./.github/workflows/release.yml) opens a GitHub Release,
   pulling its notes from `plugins/marvin/CHANGELOG.md`. Pre-1.0 tags
   (`-alpha` / `-beta` / `-rc`) are marked as pre-releases automatically.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
