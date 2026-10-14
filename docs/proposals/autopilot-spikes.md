# Autopilot — Phase 0 spike results

| Field      | Value                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| Status     | Phase 0 complete; D20 decided (a); S8 verified at the process level by tests (2026-10-11), a real turn end and desktop-app restart still owed |
| Date       | 2026-10-04                                                                                    |
| Plan       | `docs/proposals/autopilot-implementation-plan.md`                                             |
| Setup      | Claude Code CLI 2.1.285, macOS, Haiku 4.5 for most probes, Sonnet 5.5 for S6; host repo = osint-chat-client |

Each entry gives the command shape, what was observed, and the decision applied to the plan. A
"child" is a headless `claude -p` session; "W" is an osint worktree nested at
`<osint>/.claude/worktrees/<name>`.

## S1 — orchestrator → running child

- **Run 1.** Child in `--permission-mode auto`, asked to run `sleep 40` three times.
  - Foreground `sleep` is blocked in this environment, so the child **backgrounded** it.
  - It then ended its turn after 10 s, with "First sleep started in background. Waiting for completion."
- **Run 2.** Same, in `auto`, with `node -e "setTimeout(()=>{}, 35000)"`.
  - The **auto-mode classifier denied** the command (`permission_denials: [Bash node -e …]`). The child gave up after 10 s.
- **Run 3.** `--permission-mode acceptEdits --allowedTools "Bash(node -e:*)"`, with env `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`.
  - All three 35 s runs completed in the foreground: 117 s, no denials.
  - A `SendMessage` from the interactive orchestrator to `spike-s1c`, sent while the child was busy, was delivered. The child quoted it verbatim.

