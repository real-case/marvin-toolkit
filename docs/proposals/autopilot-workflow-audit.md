# Autopilot workflow audit — 2026-10-18

| Field      | Value                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Findings F1–F7 fixed in 0.31.0; F8–F14 are recommendations, each with the evidence it rests on                                           |
| Date       | 2026-10-18                                                                                                                               |
| Evidence   | the six runs under `~/.local/state/marvin-pipeline` (2026-10-13 to 2026-10-18): `run.json`, `events.jsonl`, child logs and result files |
| Code read  | `mcp/server/src/pipeline/*` (engine, loop, runtime, gate, seal, learning, wait, ci, command, launch), `pipeline/roles`, `pipeline/hooks`, `skills/autopilot`, the pipeline modes of `task-implement`, `task-deliver`, `commit`, `pr-create` |
| Applies to | engine 0.30.1 → 0.31.0                                                                                                                   |

## 1. Method

Every stop, every wasted iteration and every minute of wall time in the six real runs was traced
to the code path that produced it. A finding is kept only where the run files show it; a change is
made only where a program, not a model, can make the decision. Prompt and rubric changes that
would need the replay benchmark (R17) are recorded as recommendations.

Costs below charge a resumed session once, at its last running total (F7): the run files sum the
segments, which overstates every resumed role.

## 2. The six runs

