# ADR 0020 — Root-cause analysis as an agent (`marvin-debugger`)

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-22                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0017](0017-adversarial-critic-gates.md) (fresh-context agent pattern), [ADR-0021](0021-lessons-feedback-loop.md) (the debugger is its first writer), [ADR-0006](0006-all-subagents-opus.md) (subagents on Opus), `plugins/marvin/agents/marvin-debugger.md`, `plugins/marvin/skills/debug/SKILL.md` |

## Context

The pipeline authored bug fixes richly but executed them thinly. `task-start`
Step 3B drove a hypothesis-driven root-cause analysis **in prose**, and the
standalone `/marvin:debug` skill encoded the *same* methodology again — including
a near-identical "common root-cause categories" list in both places, guaranteed
to drift. No agent encapsulated debugging: the headless `marvin-tm-executor` only
**consumes** a pre-computed root cause from the spec, and `/marvin:debug` was
wired into nothing — neither `task-start` nor any agent referenced it.

Root-cause analysis is precisely the kind of judgment work this codebase already
delegates to a fresh-context, read-only agent (the spec and diff critics,
[ADR-0017](0017-adversarial-critic-gates.md)) rather than carrying as duplicated
prose. The spec critic even audits *whether* a stated root cause is "supported by
evidence, or a guess" — but nothing upstream made that input rigorous.

## Decision

**Introduce `marvin-debugger`, a read-mostly, fresh-context, hypothesis-driven
root-cause-analysis agent that is the single source of the debugging
methodology.** Three doors invoke the one agent:

- **`task-start` Step 3B** — dispatched to produce the spec's Root Cause Analysis,
  Fix Approach, and Regression Test sections; its report maps onto them 1:1.
- **`/marvin:debug`** — now a thin interactive **door** that dispatches the agent
  and helps the user apply the prescribed fix (the skill↔agent sibling pattern
  already used by `task-implement`↔`marvin-tm-executor` and
  `task-fix-pr`↔`marvin-tm-review-fixer`).
- **Executor / implement fallback** — the principled path when a regression test
  passes on unfixed code, or a fix stalls after its retry budget.

The agent is **read-mostly**: it may write a throwaway reproducer, runs read-only
`git`/tests, and **prescribes** the minimal fix + regression test but never
applies, commits, or pushes. On reflect it captures a `bug-pattern` lesson via the
`lessons` tool ([ADR-0021](0021-lessons-feedback-loop.md)). Both prose copies of
the methodology are removed; `task-start` Step 3B and `/marvin:debug` now point at
the agent, leaving no third copy to drift.

## Consequences

### Positive

- **One source of the RCA methodology.** The two duplicated category lists are
  gone; the agent body is the single reference.
- **Rigorous root cause feeds the spec.** An evidence-first, confirmed root cause
  makes the spec critic's "is this a guess?" check substantive instead of
  hopeful.
- **Fresh context** mirrors the critic-isolation rationale of ADR-0017 — the
  debugger reasons from evidence, not from whoever wrote the code.

### Negative / accepted trade-offs

- One extra Opus subagent on the bugfix hot path — the same trade-off accepted
  for the ADR-0017 critics.
- Subagent/tool availability is not guaranteed in a headless `claude -p` run; both
  `task-start` Step 3B and `/marvin:debug` keep an **inline fallback** that runs
  the same phases by hand — the same degradation caveat the tool ADRs carry.
- The agent diagnoses but does not decide scope; a bug that reveals a larger
  design problem is surfaced as a note, not expanded into the fix.
