---
name: task-implement
description: Execute a ready spec interactively in the current session — implements the spec following its Chosen Approach (feature) or fix approach with regression test (bugfix), then auto-chains into /marvin:task-verify and /marvin:task-deliver. Use when the user says "run the task", "execute the spec", "implement this spec", "/marvin:task-implement", "marvin implement the spec", or after /marvin:task-start produced a spec and they want to implement it without dispatching to a worktree.
---

# Run

Execute a spec that passed the Definition-of-Ready gate. Runs interactively in the current session on the current branch — you see every step and can intervene. On success, the skill auto-chains into `/marvin:task-verify` and `/marvin:task-deliver`.

## Core principle

**The spec is the instruction set.** This skill is the interactive sibling of `marvin-tm-executor` (which runs the same spec headless, dispatched via Task-tool). Same contract, same pipelines — but the human is in the loop and the result stays on the current branch until `/marvin:task-deliver` opens the PR.

## Input

`$ARGUMENTS` — one of:
- A spec file path (`.marvin/task/<NNN>-<slug>.md`)
- A slug (`<slug>` → resolves to the spec whose filename is `<slug>.md` or `<NNN>-<slug>.md`)
- Empty — the skill resolves the spec per Step 1

---

## Workflow

### 1. Resolve the spec

**Where specs live.** Call the `spec` MCP tool with `action: "list"`. It answers with the resolved
spec directory — configured, detected, or the `.marvin/task/` default — and every spec in it, each
with its slug, title, status and seal. That answer is "the spec corpus" below; do not enumerate
directories by hand. A slug resolves to a file prefix-tolerantly (`<slug>.md`, else
`<NNN>-<slug>.md`), which is the contract, not something to re-implement.

Resolution order:

1. **Argument provided:**
   - If it ends in `.md` and the file exists — use it.
   - Else treat as a slug and take the matching record from the corpus. If there is none, fail and print the corpus as the list of available specs.
2. **No argument — match current branch:**
   - Read current branch with `git rev-parse --abbrev-ref HEAD`.
   - If it matches `task/<slug>`, resolve `<slug>` against the corpus.
3. **No branch match — prompt user:**
   - List the corpus records whose `status` is `ready`. Ask the user to choose one.
   - **List the `draft` records too, in their own labelled group, and mark them not selectable
     here.** A draft is an intake that was interrupted, not a spec to execute — its continuation is
     `/marvin:task-start <slug>`, which each draft row carries. Without this group a resumable draft
     is invisible from the command a user reaches for first. Step 2's refusal stays the backstop if
     one is named anyway.
   - If neither group has anything, tell the user to run `/marvin:task-start` first and stop.

### 2. Validate Definition of Ready

Read the resolved spec. Confirm:
- Frontmatter `status` is not `draft` — if it is, stop: the spec has not passed DoR, so run `/marvin:task-start` to finish authoring. This one rule stays here in prose because the seal gate below deliberately does not implement it.
- Frontmatter `type` is `feature` or `bugfix` — if missing, stop and report the malformed spec.
- **Seal gate (tool-backed).** Call the **`spec` MCP tool** with `action: "seal"` (`mode:` still works) and the resolved `specPath`. It checks two things and returns one verdict. It re-hashes the `spec-contract` block against the stamped `contract_sha`: a **FAIL** (`TAMPERED`) means the contract was edited after DoR sealed it — **stop and report; do not execute a tampered spec** — while a `PASS WITH WARNINGS` (unsealed, no `contract_sha`) is allowed but noted. It also refuses a spec whose lifecycle is over: a **FAIL** naming `shipped` or `superseded` means that work was already delivered, and the request in hand needs a new spec whose `supersedes:` points at it. Do **not** compute the hash or re-check the terminal statuses yourself — the tool owns both. If the `spec` tool is unavailable, report the spec as unverified rather than guessing.

### 2.5 Resume check

The spec is resolved and validated, so now ask what this session is walking into. Call the `spec`
MCP tool with `action: "resume"` and the resolved `specPath`.

