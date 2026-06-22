# Marvin

> Claude Code toolkit for those who don't panic.

[![CI](https://github.com/real-case/marvin-toolkit/actions/workflows/validate-plugins.yml/badge.svg)](https://github.com/real-case/marvin-toolkit/actions/workflows/validate-plugins.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Marvin is a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin shipping **MCP-first** workflows that cover the full development lifecycle. One plugin, one MCP server, one slash prefix — `/marvin:` — install it and get structured, repeatable workflows inside Claude Code.

**Three doors, one room.** Each skill lives once at `plugins/marvin/skills/<command>/SKILL.md`. Three entry points reach the same workflow body:

1. **Chat auto-discovery** — describe what you want ("сделай коммит") and Claude Code matches the skill via its frontmatter `description`.
2. **Markdown slash command** — `/commit`, `/sec-scan`, `/task-start`. Thin wrappers under `plugins/marvin/commands/`. Same workflow, terser invocation.
3. **MCP prompt slash command** — `/marvin:commit`, `/marvin:sec-scan`, `/marvin:task-start`. Served by the bundled MCP server.

Pick whichever feels right — they all use the same `SKILL.md`.

## Install

```shell
/plugin marketplace add real-case/marvin-toolkit
/plugin install marvin@marvin-toolkit
```

The plugin registers one MCP server (`marvin`). Commands appear as `/marvin:<group>-<command>`.

## Command naming

Commands are `/marvin:<group>-<command>`; singletons stay bare. The groups:

| Group | What | Count |
|-------|------|-------|
| _(bare)_ | core developer tools | 8 |
| `pr-*` | pull-request operations | 2 |
| `task-*` | spec-driven task pipeline | 5 |
| `sec-*` | security scanners | 10 |
| `kanban-*` | lightweight task tracker | 13 |

38 prompts total, all under `/marvin:`. The skill-backed groups (core, `pr-*`, `task-*`, `sec-*`) have all three doors; the `kanban-*` group is MCP-only (thin tool wrappers, no SKILL.md).

### Core developer tools

Language-agnostic, used by every engineer.

| Command | Description |
|---------|-------------|
| `/marvin:commit` | Generate conventional commit messages with sensitive file detection |
| `/marvin:pr-create` | Create PRs with structured descriptions and pre-flight checks |
| `/marvin:pr-review` | Code review by severity (critical, warning, suggestion) |
| `/marvin:debug` | Systematic root-cause analysis with hypotheses |
| `/marvin:adr` | Create Architecture Decision Records |
| `/marvin:changelog` | Generate changelog from git history |
| `/marvin:readme` | Generate or update README.md |
| `/marvin:migration-plan` | Plan migrations with risks and rollback strategy |
| `/marvin:explain` | Explain code, architecture, and execution flow |
| `/marvin:docs-search` | Search and synthesize project documentation |

**Agents:** `marvin-guide`, `marvin-researcher`, `marvin-debugger` (root-cause analysis — also drives `task-start`'s bugfix flow).

**External MCP servers also registered:** `context7` (library docs lookup), `gitmcp` (GitHub repository docs).

### Security — `sec-*`

OWASP Top 10, dependency audits, compliance checks.

| Command | Description |
|---------|-------------|
| `/marvin:sec-scan` | Comprehensive OWASP Top 10:2025 audit (orchestrates secrets + deps + static analysis) |
| `/marvin:sec-secrets` | Deep scan for leaked secrets across code, config, and git history |
| `/marvin:sec-deps` | Audit dependencies for vulnerabilities, license risks, and maintenance health |
| `/marvin:sec-gate` | Fast pre-commit security check — scoped to staged changes only |
| `/marvin:sec-threat-model` | STRIDE-based threat modeling for features or systems |
| `/marvin:sec-iac` | Infrastructure-as-Code security (Terraform, K8s, Docker, CloudFormation) |
| `/marvin:sec-ci` | CI/CD pipeline security audit (GitHub Actions, GitLab CI, Jenkins) |
| `/marvin:sec-fix` | Generate and verify fixes for vulnerabilities with regression tests |
| `/marvin:sec-compliance` | OWASP ASVS compliance checking (L1/L2/L3) |
| `/marvin:sec-pentest` | Generate application-specific penetration testing checklist |

**Agent:** `marvin-auditor`.

### Task pipeline — `task-*`

Spec-driven pipeline — separates human decisions from automated execution.

| Command | Description |
|---------|-------------|
| `/marvin:task-start` | Interactive spec co-creation (feature/bugfix flows, solution variants, DoR gate) |
| `/marvin:task-implement` | Execute a ready spec interactively in the current session |
| `/marvin:task-verify` | Run quality gates (tests, lint, type-check, build) with stack auto-detection |
| `/marvin:task-deliver` | Commit + PR, gated on verification passing |
| `/marvin:task-fix-pr` | Apply PR review comments as code fixes |

**Agents:** `marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`, `marvin-tm-review-fixer`.

> Batch dispatch (the old `dispatch.sh`) was removed; it will return as a dedicated feature later, designed against the MCP boundary.

### Kanban tracker — `kanban-*`

Lightweight per-project task tracker with interactive MCP-elicit forms — inquirer-style speed inside Claude Code.

| Command | Description |
|---------|-------------|
| `/marvin:kanban-menu` | Main menu |
| `/marvin:kanban-bug` / `-feature` / `-chore` / `-spike` | Quick-create a task of the given type |
| `/marvin:kanban-start` | Pick a todo task, branch off, mark WIP |
| `/marvin:kanban-review` | Move current task to review |
| `/marvin:kanban-done` | Mark current task done |
| `/marvin:kanban-list` | List all tasks grouped by status |
| `/marvin:kanban-status` | Current branch + WIP tasks |
| `/marvin:kanban-help` | Project dashboard |
| `/marvin:kanban-commit` | Commit with task context |
| `/marvin:kanban-create-pr` | Open PR with task context |

Storage: `.marvin/kanban/<seq>[-<tracker>]--<slug>.md`, optional `.marvin/config.json` (`base_branch`, `tracker_url_template`) — the default working directory per [ADR-0009](./docs/adr/0009-marvin-working-directory.md), overridable via the `MARVIN_TASKS_*` env vars.

`task-*` (heavyweight spec pipeline) and `kanban-*` (quick tracker) are intentionally distinct — use `task-*` for large features that deserve a spec, `kanban-*` for fast day-to-day tracking.

## Development lifecycle

```
Plan                  Code               Review            Secure              Document             Ship                Pipeline
├─ marvin:adr         ├─ marvin:debug    └─ marvin:        ├─ marvin:sec-scan  ├─ marvin:readme     ├─ marvin:commit    ├─ marvin:task-start
└─ marvin:            ├─ marvin:explain     pr-review      ├─ marvin:sec-      ├─ marvin:changelog  └─ marvin:pr-create ├─ marvin:task-implement
   migration-plan     └─ marvin:                              secrets          └─ marvin:                              ├─ marvin:task-verify
                         docs-search                       ├─ marvin:sec-deps     docs-search                          ├─ marvin:task-deliver
                                                            ├─ marvin:sec-gate                                          └─ marvin:task-fix-pr
                                                            └─ ...
```

For day-to-day task tracking, layer the `kanban-*` commands on top of either workflow.

## Architecture decisions

A visual architecture tour — diagrams of the three doors, the task pipeline, and
the `.marvin/` layout — lives in **[docs/architecture.md](./docs/architecture.md)**
(the [docs/](./docs/) folder is the documentation home).

Decisions with long-lived consequences are recorded as ADRs under [docs/adr/](./docs/adr/). The two pre-consolidation ADRs (source-format, MCP-first) were retired in the v2 publication cut; their still-relevant rationale is folded into 0001/0013/0018.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](./docs/adr/0001-single-plugin-consolidation.md) | Single-plugin consolidation under one `/marvin:` prefix | Accepted |
| [0002](./docs/adr/0002-tool-backed-verification.md) | Tool-backed verification gate | Accepted |
| [0003](./docs/adr/0003-tool-backed-dor.md) | Tool-backed Definition-of-Ready gate | Accepted |
| [0004](./docs/adr/0004-traceable-spec-contract.md) | Traceable spec contract and gate reordering | Accepted |
| [0005](./docs/adr/0005-portable-spec-contract.md) | Portable, host-adaptive spec contract | Accepted |
| [0006](./docs/adr/0006-all-subagents-opus.md) | All subagents on Opus; economy via deterministic tools | Accepted |
| [0007](./docs/adr/0007-marvin-working-directory.md) | Unified `.marvin/` working directory | Accepted |
| [0008](./docs/adr/0008-mcp-door-resource-resolution.md) | MCP-door plugin-resource resolution | Accepted |
| [0009](./docs/adr/0009-config-first-gate-resolution.md) | Config-first gate resolution for `verify` | Accepted |
| [0010](./docs/adr/0010-tool-backed-contract-seal.md) | Tool-backed contract-seal verification | Accepted |
| [0011](./docs/adr/0011-tool-backed-scope-gate.md) | Tool-backed scope-allowlist gate | Accepted |
| [0012](./docs/adr/0012-tool-backed-delivery-gate.md) | Tool-backed delivery gate | Accepted |
| [0013](./docs/adr/0013-self-contained-server-bundle.md) | Self-contained committed server bundle | Accepted |
| [0014](./docs/adr/0014-distribution-release-model.md) | Distribution & release model (git tag → GitHub Release; no npm) | Accepted |
| [0015](./docs/adr/0015-verify-shell-trust-boundary.md) | `verify` shell-execution trust boundary | Accepted |
| [0016](./docs/adr/0016-bundled-external-mcp-deps.md) | Bundled external MCP dependencies (context7, gitmcp) | Accepted |
| [0017](./docs/adr/0017-adversarial-critic-gates.md) | Adversarial critic gates in the task pipeline | Accepted |
| [0018](./docs/adr/0018-three-doors-instrument-taxonomy.md) | Three doors & instrument taxonomy | Accepted |
| [0019](./docs/adr/0019-branching-and-pr-flow.md) | Branching model: release `main`, integration `dev`, changes via PRs | Accepted |
| [0020](./docs/adr/0020-debugger-agent.md) | Root-cause analysis as the `marvin-debugger` agent | Accepted |
| [0021](./docs/adr/0021-lessons-feedback-loop.md) | Tool-backed lessons-learned feedback loop | Accepted |
| [0022](./docs/adr/0022-numbered-spec-files.md) | Numeric-prefixed spec filenames (`NNN-<slug>.md`) | Accepted |

## Contributing

Contributions are welcome. The quality gates every change must pass:

```shell
npm run lint              # ESLint (TypeScript source)
npm run format:check      # Prettier
npm run lint:manifests    # marketplace + plugin manifest structure
npm run lint:docs         # README/docs ADR coverage + working-dir paths
npm run build             # build every workspace
npm run test              # Node.js native test suites
npm run verify-dist       # committed dist/ matches a fresh build
```

CI runs the same checks plus a stdio smoke-test of the MCP server. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for setup and the full workflow, and
[CLAUDE.md](./CLAUDE.md) for the architecture reference.

## Security

Found a vulnerability? Please report it privately — see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Yurii Anichkin
