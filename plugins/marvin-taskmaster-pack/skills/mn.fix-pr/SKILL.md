---
name: taskmaster-fix-pr
description: Apply pull-request review feedback as code changes — fetch reviewer comments via gh, classify each as actionable / discussion / out-of-scope, make the code changes, commit, push, and reply to each thread with outcome. Use when the user says "address PR comments", "fix the review feedback", "apply reviewer suggestions", "resolve this PR's comments", "/mn.taskmaster-fix-pr", or when a PR has new review activity that needs turning into commits.
---

# Fix PR

Read review comments on a pull request, apply requested changes, answer questions, and push fixes. This is the AI side of Phase 3 — the human reviews PRs, the AI fixes them.

## Core principle

**Fix what the reviewer asked, nothing more.** This is not a refactoring opportunity. Apply the minimum change to satisfy each review comment. If a comment conflicts with the original spec, note it rather than silently deviating.

## Interactive vs. autonomous path

This skill is the **interactive** path — the user invokes `/mn.taskmaster-fix-pr`, stays in the main conversation, and sees each classification and fix as it happens. Use it when the user wants to review decisions inline.

For the **autonomous** path — a one-shot dispatch where the whole fix-cycle runs to completion without interactive feedback — delegate to the `marvin-tm-review-fixer` agent via Task-tool. The agent implements the same contract but surfaces blockers in its final report instead of asking the user mid-flow. Good fit for batch PR triage, scheduled runs, or delegation from another agent.

## Input

`$ARGUMENTS` — optional PR number (e.g., `42`). If omitted, detect from the current branch: `gh pr view --json number -q .number`.

## Workflow

### 1. Identify PR

```bash
# If $ARGUMENTS is a number, use it directly
# Otherwise, detect from current branch:
gh pr view --json number,headRefName,url -q '{number: .number, branch: .headRefName, url: .url}'
```

If no PR found, tell the user — "No open PR found for the current branch. Provide a PR number: `/mn.taskmaster-fix-pr 42`"

### 2. Fetch review comments

Gather all review feedback:

```bash
# Get reviews (approval status + body comments)
gh api repos/{owner}/{repo}/pulls/{number}/reviews

# Get inline comments (file-level and line-level)
gh api repos/{owner}/{repo}/pulls/{number}/comments

# Get issue-level comments (general discussion)
gh api repos/{owner}/{repo}/issues/{number}/comments
```

If no review comments exist, report "No review comments to address" and stop.

### 3. Classify comments

Group each comment into one of:

| Type | Description | Action |
|------|-------------|--------|
| **Requested change** | Specific code change requested ("rename this", "add null check", "extract to function") | Apply the fix |
| **Question** | Reviewer asking for clarification ("why did you choose X?", "is this intentional?") | Draft a response |
| **Suggestion** | Optional improvement, not blocking ("nit: could use destructuring here") | Apply if trivial, skip if not |
| **Spec gap discussion** | Comment about a SPEC GAP item in the PR | Read the original spec, respond with context |

### 4. Apply fixes

For each **requested change**:

1. Read the affected file at the referenced lines
2. Understand the reviewer's intent — what do they want changed and why?
3. Apply the **minimal fix** that satisfies the request
4. If the change conflicts with the original spec, do NOT apply it. Instead, note: "This change conflicts with the spec — flagging for discussion."

For each **suggestion** (non-blocking):
- If the fix is trivial (rename, formatting, small refactor): apply it
- If the fix is non-trivial or changes behavior: skip it, note as skipped

### 5. Answer questions

For each **question**:
- Read the relevant code context
- Draft a concise, factual response
- If the answer requires reading the spec, read it from `specs/` directory

For each **spec gap discussion**:
- Read the original spec
- Provide context on why the decision was made
- If the reviewer's suggestion is better, note it for the spec author

### 6. Commit and push

Stage all fixes and commit:

Follow the `/mn.commit` workflow with this context:
- Commit message: `fix(review): address PR #{number} review comments`
- Body: brief summary of what was changed

Push to the PR branch:
```bash
git push
```

### 7. Reply to comments

For each applied fix, reply to the original comment:
```
Fixed in {short_sha}
```

For each answered question, post the drafted response as a reply.

For each skipped suggestion, reply:
```
Noted — skipping this as it's non-trivial / out of scope for this PR.
```

### 8. Report

Present a summary to the user:

```
## PR #{number} — Review Fixes Applied

**Applied:** {N} changes
- {brief description of each fix}

**Answered:** {N} questions
- {brief summary of each response}

**Skipped:** {N} comments
- {reason for each skip}

**Commit:** {sha} pushed to {branch}
```

## Guidelines

- **Minimal fixes only.** Don't refactor, don't improve code you weren't asked to change, don't add features.
- **Respect the spec.** If a reviewer asks for something that contradicts the spec, flag it — don't silently change direction.
- **Reply to every comment.** Even if you skip a suggestion, acknowledge it. Silence is confusing for reviewers.
- **Don't batch unrelated changes.** If the reviewer left comments on different files about different issues, address them individually in the commit message body.
- **Checkout the PR branch first.** If you're not on the PR's branch, check it out before making changes:
  ```bash
  gh pr checkout {number}
  ```