**With no journal**, say so out loud and verify **every** criterion from scratch. An absent journal
**is never evidence that nothing was done** — the record can be missing for a dozen reasons that
have nothing to do with the work, and this fork's output is what a human uses to decide what *not*
to re-check. The tool renders the same sentence; the two surfaces state one rule.

**With a journal**, show the recorded state — the last step, the criteria recorded complete, and any
`contract_sha` that differs from the spec's current seal (a differing seal means the contract was
re-sealed after those entries were written, so they describe a different contract). Then offer
exactly two options and take one:

- **Resume** — continue from the recorded position. A recorded criterion is a claim, not a proof:
  skip nothing without re-reading that criterion's own `oracle`.
- **Archive** — append a `kind: "archived"` boundary (`action: "progress"`) and start clean.
  Everything before the boundary stops counting without being deleted, so what was abandoned stays
  answerable.

Then set the spec's `status: in-progress` — the lifecycle carve-out (content stays immutable) so a
resumed or concurrent run sees the task is being worked — and append a `kind: "step"` entry
recording it. The flip lives **here**, not at the end of step 2, so a run that is archived and then
abandoned at this fork leaves no lifecycle change behind it.

### 3. Read context

In parallel, read:
- The spec in full
- `CLAUDE.md` if it exists (project conventions)
- **Prior lessons** — call the `lessons` tool (`action: "search"`, keywords from the spec's slug, title, and the areas it touches) to recall what past tasks in this repo learned (`.marvin/memory`, ADR-0021/0028). A relevant `gotcha` or `bug-pattern` is a constraint to respect while implementing — note it next to the criterion it affects. If the tool is unavailable, skim `.marvin/memory/MEMORY.md` directly.
- **The host project's own skills.** If `.claude/skills/` exists at the project root, list it
  (`ls -d .claude/skills/*/`) and read the `SKILL.md` of those whose domain covers the contract's
  `files` paths — matching on each skill's frontmatter `metadata.filePattern` where it has one, on the
  directory name otherwise, and reading at most the three closest matches. A project that ships
  skills usually states in `CLAUDE.md` that they are binding, and their rules are exactly the ones a
  diff critic blocks on: one measured run lost a 393-second review round to two `aria-label`
  attributes that the project's own `ui-styling` skill forbids, and reading the two matching skills
  would have cost about two seconds. Treat what they say as a constraint on the code you are about
  to write, not as background.

Summarize back to the user in 2–4 lines: the goal, the chosen approach (or fix approach for bugs), and the acceptance criteria count. This is a handshake — the user confirms the skill parsed the spec correctly.

### 4. Select pipeline

- `type: feature` → **Feature Pipeline** (Step 5F)
- `type: bugfix` → **Bugfix Pipeline** (Step 5B)

---

## Feature Pipeline

### Step 5F: Implement

Follow the spec's **Chosen Approach** section. Rules:

- Modify only the files in the spec's `spec-contract` block `files` list (the authoritative allowlist).
- **Use the traceability graph as your work list.** For each criterion, change exactly the `files` ids named in its `implemented_by` and prove it with its `oracle`. The mapping is given — do not infer it.
- Write code that satisfies each acceptance criterion.
- Write tests for the acceptance criteria.
- Respect project conventions from `CLAUDE.md`.
- If something is ambiguous, make the minimal reasonable choice and record it as a `⚠️ SPEC GAP` note for the PR description later.
- **No scope expansion.** If you notice adjacent improvements, ignore them.

Use TodoWrite to track acceptance criteria as you go — one todo per criterion, marked complete as each is implemented and covered by a test.

**And record each one durably.** As each acceptance criterion is completed, call the `spec` tool with
`action: "progress"`, `kind: "criterion"`, the criterion id, and the resolved `specPath`. These are
not duplicates of the TodoWrite list: TodoWrite is the live in-session view and **context compaction
destroys it with no trace**, while the journal is what survives compaction and is what Step 2.5 reads
on the next run. Keep `detail` to one line of position and choice — never a pasted credential, token
or customer datum.

### Step 6F: Verify, then self-review

The deterministic half of this step — the scope gate, the project's gates, the acceptance oracles —
is fast and is not a matter of opinion. The critic is a model and runs roughly seven times slower.
Run the deterministic half first and dispatch the critic **once**, against a tree that is already
green.

This reverses the concurrency the step used to prescribe (P2 of
`docs/proposals/task-workflow-latency-optimization.md`), and measurement is the reason. A critic
dispatched beside a verify that then fails is reading a tree the fix changes underneath it — the
case the stale-review rule this step used to carry existed for, and that rule mandated a second pass
in full.
One instrumented run saved 76 seconds on the overlap and paid 393 seconds for the re-review it
forced.

**First, the scope gate (deterministic, fast).** Call the `spec` tool with `action: "scope"` (pass the
resolved `specPath`). It checks `git diff` ⊆ the contract `files` allowlist and **FAILs** listing any
out-of-scope file. Resolve a FAIL before continuing: revert genuine scope creep, or — if the file is a
legitimate discovery — record it as a **SPEC GAP** and re-run with `allow: [<paths>]` (the sealed
contract is immutable; do not silently edit it). This is the *mechanical* half of scope-creep
detection; `marvin-tm-diff-critic` below is the *semantic* half.

1. **Verify.** Invoke `/marvin:task-verify feature`. In this chained call, pass `mode: feature`
   (and the `stack` if already known) forward so the tool skips re-detection (it calls the `verify`
   tool, `execution: parallel`).
   - **PASS / PASS WITH WARNINGS** — proceed (collect warnings for the PR).
   - **FAIL** — read the failing output, fix it, then re-run **only the failed gate** to confirm
     the fix (`/marvin:task-verify` with `only: ["<gate>"]`) under the **Fix-cycle protocol** below.
     This is the verify-gate loop and it carries its own budget. Once the targeted gate is green,
     run **one final full `verify` pass** as the pre-delivery confirmation. If the loop reaches its
     limit unresolved, stop and hand back to the user with a summary. Do not deliver — and do not
     dispatch the critic, which has nothing stable to review.
2. **Record the acceptance oracles.** With the gates green, call the `verify` tool with
   `action: "oracles"` and this spec's `specSlug` (`expect` defaults to `"pass"`, which is the only
   phase a feature has). It runs each criterion's own typed oracle and appends the outcome to
   `.marvin/task/runs/<slug>.oracles.md`. The gates prove the suite is green; the oracles prove
   **this spec's criteria** are, one at a time, which is the question the critic asks next and the
   only one the whole-suite verdict cannot answer. It is cheap: one measured run executed nine
   oracles in 16 seconds against 343 seconds for the gates. A criterion whose oracle fails is a
   verify-gate-loop failure like any other — fix it before the critic sees the diff. The tool refuses
   an **unsealed** spec before spawning anything: that is Step 2's seal warning coming due, so record
   it and move on rather than sealing a spec mid-execution.
