# Session status in the session title

While a task runs through the task pipeline (`task-start` → `task-implement` → `task-verify` →
`task-deliver`) or through `/marvin:autopilot`, the session title shows where the task stands:
`[<status>] <task name>`, for example `[in progress] New notifications page`. The user can then
read every session's state from the sidebar without opening it.

## When it applies

- **Only with a session-title tool.** The Claude desktop app's Code tab provides
  `set_session_title` (call it with `session_id: "self"`). The terminal CLI has no title tool a
  model can call: there, skip every step of this file silently and never mention it.
- **Only in an interactive session.** Never under `MARVIN_PIPELINE=1` (a pipeline child is not
  the user's session) and never from a subagent, which cannot rename the session it runs in.
- **Never block on it.** A failed or declined rename changes nothing about the task. Do not retry
  it in the same turn; the next transition tries again.

## The task name

Derive it once, when the task begins, and keep it for the rest of the session.

- Name the result, not the action: "Create a new page - notifications" becomes
  `New notifications page`; "почини прокрутку в отчёте" becomes `Исправление прокрутки в отчёте`.
- At most 50 characters, sentence case, no trailing period, in the language of the task as the
  user wrote it.
- When the current title already carries one of the prefixes below (a resumed run, a second
  command of the same task), keep its name and change only the prefix.
- A bugfix spec, a resumed autopilot run or a spec handed to `task-implement` supplies the task:
  derive the name from the spec's title or the run's `task.original`.

## The statuses

Exactly one prefix, lower case, in square brackets, followed by one space.

| Prefix | Meaning | Set when |
|--------|---------|----------|
| `[in progress]` | work is under way and needs nobody | the task begins; work resumes after the user answered |
| `[waiting]` | the session needs the user | a turn ends with a question, an approval or a go-ahead the work cannot continue without |
| `[spec ready]` | the spec is sealed, implementation has not begun | `task-start` wrote and sealed the spec |
| `[ci]` | a pull request is open and its checks are still running | the PR was created and `gh pr checks` reports pending checks |
| `[pr ready]` | the pull request can be merged | every check passed, or the repository runs none |
| `[merged]` | the pull request was merged | the session merged it, or learned it from `gh pr view` or an app notice |
| `[halted]` | the work stopped without a mergeable pull request | the delivery gate refused, an autopilot run closed without a ready PR, or the work cannot continue |
| `[closed]` | the pull request was closed unmerged | the session learned it from `gh pr view` or an app notice |

Rules for moving between them:

- **Rename only when the prefix changes.** Two consecutive turns in the same status cost nothing.
- **`[waiting]` is for a real block.** An informational message at the end of a turn whose work
  goes on without the user does not set it. Ending a turn on a question the user must answer, a
  spec approval, a choice between options, or a confirmation before an outward action does.
- **Answering returns to `[in progress]`.** Set it at the start of the turn that acts on the
  user's answer, before the work, not at its end.
- **`[pr ready]`, `[merged]`, `[closed]` and `[halted]` hold** until the next task begins in this
  session; nothing else in this file moves them, except `[pr ready]` → `[merged]` or `[closed]`,
  and a pull request whose checks turn red after `[pr ready]`, which goes back to `[in progress]`
  while it is fixed.
- **Learn merges and closures only from evidence.** Before `[merged]` or `[closed]`, confirm the
  state with `gh pr view <n> --json state`. A remark that the PR "should be merged by now" is not
  evidence.

## Autopilot: the title is the orchestrator's address

Pipeline children report to the orchestrator with `SendMessage`, which finds a session by its
title. Every rename of the orchestrator session therefore changes its address, and
`/marvin:autopilot` follows each rename with `marvin-pipe attach --orch "<new title>"` so that
the run's heartbeat reminders and its message guard name the new title. The autopilot skill
describes the order of the two calls.
