# Command reference

Every command Marvin ships, with a one-line synopsis and natural-language phrases that invoke
it. Commands are `/marvin:<group>-<command>` (singletons stay bare). There are **41** in total.

**Three ways to invoke the same workflow** (see the ["three doors"](./architecture.md) model):

- **Chat (natural language)** — just say what you want. Claude Code matches the skill by its
  frontmatter `description`, so a phrase like `marvin start a new task` or
  `resolve the comments on PR 51` runs the command. Leading with **“marvin”** is optional but
  helps disambiguate from an ordinary request. The **Say it in chat** column below lists example
  phrases per command.
- **`/<command>`** — the terse markdown slash command (e.g. `/commit`, `/sec-scan`).
- **`/marvin:<command>`** — the MCP prompt slash command (e.g. `/marvin:commit`).

Every command also runs in slash form as **`/marvin:<command> [args]`**. The chat phrases below
are illustrative, not exhaustive — any close paraphrase works. The `kanban-*` group and the three
read-side commands (`help`, `handoff-list`, `task-summary`) have no `SKILL.md`; there a chat
phrase is served by Claude calling the underlying tool rather than by skill auto-discovery, but
the effect is the same.

---

## Natural-language routing (the `marvin` wake-word)

Two layers turn a plain phrase into the right command:

1. **Skill auto-discovery — built in, always on.** Claude Code matches your wording against each
   skill's frontmatter `description`; the phrases in the **Say it in chat** columns below are part
   of those descriptions, so `start a new task` or `resolve the review comments` land on the right
   command with no setup. It is a best-effort semantic match, and `adr` / `migration-plan` opt out
   of it on purpose (`disable-model-invocation`).

2. **The `marvin` wake-word hook — opt-in, deterministic routing.** A `UserPromptSubmit` hook
   ([`.claude/hooks/marvin-router.sh`](../.claude/hooks/marvin-router.sh)) makes any prompt that
   *starts with* **`marvin …`** resolve to a `/marvin:` command instead of an ad-hoc answer — e.g.
   `marvin start a new task`, `marvin resolve pr 12`, `marvin scan for secrets`, or just `marvin`
   (opens help). Because it points Claude straight at the command, it also routes `adr` /
   `migration-plan`, which auto-discovery skips.

   It is wired for this repo in [`.claude/settings.json`](../.claude/settings.json); enable it
   for **all** your projects by adding the same block to `~/.claude/settings.json`:

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         { "hooks": [ { "type": "command",
           "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/marvin-router.sh" } ] } ]
     }
   }
   ```

   The hook **fails open** (never blocks a prompt), needs `jq`, and deliberately ignores ordinary
   prose — `marvin is slow`, `marvin's server`, `marvin the …` pass straight through. The word
   `marvin` is a human mnemonic: the hook keys on the leading prefix, not on Claude treating
   `marvin` as a special token.

---

## Core developer tools

