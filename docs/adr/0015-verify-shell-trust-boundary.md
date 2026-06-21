# ADR 0015 — `verify` shell-execution trust boundary

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-21                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0002](0002-tool-backed-verification.md) (the `verify` tool), [ADR-0009](0009-config-first-gate-resolution.md) (config-first gate resolution), `plugins/marvin/mcp/server/src/tools/verify.ts`, `SECURITY.md` |

> Records and formalises the trust boundary already documented in `SECURITY.md`, making the
> security decision auditable as an ADR.

## Context

The `verify` tool ([ADR-0002](0002-tool-backed-verification.md)) exists to run a project's
real quality gates — its tests, lint, type-check, and build. By definition those are commands
the project defines, in the project's own toolchain (`package.json` scripts, `Makefile`
targets, or explicit `.marvin/config.json` `gates`). To run them faithfully, the tool spawns
them through a shell.

That makes `verify` an intentional **trust boundary**: running Marvin against a repository
runs that repository's declared build commands on the user's machine. A reviewer evaluating
Marvin's safety needs this stated plainly rather than buried in code.

The design alternatives are a sandbox (containerised/seccomp execution) or an allowlist of
"known safe" commands. Both defeat the tool's purpose — the whole point is to execute *this
project's actual gates*, which are arbitrary by nature and differ per repo and per stack.

## Decision

**`verify` executes the project's own declared gate commands through a shell, and this is a
documented trust boundary equivalent to running that repo's `npm test` yourself.**

- **What runs.** Only commands the project declares — `.marvin/config.json` `gates`,
  `package.json` scripts, and `Makefile` targets — resolved per [ADR-0009](0009-config-first-gate-resolution.md)
  (config-first, then auto-detected stack). Marvin does not inject commands of its own.
- **Trust model.** Treat an untrusted repository's build commands as you would treat running
  `npm test` in it. This is stated in `SECURITY.md` under **Trust boundary**.
- **No sandbox, no allowlist — by design.** Sandboxing would prevent the gates from doing
  what they legitimately must (touch the filesystem, hit the network for deps); an allowlist
  cannot enumerate arbitrary project commands. The honest control is *disclosure plus
  config-first scoping*, not a false promise of isolation.

## Consequences

### Positive

- The security posture is explicit and matches user intuition (running a repo's tests is
  already executing its code).
- Config-first resolution ([ADR-0009](0009-config-first-gate-resolution.md)) means the
  commands are auditable in `.marvin/config.json` rather than inferred opaquely.

### Negative / accepted trade-offs

- Running `verify` on an untrusted repository runs that repo's commands. Accepted and
  disclosed; the mitigation is operator awareness, not technical isolation.
- `verify` is the only place the server uses `shell:true` execution, which keeps the audited
  exec surface small but concentrated — it is the highest-scrutiny code path in the server.