3. **Dispatch the critic — once.** If Task-tool is available, dispatch `marvin-tm-diff-critic`
   against the now-green tree, passing the spec path, `git diff`, **and**
   `git status --porcelain --untracked-files=all`. The status listing is not a nicety: a new file is
   untracked, so `git diff` cannot show it, and a feature spec is mostly `action: new` rows — one
   measured run passed a diff that held 4 of the 17 contract files and hid every file the feature
   actually consisted of. If Task-tool is unavailable, skip the critic — the gates and oracles still
   ran, and the skip travels to `/marvin:task-deliver` as `⚠️ critic skipped`.

**Critic result:** before acting on any finding, open the file it cites at the cited lines and read
enough around them to judge the claim — a finding whose premise the current code contradicts is not
fixed but recorded as refuted, one line for the PR's `## Self-Review Notes`:
`Refuted: {finding} — {file}:{line} shows {what}`. Pass those lines to `/marvin:task-deliver` with
the rest. A refuted blocker is resolved, not deferred: a `BLOCK` whose every blocker was refuted with
file-and-line evidence no longer gates delivery — the PR opens normally and the `Refuted:` lines are
the receipt. One surviving blocker keeps the `BLOCK` and the draft PR.

- `BLOCK` — attempt fixes under the **Fix-cycle protocol** below; this is the critic loop and its
  budget is counted separately from the verify-gate loop's. If still blocked at the limit, this
  still **gates delivery** (PR opens as draft, every surviving blocker surfaced as a deferred or
  blocked item) — exactly as in the sequential design.
