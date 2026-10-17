# Security policy

## Supported versions

Marvin is pre-1.0, so security fixes are applied to the latest released version of the
plugin only. There are no long-term support branches yet.

| Version  | Supported |
| -------- | --------- |
| `0.29.x` | Yes       |

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue. You have two
options:

- Open a [GitHub security advisory](https://github.com/real-case/marvin-toolkit/security/advisories/new), which is preferred.
- Email **personal@yurii-anichkin.dev** with the details.

Include the following where you can:

- the affected command or area and the plugin version,
- a description of the issue and its impact,
- steps to reproduce it, or a proof of concept.

You can expect an initial acknowledgement within a few days. Once a fix is released, the
advisory is published with appropriate credit unless you prefer to remain anonymous.

## Scope

Marvin ships an MCP server and prompt content that run inside Claude Code on your machine.
The areas of particular interest are:

- how the board MCP tools handle untrusted input, under `plugins/marvin/mcp/server/src/tools/`,
- the git and shell operations that tools and skills perform,
- the secret-handling guidance in the `sec-*` and core skills, under `plugins/marvin/skills/`.

## Trust boundary

The `verify` tool and the task pipeline execute the **commands a project declares** — the
`gates` in `.marvin/config.json`, `package.json` scripts, and `Makefile` targets — through
a shell, in order to run that project's tests, lint, and build. Running Marvin against a
repository therefore runs that repository's declared commands, so treat an untrusted repo's
build commands the way you would treat running `npm test` in it.

The autopilot pipeline (`/marvin:autopilot`) goes further: it starts headless `claude -p`
children that edit the repository and run its test commands without a human approving each
step. They run as your OS user, with your environment and credentials, in a git worktree
outside the repository. The guards under `plugins/marvin/pipeline/hooks/` keep them on the
run branch, refuse protected and sealed files, and keep `gh` to the run's own pull request,
but a child that writes a test file and runs it executes code no guard inspects. Run the
autopilot only on repositories whose content you trust, and use a container or a dedicated
OS user when a task could be steered by untrusted input such as an issue body.

Marvin also registers two external MCP servers, described in `plugins/marvin/.mcp.json`:
`context7`, which runs through `npx`, and `gitmcp`, which is a remote service.
