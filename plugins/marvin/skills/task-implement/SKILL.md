---
name: task-implement
description: Execute a ready spec interactively in the current session — implements the spec following its Chosen Approach (feature) or fix approach with regression test (bugfix), then auto-chains into /marvin:task-verify and /marvin:task-deliver. Use when the user says "run the task", "execute the spec", "implement this spec", "/marvin:task-implement", or after /marvin:task-start produced a spec and they want to implement it without dispatching to a worktree.
---

# Run

Execute a spec that passed the Definition-of-Ready gate. Runs interactively in the current session on the current branch — you see every step and can intervene. On success, the skill auto-chains into `/marvin:task-verify` and `/marvin:task-deliver`.

## Core principle

**The spec is the instruction set.** This skill is the interactive sibling of `marvin-tm-executor` (which runs headless via `dispatch.sh`). Same contract, same pipelines — but the human is in the loop and the result stays on the current branch until `/marvin:task-deliver` opens the PR.

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
   - If `specs/` is empty or missing, tell the user to run `/marvin:task-start` first and stop.

### 2. Validate Definition of Ready

Read the resolved spec. Confirm:
- Frontmatter contains `Status: ready` — if not, stop. The spec has not passed DoR; run `/marvin:task-start` to finish authoring.
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

### Step 6F: Self-review ‖ Verify (concurrent)

Self-review (`marvin-tm-diff-critic`) and verification are both slow and **independent** — the
critic is read-only; the `verify` tool writes only `verification.md`. Run them **concurrently**
so wall-clock collapses to the slower of the two instead of their sum.

1. **Launch the critic in the background.** If Task-tool is available, dispatch
   `marvin-tm-diff-critic` (with `run_in_background`) passing the spec path and the current diff
   (`git diff`). If Task-tool is unavailable, skip the critic — verify still runs.
2. **Run verify concurrently.** While the critic runs, invoke `/marvin:task-verify feature`. In
   this chained call, pass `mode: feature` (and the `stack` if already known) forward so the tool
   skips re-detection (it calls the `verify` tool, `execution: parallel`).
3. **Merge point.** Collect **both** results before any delivery decision — never decide on one
   alone.

**Verify result:**
- **PASS / PASS WITH WARNINGS** — proceed (collect warnings for the PR).
- **FAIL** — read the failing output, fix it, then re-run **only the failed gate** to confirm the
  fix (`/marvin:task-verify` with `only: ["<gate>"]`). Up to **2 retries**. Once the targeted gate
  is green, run **one final full `verify` pass** as the pre-delivery confirmation. If still
  failing after retries, stop and hand back to the user with a summary. Do not deliver.

**Critic result:**
- `BLOCK` — attempt fixes (up to 2 retries). If still blocked, this still **gates delivery** (PR
  opens as draft with blockers surfaced) — exactly as in the sequential design.
- `PASS WITH WARNINGS` — collect warnings for the PR.
- `PASS` — clean.

**Stale-review guard.** If a verify FAIL triggered a code fix, the critic's report is now stale —
**re-run `marvin-tm-diff-critic` against the final diff** before delivery.

### Step 7F: Deliver

Invoke `/marvin:task-deliver` (see `skills/task-deliver/SKILL.md`), passing the already-read spec
context (so deliver does not re-parse it), any spec-gap notes, and self-review findings as
additional context for the PR body.

The skill ends when the PR is open. Report the PR URL to the user.

---

## Bugfix Pipeline

### Step 5B: Write regression test first

From the spec's **Regression Test Specification** section:
- Create the test at the specified location.
- The test exercises the bug's trigger condition.
- The test asserts the expected (correct) behavior.

### Step 6B: Verify the test fails

Run only the new regression test. Detect the test runner from project config (see `skills/task-verify/SKILL.md` for stack → command mapping).

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

### Step 9B: Self-review ‖ Verify (concurrent)

Same as Step 6F, with `mode: bug`: launch `marvin-tm-diff-critic` in the background (if Task-tool
is available) and run `/marvin:task-verify bug` concurrently; merge both before any delivery
decision. On a verify FAIL, retry only the failed gate (`only: ["<gate>"]`, up to 2 retries) then
a final full pass; re-run the critic against the final diff if a fix changed it. A critic `BLOCK`
still gates delivery.

### Step 10B: Deliver

Same as Step 7F — invoke `/marvin:task-deliver`, passing the already-read spec context, spec-gap
notes, and self-review findings.

---

## Guidelines

- **Watch, don't race.** Show the user each major step before executing. Interactive is the whole point of this skill versus `dispatch.sh`.
- **Never skip the regression test step for bugs.** Red→green is the proof the fix works.
- **Respect retries.** 2 is the budget. After that, stop — don't silently flail.
- **No AI attribution** in any commit or PR text (inherited from `/marvin:commit` and `/marvin:pr-create`).
- **SPEC GAPs are first-class.** Record them inline as you work; `/marvin:task-deliver` will surface them in the PR body.
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

1. Stop. Do not attempt `/marvin:task-verify` or `/marvin:task-deliver`.
2. Summarize for the user: what you tried, what blocked you, what you recommend they do.
3. Leave the working tree as-is so the user can inspect or continue manually.
