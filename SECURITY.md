# Security Policy

## Supported versions

Marvin is pre-1.0. Security fixes are applied to the latest released version of
the plugin only. There are no long-term support branches yet.

| Version            | Supported |
| ------------------ | --------- |
| `2.0.0-alpha.x`    | ✅        |
| earlier pre-alpha  | ❌        |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: open a [GitHub security advisory](https://github.com/real-case/marvin-toolkit/security/advisories/new).
- Alternatively, email **personal@yurii-anichkin.dev** with the details.

Include where possible:

- the affected command or area and the plugin version,
- a description of the issue and its impact,
- steps to reproduce or a proof of concept.

You can expect an initial acknowledgement within a few days. Once a fix is
released, the advisory will be published with appropriate credit unless you
prefer to remain anonymous.

## Scope

Marvin ships an MCP server and prompt/skill content that run inside Claude Code on
the user's machine. Of particular interest:

- handling of untrusted input in the kanban MCP tools (`plugins/marvin/mcp/server/src/tools/`),
- git and shell operations performed by tools and skills,
- secret-handling guidance in the `sec-*` and core skills (`plugins/marvin/skills/`).

**Trust boundary.** The `verify` tool and the task pipeline execute the **commands a project
declares** — `.marvin/config.json` `gates`, `package.json` scripts, and `Makefile` targets — through a
shell, to run that project's tests / lint / build. Running marvin against a repository therefore runs
that repository's declared commands; treat an untrusted repo's build commands as you would treat
running `npm test` in it. marvin also registers two external MCP servers — `context7` (run via `npx`)
and `gitmcp` (a remote service) — see `plugins/marvin/.mcp.json`.
