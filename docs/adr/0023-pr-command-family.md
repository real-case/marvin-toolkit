# ADR 0023 — Unified `pr-*` pull-request command family

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-28                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0001](0001-single-plugin-consolidation.md) (command naming scheme), [ADR-0018](0018-three-doors-instrument-taxonomy.md) (three doors), [ADR-0019](0019-branching-and-pr-flow.md) (PR-based flow), [ADR-0017](0017-adversarial-critic-gates.md) (`marvin-tm-review-fixer`), `plugins/marvin/skills/pr-*/SKILL.md` |

## Context

The pull-request commands had grown up piecemeal and no longer matched how a user
drives the PR lifecycle by prose:

- `pr-create` opened a PR — fine.
- `pr-review` did a **local** read-only code review that only printed findings to
  chat (`disable-model-invocation: true`) and never touched GitHub. A user saying
  "review the PR" expected a review **posted on the PR**, not chat output.
- `task-fix-pr` fetched PR comments and applied fixes, but it lived in the `task-*`
  spec-pipeline namespace, fetched **all** comments (not just unresolved), and
  **replied but never resolved** the review threads — so addressed feedback stayed
  visually "open".
- There was **no merge command** at all; landing a PR and getting back onto an
  up-to-date base branch was manual.

The result was an incoherent surface: two of the four PR lifecycle stages were
missing or misfiled, and the names did not line up with the natural verbs
("create / review / resolve / merge a PR").

## Decision

**Consolidate the whole PR lifecycle into one prose-driven `pr-*` family — one
command per stage — under the existing three-doors model.**

| Stage | Command | Behavior |
|-------|---------|----------|
| Open | `pr-create` | create a PR (unchanged; trigger prose retuned) |
| Review | `pr-review` | **repurposed** — review the PR on GitHub and submit the review there (summary + inline comments by severity, default `event=COMMENT`) |
| Resolve | `pr-resolve` | **renamed from `task-fix-pr`** — fetch the **unresolved** review threads (GraphQL `reviewThreads.isResolved`), draft a change plan, apply minimal fixes, push, then reply to each thread **and resolve it** (`resolveReviewThread`) |
| Merge | `pr-merge` | **new** — confirm mergeability, merge via `gh pr merge --delete-branch` (repo's default method), then check out the PR's base branch and `git pull` |

1. **`pr-review` becomes GitHub-side.** The local, read-only pre-commit review role
   is already served by the built-in `/code-review` and the `marvin-auditor` agent,
   so nothing is lost by repurposing `pr-review` to post a real GitHub review. On a
   self-authored PR it uses `event=COMMENT` (GitHub forbids self-approval).

2. **`task-fix-pr` → `pr-resolve`.** The operation is a PR operation, not a spec
   step, so it moves into the `pr-*` family. It gains two behaviors the user
   requires: filter to **unresolved** threads only, and **reply-then-resolve** each
   addressed thread (spec-conflicts stay open for the reviewer). The autonomous twin
   `marvin-tm-review-fixer` keeps the same contract and is updated in lock-step.

3. **The family stays prose/skill-driven.** Like `pr-create`, the new commands are
   `SKILL.md` workflows that shell out to `gh` — the `git` MCP tool is **not**
   extended. Determinism here is GitHub's (the `gh` calls), and the judgement
   (what to review, which fix satisfies a comment, whether to merge) belongs in
   prose. This matches the existing `pr-*` style and keeps the tool layer for the
   genuinely deterministic gates (`verify`, `spec`).

4. **Resolved/unresolved state needs GraphQL.** GitHub exposes thread resolution
   only on the GraphQL API, so `pr-resolve` reads `reviewThreads { isResolved }`
   and calls `resolveReviewThread` — REST is used only for posting replies and
   fetching non-threaded discussion.

   > **Update 2026-07-16:** thread replies also moved to GraphQL
   > (`addPullRequestReviewThreadReply`, keyed on the same thread node id as
   > `resolveReviewThread`). The REST `/replies` path depended on a `$REPO` shell
   > variable set in an earlier step — commands run in separate shells, so the
   > variable was empty and replies silently 404'd. REST now serves only to fetch
   > non-threaded discussion.

## Consequences

- The PR lifecycle reads as four natural commands: `pr-create`, `pr-review`,
  `pr-resolve`, `pr-merge`. The `pr-*` group goes from 2 to 4; `task-*` drops from
  5 to 4 — a net +1 prompt.
- **Breaking:** the `/marvin:task-fix-pr` prompt and the `task-fix-pr` skill/command
  are removed. Callers move to `/marvin:pr-resolve`. Acceptable pre-1.0 (no external
  installed base); the rename is recorded here.
- Posting reviews and merging require `gh` auth with repo write. Both `pr-review`
  (posting) and `pr-merge` confirm with the user before any outward action.
- Historical ADRs that mention `task-fix-pr` (e.g. [ADR-0020](0020-debugger-agent.md))
  keep their original wording as a record of state at decision time; this ADR is the
  forward pointer.
