---
description: Create a git commit following project conventions. Optionally pass a commit message as argument.
---

# Commit

Create a git commit.

## Arguments

- `$ARGUMENTS` — Optional: commit message (if not provided, one will be generated)

## Instructions

**Read `skills/mn.commit/SKILL.md`** and follow its full workflow (Steps 1–7).

Pass `$ARGUMENTS` as the commit message if provided.

## Examples

| Command                        | Behavior                               |
| ------------------------------ | -------------------------------------- |
| `/mn.commit`                    | Auto-generate message, confirm, commit |
| `/mn.commit fix login redirect` | Use provided message, confirm, commit  |
