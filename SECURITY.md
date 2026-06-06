# Security Policy

## Supported versions

Marvin is pre-1.0. Security fixes are applied to the latest released version of
each pack only. There are no long-term support branches yet.

| Version            | Supported |
| ------------------ | --------- |
| `1.0.0-alpha.x`    | ✅        |
| earlier pre-alpha  | ❌        |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: open a [GitHub security advisory](https://github.com/real-case/marvin-toolkit/security/advisories/new).
- Alternatively, email **personal@yurii-anichkin.dev** with the details.

Include where possible:

- the affected pack and version,
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
