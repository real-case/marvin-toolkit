---
name: pr-review
description: Review a pull request on GitHub and post the review there — fetch the PR diff, review it for bugs, security, performance, and style, then submit a GitHub review with inline comments and a summary. Use when the user says "review the PR", "make a PR review", "start a PR review", "review PR #N", or "leave review comments on the PR". This posts to GitHub; for a local pre-commit read-only review use /code-review or the marvin-auditor agent.
---

Review a pull request **on GitHub** and submit the review there — a summary plus inline comments anchored to the diff. This is the reviewer side of the PR flow: the author opens the PR (`/marvin:pr-create`), this command reviews it, and `/marvin:pr-resolve` turns the comments into fixes.

## Core principle

**Review what changed, post where it can be acted on.** The findings land as a GitHub review tied to specific lines, not as throwaway chat output. Be specific, be actionable, and never post AI/automation attribution.

## Input

`$ARGUMENTS` — optional PR number (e.g., `42`). If omitted, detect from the current branch.

## Workflow

### 1. Identify the PR

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
# If $ARGUMENTS is a number, use it. Otherwise detect from the branch:
gh pr view --json number,headRefName,baseRefName,url,title -q '{number,branch:.headRefName,base:.baseRefName,url,title}'
```

If no PR is found, stop: "No open PR found for the current branch. Provide a PR number: `/marvin:pr-review 42`".

### 2. Gather the diff and context

```bash
gh pr diff <number>                                  # the unified diff under review
gh pr view <number> --json title,body,files          # intent + changed-file list
```

Read the key changed files in the working tree for surrounding context — a diff hunk alone rarely shows enough to judge correctness. If the PR references a spec (`.marvin/task/<NNN>-<slug>.md`), read it to ground the review in the intended behavior.

### 3. Review checklist

Assess the diff against each dimension:

1. **Correctness** — logic errors, edge cases, off-by-one, null/nil handling, race conditions
2. **Security** — injection, hardcoded secrets, missing authz checks, unsafe deserialization, OWASP Top 10
3. **Performance** — N+1 queries, needless allocations, missing indexes, O(n²) where O(n) is possible
4. **Error handling** — swallowed errors, missing failure paths, unclear messages
5. **Readability** — unclear naming, over-complex logic, missing rationale for non-obvious decisions
6. **Testing** — untested paths, missing edge-case or regression tests
7. **Scope** — changes unrelated to the PR's stated purpose

### 4. Compose the review

For each finding, decide severity and anchor it to a file + line in the diff:

- **critical** — must fix before merge (bugs, security, data loss)
- **warning** — should fix (fragile code, missing tests, perf traps)
- **suggestion** — optional (nits, style, readability)

Pick the review **event**:

- `COMMENT` — default; observations without a verdict. **Use this when reviewing your own PR** — GitHub forbids approving or requesting changes on a PR you authored.
- `REQUEST_CHANGES` — there is at least one `critical`/`warning` you want resolved before merge (only on PRs you did not author).
- `APPROVE` — no blocking findings (only on PRs you did not author).

### 5. Confirm, then post

**Show the user the full review** — the summary body, the chosen event, and every inline comment — and get approval before posting. Posting a review is outward-facing.

Submit one review with inline comments. Build a JSON payload and pipe it to the reviews API so line anchoring is exact:

```bash
gh api "repos/$REPO/pulls/<number>/reviews" --method POST --input - <<'JSON'
{
  "event": "COMMENT",
  "body": "<concise summary: what's good, the headline concerns, overall risk>",
  "comments": [
    { "path": "src/api/handler.ts", "line": 42, "side": "RIGHT", "body": "**critical** — null deref when `user` is unset; guard before the call." },
    { "path": "src/api/handler.ts", "line": 88, "side": "RIGHT", "body": "**suggestion** — extract this branch into a helper for readability." }
  ]
}
JSON
```

Notes:
- `line` is the line number in the file's new version; use `side: "LEFT"` to comment on a removed line. For multi-line comments add `start_line` + `start_side`.
- A comment whose `path`/`line` is not part of the diff is rejected — keep inline comments on changed lines; raise anything else in the summary `body`.
- Never include "Claude", "AI", "LLM", or generated-by attribution in the body or comments.

### 6. Report

Confirm what was posted: the review URL, the event, and a count by severity (e.g. "Posted REQUEST_CHANGES — 1 critical, 2 warnings, 1 suggestion"). Point the user to `/marvin:pr-resolve` to act on the comments.

## Guidelines

- **Anchor to lines.** Inline comments the author can resolve beat a wall of prose in the summary.
- **One review, not N comments.** Submit a single review so the author gets one coherent pass, not a stream of notifications.
- **Don't review your own approval away.** On self-authored PRs, `COMMENT` is the only valid event.
- **Be honest about risk.** If the diff is clean, say so and approve (or COMMENT) — don't manufacture findings.
