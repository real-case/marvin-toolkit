---
description: Code review for bugs, security, performance, and style. Optionally specify files or a commit to review.
---

# Review

Perform a comprehensive code review.

## Arguments

- `$ARGUMENTS` — Optional: file paths, commit ref, or "staged" to review staged changes

## Instructions

**Read `skills/mn.review/SKILL.md`** and follow its full review checklist.

Pass `$ARGUMENTS` to scope the review if provided.

## Examples

| Command                                | Behavior                                    |
| -------------------------------------- | ------------------------------------------- |
| `/mn.review`                            | Review unstaged changes or latest commit    |
| `/mn.review src/api/handler.ts`         | Review a specific file                      |
| `/mn.review staged`                     | Review currently staged changes             |
| `/mn.review HEAD~3..HEAD`               | Review the last 3 commits                  |
