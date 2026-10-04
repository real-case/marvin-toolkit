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