**Decisions.**
- Orchestrator → child messages work (interventions are possible).
- `auto` is unpredictable for children; writing roles run `acceptEdits` with an explicit `--allowedTools` role allowlist.
- Every child gets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` plus a role-prompt rule never to background a command. A `-p` child that backgrounds work **ends its turn and loses the work**.

## S2 — marvin MCP inside a child

- Child in W with `acceptEdits`/`auto` and no allow rule: `spec` and `lessons` were **denied** (`permission_denials`). With `--permission-prompts none`, MCP tools are not usable unless explicitly allowed.
- With `--allowedTools "mcp__plugin_marvin_marvin"` (a server-level rule): both tools ran.
  - `spec list` resolved W's `specs/` (92 specs).
  - `lessons stats` resolved W's `.marvin/memory` (142 lessons).
  - So read-side resolution follows the child's cwd.
- Write-side `lessons add` was deliberately not exercised. The plan already writes lessons through storage with an explicit root (memory `tools-resolve-project-root-from-launch-cwd`).

**Decision.** Every role allowlist includes `mcp__plugin_marvin_marvin`. Read-only roles get it only if they need marvin reads; today they do not.

## S3 — headless marvin and `--plugin-dir`

- `/marvin:help` works headless once the marvin server is allowed. Without the allow rule it is denied (same cause as S2).
- With `--plugin-dir <M-worktree>/plugins/marvin`, `ps` shows the child's marvin MCP server running **from the worktree's** `mcp/server/dist/server.js`. It is a single server, not the global `~/.claude/skills/marvin` copy. The tool names are unchanged: `mcp__plugin_marvin_marvin__*`.

**Decision.** Development and acceptance runs pass `--plugin-dir` through an optional `pipeline.plugin_dir` config/env. Production omits it.

## S4 — permission edges for writing roles

Child in W, `acceptEdits`, `--permission-prompts none`, allowlist `Bash(git push:*)`, `Bash(gh pr create:*)`, `Bash(npm run test:run:*)`, `Bash(git status:*)`; `permission_denials` was empty.

| Command | Outcome |
|---------|---------|
| `git push --dry-run origin HEAD:refs/heads/spike/autopilot-s4` | Allowed, but the **husky pre-push hook ran and failed** (code 1). The hook resolves to the main checkout's `.husky` (memory `husky-hooks-resolve-to-main-checkout-in-worktrees`). |
| `gh pr create --dry-run --draft --base dev …` | Allowed; worked ("Would have created a Pull Request"). |
| `npm run test:run -- --version` | Allowed (a rule containing a colon matches). vitest then failed on `react-day-picker`: W has no `node_modules`, so Node **resolved packages from the main checkout's `node_modules` by walking up the directory tree** — a silent wrong-dependency hazard. |
| `touch spike-s4.txt` | **Allowed** although unlisted: `acceptEdits` auto-accepts common filesystem commands. |

**Decisions.**
- Writing roles get explicit allowlists, but `acceptEdits` is not a strict boundary: guards plus snapshots stay mandatory.
- Worktrees move outside the repository tree (see S11).
- **Husky in children — D20, decided 2026-10-04 (option a).** Children run with `HUSKY=0`. The engine's gate stage is authoritative and runs the same gates as osint's `pre-commit` (lint-staged) and `pre-push` (`css-types:check`, `test:run`, `build`, `type-check`), and more. This saves about 6 min per push and avoids the main-checkout hook resolution.

### S4b — `dontAsk` for read-only roles

`--permission-mode dontAsk --allowedTools "Read" "Bash(git status:*)" --disallowedTools Edit Write NotebookEdit`:

| Command | Outcome |
|---------|---------|
| Read | ran |
| `git status` | ran |
| `touch` | **denied** |
| Write | **denied** |
| `pwd` | ran — unlisted, but treated as a read-only built-in |

**Decision.** `dontAsk` is a sound boundary for verifier and retro. Read-only built-ins pass without listing, so the read-only guard and tree snapshot remain defence in depth.

## S5 — worktree bootstrap

Fresh osint worktree from `origin/dev`; its lockfile differs from the main checkout's (main's local `dev` is stale).

| Step | Time / result |
|------|---------------|
| `cp -cR <main>/node_modules` (APFS clone, 966 MB) | 16 s |
| `npm ci --prefer-offline --no-audit --fund=false` (warm cache) | **8 s**, exit 0; npm 11 warns about pending `allow-scripts` |
| `npx vitest run src/shared/routes` in the installed worktree | 3 files / 25 tests pass |

**Decision.** Drop the clone path entirely: `npm ci` is faster and always matches the worktree's own lockfile. `bootstrapPlan` goes; the runtime always runs `pipeline.bootstrap`.

## S6 — long structured turn, resume, kill

- **Long turn.** Sonnet `--effort low` in W with `--json-schema`, `--settings` (a PostToolUse hook injecting a marker) and `--append-system-prompt-file` (a rule: the summary ends with KIWI).
  - 6 turns, `structured_output` present.
  - Hook fired 4 times; marker and KIWI both present. Cost $0.345.
- **Resume** with `--resume <id>` and the same flags: same session id, `structured_output` `done`, hook fired twice, KIWI still present.
- **Kill.** Launched under the plan's `sh -c` wrapper; `kill -TERM` hit the **wrapper** (`pgrep -f` matches it too).
  - The `claude` child was orphaned (PPID 1) but finished normally and wrote its `result` line to the still-open log.
  - **No exit file appeared**, because the wrapper was dead. The engine would have waited until stall detection.

**Decisions.**
- The wrapper traps TERM/INT, forwards them to the child, and still writes the exit code.
- `classify` treats a log containing a `result` event as finished even without an exit file.
- The engine stops a child by signalling the wrapper pid.
- Resume re-passes `--settings` and `--append-system-prompt-file` (already the plan).

## S7 — prompt cache across sessions (D13)

Haiku, `acceptEdits`, ~3.7k-word `--append-system-prompt-file`, no tools.

| Run | cache_creation | cache_read | cost |
|-----|----------------|------------|------|
| A1 (cold) | 40,367 | 0 | $0.081 |
| A2, A4–A7 (same file) | ~9.2–10.5k | **29,866** | $0.022–0.024 |
| B (different file) | 20,251 | 20,089 | $0.043 |
| A3 (same file) | 40,673 | 0 | $0.082 — one miss in six |

**Decision.** D13 confirmed: a byte-identical static system prompt per role makes later spawns' first request about 73% cheaper. Caching is best-effort, with an occasional miss. The engine records `cache_read_input_tokens` per child for calibration.

## S8 — detached engine survival

**2026-10-04, by hand.** A node process spawned with `detached: true` + `unref()` from a Code-tab Bash call: PPID 1, its own process group. It was alive across 20+ later tool calls and 10+ minutes (pid 68940, self-exits after 1 h).

**2026-10-11, by test.** The process-level half is pinned by two hermetic tests in
`test/autopilot-sandbox.test.mjs`. They drive the committed `marvin-pipe` bundle over the
deterministic sandbox's fake children, with the fake planner held mid-turn, so that the engine
rests on a running child while the test acts on it.

| Verified | Test |
|----------|------|
| The engine `start` launches leads a process group of its own, and leaves the launching shell's process tree once `start` exits. | "S8: the engine outlives the process group of the shell that started it …" |
| A shell runs `node <cli> start --run <runDir>` as SKILL.md does. SIGKILL to the shell's whole process group, plus closing the pipes its output was read through, leaves the engine running. The same engine then drives the run to `ready` and writes its last line to `engine.log`. | same |
| While that engine lives, a second `start` is refused (`an engine already holds`), and so is a bare `engine` (`engine already running (pid N)`). Neither writes to `run.json` or `events.jsonl`. | same |
| SIGKILL to the engine's process group mid-run leaves no `engine stopped` note, and `await` prints `ENGINE down`. The running child survives, since it leads a group of its own. | "S8: an engine killed mid-run is reported down …" |
| The resume path of SKILL.md section 2 and `recovery.md` (`list`, `attach`, `start`) restarts the run. A second engine, killed in turn, is reported down again. A third picks up the child that finished while no engine ran. The run reaches `ready` with the planner launched once, and every child spawned after `attach` reports to the new orchestrator. | same |

Each test was checked against the defect it targets, by mutating the source and rebuilding the
bundle:

- `start` without `detached`: the first test fails, since the engine shares the launcher's process group and dies with it;
- `start` with inherited stdio: the first test fails at `engine.log`. The run still reaches `ready`, but the engine's last line went to the dead pipe;
- child wrappers launched without `detached`: the second test fails, since the planner dies with the engine's group.

**Already pinned at the module level** (plan Task 12), with scripted dependencies or a lock taken
in-process:

- the takeover of a dead holder's lock and its compare-and-swap (`pipeline-loop`: "a lock left by an engine that died is taken over", "starters racing over a dead engine's lock");
- a restart while a child runs, after an interrupted spawn, during interrupted work, and on a pending judgment (`pipeline-loop`);
- a replayed spawn adopting the child already launched (`pipeline-runtime`: "a replayed spawn adopts the child already launched").

The new tests add the real processes.

**Supporting evidence.** In all eight runs of the 2026-10-11 Haiku baseline, a `start` that exited
at once launched the engine. Each engine drove its run to a terminal stage alone, under a single
lock generation.

**Still owed to a human.**

- **A real desktop-app restart** with a run in flight: quit and relaunch, and an update relaunch. Afterwards the engine's pid and a running child's wrapper must be alive, and `/marvin:autopilot resume` must reattach. The tests show the engine is outside the launching shell's process group and tree, which is what a tool call's or a session's teardown can reach. What macOS does to an application's other descendants on quit is not observable from a test.
- **A real Code-tab turn end.** The test kills the process group of a shell it made itself; how the Bash tool tears down its shell (group, tree, or a pty hangup) was not observed. A hangup cannot reach the engine, which has no controlling terminal, but that is inferred, not observed.

**Observed, not changed.**

- The lock holder's liveness is `kill(pid, 0)`, which any live process with that pid satisfies (`pipeline-loop`: "a holder the OS refuses to signal is alive, not stale"). An engine that died, and whose pid was later reused, most plausibly after a reboot, would read as alive. `start` would then refuse the run, and `await` would never print `ENGINE down`. Comparing the process's start time with the holder's `startedAt`, or its command line as `stopStalled` does for a child's wrapper, would close this.
- A child whose wrapper died without writing an exit file (a reboot, not an engine death) reads as running until `stall_minutes` (default 15). It is then halted as stalled; nothing checks the wrapper's pid sooner.

## S9 — hook payload and denial

Child in W with a PreToolUse `Edit|Write` hook from `--settings`.
- `tool_input.file_path` is **absolute**.
- The hook's cwd and `CLAUDE_PROJECT_DIR` are both **the worktree root** (not the main checkout).
- Exit 2 with a stderr reason denied the write; the reason reached the model verbatim, and the call appears in `permission_denials`.

**Decision.** `sealed-guard`, `test-path-guard` and the new boundary guard compute paths relative to `CLAUDE_PROJECT_DIR` as planned.

## S10/S11 — writes outside the worktree (new, found during S6)

- In S6's kill run, the child in W **read the main checkout's files** by absolute path (`/Users/urchin/tesari/osint-chat-client/src/shared/...`) although its cwd was W.
- S10: a child in W (`acceptEdits`, prompts `none`) **wrote a file into the main checkout** by absolute path. No denial; the file was deleted at once.
- S11: in a worktree created **outside** the repository tree (`~/.local/state/marvin-pipeline/worktrees/osint-chat-client/<id>`, detached), the child:
  - still loaded the project's auto-memory and `CLAUDE.md`;
  - reported the outside path as its working directory;
  - read files via the worktree's own paths.
  
  But an explicit absolute write into the main checkout was **still allowed**.

**Decisions.**
- **D18:** run worktrees live outside the repository tree. This removes both the path drift and S4's `node_modules` fallback.
- **D19:** a `worktree-boundary-guard` (PreToolUse `Edit|Write|MultiEdit|NotebookEdit`, every writing role) denies any path that does not resolve under `CLAUDE_PROJECT_DIR`.
- The engine snapshots the **main checkout's** `git status --porcelain` before and after every child. Any new entry halts the run (`child wrote outside its worktree`).

## Cost reference (for calibration)

| Child | Cost |
|-------|------|
| Trivial Haiku, cold cache | about $0.08 |
| Trivial Haiku, warm cache | about $0.02 |
| Sonnet `--effort low`, 6-turn read of two files plus a ~40k-token system prompt | $0.345 |

The fixed per-spawn overhead is dominated by the system prompt, which is what D13 targets.

## Acceptance

The first calibration baseline (plan Task 20). Scenarios 3 and 4, real tasks in the host project,
have not run yet.

### Scenario 2 — live sandbox, headless half (2026-10-10)

`MARVIN_LIVE=1 node scripts/autopilot-live-sandbox.mjs`: the Task 20 sandbox fixture (a 3-file
Node project, a local bare origin) with real `claude -p` children, all on Haiku 4.5 through
`MARVIN_PIPELINE_MODEL_OVERRIDE=haiku` under `MARVIN_PIPELINE_SANDBOX=1`, the `gh` shim for the
PR, `MARVIN_PIPELINE_FAKE_CI=green`, and the script standing in for the orchestrator (it approves
the spec and answers child questions with their own recommendations). Claude Code CLI 2.1.286.
The task was given in Russian with `--lang ru` and an English translation, and the stage-A guess
was `standard`.

**Outcome of the accepted run** (`r20261010-1058-cf23`): `ready` in one executor iteration, verifier
PASS on iteration 1, the run branch `feature/SANDBOX--add-clamp-function` pushed to the sandbox
origin with the shipped spec, the calibration record and two code files, and the PR (the shim's)
left a draft because CI is fake. The planner set `risk: low`, so the tier came out `light` and the
test-author was skipped: no sealed tests were written in this run.

| Role | Model | Cost | Wall time | cache_read (total) | cache_read (first request) |
|------|-------|------|-----------|--------------------|----------------------------|
| planner | Haiku 4.5, spec critic on Opus 5.5 | $0.50 (critic $0.12) | 3.1 min | 2,090,998 | 21,991 |
| executor 1 | Haiku 4.5 | $0.22 | 1.3 min | 1,016,111 | 22,116 |
| verifier 1 | Haiku 4.5 | $0.10 | 0.5 min | 69,389 | 0 |
| retro | Haiku 4.5 | $0.08 | 0.9 min | 355,526 | 23,141 |
| **run** | | **$0.90** | **5.9 min** | | |

**Checks.**

| Check | Result |
|-------|--------|
| Reaches `ready` | yes |
| A report in `events.jsonl` at least every 6 min of executor wall time | vacuously yes: the only executor ran 1.3 min and sent no report, so the heartbeat (300 s) never fired |
| Every child log English | yes: no Cyrillic in any assistant text, although the task text was Russian |
| No Fable model anywhere | yes |
| `cacheReadTokens > 0` on iteration 2's system prompt (D13) | not measurable in the accepted run (one iteration). Measured in the earlier run `r20261010-1044-9dec`: executor 2's first request read 27,499 cached tokens against executor 1's 0 (33,453 written), and executor 3's 27,499. D13 holds on Haiku |

**Spend to get there.** Five earlier runs halted or were stopped on the pipeline bugs below; with
the probes, the session spent about $3.60 in total. The longest run took 14 min.

**Bugs the live runs exposed, all fixed with a regression test** (CHANGELOG 0.29.0, Fixed):

1. `--strict-mcp-config` with no `--mcp-config` leaves a child with no MCP server, the plugin's
   included, so the planner never reached `spec` and wrote a spec with no contract (two planner
   crashes, then a halt). The runtime now hands the marvin server back as `plugin_marvin_marvin`.
2. The command wrappers say "Read `skills/<name>/SKILL.md`", a path relative to the plugin that a
   child in a foreign worktree cannot resolve, and a read outside the worktree is denied with
   prompts off. The planner and executor contexts now name the plugin root, and writing roles get
   `Read(/<plugin>/**)`.
3. The DoR passed an oracle ref `test/math.test.mjs::clamp throws RangeError when lo > hi`, which
   every gate then refused as `unsafe-ref`; the executor, unable to fix a sealed spec, edited it
   and tripped the tamper check. The DoR now FAILs such a ref (`oracle-ref`).
4. `marvin-pipe start` returned before the engine took its lock, so the first `await` read
   `ENGINE down` and the restart was refused. `start` now waits for the lock.
5. `tracker: none` produced the branch `feature/none--<slug>`.
6. Nothing told the executor to commit the sealed spec, which the gate requires; the role now
   says `git add -f <spec>` and nothing else under `.marvin/` but the metrics record. The fixture
   gained the host-style `.gitignore` (`.marvin/*`, `!.marvin/config.json`, `!.marvin/metrics/`)
   without which every `.marvin/` service file read as uncommitted work.
7. The retro answered `failed` for a halted run, describing the run rather than itself, which
   cost a retry; the role now says its status reports its own work.

**Observed, not changed.**

- `MARVIN_PIPELINE_MODEL_OVERRIDE` does not reach a subagent whose definition pins a model: the
  spec critic ran on Opus 5.5 (2 turns, $0.12). Setting `CLAUDE_CODE_SUBAGENT_MODEL` did not
  change that, so the runtime does not set it. Plan F8 stays deferred.
- The Haiku executor's PR body carried no `## Pipeline` section, which `pr-create`'s pipeline
  mode asks for. Nothing checks it.

**Still open for a human-driven run in the Code tab:** orchestrator lines in the invocation
language, the push notifications at approval and at ready, the skill's own spec-approval
presentation, and `--answered-by` reaching `calibration.jsonl` through `aggregate` (the accepted
run raised no question; the one answered under `--answered-by orchestrator` was in a run stopped
before its retro). A run that reaches the standard tier, so that sealed tests are exercised live,
and one long enough for the 6-minute heartbeat to fire are also still owed.

### Scenario 2 — live sandbox, interactive half (2026-10-12)

The orchestrator was a real Code-tab session on Opus 5.5 following `/marvin:autopilot`, and the
owner answered every `AskUserQuestion` in it. The children ran on Haiku 4.5 under the same
switches as the headless half (`MARVIN_PIPELINE_SANDBOX=1`, `MARVIN_PIPELINE_MODEL_OVERRIDE=haiku`,
`MARVIN_PIPELINE_FAKE_CI=green`, the sandbox `gh` shim, a stub `gh` for the engine), wrapped in a
small `pipe` script because a Code-tab Bash call keeps no environment. The project was the
benchmark's sandbox (`evals/autopilot/replay/sandbox/project`: CSV parsing and a report built on
it), so that a task could reach the standard tier. Both tasks were given in Russian with
`--lang ru`. Claude Code 2.1.287, engine at `33dd79a` (`feature/autopilot`, with the engine-carried
metrics record).

| Run | Task | Tier | Questions | Approvals | Iterations | Cost | Wall time |
|-----|------|------|-----------|-----------|------------|------|-----------|
| `r20261012-1136-ceae` | RFC 4180 quoting in `parseCsv` (the bench's `csv-quotes`) | standard | 0 | 1 | 1 | $1.72 | 13 min |
| `r20261012-1153-36c1` | stop `totals()` returning NaN, ask how; add `summary()` | standard | 1, the owner's | 2 (changes, then approve) | 1 | $2.89 | 30 min |

Both reached `ready` with the verifier passing on iteration 1 and no rejection.

**Checks.**

| Check | Result |
|-------|--------|
| Orchestrator lines in the invocation language | yes: every status line, both spec presentations and both final reports in Russian; everything sent to the engine in English |
| Every child log English | yes: no Cyrillic in any child's result |
| Push notifications at approval and at ready | yes: sent before each of the three approvals, before the planner question, and at both `STAGE ready` |
| The skill's spec-approval presentation | yes: spec link, summary, criteria and files, risk, critic verdict, tier and reasons, assignments, assumptions, and "no estimate" with no calibration records on the tier |
| `--answered-by` reaches `calibration.jsonl` | yes: the owner's answer to the planner's question went in under `--answered-by user`, the `answer` event carries `answeredBy: user`, and the finalize commit's calibration record has `questions: {byOrchestrator: 0, byUser: 1}` |
| A standard-tier run seals tests live | yes, both runs: the sealed-test commit sits between the approved-spec commit and the executor's first commit |
| "Request changes" | yes: `{kind: "changes"}` sent the planner back with the text, and a second approval followed |
| A report at least every 6 min of executor wall time | still not exercised: the executors ran 4 min and 1 min |

**Observed.**

- In the second run the planner, after the owner's answer, narrowed the task to the `totals()`
  fix and deferred `summary()` to "a separate spec": the spec critic's first dispatch had flagged
  a feature bundled into a bugfix, and the planner chose the critic over the task text, which
  asked for both. The risk then rose to `high` and the tier to `heavy`. The owner's "request
  changes" restored the full scope as one feature (`medium`, standard). The approval step caught
  it; nothing earlier would have.
- The revised spec kept the narrowing among its `assumptions`, and the retro, reading them,
  reported that `summary()` had been deferred, although the delivered branch exports it. A
  revision does not prune stale assumptions.
- The planner decided alone that `summary()` throws a `RangeError` on a column with no numeric
  value while `totals()` returns 0; the presentation named it as a decision the owner had not
  taken.
- In the first run the executor committed the metrics record's appends itself after the delivery
  gate, which the role still allows, so the engine had nothing to carry.

**The heartbeat run** (`r20261012-1925-7698`, the same session and owner, 37 min, $4.44): a
four-part task (a UTC date module, `totalsByMonth`, a CLI script, exports and README) so that the
executor would run past six minutes. It reached `ready` at the standard tier in two iterations
with no rejection, after one "request changes" round (the planner had skipped zero and negative
values, which the task never asked for, and left the README and the script without a criterion or
a test) and one dispute the orchestrator settled alone with `revise_tests`: both sealed test files
used `await import()` in a non-async callback and failed `node --check`, so no criterion in them
could be judged, and nothing between the test-author and the executor had noticed. This was also
the first live run whose finalize commit carried the metrics record (the engine's note: "the
engine committed the metrics record … in the finalize commit").

| Check | Result |
|-------|--------|
| A report at least every 6 min of executor wall time | yes: executor 1 ran 6 min 43 s and reported at 5 min 55 s; executor 2 ran 5 min 21 s. The longest stretch without a report was 5 min 55 s |
| The heartbeat reminder fired | not observable: the reminder reaches the child as hook context, which the child's `stream-json` log does not record, and the `.heartbeat` file's last write (19:49:51) is the report's, by `message-log`. Since this run the hook also appends a `note` event (`data.heartbeat`) to `events.jsonl` each time it fires, without the notify flag, so the next long run will show it |

The orchestrator answered the dispute without `--answered-by`, against the skill; the calibration
record was unaffected, since no question was asked.

### Scenarios 3 and 4 — live runs against marvin-toolkit (2026-10-13/14)

The first runs against marvin-toolkit itself, with no sandbox switch: the children ran on the
rubric's models, the PR went to the real `dev` and CI was GitHub's. Each orchestrator was its own
Code-tab session on Sonnet 5.5, started from a task chip in a fresh worktree of the main checkout,
and the owner answered every question in it. Engine at `0085c9a` (`dev` after #225).

| Run | Task | Tier | Outcome | Cost | Wall time |
|-----|------|------|---------|------|-----------|
| `r20261013-1806-0418` | restore `tracker_url_template` in `.marvin/config.json` | — | closed at planning on the owner's answer | $1.67 | 12 min |
| `r20261013-1806-cf2b` | the seal stage runs `node --check` on a JavaScript test before sealing it | heavy | `ready`, PR #231 | $14.52 | 18:06 → 11:41 the next day, about 15 h of it stopped (below) |

**Scenario 3 did not deliver, by design of its task.** The planner found that the key was removed
on purpose (`71b6edf5`: a dead `tracker.local` host in a public repository), asked, and the owner
cancelled the run (`answeredBy: user`); the retro still ran. The task was the orchestrator's
mistake, not the pipeline's. The planner also reported that `.marvin/config.json` matches
`protected.default.json`, so no autopilot run can change that file. Scenario 3 is owed again with
another light task.

**Scenario 4 passed every criterion.** One iteration, no rejection, verifier PASS on iteration 1,
CI green, the PR marked ready, the sealed tests committed before the implementation, and the
finalize commit carrying the metrics record. The tier came out `heavy`, not the `standard` the
task was chosen for, because `seal.ts` and its test are sensitive paths.

| Role | Assignment | Cost | Wall time | cache_read |
|------|-----------|------|-----------|------------|
| planner | opus/high | $5.90 | 11 min | 8,611,089 |
| test-author | opus/high | $2.27 | 11 min | 3,169,189 |
| executor 1 | opus/high | $3.54 | 109 min | 7,724,042 |
| verifier 1 | opus/xhigh | $2.13 | 5 min | 2,157,584 |
| retro | opus/medium | $0.67 | under 1 min | 152,730 |
| **run** | | **$14.52** | | |

The executor's 109 minutes were mostly this repository's own gates: it chased a red `verify` run
to `test/pipeline-guards.test.mjs:732`, which reads the MCP server's `CLAUDE_PROJECT_DIR` (an
environment leak outside the contract), and confirmed one flaky process-group test. The heartbeat
fired three times while it worked (9 and 16 min since the last report) and each reminder was
followed by a report within seconds, which settles the last open item of scenario 2.

**Why the engine stopped for 15 hours.** The engine entered `gating` at 20:19:30Z and wrote nothing
after it: no `engine stopped` note, its lock left held, `engine.log` empty. The cause was outside
the pipeline: the machine was shut down at about 20:30Z. A `shutdown_stall` report is dated
20:34:46Z, `pmset` stops logging at 20:34:38Z, `last` shows no clean shutdown, and the next boot was
at 07:17Z on the 14th. A gate test process left a half-written cache file
(`node_modules/.cache/marvin-ts-test/*.47685.tmp`) at 20:29:40Z, which dates the kill. The
orchestrator session went down with the machine. On the 14th the run was resumed (a new engine
at 10:31Z), re-ran the gate from the start, and finished.

What the pipeline did wrong in that is narrower: the engine could not stop cleanly. The gate stage
runs synchronously (`runGateStage` through `shellRunner`'s `spawnSync`, up to
`gate_timeout_minutes`, 60 here), so the `SIGTERM` the shutdown sent waited on a blocked event
loop until the `SIGKILL` that followed. A clean stop would have written the note and released the
lock. Nothing was lost, since the run resumed from disk, but `await` could only report a dead
engine, not why. Making the gate stage asynchronous, or forwarding the signal to the gate's
process group, is a candidate fix.

