---
name: creating-pr
description: Create a pull request with structured description, verification checklist, and issue linking. Use when user asks to "create PR", "open pull request", "submit PR", "push and create PR", or when a feature/bugfix workflow reaches the PR stage.
---

Create a well-structured pull request for the current branch.

## Pre-flight

1. Determine the base branch — check repo conventions (e.g., `dev`, `main`, `develop`). When unclear, ask the user.
2. `git fetch origin` — ensure up-to-date refs
3. `git log <base>..HEAD --oneline` — understand all commits
4. `git diff <base>...HEAD --stat` — see changed files
5. Read the key changed files to understand the full context

## PR title

Format: `<short imperative description>` — under 72 chars, describes the *what*.

If the project uses a title convention (task type prefix, issue number), apply it. Examples:

```
Add pagination to search results
Fix stale state on section switch
[Feature][PROJ-123] Add pagination to search results
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

## Issue linking

If the branch name or commit messages contain an issue reference (e.g., `PROJ-123`, `#42`), include it in the body. Ask the user if no reference is found.

## Submit

1. Run verification commands available in the project (test, lint, type-check, build) and report results
2. Compose the PR: `gh pr create --base <base>`
3. **Always confirm with the user before submitting** — show the title and body, ask for approval
4. Never force-push to shared branches
5. Never include AI/Claude/automated references in the PR title or body