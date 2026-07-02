---
description: Review a pull request on GitHub and post the review there — inline comments by severity plus a summary. Optionally pass a PR number.
---

# Review PR

Review a pull request on GitHub and submit the review (summary + inline comments) there.

## Arguments

- `$ARGUMENTS` — Optional: PR number (e.g., `42`). If omitted, the PR is detected from the current branch.

## Instructions

**Read `skills/pr-review/SKILL.md`** and follow its full workflow (Identify PR → Gather diff → Review checklist → Compose review → Confirm + post → Report).

Pass `$ARGUMENTS` as the PR number if provided.

## Examples

| Command           | Behavior                                                        |
| ----------------- | -------------------------------------------------------------- |
| `/pr-review`      | Detect the PR from the current branch, review it, post the review |
| `/pr-review 42`   | Review PR #42 and post the review                               |

> For a local, read-only pre-commit review (no posting), use `/code-review` or the `marvin-auditor` agent instead.
