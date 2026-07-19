# Command reference

This page lists every command Marvin ships, with a one-line synopsis and the
natural-language phrases that invoke it. Commands follow the pattern
`/marvin:<group>-<command>`, and singletons stay bare. There are **50** in total,
divided into seven groups.

Use this page to look a command up. To learn the workflows themselves, read the
[usage guide](./usage.md); to understand how the commands are built, read the
[architecture tour](./architecture.md).

## The three ways to invoke a command

Every workflow has three entry points that all resolve to the same behavior, which the
["call it your way" model](./architecture.md#call-it-your-way) explains in full. Pick
whichever suits the moment.

- **Chat.** Say what you want in plain language, and Claude Code matches your wording to a skill by its frontmatter `description`. The **Say it in chat** column below lists example phrases; any close paraphrase works.
- **`/<command>`.** Type the terse markdown slash command, such as `/commit` or `/sec-scan`.
- **`/marvin:<command>`.** Type the namespaced MCP prompt, such as `/marvin:commit`, which the bundled server serves.

The `track-*` group and six read-side commands — `help`, `dashboard`, `reports`,
`handoff-list`, `lessons`, and `task-summary` — have no skill. For those, a chat phrase is served by
Claude calling the underlying tool rather than by skill auto-discovery, but the effect is
the same.

## Natural-language routing

Two layers turn a plain phrase into the right command.

The first layer is **skill auto-discovery**, which is built in and always on. Claude Code
matches your wording against each skill's frontmatter `description`, so a phrase like
`start a new task` or `resolve the review comments` lands on the right command with no
setup. A few commands opt out of this on purpose with `disable-model-invocation`:
`migration-plan`, and the three human-gated ADR lifecycle commands `adr-accept`,
`adr-supersede`, and `adr-sync`. [ADR-0027](./adr/0027-tool-backed-adr-lifecycle.md)
reserves ratification, rollback, and project-memory sync for a person.

The second layer is the **`marvin` wake-word hook**, which is opt-in and deterministic. A
`UserPromptSubmit` hook at [`.claude/hooks/marvin-router.sh`](../.claude/hooks/marvin-router.sh)
makes any prompt that starts with `marvin …` resolve to a `/marvin:` command rather than an
ad-hoc answer, as in `marvin start a new task` or `marvin scan for secrets`. Because it
points Claude straight at the command, it also routes `migration-plan` and the human-gated
`adr-*` commands that auto-discovery skips.

The hook is wired for this repository in [`.claude/settings.json`](../.claude/settings.json).
To enable it for all your projects, add the same block to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
        "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/marvin-router.sh" } ] } ]
  }
}
```

The hook fails open so it never blocks a prompt, needs `jq`, and deliberately ignores
ordinary prose, so `marvin is slow` or `marvin's server` pass straight through. The word
`marvin` is a human mnemonic: the hook keys on the leading prefix, not on Claude treating
`marvin` as a special token.

## Core developer tools

