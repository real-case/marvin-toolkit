# Command reference

Every command Marvin ships, with a one-line synopsis and a usage example. Commands are
`/marvin:<group>-<command>` (singletons stay bare). There are **43** in total.

**Three ways to invoke the same workflow** (see the ["three doors"](./architecture.md) model):

- **Chat** — describe the intent in plain language ("сделай коммит", "review PR 51") and
  Claude Code auto-matches the skill.
- **`/<command>`** — the terse markdown slash command (e.g. `/commit`, `/sec-scan`).
- **`/marvin:<command>`** — the MCP prompt slash command (e.g. `/marvin:commit`).

Examples below show the `/marvin:` form; arguments in `<angle brackets>` are placeholders and
optional unless noted. The `kanban-*` group and the three read-side commands (`help`,
`handoff-list`, `task-summary`) are MCP-only thin tool wrappers — they have no `SKILL.md`, but
work identically in the terminal.

---

## Core developer tools

Language-agnostic, used by every engineer.

| Command | What it does | Example |
|---------|--------------|---------|
| `/marvin:commit` | Inspect the repo, stage intentionally, detect sensitive files (`.env`, keys), draft a Conventional Commits message, and confirm before committing. | `/marvin:commit "fix(api): guard null user"` |
| `/marvin:debug` | Hypothesis-driven root-cause analysis — gather evidence, form hypotheses, build a minimal reproduction instead of guessing. | `/marvin:debug "tests flake on CI only"` |
| `/marvin:adr` | Create an Architecture Decision Record capturing context, the decision, and its consequences. | `/marvin:adr "adopt tool-backed verification"` |
| `/marvin:changelog` | Generate a changelog / release notes from git history between tags, dates, or refs (Keep a Changelog). | `/marvin:changelog v0.1.0..HEAD` |
| `/marvin:readme` | Generate or update `README.md` from actual codebase analysis. | `/marvin:readme` |
| `/marvin:migration-plan` | Plan a migration or major refactor — dependency analysis, ordered steps, risks, and rollback. | `/marvin:migration-plan "REST → gRPC"` |
| `/marvin:explain` | Explain how code works — logic, architecture, and design rationale. | `/marvin:explain src/tools/verify.ts` |
| `/marvin:docs-search` | Search and synthesize project docs (ADRs, README, runbooks) to answer a question. | `/marvin:docs-search "how do verify gates resolve?"` |
| `/marvin:handoff` | Capture full session context into `.marvin/handoff/` plus a prompt to continue in a fresh session. | `/marvin:handoff` |
| `/marvin:handoff-list` | List the session-continuation handoff documents under `.marvin/handoff/`, newest first. | `/marvin:handoff-list` |
| `/marvin:help` | Project dashboard and the full command index, derived from the prompt registry; filter by group. | `/marvin:help sec` |

**Agents:** `marvin-guide`, `marvin-researcher`, `marvin-debugger`.

## Pull-request lifecycle — `pr-*`

The full PR lifecycle, from open to merge.

| Command | What it does | Example |
|---------|--------------|---------|
| `/marvin:pr-create` | Open a PR with a structured description, verification checklist, and issue linking; runs pre-flight checks. | `/marvin:pr-create "feat: task-summary aggregator"` |
| `/marvin:pr-review` | Review a PR for bugs, security, performance, and style; post the review with severity-tagged inline comments. | `/marvin:pr-review 51` |
| `/marvin:pr-resolve` | Work through unresolved review threads — plan, fix, push, then reply to and resolve each. | `/marvin:pr-resolve 51` |
| `/marvin:pr-merge` | Merge a PR, then check out the base branch and pull. | `/marvin:pr-merge 51` |

## Spec-driven task pipeline — `task-*`

Separates human decisions (the spec) from automated execution. Artifacts land under `.marvin/task/`.

| Command | What it does | Example |
|---------|--------------|---------|
| `/marvin:task-start` | Interactive spec co-creation — codebase grounding, acceptance criteria bound to proofs, a red-team critic, then a tool-backed Definition-of-Ready gate. | `/marvin:task-start "add rate limiting"` |
| `/marvin:task-implement` | Execute a ready spec in the current session, self-test, then chain into verify + deliver. | `/marvin:task-implement` |
| `/marvin:task-verify` | Run quality gates (tests, lint, type-check, build) concurrently with stack auto-detection; writes `verification.md`. | `/marvin:task-verify` |
| `/marvin:task-deliver` | Commit and open a PR, refusing if verification did not pass. | `/marvin:task-deliver` |
| `/marvin:task-summary` | Aggregate a finished task — spec criteria, gate outcomes, git log, lessons, and artifact links — into one summary. | `/marvin:task-summary` |

**Agents:** `marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`, `marvin-tm-review-fixer`.

## Security scanners — `sec-*`

OWASP-aligned scanning, threat modeling, and remediation.

