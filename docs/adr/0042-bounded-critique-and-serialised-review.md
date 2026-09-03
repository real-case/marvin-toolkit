# ADR 0042 — Bounded critique, and verification before review

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-09-03 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0002](0002-tool-backed-verification.md) (the gate runner whose ordering this changes), [ADR-0003](0003-tool-backed-dor.md) (the DoR gate this extends), [ADR-0039](0039-critique-receipts.md) (the receipts the critics leave), `docs/proposals/task-workflow-latency-optimization.md` (P2, reversed here) |

## Context

An instrumented run of the full pipeline — `/marvin:task-start` → `/marvin:task-implement`, one
feature task, marvin 0.18.1, 2026-09-03 — was measured end to end from the session transcript.
It took 74.8 minutes, and the distribution is the finding:

| | |
| --- | ---: |
| Total wall clock | 74.8 min |
| Time inside critic agents | **50.4 min (67%)** |
| Time writing the code | 1.9 min |
| Project gates (5 runs) | 5.7 min |
| Acceptance oracles (18 runs) | 0.5 min |
| Deterministic `spec` gates (DoR, seal, scope) | ~1.6 s each |

Across six critic dispatches, **211 tool calls consumed 79.6 seconds of execution against 3,026
seconds of wall clock**. Investigation is not what a critique costs; 97% of it is generating the
report. The report's length *is* the latency.

Four further facts from the same run bear on where that time went:

1. **The spec-critic loop had no budget.** `task-implement` defines a three-round fix-cycle
   protocol; `task-start` Step 8F said only "loop back, fix, re-run Step 7F, return here". It ran
   four rounds and 34.8 minutes. The loop also fed itself: two of round 2's four blockers and two
   of round 3's three were introduced by the previous round's own fix.
2. **The DoR gate validated half of a graph it stores twice.** `criteria[].implemented_by` and
   `files[].satisfies` are one relation written from both ends. The gate checked each side for
   dangling references and never compared them, so a criterion could name a file that denied it
   and both checks passed. Round 3 blocked on exactly that, and the fix introduced two more.
   The shipped feature template taught the same asymmetry.
3. **The diff critic was dispatched blind.** Step 6F prescribed `git diff`, which cannot show an
   untracked file. A feature spec is mostly `action: new` rows: the diff carried 4 of the 17
   contract files.
4. **The concurrency cost more than it saved.** Step 6F launched the critic beside `verify` "so
   wall-clock collapses to the slower of the two". Verify failed, the code was fixed while the
   critic was still reading, and the skill's own stale-review guard then mandated a second pass.
   The overlap saved 76 seconds and cost 393.

Every critic pass in that run found real defects — no blocker across six passes was a false
positive, and the diff critic caught a data-loss bug no oracle in the contract could see. The
problem to solve is therefore cost, not value: the same findings for less wall clock.

## Decision

**1. Both critics carry a countable output budget.** Blockers and per-criterion coverage are never
truncated — they are what the caller acts on. Warnings cap at 5, out-of-scope lines at 10,
confirmations at 3, each one line; overflow is stated as a count. One line per finding plus one
fix line, `file:line` instead of pasted code, nothing outside the template, and a 400-word target.
The spec critic's "Questions for the author" section is removed: a question that would change the
verdict is a blocker, one that would not is a warning. On a stated re-dispatch the caps tighten
further.

**2. `task-start`'s critic loop gets a budget, which it had never had.** Two dispatches per spec:
the first, then one after a revision. A second `BLOCK` stops dispatching and hands the surviving
blockers to the user, who revises without a critic or records them as an override. A
`NEEDS_CONTEXT` re-dispatch does not spend the budget.

**3. A deterministic sweep runs before every dispatch.** Re-run the mechanical gate after any edit;
cross-check the spec's declared gates against the project's real CI jobs; re-read every shell
snippet for its exit code; re-check the defect class just repaired across the rest of the contract.

**4. The DoR gate transposes the graph.** A new `graph-symmetry` check in `spec action: "dor"`
compares `implemented_by` against `satisfies` in both directions and FAILs on disagreement. A file
row that declares no `satisfies` declares no index and is exempt — an absent index is not a
contradicting one, and infra rows legitimately carry none. Only edges whose endpoints both exist
are compared; a dangling reference remains the existing checks' finding.

**5. Verification runs before review, not beside it.** The scope gate, the project gates and the
acceptance oracles run first; the critic is dispatched **once**, against a green tree, and receives
`git status --porcelain --untracked-files=all` alongside `git diff`. This reverses P2 of
`docs/proposals/task-workflow-latency-optimization.md` on measurement. The staleness moves rather
than disappearing: a stale *review* becomes impossible, and any code change after the green run —
including one made for a critic blocker — invalidates that run and requires the affected gate and
a final full pass before delivery, which the delivery gate's freshness check (ADR-0035) enforces.

**6. The feature pipeline records its acceptance oracles.** `verify action: "oracles"` was reachable
only from the bugfix pipeline's red and green steps, so a feature shipped with no per-criterion
proof beyond "the whole suite is green". Step 6F now runs it after the gates: 9 oracles in 16
seconds against 343 seconds for the gates, answering deterministically the coverage question the
critic asks next.

**7. A failing gate's excerpt leads with the errors.** `verify` showed the last twelve lines of
output, which for any linter that prints warnings after errors is the wrong twelve: the run's lint
failure rendered a pre-existing warning in an untouched file while all five real errors scrolled
past. The excerpt now shows the matched error lines and their count, falling back to the tail when
the output names none.

## Consequences

- **The estimated saving is 35–40 minutes on a 75-minute task**, dominated by items 1 and 2. It is
  a projection from one run, not a measurement of the changed pipeline.
- **Advisory output is genuinely dropped.** Warnings past the fifth survive only as a count. That
  is the one place where speed was traded for completeness, and it is bounded to the advisory
  channel: no blocker, coverage line, or verdict is affected.
- **Item 4 is a new way for a previously-passing spec to FAIL.** That is the intent — the failure
  costs seconds at the gate instead of minutes at the critic — but it does mean an author who
  declares a partial `satisfies` list now has to complete it. The shipped feature template was
  itself asymmetric and is corrected here, with a fence in `spec-templates.test.mjs` that runs the
  shipped checker over both templates.
- **Item 5 gives up a real overlap on the happy path.** When verify passes, serialising costs the
  gates' duration — 343 seconds in the measured run, against a critic pass of roughly 540. The
  trade is deliberate: the overlap pays only when verify passes, and the re-review it forces when
  verify fails costs several times more.
- **Nothing here changes what is checked.** The checklists, the verdict vocabulary, the receipt
  protocol (ADR-0039), the gates and the delivery decision are untouched.
- **Marvin still cannot see this.** `.marvin/usage/events.jsonl` records `{ts, kind, name}` per
  MCP call and nothing else: no skill invocation, no agent dispatch, no duration, no verdict. Every
  number above was reconstructed from a session transcript by hand. Instrumenting the usage log so
  the next comparison is a query rather than an archaeology is left to its own decision.
