---
description: Merge a pull request, then switch back to the base branch and pull. Optionally pass a PR number.
---

# Merge PR

Merge a pull request and leave the working copy on an up-to-date base branch.

## Arguments

- `$ARGUMENTS` — Optional: PR number (e.g., `42`). If omitted, the PR is detected from the current branch.

## Instructions

**Read `skills/pr-merge/SKILL.md`** and follow its full workflow (Identify PR + base → Pre-flight → Confirm + merge → Checkout base + pull → Report).

Pass `$ARGUMENTS` as the PR number if provided.

## Examples

| Command          | Behavior                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `/pr-merge`      | Detect the PR, confirm, merge (delete branch), checkout base, pull     |
| `/pr-merge 42`   | Merge PR #42, delete its branch, return to the base branch and pull    |
