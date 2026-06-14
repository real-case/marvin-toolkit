---
slug: taskmaster-latency-optimization
type: feature
status: shipped
created: 2026-06-13
tracker: "#11"
supersedes: none
stack: typescript
risk: medium
test_command: "npm test"
---

# Taskmaster latency optimization via tool-backed parallel verification

## Goal
Cut end-to-end wall-clock time of the taskmaster pipeline (`task-start` → `task-implement`
→ `task-verify` → `task-deliver`) **without changing what is checked or how deeply the model
reasons**. Quality is the hard constraint; speed is pursued only where it is provably
quality-neutral. Implements `docs/proposals/task-workflow-latency-optimization.md` (P1, P2, P4,
P5, P6) and the RFC-2119 requirements in `docs/requirements/parallel-step-execution.md`.

## Context
- Related patterns:
  - Tool authoring: `plugins/marvin/mcp/server/src/tools/{task,git,help}.ts` via `defineTool({...})` + zod, wired in `server.ts` `build` factory.
  - `marvin-tm-diff-critic` is read-only (Read/Glob/Grep/git-read Bash, model sonnet); the `verify` tool writes only `verification.md` — the two overlap without file contention.
  - `marvin-tm-executor` runs gates **inline via Bash** today (Step 3 "Self-Test", not a `task-verify` invocation). It declares tool constraints in body prose, with no `tools:` frontmatter field — like every agent in the repo. Whether a frontmatter-unconstrained agent receives the parent session's MCP tools is a Claude Code platform behaviour that is **not verifiable from this codebase**, so the spec does not depend on it: the executor **prefers** the `verify` tool when available and **falls back to its existing inline-Bash gates** otherwise (F-3). The tool surfaces as `mcp__plugin_marvin_marvin__verify`.
  - Stack-detection table currently duplicated in `task-verify/SKILL.md` (body, 5 stacks: Go/Python/TypeScript/Rust/Java) and `marvin-tm-executor.md` (same 5); the tool consolidates it into one TS source implementing exactly those 5 stacks (parity — no behaviour change).
  - Existing parallel reads in `task-start` §1.3 and `task-implement` Step 3 stay as-is (R-R-1 remains SHOULD).
- Dependencies: Node built-in `child_process`, `zod` (already a dep), `@marvin-toolkit/mcp-shared` (`defineTool`). No new dependencies.
- Sibling specs: none.

## File Change Plan
Authoritative allowlist. The implementer/executor MUST NOT touch files not listed here.

| Path | Action | Intent | Anchor |
|------|--------|--------|--------|
| `plugins/marvin/mcp/server/src/tools/verify.ts` | new | deterministic verify tool | — |
| `plugins/marvin/mcp/server/test/verify.test.mjs` | new | unit tests (parity, no-loss, latency, fail-fast); `.mjs` in `test/` to match the runner `node --test test/*.test.mjs` (package.json:10) | — |
| `plugins/marvin/mcp/server/src/server.ts` | edit | wire `buildVerifyTool` into `tools:[]` | — |
| `plugins/marvin/mcp/server/test/smoke.test.mjs` | edit | add a `tools/list` assertion that `verify` is enumerated (currently only `initialize` is exercised) | — |
| `plugins/marvin/mcp/server/dist/server.js` | edit | committed artefact (verify-dist gate) — REBUILD | — |
| `plugins/marvin/skills/task-verify/SKILL.md` | edit | delegate gates to the tool (P1), accept `mode`/`stack` from chain (P4), document `sequential` opt-in (R-V-5); fix pre-existing description/table mismatch (frontmatter advertises Ruby, body table has none) | — |
| `plugins/marvin/skills/task-implement/SKILL.md` | edit | overlap `diff-critic` ‖ verify (P2), targeted retry then final full pass (P5), forward spec/type/stack (P4) | — |
| `plugins/marvin/agents/marvin-tm-executor.md` | edit | overlap parity (P2) via the same tool, with prose-Bash fallback (F-3) | — |
| `plugins/marvin/skills/task-start/SKILL.md` | edit | default to 3 variants (P6) | — |
| `plugins/marvin/skills/task-deliver/SKILL.md` | edit | accept spec context in chained mode (P4) | — |
| `plugins/marvin/.claude-plugin/plugin.json` | edit | minor version bump | — |
| `.claude-plugin/marketplace.json` | edit | minor version bump | — |
| `plugins/marvin/mcp/server/package.json` | edit | minor version bump | — |
| `CLAUDE.md` | edit | tool inventory `task/git/help` → `+verify` | — |
| `docs/adr/0004-tool-backed-verification.md` | new | ADR for verify becoming tool-backed | — |
| `docs/proposals/task-workflow-latency-optimization.md` | edit | flip Status Draft → Accepted/Implemented, commit (currently untracked) | — |
| `docs/requirements/parallel-step-execution.md` | edit | flip Status Draft → Accepted/Implemented, commit (currently untracked) | — |

