# ADR 0058 — The autopilot gate does not charge a run with failures its base already has

| Field         | Value |
| ------------- | ----- |
| Status        | **Accepted** |
| Date          | 2026-11-27 |
| Supersedes    | — |
| Superseded by | — |
| Related       | [ADR-0036](0036-oracle-execution-and-red-green.md) (oracles judge the run's own criteria) |

## Context

The autopilot engine's gate stage (`pipeline/gate.ts`) runs the project's gates on the run's
HEAD and rejects the iteration when any of them fails. It re-runs a failed gate once and calls a
pass on the re-run flaky, but it never asks whether the failure is the run's. When the base
branch is already red, every run against it fails the gate on tests it never touched.

An analysis of 110 autopilot runs found that nine of the 49 failed runs on one large host
project halted this way: the change was green, and the engine's final gate rejected it, iteration
after iteration, over tests that failed on the base commit itself. The executor cannot fix such a
failure inside its scope, so the run spends its rejection cap and halts.

## Decision

1. **A failed ordinary gate is checked against the base.** After the project's gates run, each
   one that failed (never a prepare step, never an acceptance oracle: those judge the run's own
   criteria) goes to a base check (`pipeline/inherited.ts`). The base is the commit the gate
   diffs the run from, the same one the scope and protected-path checks use.
2. **Only the failing tests run, through `gates.test_one`.** The check reads the gate's whole
   output for test-level failure lines (node's spec and TAP reporters, vitest, jest) and the test
   files they name, keeps files that match `pipeline.test_path_pattern` and git tracks at HEAD,
   and runs each one alone, once on HEAD in the run worktree and once on the base in a throwaway
   detached worktree that borrows the run's installed dependencies (`withBaseWorktreeAsync`, the
   tree the re-seal red run already uses).
3. **Inherited means identical, file by file, and complete.** The gate is classified
   `inherited` only when all of the following hold:
   - every failing file exists on the base and the run did not change it;
   - every file fails alone on HEAD and fails on the base with the same set of normalised
     failure lines (ANSI colour, durations, TAP ordinals, `:line:col` positions and the worktree
     path removed);
   - every test-level failure line of the gate's own output is reproduced by one of those
     single-file runs on HEAD, so nothing else in the gate failed;
   - the output carries no compiler diagnostic (`error TS…`) besides its tests;
   - at most ten files fail.
4. **Everything else fails closed.** A failure the base does not have is `new`. No
   `gates.test_one`, an unreadable output, a file that passes alone, a template the engine
   refuses, a base tree that cannot be made, and any error are `unavailable`. Both leave the gate
   `fail`, exactly as before, with the reason appended to the `G-<gate>` finding's evidence and
   written to `events.jsonl`. A stop request still ends the stage with no verdict.
5. **Base results are cached by base SHA.** Each base-side run is stored in the run directory
   (`base-checks.json`) under a key over the base SHA and the exact command. A later iteration on
   the same base runs only the HEAD side; a base that moved, or a changed template, misses.
6. **An inherited failure is reported, never hidden.** The gate result is `inherited` (a new
   value of `GateResult.result` that passes the stage, as `flaky` does), carrying the base, the
   files and the failure lines. It becomes a minor `G-<gate>-inherited` finding, which reaches
   the verifier through the gate report and the run's `minorFindings`, and the engine writes a
   notify event naming the gate, the base and the files.

## Consequences

- A run against a red base no longer halts on tests it never touched, provided the project
  configures `gates.test_one` and its runner prints test-level failure lines that name files.
- The check costs two single-file runs per failing file on the first gate of a base, and one per
  file on later iterations. It runs only when a gate has already failed.
- The comparison reads output that code under test can write. A run that breaks a test which
  already fails on the base with the same failure line, or that makes a test fail without
  printing a failure marker, is not told apart from an inherited failure. CI, which runs the
  whole suite on the pull request, and the verifier remain the later checks.
- A project whose runner the line patterns do not read gets `unavailable` and today's behaviour.
  Adding a runner is a pattern in `inherited.ts` plus a fixture.
- A gate that mixes tests with another step (a build, a lint) and fails in both is not
  inherited unless the other step's failure is also reproduced by a single-file run.