| Run                       | Host           | Tier     | Outcome                | Wall     | Cost   | What the wall clock went on                                                                                               |
| ------------------------- | -------------- | -------- | ---------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `r20261013-1806-0418`     | marvin-toolkit | light    | cancelled at intake    | 12 min   | $1.7   | 11 min waiting for the user's answer; the task's premise was wrong                                                        |
| `r20261013-1806-cf2b`     | marvin-toolkit | heavy    | PR ready               | 17 h     | $14.5  | executor 109 min chasing a flaky server test under `verify`; 7 oracle runs of one 70 s file; `test` gate flaky, 47 min; a 15 h gap in the gate stage |
| `r20261014-1833-9f85`     | marvin-toolkit | light    | PR ready (#239)        | 78 min   | $5.1   | **two gate stages, 34 + 24 min = 75 %**; the `test` gate alone 33 min; children 10 min; finalize + CI 7 min              |
| `r20261017-1749-b2f2`     | osint-chat-client | standard | PR ready (#641)     | 2 h 23 m | $11.5  | engine dead 54 min on a `gates.test_one` refusal after two children had finished; two instant planner failures; two executors failed on `gh pr create`; a bookkeeping rejection; a CI rejection over unformatted journals; verifier 11 min re-running tests |
| `r20261017-1930-d2eb`     | osint-chat-client | heavy    | PR ready (#642)     | 10 h 53 m | $26.6+ | 8 h waiting on a stall halt overnight (fixed in 0.30.0); two bookkeeping iterations, 22 min; three user waits, 45 min; two transient CI halts after finalize |
| `r20261018-0913-d6f8`     | osint-chat-client | heavy    | in progress (executor) | —        | $46+   | planner 86 min and $37.8 for a 70-file spec, of which two spec-critic passes took about 30 min; test-author re-sealed once |

Cost by role across the finished runs, with resumed sessions charged once:

| Role        | Share of cost | Note                                                                                   |
| ----------- | ------------- | -------------------------------------------------------------------------------------- |
| planner     | 22–59 %, ≥80 % on d6f8 | `task-start` in pipeline mode; the spec critic is the long pole (two Opus passes, ~10 min each on a large spec) |
| executor    | 20–45 %       | every rejection buys a fresh session one rung up                                       |
| verifier    | 10–17 %       | floored to the executor's model, so every executor rung raises it too                  |
| test-author | 6–15 %        | standard and heavy only                                                                |
| retro       | 2–5 %         | cheap; cache reads near zero because its prompt is mostly the run's own aggregate      |

## 3. Findings

Severity: **S1** stops a run or needs a human; **S2** wastes an iteration or a child; **S3** wastes
minutes or misleads a number.

| Id  | Sev | Finding                                                                                                                                                                                                                                                                       | Evidence                                                                                                        | Status                       |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| F1  | S1  | A child that failed before its first request (`Failed to authenticate: OAuth session expired`, 218 ms, $0) was retried at once, met the same fault, and the run halted with `detail: "success"` (the CLI's `subtype`). The user's retry six minutes later worked.          | b2f2 planner-0 ×2, judgment 001-halt                                                                             | fixed: `caps.launch_retries` 3, waits 1/2/4 min, detail = the CLI's message |
| F2  | S2  | A rejection whose only findings were committed pipeline service files (critic receipts, `runs/*.progress.md`, the metrics record) climbed an escalation rung like a real defect, and the verifier floor climbed with it. Three iterations in two runs, each $0.5–1.3 and 6–7 min plus a gate stage. | d2eb iterations 1–2 (`scope|.marvin/critique/…`, `scope|specs/runs/…`), b2f2 iteration 1                      | fixed: bookkeeping rejections move no rung, own cap `caps.bookkeeping_rejections` 2 |
| F3  | S2  | Criteria that resolve to one command ran it once each: seven `kind: test` criteria on `pipeline-seal.test.mjs` ran the 70 s file seven times, before the ordinary gates.                                                                                               | cf2b gate report: `oracle:AC1…AC7` 70–73 s each                                                                 | fixed: one run per distinct command, each criterion reports it (`sharedWith`) |
| F4  | S1  | `gates.test_one` was validated only by the seal stage, after the planner and the test-author had finished: a template with `{name}` stopped the engine 54 min and $3.2 in, and nothing restarted it until the user came back.                                            | b2f2 `engine stopped: gates.test_one must not contain {name}…`, 18:01 → 18:55                                   | fixed: checked at prepare; an absent template is told once |
| F5  | S2  | The verifier re-ran the unit tests and polled the PR checks for 11 minutes although the gate report in its prompt already held both.                                                                                                                                      | b2f2 verifier-3: `in Bash (Wait for unit tests, recheck PR checks)`                                              | fixed: prose, `roles/verifier.md` |
| F6  | S1  | A writing child's `gh` used whichever account was active; with no access to the repository two executors failed on `gh pr create` ($2.3, 10 min) and the run halted, while `pipeline.github.token_command` named the right account for the engine's own calls.             | b2f2 executor-1 ×2: `Could not resolve to a Repository …`                                                       | fixed: the token reaches writing children as `GH_TOKEN`; redacted in `<child>.command.json` |
| F7  | S3  | `total_cost_usd` is a session's running total, and every resumed segment was summed: an executor read $20.75 for a $7.63 session; the approval-time estimate from `calibration.jsonl` grows with every question a run asked.                                                | d2eb executor-1 segments $5.74 → $7.38 → $7.63 (the last 25 s long); 9f85 planner $2.45 → $2.97 (1.5 min)       | fixed in `aggregate`, the bench and the report format; older calibration records overstate |
| F8  | S1  | **marvin-toolkit's `test` gate takes 33 minutes under the engine** (CI: 2 min 20 s for every workspace). Two gate stages were 75 % of a light run's wall time, and the executor runs the same gates once more through `verify`. Measured here: the server suite alone took 22 min under `--test-concurrency=4` at 23 % CPU, and `pipeline-seal` alone takes 74 s on an idle machine, 181 s while another suite runs; the slow files spawn git, supervisors and whole `node --test` red runs per test. | 9f85 gate report `test: 2,006,562 ms`; cf2b `test: flaky, 2,809,989 ms`; this audit's timing | host: see §5.1 |
| F9  | S2  | The planner is the dominant cost and the spec critic its long pole: on d6f8 two critic passes took about 30 of the planner's 86 minutes; the planner's cost share ranges from 22 % to over 80 %.                                                                             | d6f8 `in Agent (Spec critic pass 1/2)` 10:14–10:40; memory note "spec critic = 63 % of intake"                  | recommendation §5.2 |
| F10 | S2  | A CI rejection over the formatting of `.marvin/` and `specs/runs/` markdown the pipeline's own tools write: the host's `prettier --check` covers them, the executor cannot format what it must not commit, and the fix cost an iteration on `opus/xhigh`.                 | b2f2 iteration 2 → 3: `format:check was red on spec/receipt/metrics md`                                         | host: `.prettierignore` (§5.3) |
| F11 | S2  | Two parallel runs on one host each created `.marvin/pipeline/calibration.jsonl`; the second PR conflicted after finalize.                                                                                                                                                  | d2eb judgment 006 `CI conflict after finalize`; code comment in `mergeBaseForFinalize`                          | mitigated in 0.30.0 (merge the base before finalize); the per-run file layout of §5.4 removes the class |
| F12 | S3  | The executor spent 109 minutes on a test that was red only under the `verify` tool and green in its shell (an environment leak into a guard test), and reported progress every 15–26 min meanwhile.                                                                        | cf2b executor-1 reports 18:56–20:16                                                                              | fixed since (PR #238 status notes; `_driver.mjs` hermetic env); kept as the cost of a flaky suite |
| F13 | S3  | After finalize, CI read `CONFLICTING` once and `PR Tests` red once, each a halt the user retried into green within minutes.                                                                                                                                                 | d2eb judgments 006, 007                                                                                          | recommendation §5.5 |
| F14 | S3  | The retro reads almost nothing from cache (0 to 283 k tokens): its user prompt is the run's own aggregate and lesson index, different every run, and its system prompt is short.                                                                                          | every run's retro row                                                                                            | accepted: $0.3–0.7 per run |

## 4. What 0.31.0 changes

Engine (`decide`, `runGateStage`, `prepare`, `classify`, `aggregate`):

- **Launch faults** — a `failed` or `crashed` child with no structured output, zero cost and a
  duration under 30 s is relaunched after 1, 2 and 4 minutes (`caps.launch_retries`, 3) before it
  costs the crash retry; the CLI's own message is the detail; the orchestrator's retry of a halt
  starts the budget over.
- **Bookkeeping rejections** — blocking findings that are all scope findings on
  `.marvin/critique/`, `.marvin/metrics/`, `.marvin/handoff/`, `.marvin/task/verification.md` or
  a `runs/<slug>.*.md` journal move no rung and count on `caps.bookkeeping_rejections` (2), not
  `caps.rejections`; past that cap they are rejections like any other.
- **Oracle dedupe** — one run per distinct oracle command; each criterion reports the outcome,
  duplicates with `ms: 0` and `sharedWith`; a sealed-file change around the run is charged to
  every criterion it proved.
- **`gates.test_one` at prepare** — refused with the seal stage's message before any child;
  an absent template is noted once.
- **`GH_TOKEN` for writing children** from `pipeline.github.token_command`; read-only roles get
  none; the launch record redacts it.
- **Session cost charged once** in `aggregate`, the calibration record and the bench.

Prose: `roles/verifier.md` (no suite, no CI polling), `skills/commit` pipeline mode (the service
files it never stages), the orchestrator's `judgments.md`, `recovery.md` and `report-formats.md`.

Expected effect on the six runs, had they run on 0.31.0: b2f2 loses its 54-minute dead engine,
its two launch failures, its two failed executors and one rung; d2eb loses two rungs and the Opus
verifier they forced; cf2b loses six of seven oracle runs (about 7 minutes); every run's
calibration record and approval-time estimate becomes right.

## 5. Recommendations

### 5.1 marvin-toolkit's own test gate (F8)

The `test` gate is the whole run's bottleneck on this host and nothing in the engine can fix it:
the engine must run the gates, and the executor runs them too. Measured on this machine, the
server suite took 22 min under `--test-concurrency=4` at 23 % CPU (other test files were running
beside it, as an executor's `verify` runs beside the engine's gate in a real run); the slowest
files one at a time were `pipeline-runtime` (~200 s), `pipeline-seal` (74 s idle, 181 s under
load), `spec` (~89 s), `pipeline-learning` (~74 s) and `pipeline-gate-adversary` (~63 s). CI runs
every workspace in 2 min 20 s. A `node -e 0` costs 24 ms whatever the environment, and
`pipeline-seal` runs the same with and without the desktop app's variables, so the environment is
not the cause; the slow files spawn git, `node -e` supervisors and whole `node --test` red runs per
test, and they are load-sensitive, which is why a gate stage that runs while anything else runs
takes half an hour. Two moves, in order of return:

1. Split the slow pipeline files into a `test:fast` set the gate runs and a `test:slow` set CI
   runs, or mark the subprocess-heavy tests so that the gate runs them with
   `--test-concurrency=1` while the rest keep 4; measure before choosing.
2. Pin the root `.marvin/config.json` `test` gate to the server workspace's fast set plus the
   root suite, and leave `verify-dist`/widgets to CI as today.

Until then every autopilot iteration on marvin-toolkit costs 30 minutes of gates whatever the
change, and a flaky test doubles it.

### 5.2 The planner's cost (F9)

The planner is `task-start` in pipeline mode, and its long pole is the spec critic: an Opus
`Agent` dispatch per pass, two passes on standard and heavy. Three levers, all prompt or rubric
changes and so L3 proposals for the benchmark:

- cap the critic at one pass when the first returns `PASS WITH WARNINGS` (the second pass on
  d6f8 took 10 minutes to confirm fixes the planner had already listed);
- run the critic on `sonnet` for the light and standard tiers (the critic reads, it does not
  write), keeping Opus for heavy;
- the spec-size work already proposed in `docs/proposals/spec-size-reduction.md`: d6f8's spec
  grew to 64 files and 13 criteria, and both critic passes and the test-author scale with it.

### 5.3 Hosts whose formatter covers `.marvin/` (F10)

A host whose `prettier --check` covers `.marvin/` or its spec directory's `runs/` makes every
tool-written journal a CI failure the executor cannot fix without committing what it must not
commit. The pipeline could say so at prepare (a `.prettierrc` without a `.prettierignore` entry
for those paths); until it does, `.prettierignore` gets `.marvin/` and `<spec dir>/runs/`, as
this repository's does.

### 5.4 Per-run calibration files (F11)

`calibration.jsonl` and `checks.yaml` are append-only files every finalize commits, so two runs
on one host race for the same lines. 0.30.0 merges the base first and removes the common case;
the class goes away only with one file per run (`.marvin/pipeline/calibration/<run-id>.json`),
which also makes the approval-time estimate a directory read. It changes `finalizeRun`,
`calibrationRecords`, `efficacy`, the orchestrator's `judgments.md` and `docs/configuration.md`,
and is an ADR-sized change.

### 5.5 A second look before a CI halt after finalize (F13)

Both post-finalize halts of d2eb were transient: GitHub's mergeability and a re-run job. A
`red` or `conflict` read within the first few minutes after the finalize push could be looked at
once more after `ci_poll_seconds` before it becomes a halt, as a `pending` already is. Cheap, but
it needs one more run that shows the pattern before it is worth a rule.

### 5.6 A mechanical repair for bookkeeping rejections (F2, further)

0.31.0 stops a bookkeeping rejection from climbing a rung; it still spends an executor. The gate
report names the committed service files exactly, and the engine already builds commits with
plumbing; a commit that drops them from the branch (`git rm --cached` as a tree edit) and a
re-run of the gate stage would save the executor too. Worth doing once 5.1 makes the gate stage
cheap enough that re-running it is the smaller cost.