## Interface / Contract
New MCP tool **`verify`** (surfaces as `mcp__plugin_marvin_marvin__verify`), authored with
`defineTool({...})` + a zod input schema. See **Chosen Approach §1** for full behaviour.

Input (zod):
- `mode`: `"feature" | "bug" | "standalone"` — default `standalone`.
- `execution`: `"parallel" | "sequential" | "fail-fast"` — default `parallel`. The third value
  `fail-fast` is the additive input recorded in Design Notes (a).
- `only`: `("test" | "lint" | "typecheck" | "build")[]` — optional, for targeted retries (P5).
- `stack` — optional pre-detected hint (P4 skip-in-chain).
- `projectRoot` — defaults to `cwd`.
- `write`: boolean — default `true`.
- `gates` — optional explicit command override that bypasses detection (additive, Design Notes (b)).
- `dryRun` — report the gate plan without executing (additive, Design Notes (c)).

Output: structured JSON — per-gate `{name, command, status, durationMs, summary, details}`,
aggregate `verdict`, `detectedStacks`, `wallClockMs`, `sumOfGatesMs`, `artifactPath`. Side
effect: writes `verification.md` to `<projectRoot>/.taskmaster/current-task/verification.md`
(the path `task-deliver/SKILL.md:19` reads) unless `write:false`.

## Data & Config
No database migrations, environment variables, or feature flags. The only configurable surface
is the `verify` tool's `projectRoot` (defaults to `cwd`) and its artifact path (defaults to
`<projectRoot>/.taskmaster/current-task/verification.md` — the path `task-deliver` reads), with
`write` controlling whether the artefact is emitted. No new runtime config keys.

## Chosen Approach
Make `task-verify` **tool-backed** rather than prose-driven for the gate-running step, and make
every concurrency point structural.

1. **Verify tool (P1).** A new MCP tool `verify` with zod input:
   `mode: "feature"|"bug"|"standalone"` (default `standalone`),
   `execution: "parallel"|"sequential"` (default `parallel`),
   `only: ("test"|"lint"|"typecheck"|"build")[]` (optional, for targeted retries),
   `stack` (optional pre-detected hint), `projectRoot`, `write` (bool, default `true`).
   Behaviour:
   - Detect stack(s) from config files unless `stack` is supplied (P4 skip-in-chain).
   - Build the gate command set; `only` filters it (P5).
   - Run independent gates via `child_process.spawn` collected with `Promise.allSettled`
     (parallel) or one-at-a-time/fail-fast (`sequential`). Every gate runs to completion in
     parallel mode — one failure never aborts or discards siblings.
   - **Single merge point**: compute the aggregate verdict only after all gates settle.
   - Render and write `verification.md` (the tool owns the artefact → identical content
     guarantee). **Default `artifactPath` is `<projectRoot>/.taskmaster/current-task/
     verification.md`** — the path `task-deliver/SKILL.md:19` reads — so the delivery gate
     finds it unchanged; `projectRoot` defaults to `cwd`. Return structured JSON: per-gate
     `{name, command, status, durationMs, summary, details}`, aggregate `verdict`,
     `detectedStacks`, `wallClockMs`, `sumOfGatesMs`, `artifactPath`.
   - Implements exactly the 5 stacks in the current `task-verify` table (Go, Python,
     TypeScript, Rust, Java). Ruby — advertised in the `task-verify` description but absent
     from the table — is **not** added (that would be new behaviour); the description is
     corrected to match instead.
   - Fallback: if concurrent spawn is unavailable, degrade to sequential and still produce a
     correct verdict (F-3).
