# ADR 0025 — Kanban goes board-only: git operations fold into the `commit`/`pr-create` skills

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-07-02                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0018](0018-three-doors-instrument-taxonomy.md) (instrument taxonomy), [ADR-0023](0023-pr-command-family.md) (prose-driven PR lifecycle; `git` tool not extended), [ADR-0024](0024-mcp-apps-widget-architecture.md) (PrRef contract, PR-URL capture), `plugins/marvin/skills/commit/SKILL.md`, `plugins/marvin/skills/pr-create/SKILL.md` |

## Context

The kanban group carried two git wrappers next to the board commands:
`kanban-commit` and `kanban-create-pr`, both thin prompts over the `git` MCP
tool. That tool duplicated, behind MCP elicitation forms, what the `commit` and
`pr-create` skills already do better in prose:

- The **`commit` skill** inspects the repo, stages intentionally, detects
  sensitive files, drafts a Conventional Commits message, and handles
  pre-commit-hook failures. The tool's version was a four-field form
  (`type`/`scope`/`message`/`stage_all`) that could `git add -A` and commit —
  no sensitive-file detection, no hook-failure recovery, no diff analysis.
- The **`pr-create` skill** reads the branch's commits and diff, composes a
  structured body with a verification checklist, and confirms before
  submitting. The tool's version templated a title/body from task frontmatter
  and shelled out to `gh pr create` — no diff reading, no verification, no
  confirmation.

Two implementations of the same two operations meant every improvement had to
land twice, and the tool copy was always the lesser one. ADR-0023 had already
drawn the boundary for the `pr-*` family: **judgement belongs in prose, the
`git` tool is not extended**. The kanban wrappers were the last git surface on
the wrong side of that line.

One piece of the tool was *not* judgement: at `gh pr create` time it captured
the printed PR URL onto the task's `pr` frontmatter field (ADR-0024 widget
data — the `PrRef` in `task list`'s `structuredContent`). A skill can shell out
to `gh`, but the deterministic state write onto the board file needs a typed,
fail-closed home.

## Decision

**The kanban group becomes board-only; the `commit`/`pr-create` skills absorb
task context; the `git` MCP tool is retired. PR-URL capture survives as a new
`task` tool action, `link-pr` — judgement in prose, the deterministic state
write in the tool.**

1. **Prompts `kanban-commit` and `kanban-create-pr` are removed** (kanban
   13 → 11, total 43 → 41). The group's remaining 11 prompts are pure board
   operations over the `task`/`help` tools.
2. **The `git` MCP tool is deleted.** `src/lib/git.ts` (plumbing: branch
   queries, checkout, branch creation) stays — the `task` and `help` tools use
   it.
3. **The `commit` skill picks up the board task**: when the current branch
   equals a task's `branch` frontmatter, the commit message gains a
   `Refs: <id>` footer (`Refs: <id>, <tracker_id>` when a tracker id exists) —
   the retired tool's behavior, preserved.
4. **The `pr-create` skill picks up the board task**: title prefix
   `[<tracker_id>] <title>` (falling back to `[<id>] <title>`), body lines
   `Task: .marvin/kanban/<filename>` and `Tracker: <url>` (from
   `tracker_url_template`), an explicit `git push -u origin <branch>` before
   `gh pr create`, and — after creation — a call to `task link-pr` with the
   printed URL, then an offer to move the task to review.
5. **`task` gains `link-pr`**: validates the URL as http(s), resolves the task
   (explicit `taskId` wins, otherwise the task linked to the current branch,
   otherwise a typed error), and persists via the existing `setTaskPr`
   (bumps `updated`). `task list` renders the stored URL as a `pr` column and
   as the populated `PrRef` in `structuredContent` (ADR-0024).
6. **Auto-discovery moves to the tool descriptions.** The kanban group has no
   `SKILL.md`s, so chat phrases like "add a bug to the board" must match the
   `task`/`help` tool descriptions — they now name the kanban board explicitly.

## Consequences

- **Breaking — plugin 0.2.0.** Two prompts are gone; callers move to
  `/marvin:commit` and `/marvin:pr-create`. The `git` tool disappears from
  `tools/list`. Acceptable pre-1.0; recorded here and in the changelog.
- One implementation per operation. Commit/PR improvements land once, in the
  skill, and board users get the full workflow (sensitive-file detection,
  verification checklist, confirmation) instead of the form-based subset.
- The prose/tool boundary is now uniform across the toolkit: skills decide,
  tools persist (`verify`, `spec`, `lessons`, `handoff`, and now `link-pr`).
- The elicit-form commit UX is gone. The board keeps interactive forms only
  where they are the point (task creation, pickers).
- `link-pr` is callable outside the skill flow too — linking a manually opened
  PR onto a task is now a one-tool-call operation.
- Tests: the `git create-pr` stdio test is retargeted to drive `task link-pr`
  and keeps asserting frontmatter persistence and the rendered `PrRef`.
