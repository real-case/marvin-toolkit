# Kanban Rework — Progress

This document tracks the execution of the [kanban rework plan](./kanban-rework.md). The plan
holds the design and scope and stays stable; this file is the living record. When a work
package advances, update its row in the status board, tick the checklist items it completed,
fill in the branch, PR, and ADR references, and add a dated entry to the log. When every
checklist item of a package is ticked, flip its status to Done and update the findings
coverage table.

Status values: **Not started · In progress · Blocked · Done**.

## Status board

| WP | Title                                | Status      | Branch | PR | ADR | Notes |
| -- | ------------------------------------ | ----------- | ------ | -- | --- | ----- |
| 1  | Git-operations migration             | Done        | `feat/kanban-wp1-git-ops` | [#55](https://github.com/real-case/marvin-toolkit/pull/55) | ADR-0025 | Merged to `dev` 2026-07-02 (squash `20ed8ef`); plugin 0.2.0 |
| 2  | Configurable status model            | Done        | `feat/kanban-wp2-status-model` | [#56](https://github.com/real-case/marvin-toolkit/pull/56) | ADR-0026 | Merged to `dev` 2026-07-02 (squash `dc55252`); plugin 0.3.0; landed before the ADR-0024 widget stage |
| 3  | Input contract and storage hardening | Done        | `feat/kanban-wp3-input-contract` | [#61](https://github.com/real-case/marvin-toolkit/pull/61) | —   | Merged to `dev` 2026-07-02 (merge commit `0b120ae`); plugin 0.4.0 |
| 4  | Configuration surface                | Done        | `feat/kanban-wp4-config-surface` | [#64](https://github.com/real-case/marvin-toolkit/pull/64) | —   | Merged to `dev` 2026-07-02 (squash `289f11d`); plugin 0.5.0 |
| 5  | Polish and coverage sweep            | Done        | `feat/kanban-wp5-polish` | [#63](https://github.com/real-case/marvin-toolkit/pull/63) | —   | Merged to `dev` 2026-07-02 (squash `3aefe8d`); plugin 0.6.0; second-lander rebase + config e2e added per protocol |

## Milestones

- [x] ~~v0.1.0 promoted to `main` and tagged~~ — *superseded: the 0.1.0/0.2.0 lines were never tagged; the first release is v0.3.0, carrying the whole line*
- [x] WP1 merged into `dev`; plugin version 0.2.0
- [x] WP2 merged into `dev`; contracts tracker-ready (unblocks the widget stage and future connectors)
- [x] Release cut after WP2 (breaking changes ship together) — **[v0.3.0 released](https://github.com/real-case/marvin-toolkit/releases/tag/v0.3.0)** 2026-07-02: #58 (squash, recovered), #57 prep, #60 history-join promotion (merge commit `7a21a3c`; #59 auto-marked merged), tag `v0.3.0` → GitHub Release via release.yml. `dev` is an ancestor of `main` again.
- [x] WP3–WP5 merged into `dev` (#61 / #64 / #63; plugin 0.6.0)
- [x] Release cut after WP5 — **[v0.6.0 released](https://github.com/real-case/marvin-toolkit/releases/tag/v0.6.0)** 2026-07-02: docs finalization #66 (squash `c9ebc25`), promotion [#65](https://github.com/real-case/marvin-toolkit/pull/65) merged **with a merge commit** (`7fc26ea` — histories stayed joined), tag `v0.6.0` → GitHub Release via release.yml

## WP1 — Git-operations migration

- [x] `kanban-commit` and `kanban-create-pr` prompt entries removed (43 → 41 prompts)
- [x] `tools/git.ts` deleted and unwired from `server.ts` (`lib/git.ts` helpers kept)
- [x] `task` tool gains the `link-pr` action (URL onto frontmatter via `setTaskPr`)
- [x] `commit` skill appends the `Refs:` footer when the branch is linked to a board task
- [x] `pr-create` skill: task context in title and body, explicit `git push -u`, `task link-pr` call, offer to move the task to review
- [x] `runReview` hint points to `/marvin:pr-create`
- [x] `task` and `help` tool descriptions mention "kanban"/"board"
- [x] `kanban-list` text table shows the PR link
- [x] `git-pr-structured.test.mjs` retargeted to `task link-pr` (renamed `link-pr-structured.test.mjs`; + no-task and bad-URL cases)
- [x] Docs updated: `docs/commands.md`, `CLAUDE.md`, plugin README, CHANGELOG (also root README + docs/README ADR indexes)
- [x] ADR-0025 written and accepted
- [x] Version 0.2.0 in `plugin.json`, `marketplace.json`, server `package.json`
- [x] Exit: build, `verify-dist`, `lint-manifests`, tests green; dist rebuilt and committed

## WP2 — Configurable status model

- [x] `Config.statuses` schema with `{ key, role, tracker_status? }`, defaults, and role invariants (todo/wip/done required)
- [x] Frontmatter status validated against the configured set; unknown statuses go to the malformed channel
- [x] Role-driven transitions in `tools/task.ts` (`create` / `start` / `review` / `done` target the first status of their role)
- [x] Honest empty-candidate message replaces "Cancelled — no changes made" (finding 8)
- [x] `runStart` preselected-id path respects status filters (finding 14)
- [x] Generic `move` action over all configured statuses (`blocked` becomes reachable)
- [x] Contracts updated: `TaskCard.status` → `{ key, role }`, counts → open record with role roll-up (+ `DashboardState.config.statuses`)
- [x] Render order and dashboard counters derived from the configured set (role priority, config order within a role)
- [x] `base_branch` auto-detected from `origin/HEAD` when no config exists
- [x] Structured-content tests extended to the new shapes (+ 8-test `status-model.test.mjs`)
- [x] ADR-0026 written and accepted
- [x] Exit: build, `verify-dist`, `lint-manifests`, tests green; dist rebuilt and committed

## WP3 — Input contract and storage hardening

- [x] `task` input schema widened: `title`, `description`, `tracker_id`, `status`; elicitation only for missing fields (unknown `move` status → isError with configured keys; `review`/`done` also honor explicit `taskId`)
- [x] Elicitation capability check in `shared/elicit.ts` (`canElicit`); instructive error naming the retry arguments
- [x] Kanban prompt bodies pass natural-language intent as arguments
- [x] Unicode titles allowed (JSON-Schema-safe pattern); slug falls back to the task type when empty
- [x] `nextSeq` derived from filenames including malformed ones
- [x] Atomic task writes (temp file + rename; temp names never `.md`); stale comment corrected
- [x] Branch names follow `<type-prefix>/<seq>[-<tracker>]--<slug>` (bug→fix, feature→feat, chore→chore, spike→spike)
- [x] Tests for the new input paths and storage edge cases (argument-driven create with zero elicitations, no-capability flows, Unicode fallback, nextSeq collision regression)
- [x] Exit: build, `verify-dist`, `lint-manifests`, tests green; dist rebuilt and committed (done on the branch; CI green on Node 20/22)

## WP4 — Configuration surface

- [x] `config` action on the `task` tool + `kanban-config` prompt (view with base_branch source labels; edits via args; `statuses` JSON fail-closed; foreign keys like `gates` preserved — regression-tested; auto-detected base_branch pinned on file creation)
- [x] Optional `branch_template` setting ({type_prefix}/{type}/{seq}/{tracker}/{slug}; git-ref-safe validation, fallback+warn, preview at set time)
- [x] Commit-versus-gitignore guidance for `.marvin/kanban/` documented
- [x] Tracker connection guide in `docs/commands.md`
- [x] Exit: build, `verify-dist`, `lint-manifests`, tests green; dist rebuilt and committed (13 config tests; registry 42; config loaded per call)

## WP5 — Polish and coverage sweep

- [x] `kanban-help` calls `help` with `section: "kanban"`
- [x] Archive mechanism for done tasks (`archive` action: single taskId or bulk behind confirmation; files → `.marvin/kanban/archive/` atomic rename; `nextSeq` scans archive so ids are never reissued; "N archived" list footer)
- [x] `marvin-guide` mentions the board
- [x] End-to-end lifecycle tests (`test/lifecycle-e2e.test.mjs`: full chain create → start → move → review → done → archive across server sessions, zero elicitations; malformed collisions; `link-pr`; config round-trip mid-session added after WP4 landed)
- [x] Exit: build, `verify-dist`, `lint-manifests`, tests green; dist rebuilt and committed (second-lander rebase onto `dev`, re-bump to 0.6.0)

## Findings coverage

Mirrors Appendix A of the plan. A finding is Closed when its work package merges into `dev`.

| Finding | WP  | Status | Finding | WP  | Status |
| ------- | --- | ------ | ------- | --- | ------ |
| 1       | 3   | Closed | 11      | 3   | Closed |
| 2       | 1   | Closed | 12      | 1   | Closed |
| 3       | 1   | Closed | 13      | 1   | Closed |
| 4       | 2+4 | Closed | 14      | 2   | Closed |
| 5       | 2   | Closed | 15      | 5   | Closed |
| 6       | 3   | Closed | 16      | 3   | Closed |
| 7       | 3   | Closed | 17      | 4   | Closed |
| 8       | 2   | Closed | 18      | 1   | Closed |
| 9       | 5   | Closed | 19      | 5   | Closed |
| 10      | all | Closed |         |     |        |

## Log

Newest entries first.

- **2026-07-02** — **v0.6.0 released — the record closes.** #66 squash-merged into `dev`
  (`c9ebc25`); promotion #65 merged into `main` with a **merge commit** (`7fc26ea`, parents
  `7a21a3c` + `c9ebc25` — the v0.3.0 lesson held); tag `v0.6.0` pushed from the main session;
  release workflow green (16s); GitHub Release "marvin v0.6.0" published. The rework shipped
  in two same-day releases (v0.3.0, v0.6.0) with the plan fully implemented.
- **2026-07-02** — Release cut v0.6.0 opened: promotion
  [#65](https://github.com/real-case/marvin-toolkit/pull/65) (`dev → main`) came up
  MERGEABLE/CLEAN — the #60 history join held, zero conflicts. This docs-finalization commit
  (tracker complete through WP5, plan Status → Implemented) merges into `dev` ahead of the
  promotion, which tracks `dev` and picks it up automatically. Remaining: merge #65 **with a
  merge commit**, then tag `v0.6.0` on `main` (release workflow publishes the GitHub Release).
- **2026-07-02** — **WP5 merged — the rework is complete.** The WP5 session executed the
  second-lander task from the main session's message (rebase onto `dev`, re-bump to 0.6.0,
  config round-trip added to the e2e sweep), CI went green and
  [#63](https://github.com/real-case/marvin-toolkit/pull/63) was squash-merged (`3aefe8d`).
  Plugin 0.6.0 on `dev`. Findings 9, 10, 15, 19 closed — **19/19, the audit register is
  fully retired**. Plan Status flips to Implemented. Remaining follow-ups outside the plan:
  v0.6.0 release cut, final re-commit of these docs, session/branch cleanup.
- **2026-07-02** — **WP4 merged into `dev`** ([#64](https://github.com/real-case/marvin-toolkit/pull/64),
  squash `289f11d`; plugin 0.5.0). Findings 4 (both halves) and 17 closed. #63 turned
  CONFLICTING as predicted; the WP5 session was messaged with the second-lander task: rebase
  onto `dev`, re-bump to 0.6.0, add the config round-trip to the e2e sweep, force-push.
- **2026-07-02** — WP4 and WP5 both implemented in parallel sessions; PRs open and CI-green:
  [#63](https://github.com/real-case/marvin-toolkit/pull/63) (WP5: scoped kanban-help,
  `archive` action with `.marvin/kanban/archive/`, marvin-guide board awareness, 8-test
  lifecycle e2e, repo-wide 15s stdio test timeouts) and
  [#64](https://github.com/real-case/marvin-toolkit/pull/64) (WP4: `config` action with
  foreign-key preservation and pinned base_branch detection, `branch_template`,
  `kanban-config` prompt — registry 42, per-call config loads, 13 config tests). Both claim
  0.5.0 as designed — whichever merges second rebases and re-bumps to 0.6.0. Recommended
  order: #64 first, then the WP5 session rebases (its prompt conditionally adds a config
  round-trip to the e2e sweep once WP4 is in its base).
- **2026-07-02** — Plan docs merged ([#62](https://github.com/real-case/marvin-toolkit/pull/62),
  squash `e5b7ac2`): the tracker is now a tracked file; live edits continue as uncommitted
  working-tree changes in the main checkout (single-writer rule unchanged), with a final
  re-commit when the rework closes. WP5 dispatched to its own session; the WP4 chip was
  reissued — both prompts now carry a parallel-work protocol (fetch + rebase onto origin/dev
  before opening the PR) and a landing-order version protocol (first to land takes 0.5.0,
  the second 0.6.0).
- **2026-07-02** — Housekeeping round: WP1/WP3 worker sessions archived (worktrees
  auto-cleaned). Plan + tracker committed via
  [PR #62](https://github.com/real-case/marvin-toolkit/pull/62) (`docs/kanban-rework-plan`,
  `00d4bd9`) — live tracker edits continue on the untracked working copies in the main
  checkout until the rework ends (single-writer rule unchanged); remove those local copies
  before pulling the merged #62. WP4 dispatched to a dedicated session (config surface,
  targets 0.5.0). Deletion of the five merged remote branches awaits explicit user
  confirmation (auto mode declined it).
- **2026-07-02** — **WP3 merged into `dev`** ([#61](https://github.com/real-case/marvin-toolkit/pull/61),
  merge commit `0b120ae` — note: topic PRs are conventionally squashed, this one landed as a
  merge; harmless, recorded for consistency). Plugin 0.4.0 on `dev`. Findings 1, 6, 7, 11, 16
  closed. Remaining work packages: WP4 (configuration surface), WP5 (polish and coverage).
- **2026-07-02** — WP3 implemented and [PR #61](https://github.com/real-case/marvin-toolkit/pull/61)
  opened into `dev` (branch `feat/kanban-wp3-input-contract`, +954/−191 over 19 files, plugin
  0.4.0, CI green on Node 20/22, MERGEABLE). All WP3 checklist items done on the branch —
  status flips to Done and findings 1, 6, 7, 11, 16 close on merge. Both dispatched sessions
  (WP1/release and WP3) are idle: the WP1 session's PRs are all merged (worktree
  `reverent-payne` + branch `chore/release-prep-0.3.0` are cleanup candidates), the WP3
  session awaits only the merge of #61.
- **2026-07-02** — **v0.3.0 released**: #60 merged to `main` with a merge commit (`7a21a3c`,
  parents #58-squash + join; #59 auto-marked merged once `dev` became reachable), histories
  verified rejoined (`dev` is an ancestor of `main`), prep content confirmed on `main`
  (root 0.3.0, SECURITY 0.3.x, CHANGELOG `## [0.3.0]`). Tagged `v0.3.0` at `7a21a3c`;
  release.yml published the [GitHub Release](https://github.com/real-case/marvin-toolkit/releases/tag/v0.3.0)
  (not draft, not prerelease). The duplicate recovery branch `release/v0.3.0` from the WP
  session was deleted; `promote/v0.3.0` (#60) was the one that shipped.
- **2026-07-02** — Recovery executed from the main session: prep #57 squash-merged into `dev`
  (`dfe8e21`); #59 confirmed CONFLICTING (the #58 squash left `main` without a `dev` parent,
  so every file both lines touched three-way-conflicts); superseded by
  [#60](https://github.com/real-case/marvin-toolkit/pull/60) — branch `promote/v0.3.0` =
  `origin/dev` merged `-s ours` over `origin/main`: tree byte-identical to `dev` (verified,
  empty diff), `main` recorded as a parent. Closing #59 and merging #60 need a human (auto
  mode declines self-approval of a session-authored promotion); merge #60 **with a merge
  commit**, then tag `v0.3.0` — the release workflow publishes the GitHub Release from the
  plugin CHANGELOG.
- **2026-07-02** — Promotion [#58](https://github.com/real-case/marvin-toolkit/pull/58) was
  **squash-merged** to `main` (`0a5e503`) before prep #57 landed: content on `main` is
  WP1+WP2-complete but misses the prep, and `dev`/`main` histories diverged (squash has no
  `dev` parent). Remediation: follow-up promotion
  [#59](https://github.com/real-case/marvin-toolkit/pull/59) (head `dev`) — merge #57 first,
  then #59 **with a merge commit**, which carries the prep over *and* joins the histories;
  then tag `v0.3.0`. Merge commits are enabled in the repo settings; squash remains correct
  for topic PRs into `dev`, merge-commit is the rule for `dev → main` promotions (ADR-0019).
- **2026-07-02** — WP3 spun off into a dedicated session (self-contained prompt reflecting the
  post-WP2 codebase; base guard on `dc55252`; targets 0.4.0 and must not merge before the
  v0.3.0 promotion #58 lands). Local `dev` in the main checkout fast-forwarded to `dc55252`
  so the session's worktree starts from WP1+WP2.
- **2026-07-02** — WP2 merged into `dev` (squash `dc55252`); findings 5, 8, 14 closed, finding 4
  half-closed (detection). Release cut started: prep
  [PR #57](https://github.com/real-case/marvin-toolkit/pull/57) (root version parity 0.3.0 +
  SECURITY.md) and promotion [PR #58](https://github.com/real-case/marvin-toolkit/pull/58)
  (`dev → main`, merge-commit — not squash, then tag `v0.3.0`). v0.3.0 will be the **first**
  tag — the 0.1.0/0.2.0 lines were never promoted.
- **2026-07-02** — WP2 implemented and [PR #56](https://github.com/real-case/marvin-toolkit/pull/56)
  opened into `dev` (branch `feat/kanban-wp2-status-model`; ADR-0026; plugin 0.3.0; 8 new
  status-model tests). All WP2 checklist items done on the branch — status flips to Done and
  findings 5/8/14 (+ 4's detection half) close on merge. Note: the v0.1.0 promotion to `main`
  is still pending; WP1/WP2 landed on `dev` ahead of that milestone.
- **2026-07-02** — WP1 merged into `dev` ([PR #55](https://github.com/real-case/marvin-toolkit/pull/55),
  squash `20ed8ef`; ADR-0025; plugin 0.2.0). Findings 2, 3, 12, 13, 18 closed. The tracker was
  absent from the WP1 worktree, so it is updated retroactively from the main checkout here.
- **2026-07-02** — WP1 spun off into a dedicated session (self-contained prompt; the session
  works in a fresh worktree off `dev` and opens a PR into `dev`). Status flips to In progress
  when that session starts.
- **2026-07-02** — Plan and progress tracker created from the kanban effectiveness audit and
  the two design decisions (D1 git-operations migration, D2 configurable status model). No
  implementation started; v0.1.0 promotion to `main` is the pending precondition.
