# Verification protocol (VER-01…VER-08)

A claim becomes a confirmed finding only through rulings the `hunt` tool records. The tool,
not the agent, decides what each ruling does to the status, and it refuses a ruling the
protocol forbids. This page states the rules so a session knows what to ask for; the tool is
the authority if the two ever disagree.

## Who may rule

- **VER-01.** Nobody rules on their own claim. A verdict whose `by` equals the finding's
  `producer` is refused. The hunter produces; the skeptic, the referee, the session that ran
  the reproducing test and a person rule.
- The skeptic and the referee are separate dispatches with separate context. The referee sees
  the claim and the skeptic's argument, never the hunter's working notes.

## What each ruling does

| Stage | Ruling | Proof class (bug, perf, spec-drift) | Rule class (ux-issue, design-deviation, a11y) | risk |
| --- | --- | --- | --- | --- |
| skeptic | upheld / dismissed | recorded, status unchanged | recorded, status unchanged | recorded, status unchanged |
| referee | dismissed | → rejected | → rejected | → rejected |
| referee | upheld | stays candidate until a test rules | → confirmed, only with `rule` and a screenshot or recording (VER-07) | → suspected |
| prove | red + `failure_kind: real-defect` | → confirmed, only with `reproduction.test_path` or `scenario` (VER-03) | refused | refused |
| prove | red + any other `failure_kind` | recorded, stays candidate (VER-05) | refused | refused |
| prove | green | → rejected: the hypothesis was wrong | refused | refused |
| prove | flaky | → flaky (VER-04) | refused | refused |
| human | confirm / reject / wont-fix | → confirmed / rejected / wont-fix | same | same |

## Proving a bug (VER-03…VER-05)

1. Write the smallest test that drives the defect through the **caller's boundary** (the
   function, handler or component a real caller uses), with the project's runner and
   conventions. It asserts the *expected* behaviour from the claim, so it fails while the bug
   exists.
2. Run it three times. All three fail → `red`. All three pass → `green`. Mixed → `flaky`.
3. Read the failure. Rule `red` with `failure_kind`:
   - `real-defect` — it fails on the assertion the claim predicts;
   - `test-drift` — it fails because the test itself is wrong (imports, setup, wrong API);
   - `environment` — a missing service, port, binary or credential;
   - `data` — a fixture or seed the test depends on is absent.
   Only `real-defect` confirms. Fix the test and rerun for `test-drift`; record the others and
   move on.
4. Compare against the run's baseline: a test that fails the same way at the baseline commit
   for an unrelated reason is `environment`, not proof.
5. Mark the test as an expected failure in the runner's own vocabulary (`test.fails` in
   vitest, `it.failing` in jest, `pytest.mark.xfail(strict=True)` in pytest) so the suite
   stays green and the test turns red the day the bug is fixed without the marker being removed.
   A runner with no such marker (node:test has only `todo`, which never turns red) gets
   `{ todo: "<finding id>" }` and a note in the report that the marker will not flip by itself.
   Name the test after the finding id.

The hunt never commits these tests. They stay in the working tree, the report lists them, and
the person decides whether they become part of the suite.

## What a person can always do

`hunt action: "verdict"` with `stage: "human"` confirms, rejects or closes as won't-fix any
finding, whatever its status. A human `reject` or `wont-fix` suppresses the same fingerprint
in later runs (NFR-08); `hunt action: "set-status"` with `fixed` marks a confirmed finding
fixed, and a later sighting reopens it as `regressed`.
