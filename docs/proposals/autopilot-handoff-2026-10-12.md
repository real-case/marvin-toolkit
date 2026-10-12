# Autopilot work: session handoff (2026-10-12)

A session continuing the autopilot plan (`autopilot-implementation-plan.md`) stopped mid-task. This
note is what the next session needs to pick it up from another account. Read it whole, then
`autopilot-implementation-plan.md` ("Benchmark iterations" under Task 21) and
`evals/autopilot/README.md`. Delete this file in the commit that finishes the work it describes.

## Where things stand

| Branch | Tip | State |
|--------|-----|-------|
| `feature/autopilot` (origin) | `5b47bb6` | The integration branch. Draft PR [#225](https://github.com/real-case/marvin-toolkit/pull/225) into `dev`; CI was green at `60e5a9a`, and the push of `bede40c` and `5b47bb6` triggered a new run that nobody has read yet. |
| `fix/autopilot-engine-commits-metrics` | the commit adding this note | **Work in progress, unreviewed**: `5a60cb8` on top of `5b47bb6`, then this note. Described below. |

Already on `feature/autopilot`, each benched (two repeats, Haiku, sandbox suite):

| Bench | Variant | Commit | Delivered | Hidden | Tier matched | Notional cost | L3 (delivered-runs rule) |
|-------|---------|--------|-----------|--------|--------------|---------------|--------------------------|
| 1 | `haiku-baseline` | 5115cf6 | 7/8 | 100% | — | $13.53 | baseline |
| 2 | `haiku-seal-fix` | 0e6b6a2 | 5/8 | 75% | — | $11.38 | reject |
| 3 | `haiku-refusal-resume` | 3d4013b | 7/8 | 83.3% | — | $11.49 | accept |
| 4 | `haiku-integrated` | 80329b3 | 5/8 | 58.3% | — | $7.74 | reject |
| 5 | `haiku-engine-seal` | 19707ac | 7/8 | 83.3% | — | $9.11 | accept |
| 6 | `haiku-dor-rounds` | b9cf905 | 8/8 | 100% | 5/8 | $10.75 | accept |
| 7 | `haiku-tier-guidance` | bede40c | 8/8 | 100% | 7/8 | $11.97 | accept (vs 6 and vs 1) |

Results are committed under `evals/autopilot/results/`; the latest baseline is
`2026-10-12-haiku-tier-guidance.json`.

## The task in progress: the engine commits the metrics record

**Problem (measured).** The executor commits its work and then calls the `verify` tool's
`action: "gate"`. On ALLOW that appends a terminal `task-metrics` block to the run's record
`.marvin/metrics/<NNN>-<slug>.md`, after the commit, because the block names the delivered commit
(`head_sha`) and so cannot be inside it. The record is tracked (the engine committed it with the
approved spec), so the engine's gate (`runGateStage`) reports "uncommitted work" and the run spends
a second executor iteration committing it: 12 times in 56 runs, in five of the seven benches.

**Decision (owner, 2026-10-12): the engine commits the record.**

1. One rule, in `src/pipeline/metrics-carry.ts`: `runRecordPath` (the record path, shared by the
   spec commit, the gate and finalize) and a classifier of the working record against a commit:
   `absent`, `unchanged`, `ignored`, `appended` (regular file, one link, the committed bytes a
   prefix, the suffix only `metric-event` / `task-metrics` blocks in exactly the shape
   `storage/metrics.ts` `append()` writes, each valid and for the run's slug; an untracked record
   must be the header plus such blocks) or `refused` with a reason.
2. The gate tolerates exactly that path, and only when the classifier says `appended`. Every other
   dirty path, including another record or a rewritten one, still blocks.
3. `finalizeRun` (learning.ts) carries the appended bytes into its plumbing commit, never through
   the format command, verifies them after the commit like every other file, and on `refused`
   ships the run without the record and reports why (`FinalizeResult.metricsRecord`, a notify note
   from `finalizeWork` in runtime.ts). The halted and no-PR paths are untouched.
4. Pipeline-mode prose no longer tells the executor to commit the record's appends:
   `pipeline/roles/executor.md`, `skills/task-deliver/SKILL.md` (Pipeline mode, Step 1.5),
   `skills/task-implement/SKILL.md` (pipeline mode). Interactive prose is unchanged.
5. CHANGELOG (the 0.29.0 autopilot entries) and the `.marvin/metrics/` row of CLAUDE.md.

**What the work-in-progress commit holds.** An implementing agent wrote all five parts and was
stopped while finishing (it had reached the docs). Files: `metrics-carry.ts`, a new `plain-path.ts`
(path helpers moved out of `gate.ts`), `gate.ts`, `learning.ts`, `runtime.ts`,
`storage/metrics.ts`, tests (`pipeline-metrics-carry`, `pipeline-gate-adversary`,
`pipeline-learning`, `pipeline-runtime`, `pipeline-roles`, the root `autopilot-sandbox` test and its
fake executor), the three prose files, CHANGELOG and CLAUDE.md. `dist/` was **not** rebuilt in this
commit.

Verified at the time of the commit: `tsc --noEmit` on the server is clean; the server test files
`pipeline-metrics-carry`, `pipeline-gate`, `pipeline-gate-adversary`, `pipeline-learning` and
`pipeline-roles` pass (278 tests; two shell-runner tests in `pipeline-gate` timed out at 5 s under
load and pass when the file runs alone). **Not yet run:** `pipeline-runtime`, `pipeline-engine`,
the root `autopilot-sandbox` and `autopilot-bench` tests (they need a rebuilt `dist/`),
`lint-skills`, `lint-manifests`. **Not yet done:** any independent review.

## Next steps

1. Read the diff of the work-in-progress commit against `5b47bb6` and check it against the
   decision above. Give it an adversarial review (the planned lenses: hardening against an
   untrusted executor that can write the worktree and the git dir; behaviour preserved when there
   is no record or it is ignored, unchanged or refused, and finalize replay safety; tests that fail
   without the change, and prose with no remaining pipeline-mode instruction to commit the record).
   Fix what is real.
2. `npm run build -w @marvin-toolkit/server`, then the server tests above, the root
   `test/autopilot-sandbox.test.mjs` and `test/autopilot-bench.test.mjs`,
   `node scripts/lint-skills.mjs`, `node scripts/lint-manifests.mjs`, `npm run lint:docs`. Commit
   source and `dist/` together (lint-staged reformats on commit: check `git diff HEAD --stat`
   afterwards, and rebuild and amend if the bundle went stale), then `node scripts/verify-dist.mjs`.
   Squash the work-in-progress commit into a proper one if convenient.
3. Bench 8, an L3 run because skill prose changed. Run it from a snapshot so the worktree stays
   free, and keep work dirs outside the repository:

   ```shell
   SNAP=<scratch dir>/snap-$(git rev-parse --short HEAD)
   mkdir -p "$SNAP" && git archive HEAD plugins evals | tar -x -C "$SNAP"
   cd "$SNAP"   # the committed bundle is self-contained: no node_modules needed
   MARVIN_PIPELINE_SANDBOX=1 MARVIN_PIPELINE_MODEL_OVERRIDE=haiku \
     node plugins/marvin/mcp/server/dist/marvin-pipe.js bench \
       --suite evals/autopilot/suites/sandbox.yaml --variant haiku-engine-metrics --repeat 2 \
       --judge llm --baseline evals/autopilot/results/2026-10-12-haiku-tier-guidance.json \
       --work-dir <scratch dir>/bench-work-8 --out <scratch dir>/results-8
   ```

   About 90 minutes. Expect no "uncommitted work: .marvin/metrics/..." finding in any executor's
   iteration-2 prompt (`<work-dir>/state/<task>-<n>/bench-sandbox/<run>/*executor-2.prompt.md`),
   and each shipped run's finalize commit holding the record.
4. Copy the result into `evals/autopilot/results/`, add a row and a paragraph to "Benchmark
   iterations" in the plan, commit, report to the owner, and push to `feature/autopilot` only on
   the owner's word.

## Open items that need the owner

- The next L3 candidate after this one: a DoR warning when a spec rated `risk: low` edits an
  existing file that has callers. In bench 7 one of two `csv-quotes` planners rated a rewrite of
  `parseCsv` (called by `totals()`) `low` after reading the new task-start rule, so prose alone
  works for Haiku about half the time.
- Task 20 scenario 2, interactive half (can run on the sandbox).
- Task 20 scenarios 3–4: live runs against marvin-toolkit itself; need #225 merged to `dev` and two
  tasks the owner picks.
- Spike S8: a real turn end and a desktop-app restart are still owed.
- Task 22: not triggered.
- Before `dev` contains Task 19, the owner moves the local, ignored `.marvin/config.json` in the
  main checkout aside: git silently overwrites an ignored file with the committed one.

## Rules this work follows

- Never touch the first consumer project (tesari `osint-chat-client`, "O" in the plan); use
  marvin-toolkit or the sandbox fixture instead.
- Work only in your own worktree; never write into another worktree's files.
- Project artifacts (code, docs, commits, PR text) are English. Chat with the owner is in Russian,
  professional and restrained.
- No Fable models anywhere, the bench included (the engine refuses them too).
- Commits end with the `Co-Authored-By` line of the model that wrote them; PR bodies end with the
  Claude Code line.
- Never push to `feature/autopilot` or `dev` without the owner's explicit word, never enable
  auto-merge, and never poll CI on a schedule.
