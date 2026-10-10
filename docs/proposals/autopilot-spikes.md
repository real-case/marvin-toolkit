# Autopilot — Phase 0 spike results

| Field      | Value                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| Status     | Phase 0 complete; D20 decided (a); S8 turn-end/app-restart half pending |
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

## S8 — detached engine survival (partial)

A node process spawned with `detached: true` + `unref()` from a Code-tab Bash call: PPID 1, its own process group. It was alive across 20+ later tool calls and 10+ minutes (pid 68940, self-exits after 1 h).

**Pending.** Survival across this session's turn end and a desktop-app restart needs the user, or a check in a later turn.

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
