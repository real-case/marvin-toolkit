---
description: Apply PR review comments as code fixes — fetch feedback, apply changes, commit, push, and reply to reviewers
---

# Fix PR

Address review comments on a pull request — Phase 3 of the task pipeline.

## Arguments

- `$ARGUMENTS` — PR number (e.g., `42`). If omitted, detects the PR from the current branch.

## Instructions

**Read `skills/mn.fix-pr/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the PR number if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/mn.fix-pr` | Detects PR from current branch, fetches comments, applies fixes |
| `/mn.fix-pr 42` | Fetches comments on PR #42, applies fixes |
