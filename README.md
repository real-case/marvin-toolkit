# Marvin

> Claude Code toolkit for those who don't panic.

Marvin is a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin marketplace shipping **MCP-first** packs that cover the full development lifecycle. Four packs, one MCP server per pack — install what you need and get structured, repeatable workflows inside Claude Code.

**Three doors, one room.** Each skill lives once at `plugins/<pack>/skills/<name>/SKILL.md`. Three entry points reach the same workflow body:

1. **Chat auto-discovery** — describe what you want ("сделай коммит") and Claude Code matches the skill via its frontmatter `description`.
2. **Short markdown slash command** — `/mn.commit`, `/mn.sec.scan`, `/mn.taskmaster-start`. Thin wrappers under `plugins/<pack>/commands/`. Same workflow, terser invocation.
3. **MCP prompt slash command** — `/marvin-core:commit`, `/marvin-sec:scan`, `/marvin-tm:start`. Served by each pack's bundled MCP server.

Pick whichever feels right — they all use the same `SKILL.md`.

## Install

```shell
/plugin marketplace add real-case/marvin-toolkit

/plugin install marvin-core-pack@marvin-toolkit
/plugin install marvin-security-pack@marvin-toolkit
/plugin install marvin-taskmaster-pack@marvin-toolkit
/plugin install marvin-tasks-pack@marvin-toolkit
```

Each pack registers one MCP server. Slash commands appear as `/<server>:<prompt>`.

## What's included

