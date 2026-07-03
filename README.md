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
| _(bare)_ | core developer tools | 12 |
| `adr-*` | ADR lifecycle (accept/supersede/sync human-run) | 6 |
| `pr-*` | pull-request operations | 4 |
| `task-*` | spec-driven task pipeline | 5 |
| `sec-*` | security scanners | 10 |
| `refactor-*` | code-health audits (read side) | 2 |
| `kanban-*` | lightweight task tracker | 12 |

51 prompts total, all under `/marvin:`. Most are skill-backed (all three doors); the `kanban-*` group plus four read-side commands (`/marvin:help`, `/marvin:handoff-list`, `/marvin:lessons`, `/marvin:task-summary`) are MCP-only thin tool wrappers with no `SKILL.md`.

See the full **[command reference](./docs/commands.md)** — every `/marvin:` command with a one-line synopsis and natural-language phrases to invoke it.

### Core developer tools

Language-agnostic, used by every engineer.

| Command | Description |
|---------|-------------|
| `/marvin:commit` | Generate conventional commit messages with sensitive file detection |
| `/marvin:pr-create` | Create PRs with structured descriptions and pre-flight checks |
| `/marvin:pr-review` | Review a PR on GitHub and post the review (inline comments by severity) |
| `/marvin:pr-resolve` | Resolve unresolved PR review threads — plan, fix, push, reply + resolve |
| `/marvin:pr-merge` | Merge a PR, then check out the base branch and pull |
| `/marvin:debug` | Systematic root-cause analysis with hypotheses |
| `/marvin:adr` | Draft Architecture Decision Records (tool-backed numbering; drafts land `proposed`) |
| `/marvin:changelog` | Generate changelog from git history |
| `/marvin:readme` | Generate or update README.md |
| `/marvin:migration-plan` | Plan migrations with risks and rollback strategy |
| `/marvin:explain` | Explain code, architecture, and execution flow |
| `/marvin:docs-search` | Search and synthesize project documentation |
| `/marvin:handoff` | Capture full context into `.marvin/handoff/` + a prompt to continue in a fresh session |
| `/marvin:handoff-list` | List the session-continuation handoff documents, newest first |
| `/marvin:lessons` | Browse the lessons-learned store — search, add, stats, prune (delete confirms first) |
| `/marvin:help` | Project dashboard + the full command index (filter with `/marvin:help <group>`) |