| Command | What it does | Example |
|---------|--------------|---------|
| `/marvin:sec-scan` | Comprehensive OWASP Top 10:2025 audit — orchestrates secrets + deps + IaC scans plus deep static analysis. | `/marvin:sec-scan` |
| `/marvin:sec-secrets` | Deep scan for leaked secrets and keys across code, config, and full git history. | `/marvin:sec-secrets` |
| `/marvin:sec-deps` | Audit dependencies for known CVEs, license risks, and unmaintained / typosquatted packages. | `/marvin:sec-deps` |
| `/marvin:sec-gate` | Fast, diff-scoped security check for staged or recent changes — a pre-commit gate. | `/marvin:sec-gate` |
| `/marvin:sec-threat-model` | STRIDE threat model for a feature, service, or the whole app — data flows, trust boundaries, threats, mitigations. | `/marvin:sec-threat-model "the kanban tools"` |
| `/marvin:sec-iac` | Security review of Infrastructure-as-Code — Terraform, CloudFormation, Kubernetes, Docker, Helm. | `/marvin:sec-iac` |
| `/marvin:sec-ci` | Audit CI/CD pipelines for supply-chain risks, secret exposure, and excessive permissions. | `/marvin:sec-ci` |
| `/marvin:sec-fix` | Generate and verify a minimal, tested patch for a vulnerability from any scanner or manual finding. | `/marvin:sec-fix` |
| `/marvin:sec-compliance` | Check code against OWASP ASVS (L1/L2/L3) and report a control-by-control gap analysis. | `/marvin:sec-compliance` |
| `/marvin:sec-pentest` | Generate an application-specific penetration-testing checklist mapped to PTES / OWASP. | `/marvin:sec-pentest` |

**Agent:** `marvin-auditor`.

## Kanban tracker — `kanban-*`

A lightweight per-project board with interactive MCP-elicit forms — inquirer-style speed inside
Claude Code. Storage: `.marvin/kanban/` (+ optional `.marvin/config.json`).

| Command | What it does | Example |
|---------|--------------|---------|
| `/marvin:kanban-menu` | Open the kanban main menu. | `/marvin:kanban-menu` |
| `/marvin:kanban-bug` | Quick-create a bug task via an interactive form. | `/marvin:kanban-bug` |
| `/marvin:kanban-feature` | Quick-create a feature task. | `/marvin:kanban-feature` |
| `/marvin:kanban-chore` | Quick-create a chore task. | `/marvin:kanban-chore` |
| `/marvin:kanban-spike` | Quick-create a spike (research) task. | `/marvin:kanban-spike` |
| `/marvin:kanban-start` | Pick a todo task, branch off, and mark it work-in-progress. | `/marvin:kanban-start` |
| `/marvin:kanban-review` | Move the current task to review. | `/marvin:kanban-review` |
| `/marvin:kanban-done` | Mark the current task done. | `/marvin:kanban-done` |
| `/marvin:kanban-list` | List all tasks grouped by status. | `/marvin:kanban-list` |
| `/marvin:kanban-status` | Show the current branch and its work-in-progress tasks. | `/marvin:kanban-status` |
| `/marvin:kanban-help` | Show the project dashboard. | `/marvin:kanban-help` |
| `/marvin:kanban-commit` | Commit with the current task's context. | `/marvin:kanban-commit` |
| `/marvin:kanban-create-pr` | Open a PR with the current task's context. | `/marvin:kanban-create-pr` |

---

## Appendix — deterministic MCP tools

Where determinism matters, prompts delegate to typed MCP tools (each declares a zod input
schema). They are invoked by the commands above (and callable by the model), not typed as
slash commands:

| Tool | Purpose |
|------|---------|
| `task` | Kanban task CRUD + status transitions |
| `git` | git operations (commit, branch, PR helpers) |
| `help` | Dashboard + registry-derived command index |
| `verify` | Concurrent quality-gate runner (writes `verification.md`) |
| `spec` | Definition-of-Ready gate — parses & validates the spec contract |
| `lessons` | Lessons-learned store under `.marvin/memory/` |
| `handoff` | Session-continuation handoff docs under `.marvin/handoff/` |
| `summary` | Task-delivery summary aggregator |

## Appendix — agents

Claude Code subagents, auto-loaded on install (invoke via the Task tool or the pipeline):

| Agent | Role |
|-------|------|
| `marvin-guide` | Onboarding / codebase navigation (read-only) |
| `marvin-researcher` | Version-specific documentation lookup |
| `marvin-debugger` | Root-cause analysis (read-mostly) |
| `marvin-auditor` | Security review (read-only) |
| `marvin-tm-writer` | Conversational spec exploration |
| `marvin-tm-spec-critic` | Red-team review of a drafted spec (read-only) |
| `marvin-tm-executor` | Headless spec execution in a worktree |
| `marvin-tm-diff-critic` | Red-team review of a branch/staged diff (read-only) |
| `marvin-tm-review-fixer` | Autonomous PR-review-comment resolution |

---

See the [README](../README.md) for the install steps and the lifecycle overview, and
[CLAUDE.md](../CLAUDE.md) for the architecture reference.
