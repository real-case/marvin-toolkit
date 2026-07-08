# Contributing to Marvin

Thank you for your interest in improving Marvin. This guide covers the local setup, the
validation gates your change must pass, and how the repository is laid out.

## Prerequisites

You need Node.js 20 or later and npm, since the repository is an npm workspaces monorepo.
Clone it and install the dependencies:

```shell
git clone https://github.com/real-case/marvin-toolkit
cd marvin-toolkit
npm ci
```

Running `npm ci` also installs the husky pre-commit hook through the `prepare` script.

## Repository layout

Marvin is a single Claude Code plugin that ships one MCP server plus auto-discovered
skills, markdown slash commands, agents, and widgets:

```
plugins/marvin/
├── .claude-plugin/plugin.json     # plugin manifest
├── .mcp.json                      # registers the "marvin" MCP server
├── skills/<command>/SKILL.md      # source of truth for prompt bodies
├── commands/<command>.md          # short /<command> slash wrappers
├── agents/*.md                    # Claude Code subagents
├── widgets/*.html                 # committed self-contained MCP Apps widgets
└── mcp/server/                    # TypeScript MCP server, bundled to dist/server.js
```

Two workspaces under [`packages/`](./packages) support the plugin: `marvin-mcp-shared` is
the shared TypeScript library the server consumes, and `marvin-widgets` is the browser
workspace that builds the committed widget HTML. Every command is
`/marvin:<group>-<command>`, and singletons stay bare.

The architectural rationale is recorded in [`docs/adr/`](./docs/adr/); start with
[ADR-0001](./docs/adr/0001-single-plugin-consolidation.md). For the full architecture
reference, including the "three doors, one room" model and step-by-step recipes for adding
prompts, tools, and agents, read [CLAUDE.md](./CLAUDE.md).

## Quality gates

Every change must pass the same checks CI runs. Run them locally before you push:

```shell
npm run lint                      # ESLint over the TypeScript source
npm run format:check              # Prettier; run `npm run format` to auto-fix
npm run lint:manifests            # marketplace and plugin manifest structure
npm run lint:docs                 # ADR coverage and working-directory paths
npm run build                     # build every workspace
npm run test                      # Node.js native test suites
npm run verify-dist               # committed dist/server.js matches a fresh build
node scripts/verify-widgets.mjs   # committed widget HTML matches a fresh build
```

Run `npm run coverage` when you want the test suites with c8 coverage reporting.

A [husky](https://typicode.github.io/husky/) pre-commit hook runs `lint-staged`, which
applies Prettier and ESLint to your staged files automatically. Because `dist/server.js` is
a committed build artifact, rebuild and commit `dist/` alongside `src/` after changing any
MCP server source. CI rejects a stale `dist/` through `verify-dist.mjs`, and it rejects
stale widget HTML through `verify-widgets.mjs`.

## Submitting a change

`dev` is the integration branch and the base for all contributions, while `main` is
release-only and advances solely through a `dev → main` promotion PR. Every change lands
through a pull request, with no direct pushes to either branch
(see [ADR-0019](./docs/adr/0019-branching-and-pr-flow.md)).

1. Branch off `dev` with a topic branch named `feat/…`, `fix/…`, `chore/…`, `docs/…`, or `sec/…`.
2. Make your edits under `plugins/marvin/`, or under `packages/` for the shared library and widgets.
3. If you touched the MCP server, rebuild it with `npm run build` and commit `dist/`.
4. Bump the version with `npm run sync-version <x.y.z>`, as the versioning section below describes.
5. Run the full quality-gate suite above.
6. Open a PR into `dev`. CI lints the manifests, builds, tests, smoke-tests the MCP server, and verifies that `dist/` is in sync.

Maintainers cut a release by promoting `dev → main` through a PR and tagging `vX.Y.Z` on
`main`, which the release workflow turns into a GitHub Release
([ADR-0014](./docs/adr/0014-distribution-release-model.md)).

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/), for example
`feat(core): add migration-plan prompt` or `fix(kanban): handle missing config`.

## Versioning

The whole repository shares one version. Bump it in a single step with
`npm run sync-version <x.y.z>`, which propagates the version from
`plugins/marvin/.claude-plugin/plugin.json` to every workspace `package.json` and the
marketplace plugin entry; then run `npm run build` so the server picks it up. The server's
runtime `VERSION` is injected from its `package.json` at build time, and
`npm run lint:manifests` fails the build if any version drifts. The marketplace's top-level
`metadata.version` is independent — change it only when the manifest schema or the plugin
list changes.

- A **patch** covers prompt body tweaks and bug fixes.
- A **minor** covers a new prompt, tool, or agent.
- A **major** covers a breaking change, such as a server-key rename, a prompt removal, or a schema break.

## Releasing

Marvin installs through the Claude Code marketplace over git, so a release is a tag plus a
GitHub Release, with no npm publish.

1. Bump the version with `npm run sync-version <x.y.z>`, rebuild with `npm run build`, and update both changelogs — `plugins/marvin/CHANGELOG.md` for the plugin and the root `CHANGELOG.md` for marketplace-level changes.
2. Tag and push: `git tag v<version> && git push origin v<version>`.
3. The [release workflow](./.github/workflows/release.yml) opens a GitHub Release, drawing its notes from `plugins/marvin/CHANGELOG.md`. Pre-1.0 tags with an `-alpha`, `-beta`, or `-rc` suffix are marked as pre-releases automatically.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