Language-agnostic, used by every engineer.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:commit` | Inspect the repo, stage intentionally, detect sensitive files (`.env`, keys), draft a Conventional Commits message — with a `Refs:` footer when the branch belongs to a kanban task — and confirm before committing. | `marvin commit this`, `marvin stage and commit`, `commit my changes`, `marvin commit with task context` |
| `/marvin:debug` | Hypothesis-driven root-cause analysis — gather evidence, form hypotheses, build a minimal reproduction instead of guessing. | `marvin debug this`, `marvin why is this failing?`, `the tests only flake on CI` |
| `/marvin:adr` | Create an Architecture Decision Record capturing context, the decision, and its consequences. | `marvin write an ADR`, `marvin record this decision`, `document this design choice` |
| `/marvin:changelog` | Generate a changelog / release notes from git history between tags, dates, or refs (Keep a Changelog). | `marvin changelog since v0.1.0`, `marvin what changed since the last tag?`, `generate release notes` |
| `/marvin:readme` | Generate or update `README.md` from actual codebase analysis. | `marvin update the README`, `marvin generate project docs`, `write a readme for this repo` |
| `/marvin:migration-plan` | Plan a migration or major refactor — dependency analysis, ordered steps, risks, and rollback. | `marvin plan a migration`, `marvin how do we move REST → gRPC?`, `plan this refactor` |
| `/marvin:explain` | Explain how code works — logic, architecture, and design rationale. | `marvin explain this code`, `marvin how does verify.ts work?`, `walk me through this file` |
| `/marvin:docs-search` | Search and synthesize project docs (ADRs, README, runbooks) to answer a question. | `marvin where is X documented?`, `marvin find the deploy runbook`, `how do the verify gates resolve?` |
| `/marvin:handoff` | Capture full session context into `.marvin/handoff/` plus a prompt to continue in a fresh session. | `marvin hand off this session`, `marvin save context to continue later`, `create a handoff` |
| `/marvin:handoff-list` | List the session-continuation handoff documents under `.marvin/handoff/`, newest first. | `marvin list handoffs`, `marvin show session handoffs` |
| `/marvin:help` | Project dashboard and the full command index, derived from the prompt registry; filter by group. | `marvin help`, `marvin what commands are there?`, `marvin help sec` |

**Agents:** `marvin-guide`, `marvin-researcher`, `marvin-debugger`.

## Pull-request lifecycle — `pr-*`

The full PR lifecycle, from open to merge.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:pr-create` | Open a PR with a structured description, verification checklist, and issue linking; runs pre-flight checks. Picks up kanban task context (title prefix, task/tracker links) and captures the PR URL onto the task. | `marvin create a PR`, `marvin open a pull request`, `push and open a PR`, `marvin open a PR for this board task` |
| `/marvin:pr-review` | Review a PR for bugs, security, performance, and style; post the review with severity-tagged inline comments. | `marvin review PR 51`, `marvin review this PR on GitHub`, `post a review on #51` |
| `/marvin:pr-resolve` | Work through unresolved review threads — plan, fix, push, then reply to and resolve each. | `marvin resolve PR 51`, `marvin address the review comments on #51`, `fix the PR feedback` |
| `/marvin:pr-merge` | Merge a PR, then check out the base branch and pull. | `marvin merge PR 51`, `marvin land this PR`, `merge it and pull the base` |

## Spec-driven task pipeline — `task-*`

Separates human decisions (the spec) from automated execution. Artifacts land under `.marvin/task/`.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:task-start` | Interactive spec co-creation — codebase grounding, acceptance criteria bound to proofs, a red-team critic, then a tool-backed Definition-of-Ready gate. | `marvin start a new task`, `marvin new task`, `marvin spec this out` |
| `/marvin:task-implement` | Execute a ready spec in the current session, self-test, then chain into verify + deliver. | `marvin implement the spec`, `marvin run the task`, `execute this spec` |
| `/marvin:task-verify` | Run quality gates (tests, lint, type-check, build) concurrently with stack auto-detection; writes `verification.md`. | `marvin verify`, `marvin run the gates`, `is this green?` |
| `/marvin:task-deliver` | Commit and open a PR, refusing if verification did not pass. | `marvin deliver`, `marvin ship it`, `commit and PR the task` |
| `/marvin:task-summary` | Aggregate a finished task — spec criteria, gate outcomes, git log, lessons, and artifact links — into one summary. | `marvin summarize the task`, `marvin what was done?`, `task summary` |

**Agents:** `marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`, `marvin-tm-review-fixer`.

## Security scanners — `sec-*`

OWASP-aligned scanning, threat modeling, and remediation.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:sec-scan` | Comprehensive OWASP Top 10:2025 audit — orchestrates secrets + deps + IaC scans plus deep static analysis. | `marvin security scan`, `marvin full OWASP audit`, `harden this service` |
| `/marvin:sec-secrets` | Deep scan for leaked secrets and keys across code, config, and full git history. | `marvin scan for secrets`, `marvin did I commit a key?`, `find leaked credentials` |
| `/marvin:sec-deps` | Audit dependencies for known CVEs, license risks, and unmaintained / typosquatted packages. | `marvin audit dependencies`, `marvin check for vulnerable packages`, `run npm audit` |
| `/marvin:sec-gate` | Fast, diff-scoped security check for staged or recent changes — a pre-commit gate. | `marvin quick sec check`, `marvin gate this commit`, `security-check my diff` |
| `/marvin:sec-threat-model` | STRIDE threat model for a feature, service, or the whole app — data flows, trust boundaries, threats, mitigations. | `marvin threat model the kanban tools`, `marvin STRIDE analysis`, `what can go wrong here?` |
| `/marvin:sec-iac` | Security review of Infrastructure-as-Code — Terraform, CloudFormation, Kubernetes, Docker, Helm. | `marvin review the Terraform`, `marvin scan the Dockerfile`, `IaC security review` |
| `/marvin:sec-ci` | Audit CI/CD pipelines for supply-chain risks, secret exposure, and excessive permissions. | `marvin audit the CI pipeline`, `marvin review the GitHub Actions`, `harden the workflows` |
| `/marvin:sec-fix` | Generate and verify a minimal, tested patch for a vulnerability from any scanner or manual finding. | `marvin fix this vulnerability`, `marvin patch the finding`, `remediate the CVE` |
| `/marvin:sec-compliance` | Check code against OWASP ASVS (L1/L2/L3) and report a control-by-control gap analysis. | `marvin ASVS audit`, `marvin compliance check`, `OWASP ASVS gap analysis` |
| `/marvin:sec-pentest` | Generate an application-specific penetration-testing checklist mapped to PTES / OWASP. | `marvin plan a pentest`, `marvin generate a pentest checklist`, `red-team scope` |

