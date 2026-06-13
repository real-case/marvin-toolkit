# ADR 0004 — Tool-backed verification gate

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-13                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | `docs/proposals/task-workflow-latency-optimization.md` (P1, P2), `docs/requirements/parallel-step-execution.md`, `specs/taskmaster-latency-optimization.md` |

## Context

`/marvin:task-verify` ran the project's quality gates — test, lint, type-check, build — as
**prose instructions** the model followed: detect the stack, then run the gates "in order, stop
early on critical failures." The stack-detection table was duplicated in
`skills/task-verify/SKILL.md` and `agents/marvin-tm-executor.md`.

The latency work (`docs/proposals/task-workflow-latency-optimization.md`) asked to run the
independent gates **concurrently** to cut wall-clock on the common PASS path, and
`docs/requirements/parallel-step-execution.md` formalised this with RFC-2119 obligations:

- **R-GEN-4 / R-V-4** — no verdict before a single merge point;
- **R-V-3 / F-1** — a failing gate must not discard sibling results;
- **I-2** — parallel and sequential runs must yield the same verdict (verdict parity).

### The binding constraint

These are guarantees about *control flow*. Expressed as prose, they hold only by the model's
discipline at run time — an LLM following markdown can still decide on a partial result set or
drop a crashed branch. The proposal's own note ("No MCP server rebuild required") assumed a
prose edit; that assumption cannot deliver the MUSTs above.

## Decision

Move gate-running out of prose into a **deterministic MCP tool**, `verify`, in the `marvin`
server.

- The tool detects the stack, runs the independent gates with `Promise.allSettled`, and reduces
  them to one verdict at a **single `await`** — the merge point is a line of code, not a
  convention. A crashed gate becomes its own `error` result; siblings are never lost. Parallel
  and sequential execution share the same reducer, so verdicts match.
- Default `execution: "parallel"`; `"sequential"` (all gates, lower peak resource use) and
  `"fail-fast"` (stop at first failure) are opt-in.
- The tool **owns `verification.md`**, writing it to
  `<projectRoot>/.taskmaster/current-task/verification.md` — the exact path `/marvin:task-deliver`
  reads.
- Stack detection lives **once** in the tool (five stacks: Go, Python, TypeScript, Rust, Java),
  removing the duplicated prose tables.

`skills/task-verify/SKILL.md` now delegates to the tool. `agents/marvin-tm-executor.md` prefers
the tool and **falls back to its existing inline-Bash gates** when the tool is unavailable in a
headless run.

## Consequences

### Positive

- The RFC-2119 control-flow MUSTs (merge point, no-loss-on-failure, verdict parity) are
  guaranteed by code, with unit tests, rather than by prompt discipline.
- Concurrent gates cut verify wall-clock to the slowest gate on the PASS path.
- One source of truth for stack detection; the two prose tables stop drifting.

### Negative / accepted trade-offs

- Gate-logic changes now require a server rebuild and committed `dist/` (was a prose edit).
- MCP-tool availability inside a headless `claude -p` executor run is not guaranteed by this
  codebase; mitigated by the mandatory inline-Bash fallback (requirement F-3).
- Concurrent test + build raises peak CPU/RAM; mitigated by the `sequential` opt-in.
- Adding a stack (e.g. Ruby, which the old description advertised but never implemented) is now
  a code change, not a table edit. Accepted — the five-stack set is unchanged here.