These are language-agnostic and used by every engineer.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:commit` | Inspect the repo, stage intentionally, detect sensitive files such as `.env` and keys, draft a Conventional Commits message with a `Refs:` footer when the branch belongs to a board task, and confirm before committing. | `marvin commit this`, `commit my changes`, `stage and commit` |
| `/marvin:debug` | Run hypothesis-driven root-cause analysis — gather evidence, form hypotheses, and build a minimal reproduction instead of guessing. | `marvin debug this`, `why is this failing?`, `the tests only flake on CI` |
| `/marvin:adr` | Draft an Architecture Decision Record, with the numbering, path, and index coming from the `adr` tool; drafts always land `proposed`. | `marvin write an ADR`, `record this decision`, `document this design choice` |
| `/marvin:changelog` | Generate a changelog or release notes from git history between tags, dates, or refs, in Keep a Changelog form. | `marvin changelog since v0.1.0`, `what changed since the last tag?`, `generate release notes` |
| `/marvin:readme` | Generate or update `README.md` from an analysis of the actual codebase. | `marvin update the README`, `generate project docs`, `write a readme for this repo` |
| `/marvin:migration-plan` | Plan a migration or major refactor with dependency analysis, ordered steps, risks, and a rollback strategy. | `marvin plan a migration`, `how do we move REST to gRPC?`, `plan this refactor` |
| `/marvin:explain` | Explain how code works, covering its logic, architecture, and design rationale. | `marvin explain this code`, `how does verify.ts work?`, `walk me through this file` |
| `/marvin:docs-search` | Search and synthesize the project's documentation to answer a question. | `marvin where is X documented?`, `find the deploy runbook`, `how do the verify gates resolve?` |
| `/marvin:handoff` | Capture the full session context into `.marvin/handoff/` plus a prompt to continue in a fresh session. | `marvin hand off this session`, `save context to continue later`, `create a handoff` |
| `/marvin:handoff-list` | List the session-continuation handoff documents, newest first. | `marvin list handoffs`, `show session handoffs` |
| `/marvin:lessons` | Browse the lessons-learned store — search, add, count by type or tag, or prune stale and duplicate lessons. | `marvin what did we learn about auth?`, `lessons stats`, `prune the lessons` |
| `/marvin:help` | Show the project dashboard and the full command index, filtered by group. | `marvin help`, `what commands are there?`, `marvin help sec` |
| `/marvin:dashboard` | Report the whole-toolbox state — board counters, artifact inventories with freshness, the ADR corpus by status, lessons stats, and the local usage summary. | `marvin dashboard`, `toolbox status`, `what state is the project in?` |
| `/marvin:reports` | List every report marvin generated under `.marvin/` — security, refactor, task, handoff — newest first, with freshness. | `marvin show the reports`, `what reports do we have?`, `open the latest security report` |

The `marvin-guide`, `marvin-researcher`, and `marvin-debugger` agents support these
commands.

## ADR lifecycle — `adr-*`

These commands wrap the full decision-record lifecycle around the bare
[`/marvin:adr`](#core-developer-tools) create command
([ADR-0027](./adr/0027-tool-backed-adr-lifecycle.md)). The deterministic mechanics —
numbering, corpus parsing, the accept readiness gate, paired supersede links, and the
managed index — live in the `adr` tool, and the corpus location is host-adaptive.
Authority sits at the gates: drafts always land `proposed`, and the three commands marked
below are human-run, so Claude never ratifies, rolls back, or syncs project memory on its
own.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:adr-review` | Deeply review one `proposed` record — section validation, codebase grounding, and auto-fix of formal defects only — returning `READY_FOR_ACCEPTANCE` or a defect list. | `marvin review the ADR`, `is ADR 31 ready?`, `check the decision record` |
| `/marvin:adr-accept` 👤 | Ratify a `proposed` record through the tool's fail-closed readiness gate, then stamp its status and date. | Run `/marvin:adr-accept 31` yourself; it is deliberately not chat-invocable. |
| `/marvin:adr-audit` | Lint the corpus read-only for dangling references, numbering gaps, broken supersede pairs, placeholder residue, and a stale index, with remediation guidance per finding. | `marvin audit the ADRs`, `ADR health check`, `are the decision records consistent?` |
| `/marvin:adr-coverage` | Analyze gaps read-only — recorded decisions against the actual stack — and rank undocumented decisions by blast radius. | `marvin what decisions are undocumented?`, `ADR coverage`, `what ADRs are we missing?` |
| `/marvin:adr-supersede` 👤 | Roll back an accepted decision through a paired successor record, linking both ways and never editing the old record's content. | Run `/marvin:adr-supersede 7 <new title>` yourself; it is deliberately not chat-invocable. |
| `/marvin:adr-sync` 👤 | Regenerate the accepted-decisions digest in `CLAUDE.md` from accepted records only, showing a diff and asking to confirm before writing. | Run `/marvin:adr-sync` yourself; it is deliberately not chat-invocable. |

## Pull-request lifecycle — `pr-*`

