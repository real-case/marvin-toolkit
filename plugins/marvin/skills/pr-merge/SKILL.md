---
name: pr-merge
description: Merge a pull request, then return to the base branch with the merge pulled in — confirm mergeability, merge via gh (repo's default method) and delete the head branch, then check out the PR's base branch (e.g. dev) and pull. Use when the user says "merge the PR", "merge PR #N", "merge and switch back", or "land this PR".
---

# Merge PR

Land a pull request and leave the working copy clean on the base branch with the merge already pulled in. The closing step of the PR flow.

## Core principle

**Merging is outward-facing and hard to undo — confirm first.** Surface the PR's state, get explicit approval, merge, then put the user back on an up-to-date base branch so they can keep working.

## Input

`$ARGUMENTS` — optional PR number (e.g., `42`). If omitted, detect from the current branch.

## Workflow

### 1. Identify the PR and its base

```bash
gh pr view <number> --json number,title,baseRefName,headRefName,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision
```

If no PR is found, stop: "No open PR found for the current branch. Provide a PR number: `/marvin:pr-merge 42`".

Note the `baseRefName` — that is the branch to return to after merging (typically `dev`; falls back to `.marvin/config.json` `base_branch`, default `dev`).

### 2. Pre-flight

Surface the merge readiness and let the user judge:

- `state` must be `OPEN` and `isDraft` false — refuse to merge a draft or a closed PR.
- `mergeable` / `mergeStateStatus` — flag conflicts (`CONFLICTING`), pending or failing checks (`BLOCKED`, `UNSTABLE`), or behind-base.
- `reviewDecision` — note if it is `REVIEW_REQUIRED` or `CHANGES_REQUESTED`.

Report blockers plainly. If anything is not green, ask the user whether to proceed anyway or to stop — do not force a merge silently.

### 3. Confirm, then merge

**Show the user what will happen** — which PR, which merge method, branch deletion — and get explicit approval before merging.

```bash
gh pr merge <number> --delete-branch
```

`gh pr merge` uses the repository's default merge method (merge / squash / rebase per repo settings). `--delete-branch` removes the remote head branch (and the local one if checked out). Never force; never bypass branch protection.

### 4. Return to the base branch and pull

```bash
git checkout <baseRefName>
git pull
```

If the working tree is dirty and blocks the checkout, stop and tell the user — do not stash or discard their changes without asking.

### 5. Report

Confirm the outcome: the merged PR (number + URL), the merge method used, that the head branch was deleted, and that the local checkout is now on `<baseRefName>` at the latest commit (`git log -1 --oneline`).

## Guidelines

- **Confirm before merging.** A merge can trigger deploys and is awkward to reverse — never merge without explicit go-ahead.
- **Respect protection rules.** If the merge is blocked by required checks or reviews, report it; don't try to bypass it.
- **Leave the user on a clean base.** The point of the final checkout + pull is that they can start the next task immediately.
- **Don't touch unrelated local changes.** If returning to base would clobber uncommitted work, stop and ask.