| Pack | Server | Skills | Markdown `/mn.*` | MCP prompts | Agents | MCP prefix |
|------|--------|--------|------------------|-------------|--------|------------|
| [marvin-core-pack](#marvin-core-pack) | `marvin-core` | 10 | 10 | 10 | 2 | `/marvin-core:` |
| [marvin-security-pack](#marvin-security-pack) | `marvin-sec` | 11 | 11 | 11 | 1 | `/marvin-sec:` |
| [marvin-taskmaster-pack](#marvin-taskmaster-pack) | `marvin-tm` | 5 | 5 | 5 | 5 | `/marvin-tm:` |
| [marvin-tasks-pack](#marvin-tasks-pack) | `marvin-tasks` | — | — | 13 | — | `/marvin-tasks:` |

Skills count = `plugins/<pack>/skills/<name>/SKILL.md` (source of truth, auto-discovered by Claude Code). Markdown `/mn.*` count = thin slash wrappers under `commands/`. MCP prompt count = `mcp/server/src/prompts/index.ts` entries. For core/security/taskmaster they line up 1:1:1 — every workflow has all three doors. **marvin-tasks-pack** is MCP-only by design: its 13 prompts are thin tool wrappers, no SKILL.md or markdown command counterpart.

### marvin-core-pack

Core developer tools — language-agnostic, used by every engineer.

| Command | Description |
|---------|-------------|
| `/marvin-core:commit` | Generate conventional commit messages with sensitive file detection |
| `/marvin-core:pr` | Create PRs with structured descriptions and pre-flight checks |
| `/marvin-core:review` | Code review by severity (critical, warning, suggestion) |
| `/marvin-core:debug` | Systematic root-cause analysis with hypotheses |
| `/marvin-core:adr` | Create Architecture Decision Records |
| `/marvin-core:changelog` | Generate changelog from git history |
| `/marvin-core:readme` | Generate or update README.md |
| `/marvin-core:migration-plan` | Plan migrations with risks and rollback strategy |
| `/marvin-core:explaining-code` | Explain code, architecture, and execution flow |
| `/marvin-core:docs-search` | Search and synthesize project documentation |

**Agents:** `onboarding-guide`, `research`.

**External MCP servers also registered:** `context7` (library docs lookup), `gitmcp` (GitHub repository docs).

### marvin-security-pack

Security-focused tools — OWASP Top 10, dependency audits, compliance checks.

| Command | Description |
|---------|-------------|
| `/marvin-sec:scan` | Comprehensive OWASP Top 10:2025 audit (orchestrates secrets + deps + static analysis) |
| `/marvin-sec:secrets` | Deep scan for leaked secrets across code, config, and git history |
| `/marvin-sec:deps` | Audit dependencies for vulnerabilities, license risks, and maintenance health |
| `/marvin-sec:gate` | Fast pre-commit security check — scoped to staged changes only |
| `/marvin-sec:threat-model` | STRIDE-based threat modeling for features or systems |
| `/marvin-sec:iac` | Infrastructure-as-Code security (Terraform, K8s, Docker, CloudFormation) |
| `/marvin-sec:ci` | CI/CD pipeline security audit (GitHub Actions, GitLab CI, Jenkins) |
| `/marvin-sec:fix` | Generate and verify fixes for vulnerabilities with regression tests |
| `/marvin-sec:compliance` | OWASP ASVS compliance checking (L1/L2/L3) |
| `/marvin-sec:pentest` | Generate application-specific penetration testing checklist |

**Agent:** `security-reviewer`.

### marvin-taskmaster-pack

Spec-driven task pipeline — separates human decisions from automated execution.

| Command | Description |
|---------|-------------|
| `/marvin-tm:start` | Interactive spec co-creation (feature/bugfix flows, solution variants, DoR gate) |
| `/marvin-tm:run` | Execute a ready spec interactively in the current session |
| `/marvin-tm:verify` | Run quality gates (tests, lint, type-check, build) with stack auto-detection |
| `/marvin-tm:deliver` | Commit + PR, gated on verification passing |
| `/marvin-tm:fix-pr` | Apply PR review comments as code fixes |

**Agents:** `marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`, `marvin-tm-review-fixer`.

> Batch dispatch (the old `dispatch.sh`) was removed; it will return as a dedicated feature later, designed against the MCP boundary.

### marvin-tasks-pack

Lightweight per-project task tracker with interactive MCP-elicit forms — inquirer-style speed inside Claude Code.

| Command | Description |
|---------|-------------|
| `/marvin-tasks:menu` | Main menu |
| `/marvin-tasks:bug` / `:feature` / `:chore` / `:spike` | Quick-create a task of the given type |
| `/marvin-tasks:start` | Pick a todo task, branch off, mark WIP |
| `/marvin-tasks:review` | Move current task to review |
| `/marvin-tasks:done` | Mark current task done |
| `/marvin-tasks:list` | List all tasks grouped by status |
| `/marvin-tasks:status` | Current branch + WIP tasks |
| `/marvin-tasks:help` | Project dashboard |
| `/marvin-tasks:commit` | Commit with task context |
| `/marvin-tasks:create-pr` | Open PR with task context |

Storage: `marvin/tasks/<seq>[-<tracker>]--<slug>.md`, optional `marvin/config.json` (`base_branch`, `tracker_url_template`).

## Development lifecycle

```
Plan                     Code                      Review                Secure                 Document                  Ship                  Pipeline
├─ marvin-core:adr       ├─ marvin-core:debug      └─ marvin-core:review ├─ marvin-sec:scan     ├─ marvin-core:readme    ├─ marvin-core:commit ├─ marvin-tm:start
└─ marvin-core:           ├─ marvin-core:                                ├─ marvin-sec:secrets ├─ marvin-core:changelog  └─ marvin-core:pr     ├─ marvin-tm:run
   migration-plan       │  explaining-code                              ├─ marvin-sec:deps    └─ marvin-core:                                ├─ marvin-tm:verify
                        └─ marvin-core:                                  ├─ marvin-sec:gate      docs-search                                  ├─ marvin-tm:deliver
                           docs-search                                   ├─ marvin-sec:iac                                                    └─ marvin-tm:fix-pr
                                                                         ├─ marvin-sec:ci
                                                                         └─ ...
```

For day-to-day task tracking, layer `marvin-tasks-pack` on top of either workflow.

## Architecture decisions

Decisions with long-lived consequences are recorded as ADRs under [docs/adr/](./docs/adr/):

- [ADR 0001](./docs/adr/0001-source-format.md) — superseded by ADR-0002
- [ADR 0002 — MCP-first architecture](./docs/adr/0002-mcp-first-architecture.md)

## Contributing

1. Create a branch for your changes.
2. Add or modify packs under `plugins/`.
3. Build affected pack server (`cd plugins/<pack>/mcp/server && npm run build`) and commit `dist/` together with `src/`.
4. Update `marketplace.json` if adding a new pack; bump the pack's `plugin.json` version.
5. Run `node scripts/lint-manifests.mjs` and `node scripts/verify-dist.mjs` before pushing.
6. Open a PR — CI validates manifests, builds, smoke-tests every MCP server, and rejects stale `dist/` commits.

See [CLAUDE.md](./CLAUDE.md) for development guidelines.

## License

[WTFPL](./LICENSE)
