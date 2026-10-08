---
name: task-deliver
description: Final delivery phase of the taskmaster pipeline — commits changes and opens a pull request by delegating to the commit and pr-create skills, and refuses to proceed if the preceding task-verify step did not pass. Use when the user says "deliver", "ship it", "finalize the task", "commit and PR", "close out the task", "marvin deliver the task", or when a taskmaster worktree has finished implementation and verification.
---

# Deliver

Commit changes and create a pull request. This is the final phase — it gates on successful verification and delegates the actual commit/PR creation to the commit and pr-create skills.

## Core principle

**Don't ship unverified code.** Delivery is the last gate. It checks that verification passed, then delegates to the battle-tested commit and PR workflows.

## Workflow

### 1. Check verification (tool-backed gate)

Call the **`verify` MCP tool** with `action: "gate"`, passing `specSlug` **whenever a spec exists** — resolve it the way `/marvin:task-verify` does (the spec's frontmatter `slug`, else its filename slug) rather than passing it only when it happens to be at hand. Since ADR-0044 the slug decides more than which artifact is judged: a gate call that resolves no slug writes no metrics record, so an omitted slug silently drops the task out of the series. It reads the run for that spec (`.marvin/task/runs/<slug>.md`, else `.marvin/task/verification.md`), parses the machine-readable `verify-result` verdict, compares the recorded provenance against the working tree in front of it, and returns a `deliver-gate` decision — do **not** eyeball the prose verdict yourself.

- **BLOCK** — no `verification.md`, no parseable verdict, verdict **FAIL**, no test evidence, or **stale** evidence. **Stop.** Relay the gate's reason and tell the user what it asks for. Do not deliver.
- **ALLOW** — verdict **PASS** or **PASS WITH WARNINGS**. Proceed. On PASS WITH WARNINGS, surface the warnings and confirm the user wants to proceed.

Three cases the reason will name, each needing a different answer:

- **Stale** (`"staleness": "stale"`) — the tree changed after the verification ran, so the proof no longer describes what you are about to ship. Relay it as an instruction: **re-run `/marvin:task-verify`**, then call the gate again. Only if the user, told this plainly, decides the change was inconsequential may you retry with `allowStale: true` — never on your own initiative, and never as a first response to a BLOCK. A delivery made that way carries an explicit override line into the PR body (step 3): `> **Freshness override:** delivered with allowStale after <the reason the user gave>.`
- **No test evidence** — every recorded `test` gate, or every gate, was `not-run` because its binary is absent. No input waives this. Install the runner (or pin one in `.marvin/config.json`) and re-verify.
- **FAIL** — fix the failing gates and re-run `/marvin:task-verify`. `allowStale` does not reach a FAIL.

**Call the tool on every delivery, including a chained one.** A verdict already in context carries no freshness check — it was true when it was produced, and the point of this gate is that the tree may have moved since. Reusing it is exactly the case the gate exists to catch, and the chained run (verify → fix a lint error → deliver, one session) is where it happens most.

**If the `verify` tool is unavailable, refuse — do not read the artifact by hand.** A hand-read `verification.md` gives you a verdict and no freshness check, which is a strictly weaker gate presented as the real one. Tell the user the delivery gate cannot run and stop.

### 1.5 Relay the task's metrics (ADR-0043/0044)

**The delivery gate already wrote the record.** When step 1 returned ALLOW for a resolved slug, the
`verify` tool derived the terminal ` ```json task-metrics ` block from the artifacts on disk — the
spec, the progress, oracle and verification-run journals, the `verify-result` block, the critique
receipts and git — and appended it to `.marvin/metrics/<NNN>-<slug>.md`, before anything is
committed, so the record ships in the same commit and pull request as the work. Do **not** call the
`metrics` tool's `rollup` action here: a second append would put two terminal blocks in the record
for one delivery and make the roll-up count stop meaning what it says.

Read it back and relay it. Call the `metrics` tool with `action: "series"` and the spec's `slug`,
which renders that one record in full, and give the user the three groups and the `Sources` line —
a source marked absent is a coverage gap worth naming, not an error. The gate's own answer carries
the record's path on its `**Metrics:**` line, and says there when git **ignores** the record; relay
that warning too, naming the negation to add (`!.marvin/metrics/` after `.marvin/*`).

Skip silently only when step 1 resolved no slug — a standalone delivery has nothing to measure, and
nothing was written. If the `metrics` tool is unavailable, say so and continue: the record is already
on disk either way, and this step only reads it.

### 2. Commit

Follow the `/marvin:commit` workflow.

When composing the commit:
- Stage the metrics record the delivery gate wrote (`.marvin/metrics/<NNN>-<slug>.md`) with the change — it is part of the delivery, and it is the one `.marvin/` artifact this repository commits besides the lessons
- Use the spec title as the commit scope/subject
- Reference the spec for the "why" in the commit body — what problem this solves or what feature this delivers
- Spec context: in a **chained** session (invoked straight after `/marvin:task-implement`), reuse the spec already read in the conversation — do not re-read it, and do no lookup at all. Only when invoked **standalone** read from disk: call the `spec` MCP tool with `action: "list"` and match the slug from conversation against the records it returns, then fall back to `.marvin/task/spec.md`

### 3. Create pull request

Follow the `/marvin:pr-create` workflow.

When composing the PR:
- Include the spec summary in the PR body
- Include the verification results summary
- Reference the original issue/ticket if one was identified during intake
- **Carry a freshness override.** If step 1 returned ALLOW only because you passed `allowStale: true`, the PR body must say so on its own line, first in `## Self-Review Notes` — or at the top of the `pr-create` template's `## Notes` when the spec is not v2.0: `> **Freshness override:** delivered with allowStale — the recorded verification described commit <head_sha> on <branch>, not this tree. <the user's reason>.` A waived gate that leaves no trace in the PR is a gate the reviewer cannot see was waived
- **Carry both critic verdicts.** Two semantic gates run in the pipeline and each gets its **own line**, first in `## Self-Review Notes` — or at the top of the `pr-create` template's `## Notes` when the spec is not v2.0. Render them independently, never merge them, never omit one, and never render an inability as a pass:
  - **Spec critic** (`marvin-tm-spec-critic`) — from the spec's `## Critic Verdict & Overrides` section (the spec is already resolved in step 2), with any recorded author override.
  - **Diff critic** (`marvin-tm-diff-critic`) — from the chained `/marvin:task-implement` result (its Step 6F / Step 9B), or from a `marvin-tm-diff-critic` run in this session. With no chained context — a standalone `/marvin:task-deliver` — render `not run — delivered standalone`.

  Each line takes an optional trailing **receipt reference** — ` · receipt: .marvin/critique/<NNN>-<slug>.md` — appended after the rendered verdict when a receipt was written for that critic (ADR-0039), and omitted entirely when none was. The receipt is **evidence, not a gate**: delivery is still decided by the diff critic's `BLOCK` with a surviving blocker, exactly as below, and nothing reads a receipt back to decide anything.

  The rendering rule is total, and each slot resolves against its own source. Render the recorded verdict when the source holds one of the four terminal critic verdicts (`PASS`, `PASS WITH WARNINGS`, `BLOCK`, `UNABLE`), an `UNABLE` as `⚠️ critic UNABLE — <reason>` with the critic's reason verbatim. Render `⚠️ critic skipped` in **every** other case — for the **Spec critic**: "none", "none — critic skipped", an empty section, an absent section, or no spec file at all; for the **Diff critic**: chained context reporting that the critic was not dispatched, or reporting nothing about it at all. The one exception is the standalone case above, where the **Diff critic** line reads `not run — delivered standalone`. An absent receipt omits the suffix and never changes the verdict token — `⚠️ critic skipped` still renders for every non-terminal case. A semantic gate that did not run is never silent in the PR
- **Carry the open items.** Every item a fix cycle left unresolved arrives from `/marvin:task-implement` already classified as **deferred, with a rationale** or **blocked, with a cause**. Reproduce each line in `## Self-Review Notes` below — or in the `pr-create` template's `## Notes` when the spec is not v2.0. Dropping one silently is banned; when there are none, omit the lines rather than summarising them away. In a standalone invocation there is no chained context — omit the lines rather than reconstructing them
- **Carry the refuted findings.** A critic finding `/marvin:task-implement` re-grounded and refuted against the code arrives as one line per finding. Reproduce each in the same section; omit the lines when there are none
- **Open a draft when a semantic gate is still red.** When the diff critic's verdict arrives as `BLOCK` with at least one **surviving** blocker (one that was neither fixed nor refuted), ask `/marvin:pr-create` for a **draft** PR and tell the user why — the blockers are recorded in `## Self-Review Notes`, and the draft state is what keeps them from being merged past. Every other verdict opens a normal PR
- If spec is v2.0 format (from `.marvin/task/` or a host spec dir), use the v2.0 PR body structure:

```markdown
## Summary
{from spec goal/problem statement}

## Spec Reference
`.marvin/task/<NNN>-{slug}.md`   <!-- the actual resolved spec path -->

## Changes
{key changes grouped by area}

## Self-Review Notes
**Spec critic:** {PASS | PASS WITH WARNINGS | BLOCK | ⚠️ critic UNABLE — {reason} | ⚠️ critic skipped}{ · receipt: .marvin/critique/{NNN}-{slug}.md — omit when no receipt was written}
**Diff critic:** {PASS | PASS WITH WARNINGS | BLOCK | ⚠️ critic UNABLE — {reason} | ⚠️ critic skipped | not run — delivered standalone}{ · receipt: .marvin/critique/{NNN}-{slug}.md — omit when no receipt was written}

{any concerns or trade-offs noted}

{refuted critic findings, one line each — omit this line when there are none:}
Refuted: {finding} — {file}:{line} shows {what}

{open fix-cycle items, one line each — omit these lines when there are none:}
Deferred: {item} — Rationale: {why the change is safe to ship without it}
Blocked: {item} — Cause: {what prevents it, and what would unblock it}

## Tests
- [ ] New tests written for acceptance criteria
- [ ] Regression test (bugfix only)
- [ ] All existing tests pass
```

### 4. Record delivery on the spec

If the spec is one of the records the `spec` tool's `action: "list"` returns — i.e. it lives under
this project's resolved spec directory — and the PR was created, update its lifecycle metadata: the
only mutable part of an otherwise-immutable spec:
- Set frontmatter `status: shipped`.
- Append a `## Delivery` section with the PR URL and today's date.

Skip silently when no spec file is found (e.g. when only a verification artifact exists, no named spec).

### 5. Capture a lesson (retrospective)

Close the feedback loop (ADR-0021). If this task surfaced something a future task should inherit — a recurring **SPEC GAP**, a non-obvious convention you had to discover, a gotcha that cost time, or a process friction — capture **one** lesson via the `lessons` tool:

- `action: "add"`, a one-line `title`, a `body` of 2–4 sentences (what to know · why · how to apply), relevant `tags`, and `source: "<spec-slug>"`.
- Choose `type`: `gotcha` / `convention` / `pitfall` for code knowledge, `process` for workflow friction. (Bug root-cause patterns are captured upstream by `marvin-debugger` — don't duplicate them here.)

Skip it for routine tasks that taught nothing new — an empty lesson is noise, and the store earns its value by staying scannable. Capture at most one or two. If the `lessons` tool is unavailable, append the index line to `.marvin/memory/MEMORY.md` yourself.

### 6. Preserve artifacts

Do NOT delete `.marvin/task/` artifacts. They serve as documentation:
- `spec.md` — what was intended
- `plan.md` — how it was implemented
- `verification.md` — that it was verified
- `.marvin/metrics/<NNN>-<slug>.md` — what it cost and what it produced (committed with the work, ADR-0043)

## Guidelines

- **Never bypass the verification gate.** If verification wasn't run or failed, refuse to deliver. This is the whole point of the pipeline.
- **Delegate, don't duplicate.** The commit and PR workflows already exist (`/marvin:commit`, `/marvin:pr-create`) — use them via command invocation. Don't re-implement commit message generation or PR body formatting.
- **Enrich, don't replace.** Add spec/plan/verification context to the commit and PR, but let those workflows handle their standard checks (sensitive files, pre-flight, etc.).
- **Artifacts are documentation.** After delivery, the `.marvin/task/` directory is a record of the decision process. Users can archive or clean up at their discretion.

## Pipeline mode

Active only when `MARVIN_PIPELINE=1` is set: this session is the executor child of the autopilot pipeline, chained from `/marvin:task-implement`'s own pipeline mode, and nobody is present to confirm anything. Every step above applies except where this section overrides it. An interactive session never sets the variable, so none of this reaches one.

- **Write everything before the final verify.** Every progress-journal entry and spec edit lands before the last full `verify` run, never between that run and step 1. When the spec lives outside `.marvin/`, in a host directory such as `specs/`, the freshness digest the gate compares counts the spec file and its `runs/` progress journal, so an entry written after the run turns its PASS stale without a source file moving. If one was, re-run the full `verify` (the spec's `specSlug` and `mode`, `execution: "sequential"`) before step 1. Nothing under `.marvin/` counts: receipts, the oracle and verification-run journals and the metrics record never make a run stale.
- **Step 1 — never `allowStale`.** The waiver is a user's decision and no user is present; the pipeline's guard refuses it besides. A stale BLOCK means re-run the full `verify` and call the gate again. A FAIL or a no-test-evidence BLOCK means do not deliver through this gate: hand the reason back to `/marvin:task-implement`, which delivers as it does at a loop's limit: a commit and a draft pull request that report the red gates, with no gate call. Call the gate once per delivery and never as a pre-check, because each ALLOW appends the metrics record's terminal block. A PASS WITH WARNINGS proceeds without confirmation, its warnings carried into the PR body.
- **Step 1.5 — no read-back.** Skip the `metrics` series call and the relay; stage the record the gate wrote. If the gate's Metrics line says git ignores the record, say so in the executor's `summary`.
- **Steps 2–3** run `/marvin:commit` and `/marvin:pr-create` in their own pipeline modes. Ask for a **draft** pull request whatever the critics said: the pipeline marks it ready itself once its verifier has passed and CI is green. The diff critic line renders `⚠️ critic skipped` by the rule above, since task-implement does not dispatch that critic in pipeline mode, and the pull request's Pipeline section names the review that replaced it.
- **Step 4 — skipped.** The spec's status stays `in-progress` and gains no Delivery section. The pipeline flips it to `shipped` in its finalize step, after its verifier and CI have passed: a delivery the verifier then rejects must not already read as shipped.
- **Step 5 — skipped.** The run's retro owns lessons, and the pipeline's guard refuses `lessons` `action: "add"` to a child. A gotcha worth keeping is one line of the executor's `summary`.