**Agent:** `marvin-auditor`.

## Kanban tracker — `kanban-*`

A lightweight per-project board with interactive MCP-elicit forms — inquirer-style speed inside
Claude Code. Storage: `.marvin/kanban/` (+ optional `.marvin/config.json`).

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:kanban-menu` | Open the kanban main menu. | `marvin open the board`, `marvin kanban menu` |
| `/marvin:kanban-bug` | Quick-create a bug task via an interactive form. | `marvin add a bug to the board`, `marvin new bug task` |
| `/marvin:kanban-feature` | Quick-create a feature task. | `marvin add a feature to the board`, `marvin new feature task` |
| `/marvin:kanban-chore` | Quick-create a chore task. | `marvin add a chore`, `marvin new chore task` |
| `/marvin:kanban-spike` | Quick-create a spike (research) task. | `marvin add a spike`, `marvin new research task` |
| `/marvin:kanban-start` | Pick a todo task, branch off, and mark it work-in-progress. | `marvin start a board task`, `pick a todo and branch off` |
| `/marvin:kanban-review` | Move the current task to review. | `marvin move my task to review`, `mark this in review` |
| `/marvin:kanban-done` | Mark the current task done. | `marvin mark the task done`, `finish this board task` |
| `/marvin:kanban-list` | List all tasks grouped by status. | `marvin list board tasks`, `show the kanban` |
| `/marvin:kanban-status` | Show the current branch and its work-in-progress tasks. | `marvin what am I working on?`, `board status` |
| `/marvin:kanban-help` | Show the project dashboard. | `marvin board dashboard`, `kanban help` |

Committing and opening PRs for board tasks is handled by the kanban-aware
[`/marvin:commit`](#core-developer-tools) and [`/marvin:pr-create`](#pull-request-lifecycle--pr-)
— they pick up the linked task automatically (ADR-0025).

Statuses are per-project data (ADR-0026): declare your tracker's vocabulary as
`statuses: [{ key, role, tracker_status? }]` in `.marvin/config.json` and the lifecycle
commands drive it by role (`start` → first wip-role status, and so on). The `task` tool's
generic `move` action reaches every configured status — including `blocked`. With no
configuration the classic `todo / wip / review / done / blocked` set applies unchanged.

---

## Appendix — deterministic MCP tools

Where determinism matters, prompts delegate to typed MCP tools (each declares a zod input
schema). They are invoked by the commands above (and callable by the model), not typed as
slash commands:

| Tool | Purpose |
|------|---------|
| `task` | Kanban board — task CRUD, role-driven transitions over the configured statuses (incl. a generic `move`), PR-URL capture (`link-pr`) |
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
