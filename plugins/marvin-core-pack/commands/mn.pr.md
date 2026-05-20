---
description: Create a pull request with structured description and verification checklist. Optionally pass a PR title as argument.
---

# Pull Request

Create a pull request for the current branch.

## Arguments

- `$ARGUMENTS` — Optional: PR title (if not provided, one will be generated from branch changes)

## Instructions

**Read `skills/mn.pr/SKILL.md`** and follow its full workflow (Pre-flight → PR title → PR body → Issue linking → Submit).

Pass `$ARGUMENTS` as the PR title if provided.

## Examples

| Command                            | Behavior                                    |
| ---------------------------------- | ------------------------------------------- |
| `/mn.pr`                            | Auto-generate title and body, confirm, submit |
| `/mn.pr Add pagination to search`   | Use provided title, generate body, confirm    |