These commands cover the pull request from open to merge.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:pr-create` | Open a PR with a structured description, a verification checklist, and issue linking, after running pre-flight checks. Picks up board task context and captures the PR URL onto the task. | `marvin create a PR`, `open a pull request`, `push and open a PR` |
| `/marvin:pr-review` | Review a PR for bugs, security, performance, and style, and post the review with severity-tagged inline comments. | `marvin review PR 51`, `review this PR on GitHub`, `post a review on #51` |
| `/marvin:pr-resolve` | Work through unresolved review threads — plan, fix, push, then reply to and resolve each. | `marvin resolve PR 51`, `address the review comments on #51`, `fix the PR feedback` |
| `/marvin:pr-merge` | Merge a PR, then check out the base branch and pull. | `marvin merge PR 51`, `land this PR`, `merge it and pull the base` |

## Spec-driven task pipeline — `task-*`

These commands separate the human decisions in a spec from the automated execution that
follows, with artifacts landing under `.marvin/task/`.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:task-start` | Co-create a spec interactively — codebase grounding, acceptance criteria bound to their proofs, a red-team critic, then a tool-backed Definition-of-Ready gate. | `marvin start a new task`, `new task`, `spec this out` |
| `/marvin:task-implement` | Execute a ready spec in the current session, self-test, then chain into verify and deliver. | `marvin implement the spec`, `run the task`, `execute this spec` |
| `/marvin:task-verify` | Run the quality gates concurrently with stack auto-detection and write `verification.md`. | `marvin verify`, `run the gates`, `is this green?` |
| `/marvin:task-deliver` | Commit and open a PR, refusing if verification did not pass. | `marvin deliver`, `ship it`, `commit and PR the task` |
| `/marvin:task-summary` | Aggregate a finished task — spec criteria, gate outcomes, git log, lessons, and links — into one summary. | `marvin summarize the task`, `what was done?`, `task summary` |

The `marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`,
`marvin-tm-diff-critic`, and `marvin-tm-review-fixer` agents support this pipeline.

## Security scanners — `sec-*`

These commands cover OWASP-aligned scanning, threat modeling, and remediation.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:sec-scan` | Run a comprehensive OWASP Top 10:2025 audit that orchestrates the secrets, dependency, and IaC scans plus deep static analysis. | `marvin security scan`, `full OWASP audit`, `harden this service` |
| `/marvin:sec-secrets` | Scan deeply for leaked secrets and keys across code, config, and the full git history. | `marvin scan for secrets`, `did I commit a key?`, `find leaked credentials` |
| `/marvin:sec-deps` | Audit dependencies for known CVEs, license risks, and unmaintained or typosquatted packages. | `marvin audit dependencies`, `check for vulnerable packages`, `run npm audit` |
| `/marvin:sec-gate` | Run a fast, diff-scoped security check on staged or recent changes, as a pre-commit gate. | `marvin quick sec check`, `gate this commit`, `security-check my diff` |
| `/marvin:sec-threat-model` | Build a STRIDE threat model for a feature, service, or the whole app, covering data flows, trust boundaries, threats, and mitigations. | `marvin threat model the board tools`, `STRIDE analysis`, `what can go wrong here?` |
| `/marvin:sec-iac` | Review Infrastructure-as-Code across Terraform, CloudFormation, Kubernetes, Docker, and Helm. | `marvin review the Terraform`, `scan the Dockerfile`, `IaC security review` |
| `/marvin:sec-ci` | Audit CI/CD pipelines for supply-chain risks, secret exposure, and excessive permissions. | `marvin audit the CI pipeline`, `review the GitHub Actions`, `harden the workflows` |
| `/marvin:sec-fix` | Generate and verify a minimal, tested patch for a vulnerability from any scanner or manual finding. | `marvin fix this vulnerability`, `patch the finding`, `remediate the CVE` |
| `/marvin:sec-compliance` | Check code against OWASP ASVS at L1, L2, or L3 and report a control-by-control gap analysis. | `marvin ASVS audit`, `compliance check`, `OWASP ASVS gap analysis` |
| `/marvin:sec-pentest` | Generate an application-specific penetration-testing checklist mapped to PTES and the OWASP Testing Guide. | `marvin plan a pentest`, `generate a pentest checklist`, `red-team scope` |
| `/marvin:sec-report` | Recover the structured findings the scanners wrote under `.marvin/security/` and list them by severity for triage. | `marvin show the security findings`, `list the audit report`, `triage the scan results` |

