---
name: taskmaster-run
description: Execute a ready spec interactively in the current session — implements the spec following its Chosen Approach (feature) or fix approach with regression test (bugfix), then auto-chains into /mn.taskmaster-verify and /mn.taskmaster-deliver. Use when the user says "run the task", "execute the spec", "implement this spec", "/mn.taskmaster-run", or after /mn.taskmaster-start produced a spec and they want to implement it without dispatching to a worktree.
---

# Run

Execute a spec that passed the Definition-of-Ready gate. Runs interactively in the current session on the current branch — you see every step and can intervene. On success, the skill auto-chains into `/mn.taskmaster-verify` and `/mn.taskmaster-deliver`.

## Core principle

**The spec is the instruction set.** This skill is the interactive sibling of `marvin-tm-executor` (which runs headless via `dispatch.sh`). Same contract, same pipelines — but the human is in the loop and the result stays on the current branch until `/mn.taskmaster-deliver` opens the PR.

## Input

`$ARGUMENTS` — one of:
- A spec file path (`specs/<slug>.md`)
- A slug (`<slug>` → resolves to `specs/<slug>.md`)
- Empty — the skill resolves the spec per Step 1

---

## Workflow

### 1. Resolve the spec

Resolution order:

1. **Argument provided:**
   - If it ends in `.md` and the file exists — use it.
   - Else treat as a slug: try `specs/<arg>.md`. If not found, fail with a list of available specs.
2. **No argument — match current branch:**
   - Read current branch with `git rev-parse --abbrev-ref HEAD`.
   - If it matches `task/<slug>`, try `specs/<slug>.md`.
3. **No branch match — prompt user:**
   - List files in `specs/` that have `Status: ready` in their frontmatter.
   - Ask the user to choose one.
   - If `specs/` is empty or missing, tell the user to run `/mn.taskmaster-start` first and stop.

### 2. Validate Definition of Ready

Read the resolved spec. Confirm:
- Frontmatter contains `Status: ready` — if not, stop. The spec has not passed DoR; run `/mn.taskmaster-start` to finish authoring.
- Frontmatter contains `Type: feature` or `Type: bugfix` — if missing, stop and report the malformed spec.

### 3. Read context

In parallel, read:
- The spec in full
- `CLAUDE.md` if it exists (project conventions)

Summarize back to the user in 2–4 lines: the goal, the chosen approach (or fix approach for bugs), and the acceptance criteria count. This is a handshake — the user confirms the skill parsed the spec correctly.

### 4. Select pipeline

- `Type: feature` → **Feature Pipeline** (Step 5F)
- `Type: bugfix` → **Bugfix Pipeline** (Step 5B)

---

## Feature Pipeline

### Step 5F: Implement

Follow the spec's **Chosen Approach** section. Rules:

- Modify only the files listed in the spec's Context and Approach sections.
- Write code that satisfies each acceptance criterion.
- Write tests for the acceptance criteria.
- Respect project conventions from `CLAUDE.md`.
- If something is ambiguous, make the minimal reasonable choice and record it as a `⚠️ SPEC GAP` note for the PR description later.
- **No scope expansion.** If you notice adjacent improvements, ignore them.

Use TodoWrite to track acceptance criteria as you go — one todo per criterion, marked complete as each is implemented and covered by a test.

### Step 6F: Self-review (optional)

If Task-tool is available, invoke `marvin-tm-diff-critic` with the spec path and the current diff (`git diff`). Show its report to the user.

- `BLOCK` — attempt fixes (up to 2 retries). If still blocked, continue to verification but surface the blockers to the user.
- `PASS WITH WARNINGS` — continue; collect warnings for the PR.
- `PASS` — continue cleanly.

If Task-tool is unavailable, skip this step.

### Step 7F: Verify

Invoke `/mn.taskmaster-verify feature` (see `skills/mn.taskmaster-verify/SKILL.md`).

- **PASS** — continue to delivery.
- **PASS WITH WARNINGS** — show warnings to the user; continue to delivery.
- **FAIL** — read the failing output. Attempt a fix. Re-run verify. Up to **2 retries**. If still failing after retries, stop and hand control back to the user with a summary of what failed and what was tried. Do not attempt delivery.

### Step 8F: Deliver

Invoke `/mn.taskmaster-deliver` (see `skills/mn.taskmaster-deliver/SKILL.md`), passing any spec-gap notes and self-review findings as additional context for the PR body.

The skill ends when the PR is open. Report the PR URL to the user.

---

## Bugfix Pipeline

### Step 5B: Write regression test first

From the spec's **Regression Test Specification** section:
- Create the test at the specified location.
- The test exercises the bug's trigger condition.
- The test asserts the expected (correct) behavior.

### Step 6B: Verify the test fails

Run only the new regression test. Detect the test runner from project config (see `skills/mn.verify/SKILL.md` for stack → command mapping).

- **Fails** → expected. Continue.
- **Passes** → the bug may already be fixed or the test is wrong. Record as `⚠️ SPEC GAP: regression test passes on unfixed code` and proceed cautiously — confirm with the user before continuing.

### Step 7B: Apply the fix

Follow the spec's **Fix Approach** section. Rules:
- Minimal changes only — fix the root cause, nothing else.
- Do not refactor adjacent code.

### Step 8B: Verify the test passes

Run the regression test again. It **must** pass now.

- **Passes** → continue.
- **Fails** → re-read the fix approach, adjust, retry. Up to **2 retries**. If still failing, stop and hand back to the user.

### Step 9B: Self-review (optional)

Same as Step 6F — invoke `marvin-tm-diff-critic` if Task-tool is available.

### Step 10B: Verify + Deliver

Same as Steps 7F and 8F — invoke `/mn.taskmaster-verify` (with `bug` context) then `/mn.taskmaster-deliver`.

---

## Guidelines

- **Watch, don't race.** Show the user each major step before executing. Interactive is the whole point of this skill versus `dispatch.sh`.
- **Never skip the regression test step for bugs.** Red→green is the proof the fix works.
- **Respect retries.** 2 is the budget. After that, stop — don't silently flail.
- **No AI attribution** in any commit or PR text (inherited from `/mn.commit` and `/mn.pr`).
- **SPEC GAPs are first-class.** Record them inline as you work; `/mn.taskmaster-deliver` will surface them in the PR body.
- **Current branch, current session.** This skill does not create worktrees. For multi-task or hands-off execution, use `scripts/dispatch.sh`.

## SPEC GAP protocol

When the spec doesn't cover a situation you encounter:

1. Make the simplest reasonable decision — prefer doing less over more.
2. Record it in this format (the delivery step will include it in the PR body):

```
⚠️ SPEC GAP: {situation the spec did not cover}
Decision: {what you decided to do}
Rationale: {why this was the minimal reasonable choice}
```

3. Never expand scope to fill a gap.

## Blocker protocol

If you truly cannot proceed (missing dependency, broken environment, infrastructure unavailable):

1. Stop. Do not attempt `/mn.taskmaster-verify` or `/mn.taskmaster-deliver`.
2. Summarize for the user: what you tried, what blocked you, what you recommend they do.
3. Leave the working tree as-is so the user can inspect or continue manually.
