---
name: pr-resolve
description: Resolve open review feedback on a pull request — fetch the UNRESOLVED review threads, draft a change plan from them, apply the fixes, push, then reply to each thread and mark it resolved. Use when the user says "resolve the PR", "update the PR", "address the review comments", "apply the PR feedback", "marvin resolve the PR", or "resolve PR #N". The complement to /marvin:pr-review.
---

# Resolve PR

Turn open review feedback into code. Fetch the **unresolved** review threads on a pull request, plan the changes, apply them, push, then reply to each thread and resolve it. This is the author side of the review loop — `/marvin:pr-review` leaves the comments, this command clears them.

## Core principle

**Fix what the reviewer asked, nothing more — then close the loop.** Apply the minimum change that satisfies each comment; do not refactor opportunistically. A thread is only resolved once it is actually addressed (a fix, an answer, or an explicit "won't do" with reasoning). If a comment conflicts with the spec, flag it instead of silently deviating.

## Interactive vs. autonomous path

This skill is the **interactive** path — the user invokes `/marvin:pr-resolve`, stays in the main conversation, and approves the plan and each decision inline.

For the **autonomous** path — a one-shot dispatch that runs the whole cycle to completion and surfaces blockers in a final report — delegate to the `marvin-tm-review-fixer` agent via Task-tool. Both implement the same contract.

## Input

`$ARGUMENTS` — optional PR number (e.g., `42`). If omitted, detect from the current branch:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh pr view --json number,headRefName,baseRefName,url -q '{number,branch:.headRefName,base:.baseRefName,url}'
```

If no PR is found, stop: "No open PR found for the current branch. Provide a PR number: `/marvin:pr-resolve 42`".

## Workflow

### 1. Check out the PR branch

If not already on the PR's head branch, check it out. Refuse to proceed on a dirty tree:

```bash
test -z "$(git status --porcelain)" || { echo "Working tree not clean — commit or stash first"; exit 1; }
gh pr checkout <number>
```

### 2. Fetch the UNRESOLVED review threads

GitHub's resolved/unresolved state lives only on the GraphQL API, so use it to filter — REST cannot tell a resolved thread from an open one. Capture each thread's `id` (needed later to reply and resolve):

```bash
gh api graphql -F owner='{owner}' -F repo='{repo}' -F pr=<number> -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:50) {
            nodes { databaseId body path line author { login } }
          }
        }
      }
    }
  }
}'
```

Keep only threads where `isResolved == false`. Also pull issue-level discussion that isn't part of a thread:

```bash
gh api "repos/$REPO/issues/<number>/comments"        # general discussion
```

If there are no unresolved threads, report "No unresolved review comments to address" and stop.

### 3. Classify and draft a change plan

Assign each unresolved thread exactly one class, then **present the plan to the user before touching code**:

| Class | Definition | Action |
|-------|-----------|--------|
| **requested-change** | Concrete change requested ("rename X", "add a null check", "extract this") | Apply the minimal fix |
| **question** | Clarification sought ("why X?", "is this intentional?") | Draft a factual answer |
| **suggestion** | Non-blocking improvement ("nit: …") | Apply if trivial, else skip with a reason |
| **spec-conflict** | Request contradicts the spec's Chosen Approach / Acceptance Criteria / Non-goals | Do **not** apply; queue a reply asking the reviewer to confirm |

The plan lists, per thread: the file/line, the class, and the intended change (or the reason for skipping). This is the "составить план изменений" step — get the user's go-ahead.

### 4. Apply the fixes

For each **requested-change** not in spec-conflict:
1. Read the referenced file at the cited lines.
2. Apply the **minimal** edit that satisfies the request — do not touch adjacent code.

For each **suggestion**: apply if trivial (rename, formatting, small expression swap); otherwise skip and note why.

Never stage a sensitive file (`.env`, `*.pem`, `*.key`, `credentials`, `secret`, `token`) — if a fix requires one, flag it for human approval instead.

### 5. Commit and push

Follow the `/marvin:commit` workflow. One commit for the review pass:

- Message: `fix(review): address PR #<number> review comments`
- Body: one bullet per applied fix (imperative mood, no reviewer names)
- Never `--amend`, never `--force`. Split into multiple commits only when unrelated review streams touch different subsystems.

```bash
git push
```

Capture the pushed short SHA — you'll cite it in the replies.

### 6. Reply to each thread, then resolve it

For every thread you addressed, **first reply** (so the resolution has a visible reason), **then resolve**.

Reply to a thread (post in-reply to its first comment via REST):

```bash
gh api "repos/$REPO/pulls/<number>/comments/<comment_databaseId>/replies" \
  --method POST -f body='Fixed in <short_sha>.'
```

Reply text by class:
- **requested-change / applied suggestion** — `Fixed in <short_sha>.`
- **skipped suggestion** — `Noted — skipping; out of scope for this PR.`
- **question** — the drafted factual answer
- **spec-conflict** — `This contradicts <spec section>. Confirm you want to override the spec, or we address it in a follow-up.`

Then resolve the thread (GraphQL only) — **except spec-conflicts, which stay open** pending the reviewer:

```bash
gh api graphql -F threadId='<thread_node_id>' -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}'
```

### 7. Report

```
## PR #<number> — Review Resolved

**Commit:** <sha> pushed to <branch>
**Resolved:** <N> threads
  - <one line per fix>
**Answered:** <N> questions
**Skipped:** <N> suggestions
**Left open (spec-conflict):** <N>
  - <thread url> — <why>
```

## Guidelines

- **Unresolved only.** Never re-touch an already-resolved thread — that's why step 2 filters on `isResolved`.
- **Reply before you resolve.** A silently-resolved thread reads as dismissed; the reply is the receipt.
- **Don't resolve what you didn't address.** Spec-conflicts and anything you couldn't fix stay open.
- **Respect the spec.** The spec is immutable. If the review exposes a real gap, flag it — the author opens a new spec.
- **Stop on auth failures.** If `gh` fails auth, don't loop — report and stop.