2. **Overlap critic ‖ verify (P2).** In `task-implement` (6F/9B) and `marvin-tm-executor`
   (§3/§4), dispatch `marvin-tm-diff-critic` as a backgrounded Task subagent and run the
   gates concurrently — via the `verify` tool, or the executor's inline-Bash fallback when the
   tool is unavailable — then collect both at a single merge point before delivery. If a
   verify failure triggers a code fix, re-run the critic against the **final** diff (R-C-3),
   and the critic verdict still **blocks** delivery on `BLOCK` exactly as in the sequential
   design (R-C-4). This also unifies the two siblings, which today order these steps
   oppositely: `task-implement` runs critic (6F) → verify (7F); `marvin-tm-executor` runs
   inline gates (§3 Self-Test) → critic (§4 Self-Review).
3. **No re-derivation in chain (P4).** When invoked as one chained session, pass
   `spec`/`type`/`stack` forward: `task-verify` skips detection when `stack`/`mode` are given;
   `task-deliver` reuses already-read spec context. Standalone invocation preserves full
   re-derivation.
4. **Targeted retries (P5).** On a gate FAIL, re-run only the failed gate (`only:[gate]`) to
   confirm the fix, then perform one full `verify` pass as the final pre-delivery confirmation.
5. **Default 3 variants (P6).** `task-start` Step 3F defaults to 3 genuinely-different
   variants; expand to 5 only for high-uncertainty / high-blast-radius tasks. NATIVE fallback
   and anti-strawman rules retained.

**Stack compliance:** NATIVE
**Future alignment:** N/A (no VISION.md in repo)

**Stack extensions required:**
- None.

## Why this over alternatives
- Variant — prose-only background-Bash for P1 (rejected): cheapest, no rebuild, but the
  RFC-2119 MUSTs (merge point R-GEN-4/R-V-4, no-loss-on-failure R-V-3/F-1, verdict parity I-2)
  would be held only by model discipline, not by code — i.e. not actually guaranteed. Fails
  the "no quality change" bar at the one gate where partial-result decisions matter most.
- Variant — hybrid: tool for P1, prose for the rest (rejected): a reasonable middle, but the
  chosen full-scope path also closes P4/P5/P6 and the executor parity gap in one coherent
  change, and the tool already consolidates the duplicated stack-detection table.

## Acceptance Criteria
Each criterion is observable from the outside and bound to the proof that verifies it.