- `PASS WITH WARNINGS` — collect warnings for the PR.
- `PASS` — clean.
- `NEEDS_CONTEXT` — the critic could not judge yet and named the exact input it lacks (the spec
  path, a diff range that resolved to nothing, an unreadable file). Supply it and re-dispatch the
  critic **once**, stating in the dispatch prompt that this is the re-dispatch for the
  `NEEDS_CONTEXT` it raised — it enters with a fresh context and cannot see the earlier turn. A
  second `NEEDS_CONTEXT` is treated as `UNABLE`.
- `UNABLE` — the critic could not judge and could not name what would fix that. **Not a pass.**
  Keep its Blocker / Attempted / Recommendation verbatim and pass them to
  `/marvin:task-deliver`, which renders "⚠️ critic UNABLE — <reason>" on the PR's **Diff critic**
  line exactly as it renders a skipped critic. Tell the user the semantic half of the review did
  not run.

**Stale-verify guard.** The order above makes a stale *review* impossible — the critic never reads a
tree that a verify fix is about to change. It moves the staleness to the other side: any code change
made after the green run, **including one made to satisfy a critic blocker**, invalidates that run.
Re-run the affected gate (`only: ["<gate>"]`), then one final full `verify` before delivery. This is
not bookkeeping — the delivery gate compares the recorded run against the working tree (ADR-0035) and
refuses one that no longer describes it.

**Write the receipt** (ADR-0039). Once the critic has returned and its verdict is terminal, save the
critic's report **verbatim** followed by its ` ```json critic-verdict ` block to
`.marvin/critique/<NNN>-<slug>.md`, where `<NNN>` is the highest existing leading-integer prefix in
`.marvin/critique/` plus one (`001` when the directory is empty or absent — the rule
`skills/handoff/SKILL.md` states for its own sequence) and `<slug>` is the spec slug, which is also
the block's `subject`. Then:

- **Write it after the verdict arrives, never at dispatch.** The receipt records what the critic
  said, and at dispatch that verdict does not exist yet.
- **The receipt records the FINAL run.** Where a critic-loop round forced a re-dispatch, replace the
  receipt already written for the superseded run rather than leaving it beside its successor — two
  receipts for one diff make the newest ambiguous.
- **Terminal verdicts only, and only with a block.** A `NEEDS_CONTEXT` gets its receipt after the
  single re-dispatch resolves; a critic that emitted no block gets no receipt and the PR line
  renders exactly as it does today.
- **The receipt is evidence, not a gate.** It is written after the delivery decision is reached and
  nothing reads it back to change one.

### Step 7F: Deliver

Invoke `/marvin:task-deliver` (see `skills/task-deliver/SKILL.md`), passing the already-read spec
context (so deliver does not re-parse it), any spec-gap notes, and self-review findings as
additional context for the PR body. The diff-critic's verdict is part of that hand-off — deliver
renders it as its own **Diff critic** line and cannot recover it from the spec, which carries only
the spec critic's. Pass it even when it is `⚠️ critic skipped`. **Pass the receipt path with it**
when one was written: deliver names it after the verdict on the **Diff critic** line.

The skill ends when the PR is open. Report the PR URL to the user.

---

## Bugfix Pipeline

**Record each criterion durably**, exactly as Step 5F states it above: as each acceptance criterion
is completed, append a `kind: "criterion"` entry through the `spec` tool's `action: "progress"`.
TodoWrite is the live view that compaction destroys; the journal is what Step 2.5 reads next run.

### Step 5B: Write regression test first

From the spec's **Regression Test Specification** section:
- Create the test at the specified location.
- The test exercises the bug's trigger condition.
- The test asserts the expected (correct) behavior.

### Step 6B: Verify the test fails

