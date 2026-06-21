# ADR 0014 — Distribution & release model

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-21                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0013](0013-self-contained-server-bundle.md) (committed bundle), [ADR-0019](0019-branching-and-pr-flow.md) (release = tag on `main`), `.claude-plugin/marketplace.json`, `.github/workflows/release.yml`, `docs/publishing.md` |

> Records the distribution and release model already in effect. It promotes a decision that
> previously lived only in the publishing checklist into a first-class architecture record.

## Context

Marvin is a Claude Code plugin backed by a bundled MCP server ([ADR-0013](0013-self-contained-server-bundle.md)).
There are several plausible ways to distribute and version it, and they are mutually
exclusive enough to pick deliberately:

1. **Claude Code plugin marketplace** — a git repository plus `marketplace.json`; users run
   `/plugin marketplace add <repo>` then `/plugin install marvin`.
2. **npm** — publish the server (and/or a CLI) as a package and version it on the registry.
3. **The MCP registry** (`modelcontextprotocol.io/registry`) — catalogs *standalone-published*
   MCP servers (npm/PyPI/Docker artifacts).

The choice shapes discoverability, what "a release" means, and what users must trust.

## Decision

**Distribute through the Claude Code plugin marketplace; release via git tags and GitHub
Releases; do not publish to npm.**

- **Install path.** The repository *is* the distribution. `marketplace.json` lists the single
  `marvin` plugin; `/plugin install` reads the committed tree directly (which is why the
  server bundle is committed — [ADR-0013](0013-self-contained-server-bundle.md)).
- **A release is a tag.** `.github/workflows/release.yml` triggers on `push` of a `v*` tag,
  extracts the matching `## [<version>]` section from `plugins/marvin/CHANGELOG.md`, and
  creates a GitHub Release with those notes (`prerelease` when the tag carries
  `-alpha`/`-beta`/`-rc`). Publishing is therefore `git tag vX.Y.Z && git push origin vX.Y.Z`.
- **No npm publish.** The bundled server is an implementation detail of the plugin, not a
  standalone package.
- **MCP registry is out of scope.** It catalogs independently-published server artifacts;
  Marvin's server is bundled inside the plugin and intentionally not on npm, so the registry
  model does not fit. Revisit only if the server is ever split into a standalone artifact.

## Consequences

### Positive

- One source of truth (the repo); listings elsewhere merely point back to it.
- "Cutting a release" is a tag — no registry credentials, no publish pipeline to secure.
- Versioning is governed by the plugin's own semver, independent of any registry cadence.

### Negative / accepted trade-offs

- No `npm install` reach; discovery depends on the marketplace, the official directory, and
  repo discoverability (topics, README) rather than registry search.
- Release notes quality depends on changelog discipline — the workflow only renders what the
  `CHANGELOG.md` section contains.
- Splitting the server into a reusable standalone package later would require revisiting this
  decision (and the registry trade-off above).