**Agents:** `marvin-guide`, `marvin-researcher`, `marvin-debugger` (root-cause analysis — also drives `task-start`'s bugfix flow).

**External MCP servers also registered:** `context7` (library docs lookup), `gitmcp` (GitHub repository docs).

### ADR lifecycle — `adr-*`

The full decision-record lifecycle around `/marvin:adr` ([ADR-0027](./docs/adr/0027-tool-backed-adr-lifecycle.md)). Deterministic mechanics (numbering, dual-style corpus parsing, the accept gate, paired supersede links, the managed index) live in the `adr` MCP tool; ratification, rollback, and project-memory sync are human-run (`disable-model-invocation`).

| Command | Description |
|---------|-------------|
| `/marvin:adr-review` | Deep review of one `proposed` record — grounding in the codebase, formal fixes only, verdict `READY_FOR_ACCEPTANCE` or defects |
| `/marvin:adr-accept` 👤 | Ratify `proposed → accepted` through the tool's fail-closed readiness gate |
| `/marvin:adr-audit` | Read-only corpus lint with remediation guidance per finding class |
| `/marvin:adr-coverage` | Read-only gap analysis — recorded decisions vs the actual stack, ranked by blast radius |
| `/marvin:adr-supersede` 👤 | Roll back a decision via a paired successor record — old content never edited |
| `/marvin:adr-sync` 👤 | Regenerate the accepted-decisions digest in `CLAUDE.md` between managed markers, diff-first |

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

### Refactoring — `refactor-*`

Code-health audits, read-only ([ADR-0029](./docs/adr/0029-refactoring-command-family.md)). Both produce numbered findings registers (`F<n>` + severity + effort + `file:line` evidence) under `.marvin/refactor/`, and close by offering to file findings as kanban chores.

| Command | Description |
|---------|-------------|
| `/marvin:refactor-audit` | Whole-project structural audit — architecture map, churn×size hotspots, dependency tangles, dead code |
| `/marvin:refactor-smells` | Scoped smell scan of a path, module, or diff — anti-patterns, idiom/naming inconsistencies |

**Agent:** `marvin-refactor-auditor` (read-only structural auditor — does the heavy reading for `refactor-audit`).

### Task pipeline — `task-*`

Spec-driven pipeline — separates human decisions from automated execution.

| Command | Description |
|---------|-------------|
| `/marvin:task-start` | Interactive spec co-creation (feature/bugfix flows, solution variants, DoR gate) |
| `/marvin:task-implement` | Execute a ready spec interactively in the current session |
| `/marvin:task-verify` | Run quality gates (tests, lint, type-check, build) with stack auto-detection |
| `/marvin:task-deliver` | Commit + PR, gated on verification passing |
| `/marvin:task-summary` | Aggregate a finished task's criteria, gates, commits, and lessons into one summary |

**Agents:** `marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`, `marvin-tm-review-fixer` (the autonomous twin of `/marvin:pr-resolve`).

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
| `/marvin:kanban-config` | Show or edit the board configuration (base branch, tracker URL template, branch template, statuses) |
| `/marvin:kanban-help` | Board dashboard scoped to the kanban commands |

Committing and opening PRs for board tasks goes through the kanban-aware `/marvin:commit` and `/marvin:pr-create` — they pick up the linked task automatically (`Refs:` footer, task-prefixed PR title, PR-URL capture; [ADR-0025](./docs/adr/0025-kanban-board-only.md)).

Storage: `.marvin/kanban/<seq>[-<tracker>]--<slug>.md`, optional `.marvin/config.json` (`base_branch`, `tracker_url_template`, `statuses`) — the default working directory per [ADR-0007](./docs/adr/0007-marvin-working-directory.md), overridable via the `MARVIN_TASKS_*` env vars. New tasks get topic branches `<type-prefix>/<seq>[-<tracker>]--<slug>` (bug→`fix/`, feature→`feat/`, chore→`chore/`, spike→`spike/`, e.g. `fix/007-OSI-123--login-timeout`); titles may be any printable Unicode. Every form field is also a `task`-tool argument, so details you already said skip the form — and hosts without elicitation support still get the full flow by passing arguments. Statuses are project data ([ADR-0026](./docs/adr/0026-configurable-status-model.md)): configure your tracker's vocabulary (`{ key, role, tracker_status? }`) and the lifecycle commands drive it by role; a generic `move` action on the `task` tool reaches every configured status. `base_branch` auto-detects from `origin/HEAD` when no config exists. Nobody hand-writes the config file: `/marvin:kanban-config` shows and edits every setting — including an optional `branch_template` for custom branch-name schemes — with fail-closed validation. Finished work archives off the board (the `task` tool's `archive` action) into `.marvin/kanban/archive/`; ids stay reserved and the list shows an `N archived` footer.

`task-*` (heavyweight spec pipeline) and `kanban-*` (quick tracker) are intentionally distinct — use `task-*` for large features that deserve a spec, `kanban-*` for fast day-to-day tracking.

## Development lifecycle

```
Plan                Code              Secure             Document            Ship                  Pipeline
├─ marvin:adr       ├─ marvin:debug   ├─ marvin:sec-scan ├─ marvin:readme    ├─ marvin:commit      ├─ marvin:task-start
└─ marvin:          ├─ marvin:explain ├─ marvin:sec-     ├─ marvin:changelog ├─ marvin:pr-create   ├─ marvin:task-implement
   migration-plan   └─ marvin:           secrets         └─ marvin:          ├─ marvin:pr-review   ├─ marvin:task-verify
                       docs-search    ├─ marvin:sec-deps    docs-search       ├─ marvin:pr-resolve  └─ marvin:task-deliver
                                      ├─ marvin:sec-gate                      └─ marvin:pr-merge
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
| [0023](./docs/adr/0023-pr-command-family.md) | Unified `pr-*` pull-request command family | Accepted |
| [0024](./docs/adr/0024-mcp-apps-widget-architecture.md) | MCP Apps widget layer: data-first staging + shared data contracts | Accepted |
| [0025](./docs/adr/0025-kanban-board-only.md) | Kanban goes board-only; git ops fold into the `commit`/`pr-create` skills | Accepted |
| [0026](./docs/adr/0026-configurable-status-model.md) | Configurable status model: statuses are project data, roles stay closed | Accepted |
| [0027](./docs/adr/0027-tool-backed-adr-lifecycle.md) | Tool-backed ADR lifecycle | Accepted |
| [0028](./docs/adr/0028-lessons-hygiene-and-recall-expansion.md) | Lessons v2: hygiene surface and recall/capture expansion | Accepted |
| [0029](./docs/adr/0029-refactoring-command-family.md) | Refactoring command family: read → plan → apply under hard rails | Accepted |

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
