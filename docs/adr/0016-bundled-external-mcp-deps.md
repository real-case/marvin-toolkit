# ADR 0016 — Bundled external MCP dependencies

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-21                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0015](0015-verify-shell-trust-boundary.md) (trust boundary), [ADR-0014](0014-distribution-release-model.md) (distribution), `plugins/marvin/.mcp.json`, `SECURITY.md` |

> Records a decision already in effect, and the supply-chain pinning policy adopted in
> [#33](https://github.com/real-case/marvin-toolkit/pull/33).

## Context

Beyond its own server, Marvin's `.mcp.json` registers two **external** MCP servers that the
`research` agent and the docs-search flows lean on:

- **context7** — up-to-date library documentation, run locally via `npx`.
- **gitmcp** — repository documentation, reached as a remote service.

Bundling them means installing Marvin makes the research surface work out of the box. It also
means Marvin's `.mcp.json` extends the user's dependency and trust surface — so *which*
servers, *how* they are launched, and *how* they are pinned are real decisions, not defaults.

## Decision

**Register context7 and gitmcp in `.mcp.json` so they ship with the plugin, and pin the
runnable one.**

- **context7 is version-pinned.** `npx -y @upstash/context7-mcp@3.2.1` — an exact version, not
  a floating `@latest`. An unpinned `npx -y` would resolve and execute whatever the registry
  serves at run time; pinning removes that moving target (hardened in
  [#33](https://github.com/real-case/marvin-toolkit/pull/33)).
- **gitmcp is a remote URL** (`https://gitmcp.io/docs`) — no local code execution; the trust
  is in the remote service and transport.
- **Disclosed as trust surface.** `SECURITY.md` names both external servers and how each is
  launched, consistent with the disclosure posture of [ADR-0015](0015-verify-shell-trust-boundary.md).
- **Removable.** A user who does not want them can delete the entries from `.mcp.json`; the
  marvin server itself does not depend on them.

## Consequences

### Positive

- The research/docs flows work immediately after install — no separate MCP setup.
- A pinned context7 version makes the supply chain reproducible and reviewable.

### Negative / accepted trade-offs

- Installing Marvin adds two third-party servers to the user's environment; that surface must
  be disclosed and kept current.
- A pinned version must be bumped deliberately to get upstream fixes — pinning trades
  auto-updates for predictability.
- gitmcp introduces a runtime dependency on a remote service; if it is unavailable, the flows
  that use it degrade.
