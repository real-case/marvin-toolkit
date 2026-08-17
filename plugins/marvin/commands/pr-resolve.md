---
description: Resolve open PR review feedback — fetch unresolved threads, plan and apply fixes, push, then reply to each thread and resolve it. Optionally pass a PR number.
---

# Resolve PR

Address the unresolved review comments on a pull request and close out the threads.

## Arguments

- `$ARGUMENTS` — Optional: PR number (e.g., `42`). If omitted, the PR is detected from the current branch.

## Instructions

**Read `skills/pr-resolve/SKILL.md`** and follow its full workflow (Checkout → Fetch unresolved threads → Classify + plan with the user → Apply → Commit + push → Reply + resolve → Verify closure → Report).

Pass `$ARGUMENTS` as the PR number if provided.

## Examples

| Command            | Behavior                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `/pr-resolve`      | Detect the PR, fetch unresolved threads, plan, apply, reply + resolve   |
| `/pr-resolve 42`   | Resolve the unresolved review threads on PR #42                          |
