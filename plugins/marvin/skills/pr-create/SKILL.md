---
name: pr-create
description: Create a pull request with structured description, verification checklist, and issue linking; picks up board task context (title prefix, task/tracker links, PR-URL capture) when the branch belongs to a board task. Use when the user asks to "create a PR", "make a PR", "open a pull request", "submit PR", "push and open a PR", "open a PR for this board task", "marvin create a PR", or just "PR" — when a feature/bugfix branch is ready to be proposed. This is the OPEN step only; it does not review, update, or merge an existing PR.
---

Create a well-structured pull request for the current branch.

## Pre-flight

1. Determine the base branch — check repo conventions (e.g., `dev`, `main`, `develop`). When unclear, ask the user.
2. `git fetch origin` — ensure up-to-date refs
3. `git log <base>..HEAD --oneline` — understand all commits
4. `git diff <base>...HEAD --stat` — see changed files
5. Read the key changed files to understand the full context

## Board task

If the project has a board (task files under `.marvin/track/`), find the task whose
frontmatter `branch` equals the current branch. When one is linked, note its `id`,
`tracker_id`, `title`, and filename, and read `tracker_url_template` from
`.marvin/config.json` (the `{tracker_id}` placeholder expands to the task's `tracker_id`).
The task shapes the title and body below. No board or no matching task — proceed without
task context.

## PR title

Format: `<short imperative description>` — under 72 chars, describes the *what*.

If the project uses a title convention (task type prefix, issue number), apply it. Examples:

```
Add pagination to search results
Fix stale state on section switch
[Feature][PROJ-123] Add pagination to search results
```

When a board task is linked to the current branch, prefix the title with its tracker id —
`[<tracker_id>] <title>` — falling back to the board id (`[<id>] <title>`) when the task
has no `tracker_id`:

```
[PROJ-123] Add pagination to search results
[007] Add pagination to search results
```

## PR body

Use the template, dropping sections that don't apply:

```markdown
## Summary
<!-- 1–3 sentences: what changed and why -->

## Changes
<!-- Key changes grouped by area. Skip trivial file lists. -->

## Verification
<!-- How this was verified before submitting -->
- Tests: PASS|FAIL (N tests)
- Type-check: PASS|FAIL
- Build: PASS|FAIL
- Manual verification: <brief description or "skipped">

## Notes
<!-- Trade-offs, follow-ups, risks, breaking changes. Omit if none. -->
```

When a board task is linked, open the body with its links (before `## Summary`):

```markdown
Task: `.marvin/track/<filename>`
Tracker: <url>
```

The tracker URL comes from `tracker_url_template` with `{tracker_id}` filled in; drop the
`Tracker:` line when there is no template or the task has no `tracker_id`.

## Issue linking

If the branch name or commit messages contain an issue reference (e.g., `PROJ-123`, `#42`), include it in the body. Ask the user if no reference is found.

## Submit

1. Run verification commands available in the project (test, lint, type-check, build) and report results
2. Push the branch: `git push -u origin <branch>`
3. Compose the PR: `gh pr create --base <base>` — add `--draft` when the caller asked for a draft (`/marvin:task-deliver` does when a semantic gate is still red), and say in the confirmation that the PR will open as a draft
4. **Always confirm with the user before submitting** — show the title and body, ask for approval
5. Never force-push to shared branches
6. Never include AI/Claude/automated references in the PR title or body

## After creation — link the board task

When a board task is linked to this branch, persist the PR URL onto it: call the `task`
MCP tool from the `marvin` server with `action: "link-pr"` and `url` set to the PR URL
that `gh pr create` printed (pass `taskId` only if the branch lookup would be ambiguous).
Then offer to move the task to review — `task` tool, `action: "review"`.

## Pipeline mode

Active only when `MARVIN_PIPELINE=1` is set: a child session of the autopilot pipeline, usually
chained from `/marvin:task-deliver`, where nobody is present to answer. The workflow above applies
except where this section overrides it. An interactive session never sets the variable, so none of
this reaches one.

- **The base is the run's.** Use the base the TASK CONTEXT names, which the pipeline took from
  `base_branch` in `.marvin/config.json`, and never ask. The pipeline's guard refuses `gh pr create`
  with any other `--base`.
- **One pull request, opened as a draft.** Run `gh pr view` first: when the branch already has an
  open PR, the push has updated it, so report its URL and create nothing. Otherwise add `--draft`.
  The pipeline marks the PR ready itself once its verifier has passed and CI is green.
- **No confirmation.** Skip Submit step 4; the pipeline's verifier reads the PR instead.
- **No second gate run.** Skip Submit step 1 and fill `## Verification` from the last full `verify`
  run (`.marvin/task/runs/<slug>.md`): the run the delivery gate judged, or the red run
  `/marvin:task-implement` stopped on at a loop's limit. The gates have just run, and the pipeline
  runs them again itself.
- **No issue-reference question.** Use the spec's `tracker` frontmatter, or
  `pipeline.tracker_default` from `.marvin/config.json` when the spec says `none` or nothing.
- **A Pipeline section closes the body**, whichever template composed it, task-deliver's included:

  ```markdown
  ## Pipeline
  - Run: <run id>
  - Tier: <tier>
  - Iteration: <n>

  Review: pipeline gate stage and external verifier
  ```

  Take Run, Tier and Iteration from the TASK CONTEXT: its heading names the iteration, and the line
  under the orchestrator's name names the run and the tier. This section is the one exception to
  Submit rule 6: it names the run, never a model or an assistant.
- **No board-task calls.** Skip "After creation": the board belongs to the pipeline, whose guard
  refuses the `task` tool to a child.