Record the red phase with the `verify` tool on the `marvin` server, `action: "oracles"`, passing
the spec's `specSlug`, `criteria: ["<the regression criterion's id>"]` and `expect: "fail"`. The
tool resolves the criterion's oracle to a command, runs it, and appends the outcome to
`.marvin/task/runs/<slug>.oracles.md` — do not detect the runner yourself, and do not run the test
by hand (an unrecorded red is not a red as far as the delivery gate is concerned). Where the
project's own single-test command needs declaring, that is `gates.test_one` in `.marvin/config.json`
(see `skills/task-verify/SKILL.md` for the stack → command mapping the gates use).

- **`status: "fail"`** → expected, this is the red. Continue.
- **`status: "pass"`** → the bug may already be fixed or the test is wrong. Record as `⚠️ SPEC GAP: regression test passes on unfixed code` and proceed cautiously — confirm with the user before continuing.
- **`status: "not-run"`** → **neither a red nor a green.** The command could not be resolved, could
  not be launched, or died on a signal; the `reason` field says which. Report it as `not-run` —
  never as "the test failed" — and fix the cause (usually a missing `gates.test_one` or an `oracle.run`
  on the criterion) before applying the fix, or the green phase has nothing to pair with.

### Step 7B: Apply the fix

Follow the spec's **Fix Approach** section. Rules:
- Minimal changes only — fix the root cause, nothing else.
- Do not refactor adjacent code.

### Step 8B: Verify the test passes

Record the green phase the same way — `verify`, `action: "oracles"`, the same `specSlug` and
`criteria`, with `expect: "pass"`. It **must** pass now. The two entries at one `contract_sha` over
one unchanged test file are the pair `/marvin:task-deliver`'s gate reads as `red_green: "proven"`.

- **`status: "pass"`** → continue.
- **`status: "not-run"`** → still neither a red nor a green: nothing was proved and the pair is
  incomplete. Resolve the `reason` and re-run this step; do not read it as a pass.
- **`status: "fail"`** → re-read the fix approach, adjust, retry under the **Fix-cycle protocol** — this is the
  red-green loop and its budget is its own. If it is still failing at the limit, stop and hand back
  to the user.

### Step 9B: Verify, then self-review

Same as Step 6F, with `mode: bug` and in the same order: run `/marvin:task-verify bug` first and
dispatch `marvin-tm-diff-critic` **once** afterwards (if Task-tool is available), against the green
tree, passing the spec path, `git diff` **and** `git status --porcelain --untracked-files=all`. On a
verify FAIL, retry only the failed gate (`only: ["<gate>"]`) under the **Fix-cycle protocol** then a
final full pass, and dispatch the critic only once that is green. The red and green oracle runs of
Steps 6B and 8B are this pipeline's per-criterion proof, so Step 6F's oracle step is already done. A
critic `BLOCK` still gates delivery and runs its own fix-cycle budget; a `NEEDS_CONTEXT` earns
exactly one re-dispatch carrying the input the critic named and stating that it is the re-dispatch
(not a fix-cycle round), and a second one is treated as `UNABLE`; an `UNABLE` is never a pass — it
travels verbatim to `/marvin:task-deliver` and onto the PR's **Diff critic** line. Findings refuted
by the code are recorded, not fixed, exactly as in Step 6F.