The `marvin-auditor` agent supports these commands.

## Refactoring — `refactor-*`

These commands form the code-health family ([ADR-0029](./adr/0029-refactoring-command-family.md)),
split by mutation into a read, plan, and apply progression. The read side scans without
changing anything and writes numbered findings registers under `.marvin/refactor/`, each
finding carrying an `F<n>` id, a severity, an effort estimate, `file:line` evidence, and a
suggested direction. The plan sequences selected findings into small, risk-annotated steps
and routes anything spec-sized to `/marvin:task-start`. The apply stage executes exactly
one behavior-preserving step at a time behind the verify gate.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:refactor-audit` | Run a whole-project structural audit — an architecture map, churn-by-size hotspots, dependency tangles, and dead-code candidates — with the heavy reading delegated to `marvin-refactor-auditor`. | `marvin refactoring audit`, `where is the tech debt?`, `what should we refactor first?` |
| `/marvin:refactor-smells` | Scan a single path, module, or diff for code smells, anti-patterns, and idiom or naming inconsistencies, in the same register format as the audit. | `marvin check this module for smells`, `scan src/api for anti-patterns`, `any code smells in this diff?` |
| `/marvin:refactor-plan` | Turn selected findings into a sequenced plan, annotating each step with its rationale, dependencies, risk, rollback, test strategy, and effort, and route spec-sized items to the task pipeline. | `marvin plan the refactoring`, `sequence the findings`, `plan F1 and F3` |
| `/marvin:refactor-apply` | Execute exactly one behavior-preserving step under hard rails — verify green before and after, a coverage refusal that offers a pin-down test first, lessons recall and capture, and rollback on red. | `marvin apply the refactoring`, `execute step 2 of the plan`, `do the next refactor step` |

The `marvin-refactor-auditor` agent supports these commands.

## Task tracker — `track-*`

These commands drive a lightweight per-project board with interactive forms, giving
inquirer-style speed inside Claude Code. Every form field is also a tool argument, so
details you already stated skip the form, and on hosts without form support the commands
answer with the exact arguments to pass instead. New tasks branch off following the
convention `<type-prefix>/<seq>[-<tracker>]--<slug>`, with `bug` becoming `fix`, `feature`
becoming `feat`, `chore` becoming `chore`, and `spike` becoming `spike`, as in
`fix/007-OSI-123--login-timeout`. Tasks are stored under `.marvin/track/`, with an
optional `.marvin/config.json` managed through `/marvin:track-config`.

| Command | What it does | Say it in chat |
|---------|--------------|----------------|
| `/marvin:track-menu` | Open the board main menu — every action, including `link-pr` and `archive`. | `marvin open the board`, `board menu` |
| `/marvin:track-new` | Create a task — bug, feature, chore, or spike — through an interactive form. | `marvin add a bug to the board`, `new feature task` |
| `/marvin:track-list` | List the board: all tasks by status, the current-branch + work-in-progress view, or the tracked tasks linking out to the tracker. | `marvin what's on the board?`, `what am I working on?`, `show tracked tasks` |
| `/marvin:track-show` | Show one task in full — its fields and markdown body. | `marvin show task 3`, `open the login-timeout task` |
| `/marvin:track-start` | Pick a todo task, branch off, and mark it work-in-progress. | `marvin start a board task`, `pick a todo and branch off` |
| `/marvin:track-move` | Move a task — to review, to done, or to any configured status. | `marvin move task 3 to review`, `mark this done`, `set task 3 to blocked` |
| `/marvin:track-config` | Show or edit the board configuration — base branch, tracker URL template, branch template, and statuses — with fail-closed validation. | `marvin show the board config`, `set the base branch to main`, `connect our Jira statuses` |

