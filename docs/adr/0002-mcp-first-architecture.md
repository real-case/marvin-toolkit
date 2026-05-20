# ADR 0002 — MCP-first architecture for marvin-toolkit

| Field         | Value                                                |
| ------------- | ---------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)              |
| Date          | 2026-05-19                                           |
| Phase         | Phase 0 of the MCP-first migration                   |
| Supersedes    | ADR 0001 (source-format) — Claude-native source dropped |
| Superseded by | —                                                    |

## Context

ADR-0001 (2026-05-08) preserved the original Claude-native source layout
(`plugins/<pack>/skills/<name>/SKILL.md` + `commands/<name>.md`) and
funnelled non-Claude targets through render-time adapters in the `marvin`
CLI. That decision was a snapshot of one moment: Claude Code was the
dominant client and the CLI's eject backend served everyone else by
materialising static files into a project's `.claude/`.

Two things changed since then:

1. **Maintainer intent.** The toolkit should be installable and runnable
   purely via Claude Code's plugin mechanism — no separate CLI, no
   per-project `.claude/` materialisation. Skills, prompts, and
   project-level tools should live behind an MCP boundary so they can
   be invoked, parameterised, and (where useful) backed by deterministic
   TypeScript instead of inert markdown.
2. **Model Context Protocol matured.** Stable prompt + tool + elicitation
   support in the SDK and in Claude Code (≥ 2.1.76) makes it realistic
   to deliver the same UX as a markdown SKILL but through a programmable
   server. Each pack can now ship a small MCP server that registers its
   prompts and (optionally) deterministic tools.

This ADR records the resulting redesign.

## Decision

Each plugin pack ships **one MCP server** that exposes that pack's
functionality. The marketplace, plugin manifests, and marketplace.json
remain the entry point, but the artefact a pack delivers is fundamentally
different: a TypeScript MCP server (plus markdown prompt-bodies as
resources), not a tree of SKILL.md files and slash-command shims.

```
Old (ADR-0001)                 New (this ADR)
─────────────────              ───────────────────────────────────────────────
SKILL.md (markdown)            Stays. Used as (a) auto-discovery source for
                               Claude Code and (b) body source for the matching
                               MCP prompt. Frontmatter stripped at MCP request
                               time. Single source of truth.
commands/<name>.md             Removed. Slash UX comes from MCP prompts —
                               registered as `/<server>:<name>`.
agents/<name>.md               Unchanged — Claude Code subagent.
.mcp.json (external servers)   Plus the pack's own MCP server.
```

### Locked sub-decisions

| # | Decision |
|---|----------|
| C1 | **Per-pack MCP servers.** Every pack has its own TypeScript server with its own `package.json`, build, and `dist/server.js`. No shared runtime, no cross-pack coupling at runtime. |
| C2 | **Agents stay as `plugins/<pack>/agents/*.md`.** Claude Code picks them up on `/plugin install` without any scaffold step. Subagents are a Claude Code construct that MCP cannot fully express. |
| C3 | **Slash-command prefix `marvin-<pack>:`** for every pack. Server keys: `marvin-core`, `marvin-sec`, `marvin-tm`, `marvin-tasks`. Example commands: `/marvin-core:commit`, `/marvin-sec:scan`, `/marvin-tm:start`, `/marvin-tasks:bug`. |
| C4 | **`SKILL.md` files are the single source of truth for prompt bodies.** Each pack server reads the corresponding `SKILL.md` at request time, strips its YAML frontmatter, and returns the prose. Claude Code continues to auto-discover the same `SKILL.md` through its frontmatter `description`. Prompts can also use inline `body:` (used by marvin-tasks-pack for thin tool wrappers). |
| C5 | **`dispatch.sh` is removed.** Batch dispatch will return as a dedicated feature later, designed against the MCP server boundary. |
| C6 | **`cli/` is removed.** `@real-case/marvin` (npm) is deprecated; scaffold/eject/init/update/status are not part of the MCP-first model. |
| C7 | **Slash-command names are breaking-renamed.** No backwards-compatibility shims — the project has no installed users to migrate. |
| C8 | **Migration happens in one release.** All four packs land MCP-first in marketplace `v1.0.0`; per-pack versions `1.0.0-alpha.1`. |

## Repository layout (per pack)

```
plugins/<pack>/
├── .claude-plugin/plugin.json
├── .mcp.json                      # registers <server-key>
├── CHANGELOG.md
├── skills/<name>/SKILL.md         # single source of truth (C4)
├── agents/*.md                    # unchanged (C2)
└── mcp/server/
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts
    ├── src/
    │   ├── server.ts              # entry: register prompts + tools
    │   ├── prompts/
    │   │   └── index.ts           # references skills by name
    │   ├── tools/                 # deterministic operations (optional)
    │   └── lib/                   # pack-local helpers
    └── dist/server.js             # built artefact, COMMITTED to repo
```

> **marvin-tasks-pack exception.** This pack has no `skills/` directory. Its 13 prompts are thin wrappers around the pack's MCP tools (`task`/`git`/`help`) and use inline `body:` text. They have no standalone workflow content worth duplicating into a skill.

`dist/server.js` is committed because `/plugin install` does not run
`npm install` or any post-install hook — the server must be runnable as
checked out. CI rebuilds and fails the job if `dist/` is stale.

## Shared library

A workspace package `packages/marvin-mcp-shared` provides:

- typed `PromptBundle` and `ToolBundle` interfaces
- elicitation helpers wrapping the MCP SDK
- a markdown loader that reads `*.md` next to the bundled server
- thin re-exports of pinned `@modelcontextprotocol/sdk` and `zod`

It is consumed at build time by `tsup` and bundled into each pack's
`dist/server.js`. Pack servers do **not** ship `node_modules/`; the
bundle is self-contained.

## Consequences

### Positive

- Single distribution channel (Claude Code plugin install); no separate
  CLI, no per-project scaffolded files.
- Pack servers can grow deterministic tools (e.g. git operations,
  validation) without leaving the markdown-as-instruction comfort zone
  for everything else.
- Subagents and MCP prompts coexist cleanly — each occupies the layer
  where it is strongest.
- Adding a new pack is mechanical: clone the layout, write prompts,
  build, register in `marketplace.json`.

### Negative

- Loss of "Claude-native source" guarantee. Other MCP clients work if
  they implement the prompt + elicitation slice the packs use, but
  non-MCP editors (Codex CLI, Cursor without MCP) no longer have a
  rendering path. ADR-0001's Codex adapter playbook is obsolete.
- Per-pack TypeScript build, including `dist/` committed to git, adds
  visible noise in PRs.
- Subagents are not invocable from foreign MCP clients — they remain a
  Claude Code-only feature inside each pack.

### Neutral

- Marketplace manifest (`.claude-plugin/marketplace.json`) and per-pack
  `plugin.json` are unchanged in shape.

## What would have to change to revisit this

Restoring a CLI/eject path would require:

1. A new ADR explicitly superseding this one.
2. A rendering layer that walks each pack's MCP server, snapshots its
   prompts to markdown, and writes them into `.claude/` (or another
   target directory). This is mechanically possible because prompt
   bodies are already markdown — the loss is everything tools do.
3. Re-introducing a CLI package or replacing it with a different
   distribution mechanism.

The current design does not paint over that path; it simply does not
ship it. If a second client family demands it, the path is open.

## References

- ADR-0001 (superseded by this ADR) — original source-format decision.
- Migration plan: see commit history under Phase 0–5 of the MCP-first
  migration.