**Write the receipt** on the same terms as Step 6F: after the verdict arrives and never at dispatch,
for the final run when a re-run superseded an earlier one, and only for a terminal verdict carrying
a ` ```json critic-verdict ` block — the critic's report verbatim plus that block, saved to
`.marvin/critique/<NNN>-<slug>.md` with `subject` set to this spec's slug. It is evidence for the
PR, not a gate on it.

### Step 10B: Deliver

Same as Step 7F — invoke `/marvin:task-deliver`, passing the already-read spec context, spec-gap
notes, and self-review findings.

---

## Guidelines

- **Watch, don't race.** Show the user each major step before executing. Interactive is the whole point of this skill versus a headless `marvin-tm-executor` run.
- **Never skip the regression test step for bugs.** Red→green is the proof the fix works.
- **Respect the fix-cycle budget.** Three rounds, counted per loop, and the third one changes the
  approach instead of repeating it. At the limit, stop and record the item as deferred or blocked —
  don't silently flail.
- **No AI attribution** in any commit or PR text (inherited from `/marvin:commit` and `/marvin:pr-create`).
- **SPEC GAPs are first-class.** Record them inline as you work; `/marvin:task-deliver` will surface them in the PR body.
- **Current branch, current session.** This skill does not create worktrees. For multi-task or hands-off execution, dispatch the spec to the `marvin-tm-executor` agent via Task-tool — it runs the same pipelines headless and opens the PR itself.

## Fix-cycle protocol

One named shape for every "it failed, try again" loop in this skill. A **round** is one fix attempt
following a failure. The budget is **three rounds per loop**, and each loop counts its own:

- the **verify-gate loop** — a `verify` FAIL in Step 6F / Step 9B;
- the **critic loop** — a `marvin-tm-diff-critic` `BLOCK` in Step 6F / Step 9B;
- the **red-green loop** — a regression test that will not go green in Step 8B.

Two spent verify-gate rounds do not shorten the critic's budget, and the reverse holds too. A
`NEEDS_CONTEXT` re-dispatch is **not** a round: it is a re-dispatch for missing input, not a retry
of a failed attempt, and it has its own one-shot allowance (Step 6F / Step 9B).

**Rounds 1–2 — retry the same path.** Read the failure, fix it, re-run only the thing that failed:
the failed gate with `only: ["<gate>"]`, the critic against the new diff, the regression test on its
own. Carry the feedback **verbatim** into the fix — the gate's output, the critic's blocker text,
the test's assertion message. A paraphrased error is a new guess.

**Re-run the narrowest thing that can prove the fix, and never a full `verify` inside a round.** For
a failing test that is the single file or case, through the project's `gates.test_one`
(`.marvin/config.json`) or the `verify` tool's `action: "oracles"` with `criteria: ["AC<n>"]` — one
measured run took 1.8–3.6 seconds that way against 52–75 seconds for the whole `test` gate and 343
seconds for the full plan. The full pass is the pre-delivery confirmation, run once at the end of the
loop, not the loop's feedback channel.

**Round 3 — change the conditions, not the attempt.** A fix that has stalled twice does not need a
third attempt of the same kind. For the **verify-gate** and **red-green** loops — a failure with a
reproducible symptom — dispatch **`marvin-debugger`** via Task-tool and give it exactly
three inputs:

1. the failure output, verbatim;
2. the spec path;
3. the diff range under investigation (`git diff` for the working tree, or `<base>...HEAD`).

The dispatch gives that agent a fresh context; what you control is what you put in the prompt. **Do
not pass the history of the failed attempts** — not the rounds you already tried, not the hypotheses
you rejected, not your own reading of the cause. Its value is that it reasons from evidence with no
prior commitment, and handed your dead ends it inherits them. It diagnoses and does not apply: take
its fix approach, apply it yourself, and re-run the failed thing once. If Task-tool is unavailable,
hand those same three inputs to the user rather than spending the round on another attempt of the
same kind.

**The critic loop does not go to `marvin-debugger`.** A blocker about missing coverage or an
out-of-scope change has no symptom to reproduce and no regression test to write, which is that
agent's whole contract. Spend the critic loop's round 3 re-reading the spec section the blocker
cites, then either fix it, refute it with file and line, or classify it as deferred or blocked and
hand back.

**At the limit — record, never drop.** When round 3 leaves the item open, stop that loop and
classify the item as exactly one of:

```
Deferred: {item} — Rationale: {why the change is safe to ship without it}
Blocked: {item} — Cause: {what prevents it, and what would unblock it}
```

Pass every such line to `/marvin:task-deliver`, which reproduces them in the PR's
`## Self-Review Notes`. Silently dropping an open item is banned. A verify-gate loop that reaches its
limit does not deliver at all (Step 6F) — classify the open items the same way in the summary you
hand back to the user.

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
