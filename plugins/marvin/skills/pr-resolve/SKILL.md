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
gh pr view --json number,headRefName,baseRefName,url -q '{number,branch:.headRefName,base:.baseRefName,url}'
```

If no PR is found, stop: "No open PR found for the current branch. Provide a PR number: `/marvin:pr-resolve 42`".

> Every `gh` command below is self-contained: repository identity comes from gh's own
> `{owner}`/`{repo}` placeholders, never from a shell variable set in an earlier step —
> commands run in separate shells, so exported variables do not survive between steps.

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
            nodes { body path line author { login } }
          }
        }
      }
    }
  }
}'
```

Keep only threads where `isResolved == false`. Also pull issue-level discussion that isn't part of a thread:

```bash
gh api "repos/{owner}/{repo}/issues/<number>/comments"        # general discussion
```

If there are no unresolved threads **and** no actionable general discussion, report "No unresolved review comments to address" and stop.

### 3. Classify and draft a change plan

Assign each unresolved thread exactly one class, then **present the plan to the user before touching code**:

| Class | Definition | Action |
|-------|-----------|--------|
| **requested-change** | Concrete change requested ("rename X", "add a null check", "extract this") | Apply the minimal fix |
| **question** | Clarification sought ("why X?", "is this intentional?") | Draft a factual answer |
| **suggestion** | Non-blocking improvement ("nit: …") | Apply if trivial, else skip with a reason |
| **spec-conflict** | Request contradicts the spec's Chosen Approach / Acceptance Criteria / Non-goals | Do **not** apply; queue a reply asking the reviewer to confirm |

The plan lists, per thread: the file/line, the class, the intended change (or the reason for skipping), **and the draft reply text** that will be posted to the thread. This is the discussion checkpoint — walk the user through it and get their go-ahead before touching code. The user may reclassify a thread, change a fix, or reword a reply; what they approve here is what gets posted in step 6.

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

This step is the deliverable the reviewer sees — a pushed commit with silent threads reads as ignored feedback. For every thread you addressed, **first reply** (so the resolution has a visible reason), **then resolve**. Both mutations key on the same thread `id` captured in step 2 — no other identifier is needed.

Replies are the approved drafts from step 3, updated with the pushed SHA. They must be meaningful — a sentence or two answering the comment's substance, not a bare acknowledgement:
- **requested-change / applied suggestion** — what changed and where: `Renamed resolvePath to resolveSpecPath and updated both call sites — fixed in <short_sha>.`
- **skipped suggestion** — the actual reason: `Noted — skipping: <why it's out of scope or not worth the churn here>.`
- **question** — the drafted factual answer (cite file/line where it helps)
- **spec-conflict** — `This contradicts <spec section>. Confirm you want to override the spec, or we address it in a follow-up.`

Reply to the thread:

```bash
gh api graphql -F threadId='<thread_node_id>' -f body='<reply text>' -f query='
mutation($threadId:ID!, $body:String!) {
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId, body:$body}) {
    comment { url }
  }
}'
```

The body must go through `-f` (raw string), never `-F` — `-F` magic-types values (`true`/`42` fail String coercion) and substitutes `{owner}`/`{repo}` anywhere inside the text. For replies containing single quotes or newlines, pass the body on stdin instead: replace `-f body='…'` with `-F body=@-` and feed the text with a quoted heredoc (`<<'EOF' … EOF`) — `@`-file/stdin values are passed verbatim.

Then resolve the thread — **except spec-conflicts, which stay open** pending the reviewer:

```bash
gh api graphql -F threadId='<thread_node_id>' -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}'
```

General discussion (issue-level comments outside review threads) has no resolved state. If one asked a question or requested a change you addressed, answer it with `gh pr comment <number> --body '<answer>'` and count it in the report.

### 7. Verify closure

Re-run the step-2 query and compare against the plan: every thread you replied to and resolved must now report `isResolved: true`. If one is still unresolved (failed mutation, wrong id), retry it once; if it still fails, list it in the report as **failed to resolve** with the error. Never report success over a silent failure.

### 8. Capture a lesson (retrospective)

Close the feedback loop (ADR-0021/0028). If the review revealed something future work should inherit — the same class of mistake flagged across threads, a project convention you did not know, a recurring reviewer expectation — capture **one** lesson via the `lessons` tool:

- `action: "add"`, a one-line `title`, a `body` of 2–4 sentences (what to know · why · how to apply), relevant `tags`, and `source: "PR #<number>"`.
- Choose `type`: `convention` for house style the review taught you, `gotcha`/`pitfall` for code knowledge, `process` for workflow friction.

Skip it for routine feedback — typos, one-off nits, style preferences already covered — an empty lesson is noise, and the store earns its value by staying scannable. Capture at most one or two. If the `lessons` tool is unavailable, append the index line to `.marvin/memory/MEMORY.md` yourself.

### 9. Report

```
## PR #<number> — Review Resolved

**Commit:** <sha> pushed to <branch>
**Resolved:** <N> of <M> unresolved threads (confirmed by re-query)
  - <one line per fix>
**Answered:** <N> questions
**Skipped:** <N> suggestions
**Left open (spec-conflict):** <N>
  - <thread url> — <why>
**Failed to resolve:** <N>
  - <thread url> — <error>
```

Omit the "Failed to resolve" section when step 7 confirmed everything.

## Guidelines

- **Unresolved only.** Never re-touch an already-resolved thread — that's why step 2 filters on `isResolved`.
- **The push is not the finish line.** Replying and resolving (steps 6–7) is the part the reviewer actually sees; skipping it leaves the review loop open no matter how good the fixes are.
- **Reply before you resolve.** A silently-resolved thread reads as dismissed; the reply is the receipt.
- **Self-contained commands.** Each `gh` call runs in a fresh shell — use `{owner}`/`{repo}` placeholders and literal values, never a variable exported in an earlier step.
- **Don't resolve what you didn't address.** Spec-conflicts and anything you couldn't fix stay open.
- **Respect the spec.** The spec is immutable. If the review exposes a real gap, flag it — the author opens a new spec.
- **Stop on auth failures.** If `gh` fails auth, don't loop — report and stop.
