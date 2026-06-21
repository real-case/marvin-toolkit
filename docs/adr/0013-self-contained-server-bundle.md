# ADR 0013 — Self-contained committed server bundle

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-21                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0001](0001-single-plugin-consolidation.md) (one plugin, one server), [ADR-0014](0014-distribution-release-model.md) (distribution), `plugins/marvin/mcp/server/tsup.config.ts`, `packages/marvin-mcp-shared/`, `scripts/verify-dist.mjs` |

> Records a decision already in effect since the MCP-first migration. It was previously
> documented only inside a now-retired ADR; this entry makes it a standalone, active record.

## Context

`/plugin install` checks out the marketplace repository and runs the server exactly as
committed: it does **not** run `npm install`, a build step, or any post-install hook. The
MCP server is TypeScript (`src/`) and depends on `@modelcontextprotocol/sdk`, `zod`, `yaml`,
and a workspace-local shared library (`packages/marvin-mcp-shared/`, consumed as
`@marvin-toolkit/mcp-shared`). None of those resolve at a user's checkout, because there is
no `node_modules/` and no install phase.

So the artifact that ships must be runnable with nothing but `node` and the file on disk.

## Decision

Ship **one self-contained ESM bundle** — `mcp/server/dist/server.js` — built by `tsup` and
**committed to git**.

- **Bundle everything that won't be present at runtime.** `tsup.config.ts` sets
  `noExternal: [/^@marvin-toolkit\//, "@modelcontextprotocol/sdk", "zod", "yaml"]`, so the
  shared library and the three runtime deps are inlined into the single output. The bundle
  ships no `node_modules/`.
- **Shared logic stays a workspace package, not a copy.** Common server plumbing
  (`PromptDef`/`ToolDef`, `runPackServer`, `elicit`, prompt-body loaders) lives once in
  `packages/marvin-mcp-shared/` and is inlined at build time — DRY in source, self-contained
  in the artifact.
- **CJS-in-ESM shim.** `yaml`'s bundled CJS calls `require("process")`; esbuild rewrites that
  to its `__require` shim, which throws in ESM output unless a real `require` is in scope. A
  `banner` injects one via `createRequire(import.meta.url)`.
- **Freshness is a CI gate.** `scripts/verify-dist.mjs` rebuilds and fails the job if the
  committed `dist/` differs from a fresh build, so a drifted artifact cannot merge.

## Consequences

### Positive

- The plugin runs at install time with zero setup — the dominant constraint.
- One build, one artifact, one smoke-test target (consistent with [ADR-0001](0001-single-plugin-consolidation.md)).
- Source stays DRY; the published artifact stays atomic.

### Negative / accepted trade-offs

- A ~1 MB generated `dist/server.js` is tracked in git and shows up in PR diffs as noise.
- **Every** server-source change must be followed by `npm run build` and a committed `dist/`;
  forgetting it is caught by `verify-dist`, but it is an extra step on every change.
- The committed artifact is opaque to a reviewer — trust shifts to the build being
  reproducible and the `verify-dist` gate enforcing it.