The board dashboard scoped to these commands is `/marvin:help track`
([ADR-0032](./adr/0032-track-surface-reduction.md) records the seven-command surface).

Committing and opening PRs for board tasks is handled by the board-aware
[`/marvin:commit`](#core-developer-tools) and
[`/marvin:pr-create`](#pull-request-lifecycle--pr-), which pick up the linked task
automatically ([ADR-0025](./adr/0025-kanban-board-only.md)). Finished work archives off
the board into `.marvin/track/archive/`; its ids stay reserved, and `track-list` shows
an `N archived` footer while the archive holds anything. The
[configuration reference](./configuration.md) documents connecting an external tracker.

## Widgets on rich hosts

On an MCP host that supports the Apps widget layer, nine widgets render an interactive
panel in addition to the text output ([ADR-0024](./adr/0024-mcp-apps-widget-architecture.md)).
The panel is additive, so a text-only host shows the same information as text.

| Command | Widget |
|---------|--------|
| `/marvin:track-list` | The board as a master-detail task list. |
| `/marvin:track-list` (tracked view) | Tasks with a tracker id, linking out. |
| `/marvin:track-show` | A single task's fields and body. |
| `/marvin:task-summary` | The delivery digest for a finished task. |
| `/marvin:sec-report` | The security findings viewer with severity triage. |
| `/marvin:handoff-list` | A browser over the session-continuation docs. |
| `/marvin:dashboard` | The whole-toolbox status panel. |
| `/marvin:help` | The welcome dashboard — summary, MCP servers, and the command index. |
| `/marvin:reports` | The unified viewer over every generated `.marvin/` report. |

## Deterministic MCP tools

Where determinism matters, the prompts delegate to thirteen typed MCP tools, each declaring
a zod input schema. The commands above invoke them, and the model can call them directly,
but they are not typed as slash commands.

| Tool | Purpose |
|------|---------|
| `task` | The task board — task CRUD, role-driven transitions over the configured statuses, PR-URL capture, done-task archive, and board configuration. |
| `task-detail` | A single task's fields and body, backing the detail view. |
| `tracker` | A read-only list of tasks that carry an external tracker id. |
| `help` | The dashboard and the registry-derived command index. |
| `dashboard` | The whole-toolbox state report. |
| `verify` | The concurrent quality-gate runner that writes `verification.md`. |
| `spec` | The Definition-of-Ready gate that validates the spec contract. |
| `lessons` | The lessons-learned store — add with a duplicate guard, search, count, and prune. |
| `summary` | The task-delivery summary aggregator. |
| `handoff` | The session-continuation handoff documents. |
| `adr` | The ADR-lifecycle mechanics — numbering, corpus list, lint, managed index, the accept gate, and paired supersede. |
| `audit` | The structured `sec-*` findings recovered from `.marvin/security/`. |
| `report` | The unified report list scanned from `.marvin/` — security, refactor, task, handoff. |

## Agents

Ten Claude Code subagents load on install and are invoked through the Task tool or by the
pipeline.

| Agent | Role |
|-------|------|
| `marvin-guide` | Onboarding and codebase navigation, read-only. |
| `marvin-researcher` | Version-specific documentation lookup. |
| `marvin-debugger` | Root-cause analysis, read-mostly. |
| `marvin-auditor` | Security review, read-only. |
| `marvin-refactor-auditor` | Structural audit and smell verification, read-only. |
| `marvin-tm-writer` | Conversational spec exploration. |
| `marvin-tm-spec-critic` | Red-team review of a drafted spec, read-only. |
| `marvin-tm-executor` | Headless spec execution in a worktree. |
| `marvin-tm-diff-critic` | Red-team review of a branch or staged diff, read-only. |
| `marvin-tm-review-fixer` | Autonomous resolution of PR review comments. |

For the install steps and the lifecycle overview, see the [README](../README.md), and for
the contributor reference, see [CLAUDE.md](../CLAUDE.md).
