---
description: Code review for bugs, security, performance, and style. Optionally specify files or a commit to review.
---

# Review

Perform a comprehensive code review.

## Arguments

- `$ARGUMENTS` — Optional: file paths, commit ref, or "staged" to review staged changes

## Instructions

**Read `skills/pr-review/SKILL.md`** and follow its full review checklist.

Pass `$ARGUMENTS` to scope the review if provided.

## Examples

| Command                                | Behavior                                    |
| -------------------------------------- | ------------------------------------------- |
| `/pr-review`                            | Review unstaged changes or latest commit    |
| `/pr-review src/api/handler.ts`         | Review a specific file                      |
| `/pr-review staged`                     | Review currently staged changes             |
| `/pr-review HEAD~3..HEAD`               | Review the last 3 commits                  |
