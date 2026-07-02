# ADR 0029 — Refactoring command family: read → plan → apply under hard rails

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-07-02                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0002](0002-tool-backed-verification.md) / [ADR-0009](0009-config-first-gate-resolution.md) (the `verify` gate), [ADR-0007](0007-marvin-working-directory.md) (`.marvin/` layout), [ADR-0017](0017-adversarial-critic-gates.md) (read-only agent pattern), [ADR-0021](0021-lessons-feedback-loop.md) (lessons store), [ADR-0022](0022-numbered-spec-files.md) (numeric-prefixed artifacts), [ADR-0024](0024-mcp-apps-widget-architecture.md) (shared data contracts), [ADR-0025](0025-kanban-board-only.md) (the `task` tool), [toolbox-expansion plan D3](../proposals/toolbox-expansion.md), `plugins/marvin/skills/refactor-*`, `plugins/marvin/agents/marvin-refactor-auditor.md`, `packages/marvin-mcp-shared/src/contracts/refactor.ts` |

> Covers the **whole** `refactor-*` family. The read side (`refactor-audit`,
> `refactor-smells`, the auditor agent, the register format, the contract) lands with WP4
> of the toolbox-expansion plan; `refactor-plan` and `refactor-apply` are implemented
> against this record in WP5.

## Context

Marvin has no refactoring instrument. The nearest neighbours are `migration-plan` — a
single-shot planning document for one large, named structural move — and the `sec-*`
family, which proves the shape of a scanner group (read-only commands producing
severity-ranked findings with file:line evidence). Nothing answers the continuous
code-health questions: *where is the technical debt, which of it is worth paying down,
in what order, and how do we pay it without breaking behaviour?*

Today a "refactor this" request lands on ad-hoc prose — the riskiest possible mode. Its
failure modes are well known and all observable in the wild:

1. **Unbounded diffs.** Behaviour changes and structure changes mix in one commit, so
   review cannot separate "moved" from "changed".
2. **No safety net.** Refactoring uncovered code turns silent behaviour changes into
   production surprises; nothing forces the coverage question to be asked first.
3. **Big-bang rewrites.** Without a decomposition step, "clean this up" becomes a
   half-finished parallel implementation that stalls.
4. **Amnesia.** The same debt is rediscovered every quarter because findings live in
   chat scrollback, and past refactoring outcomes (what worked, what bit us) are never
   consulted.

The building blocks for the rails already exist: the `verify` gate (ADR-0002/0009)
proves "still green" deterministically, the lessons store (ADR-0021) carries outcomes
across sessions, the kanban `task` tool (ADR-0025) is a durable place to park findings,
the task pipeline handles spec-sized work, and ADR-0017 established the read-only
`tools:`-allowlist agent pattern for heavy analysis with no write access.

## Decision

**A new `refactor-*` command group, shaped like the `sec-*` family and split by
mutation into a read → plan → apply progression. Reading never mutates; applying is
gated on proof of behaviour preservation.**

1. **Read side — `refactor-audit` and `refactor-smells` produce a numbered findings
   register.** `refactor-audit` is the whole-project structural audit: architecture
   map, hotspots (git churn × file size), dependency tangles, dead-code candidates —
   with the heavy reading delegated to a new **`marvin-refactor-auditor`** agent
   (read-only `tools:` allowlist `Read, Glob, Grep, Bash`, per the ADR-0017 pattern).
   `refactor-smells` is the scoped scan of a path, module, or diff: code smells,
   anti-patterns, idiom and naming inconsistencies. Both write reports to
   **`.marvin/refactor/`** (which joins the ADR-0007 working-directory table) as
   `NNN-audit-<slug>.md` / `NNN-smells-<slug>.md` — numeric-prefixed in creation order,
   mirroring the handoff/spec convention (ADR-0022).

2. **One register format, composable across commands.** Every finding is a register row:
   `F<n>` id, title, **severity** (`critical | high | medium | low | info` — the shared
   audit vocabulary), **effort** (`trivial | small | medium | large`), **evidence**
   (`file:line` locations — never a vibe), and a **suggested direction**. Ids are
   report-scoped; across reports a finding is referenced as
   `<report-file>#F<n>`. Because both commands emit the same shape, an audit register
   and any number of scoped smell registers compose into one backlog.

3. **`refactor-plan` turns selected findings into a sequenced, risk-annotated plan**
   (`.marvin/refactor/NNN-plan-<slug>.md`): each step small and behaviour-preserving,
   ordered by dependency and risk, with a verification point and a rollback note per
   step. **Items above a small-step threshold are routed to `task-start`** — the spec
   pipeline is the bridge for spec-sized work, not a rival: the plan step records the
   handoff and the spec takes over.

4. **`refactor-apply` executes exactly one small, behaviour-preserving step at a time,
   under hard rails:**
   - requires a **green `verify` before starting** (the baseline) and **re-runs
     `verify` after** (the behaviour-preservation proof at gate level);
   - **refuses to touch uncovered code** — when the code under the step has no test
     coverage, it offers to write the pin-down (characterization) test first and stops
     until one exists;
   - **consults the lessons store before and feeds it after** (ADR-0021): search for
     prior outcomes on the same area before editing; capture a lesson when the step
     taught something non-obvious.

5. **Findings can be filed to the kanban board.** The audit (and the smell scan) closes
   by offering to file selected findings as board chores via the existing `task` tool —
   the board is the durable memory for debt not acted on now. No new MCP tool is
   introduced: the read side is judgment work (prose skills + a read-only agent), and
   every deterministic need is already covered by existing tools (`verify`, `task`,
   `lessons`).

6. **A `RefactorFinding` zod contract joins the shared contracts** (ADR-0024 data-first
   staging): id, title, severity, effort, evidence locations, direction, source report.
   Data-only for now — the dashboard (planned ADR-0030) and the future widget family are
   the intended consumers; the skills keep emitting markdown registers that carry the
   same fields.

## Consequences

- **Deliberately slow.** One small step per `refactor-apply` invocation is the point —
  big-bang rewrites are out of scope by design (route to the task pipeline via
  `refactor-plan`, or to `migration-plan` for one large named move). `migration-plan`
  stays the single-shot planning instrument; `refactor-*` is the continuous loop
  (find → file → plan → apply).
- **Uncovered code cannot be refactored until it is pinned.** Accepted friction: the
  refusal converts the scariest class of refactoring accident into an explicit
  test-writing step.
- The register format is a **prose contract** shared by two skills (and consumed by
  WP5's plan); drift between the skills' formats would break composability, so both
  carry the identical format section — a known duplication, accepted because skills
  must stay self-sufficient through all three doors.
- `verify`-gating makes `refactor-apply` only as strong as the project's gates: on a
  project with no tests, the coverage refusal (not `verify`) is the load-bearing rail.
- Registry grows by two prompts now (audit, smells) and two more in WP5 (plan, apply);
  the agent roster gains `marvin-refactor-auditor`. Plugin version bumps minor.
- `.marvin/refactor/` reports are point-in-time artifacts; committing or gitignoring
  them stays the host owner's call, like the rest of `.marvin/` (ADR-0007).