| ID | Criterion | verified_by | Failure path |
|----|-----------|-------------|--------------|
| AC-1 | On a fixture whose gate commands are scripts each sleeping a fixed duration (≥150 ms) so spawn overhead is dwarfed, the `verify` tool runs the gates concurrently and the returned result + `verification.md` record **every** gate. | unit test asserts all gates present; `wallClockMs < sumOfGatesMs`. Timing assertions use only these controlled fake gates, never real fast gates. | a gate is missing from the result/`verification.md`, or gates ran serially (`wallClockMs ≈ sumOfGatesMs`) |
| AC-2 | For a fixed repo state, `execution:"parallel"` and `execution:"sequential"` yield the **same** verdict and the same per-gate findings. | verdict-parity unit test | parallel and sequential disagree on verdict or per-gate findings |
| AC-3 | When one gate fails, the other gates' results are still present in the output and `verification.md`. | no-loss unit test | a sibling gate's result is dropped when one gate fails |
| AC-6 | `execution:"sequential"` (fail-fast) is selectable and produces a correct verdict. | fallback unit test | sequential/fail-fast mode unavailable or yields a wrong verdict |
| AC-7 | With the same controlled fake gates (≥150 ms each), parallel wall-clock is strictly less than sequential wall-clock by a clear margin (e.g. 3 gates × 200 ms ⇒ parallel ≪ ~600 ms). | timed unit test; margin chosen to absorb spawn overhead | parallel wall-clock ≈ sequential (no concurrency win) |
| AC-TOOL | `verify` is registered in the `server.ts` `build` factory and enumerated by `tools/list`; `dist/server.js` is rebuilt and in sync. | extended `test/smoke.test.mjs` sends `tools/list` and asserts `verify`; `node scripts/verify-dist.mjs` passes | `verify` absent from `tools/list`, or `dist/server.js` out of sync |
| AC-4 | `task-implement` and `marvin-tm-executor` instruct dispatching `diff-critic` in the background concurrently with `verify`, with both results collected at a single merge point before delivery. | prose-contract review against R-C-1/R-C-2 | critic runs after verify (serialized), or results not joined at a single merge point |
| AC-5 | Both files instruct re-running `diff-critic` against the final diff after any verify-triggered fix. | prose-contract review against R-C-3 | critic verdict reflects a pre-fix (stale) diff |
| AC-4b | In the concurrent path, a `diff-critic` `BLOCK` verdict still refuses/draft-gates delivery exactly as in the sequential design — the merge-point semantics do not weaken blocking. | prose-contract review against R-C-4 | a `BLOCK` verdict no longer gates delivery |
| AC-P4 | `task-verify` skips stack/type detection when `mode`/`stack` are supplied; `task-deliver` reuses chained spec context; standalone paths still re-derive. | prose-contract review | chained run re-derives stack/type, or standalone stops re-deriving |
| AC-P5 | `task-implement` retry loop re-runs only the failed gate via `only:[…]`, then a final full `verify` pass before delivery. | prose-contract review | retry re-runs the full gate set, or skips the final full pass |
| AC-P6 | `task-start` Step 3F defaults to 3 variants, expands to 5 only for high-uncertainty/high-blast-radius, and retains NATIVE fallback + anti-strawman. | prose review of `task-start/SKILL.md` | defaults to 5, or drops NATIVE fallback / anti-strawman |
| AC-DOCS | Version bumped in `plugin.json`, `marketplace.json`, server `package.json`; `CLAUDE.md` tool inventory updated; `docs/adr/0004-tool-backed-verification.md` added; both source planning docs flipped to Accepted/Implemented. | file inspection of the version triple, `CLAUDE.md`, ADR-0004, and planning-doc status | a version left unbumped, ADR missing, or a planning doc still Draft |
| AC-CI | `lint-manifests`, `npm run build`, `verify-dist`, ESLint, Prettier, the `npm test` suite (whose `smoke.test.mjs:51` asserts `serverInfo.name == "marvin"`), and the CI workflow's inline `initialize` smoke-test all pass. | CI workflow (`.github/workflows/validate-plugins.yml`) green | any CI gate (lint/build/verify-dist/eslint/prettier/test/smoke) red |

## Test Plan
- Harness: `npm test` → `node --test test/*.test.mjs` (package.json:10) — matches the
  `test_command` frontmatter.
- Test locations: `plugins/marvin/mcp/server/test/*.test.mjs` (`.mjs` files in `test/`). New:
  `verify.test.mjs` (parity, no-loss, latency, fail-fast); extended `smoke.test.mjs` (adds the
  `tools/list` assertion for `verify`).
- Fixtures / setup: controlled fake gates — scripts each sleeping a fixed duration (≥150 ms) so
  spawn overhead is dwarfed — injected via the `gates` input override so concurrency and latency
  are unit-testable without a real toolchain. Timing assertions use only these controlled fake
  gates, never real fast gates.

## Non-goals
- Changing what any gate checks, the depth of model reasoning, the clarifying-question cadence
  in `task-start` (stays one-at-a-time, NR-1), or any quality gate / Definition-of-Ready /
  delivery gate.
- Parallelising dependent steps or multiple distinct tasks (batch dispatch is separate).
- Elevating R-R-1 from SHOULD to MUST (existing parallel reads stay as-is).
- Monorepo per-package verification orchestration beyond running all detected stacks' gates
  concurrently.
- Replacing the `marvin-tm-spec-critic` (Phase-1) gate — untouched.

## Open Questions
none

## Security / NFR
No auth, crypto, PII, or network-input surface. The `verify` tool only spawns the project's own
gate commands via Node `child_process` and writes a single artefact (`verification.md`); it
introduces no new external input. NFR notes:
- **Resource caveat (P1):** peak CPU/RAM rises when test + build run concurrently — documented.
- **Observability (N-2):** the skill surfaces which gates ran concurrently and each result as the
  tool reports them.
- **Rollback (F-3):** the executor falls back to its existing inline-Bash gates when the tool is
  unavailable, so a headless run never silently fails.

## Critic Verdict & Overrides
`marvin-tm-spec-critic` re-review verdict: **PASS WITH WARNINGS** (all prior blockers resolved).
Proceeding with two acknowledged, non-actionable residual warnings: (1) the prose-contract
acceptance criteria (AC-4, AC-4b, AC-5, AC-P4, AC-P5, AC-P6) have no automated test signal —
inherent to changes that live in `SKILL.md`/agent prose; mitigated by explicit prose-contract
review at PR time. (2) Executor parity is scope beyond both source docs — intentional, flagged
in Design Notes; reviewers comparing spec vs. source docs should read that note.

## Design Notes
- **⚠️ SPEC GAP — added tool inputs.** The spec's schema listed `mode, execution(parallel|
  sequential), only, stack, projectRoot, write`. Implementation added three, recorded here:
  (a) `execution` gained a third value **`fail-fast`** so verdict parity (AC-2, parallel vs
  sequential, all gates) and the fail-fast fallback (AC-6) are *separately* satisfiable — the
  docs' "sequential / fail-fast" is one phrase but two behaviours. (b) `gates` — an explicit
  command override that bypasses detection; required to unit-test concurrency without a real
  toolchain, and useful as a project override. (c) `dryRun` — report the gate plan without
  executing. All three are additive (defaults preserve the spec's behaviour), not contradictory.
- **Determinism is the whole point of choosing a tool over prose.** Merge point = `await
  Promise.allSettled`; no-loss = settled results captured per gate; verdict parity = same
  inputs, same reducer. These become code properties, not markdown promises (I-1…I-4).
- **The tool owns `verification.md`** (confirmed default) — strongest R-V-2 guarantee; the
  skill prose only relays the returned verdict to the user.
- **Default mode is parallel** with `sequential`/fail-fast opt-in (R-V-5, N-3); document peak
  CPU/RAM caveat for concurrent test+build (P1 caveat).
- **Executor headless fallback (F-3):** if the `verify` tool is unavailable in a headless
  `claude -p` run (server not loaded), the executor falls back to its existing prose-Bash gate
  commands — never silently fail.
- **Observability (N-2):** the skill surfaces which gates ran concurrently and each result as
  the tool reports them, preserving the interactive "show each major step" principle.
- **No AI attribution** in any commit or PR text (inherited from `/marvin:commit`).
- Build/version discipline per `CLAUDE.md`: commit `src/` + `dist/` together; minor bump
  (new tool); mirror version across `plugin.json`, `marketplace.json`, server `package.json`.
- **Intentional divergence from the proposal.** `docs/proposals/...latency-optimization.md`
  (lines 140–148) states "No MCP server rebuild required" because it assumed P1 would be a
  prose edit. This spec deliberately supersedes that note: P1 becomes a tool (rebuild
  required), recorded in ADR-0004, for the determinism guarantees the prose path cannot give.
- **Executor parity is an intentional scope extension.** Neither source doc lists
  `marvin-tm-executor` in its affected files; it is added here to (a) close the existing
  critic/verify ordering divergence between the two siblings and (b) keep "same contract, same
  pipelines" true. Flagged explicitly so a reviewer comparing spec vs. source docs sees it is
  deliberate, not creep.

## Future Considerations
- A configurable `concurrency` bound is exposed but defaults to "run all" since gates number
  ≤4; a real bound matters only if monorepo multi-stack fan-out grows.
- If a project has two gates that write the same output path (rare; e.g. a custom build), they
  are not independent per R-GEN-3 — `sequential` is the documented escape hatch. A future
  refinement could declare per-gate output paths and serialise only the conflicting pair.
- The verify tool could later emit machine-readable JUnit/SARIF for CI consumption.

## Delivery
- PR: #11 — taskmaster: tool-backed parallel verification (ADR-0004); merged as commit `2caca12`.
- Delivered: 2026-06-13.
- Status: shipped.
