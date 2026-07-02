# ADR 0021 — Tool-backed lessons-learned feedback loop

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-22                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` working dir), [ADR-0010](0010-tool-backed-contract-seal.md) ("determinism by name"), [ADR-0002](0002-tool-backed-verification.md) (tool-backed gates), [ADR-0020](0020-debugger-agent.md) (the debugger is the first writer), `plugins/marvin/mcp/server/src/tools/lessons.ts` |

## Context

The task pipeline is strictly **forward-flowing**: DoR → implement → verify →
deliver. Spec content is immutable after DoR ([ADR-0003](0003-tool-backed-dor.md)),
and there was **no channel for execution experience to flow back** into future
work. The signals that *could* become learning all evaporated: a `⚠️ SPEC GAP`
and a skipped-critic flag are surfaced to the PR and then lost; `verification.md`
is consumed by the next gate in the same run; the debug skill's "Reflect" phase
produced lessons that went nowhere. The only retained learning was the maintainer
hand-authoring the next ADR.

Separately, every agent declared `memory: project` — a real Claude Code per-agent
native-memory field — but **no agent prompt ever read or wrote it**. It was an
inert declaration: a capability wired to nothing, and per-agent native memory is
siloed (one store per agent), discipline-dependent, and not guaranteed to fire in
a headless run.

## Decision

**Add a tool-backed, git-committed, team-shared lessons store, and wire it into
the pipeline as the first backward channel.**

- **Store.** `.marvin/memory/` — one typed lesson per markdown file
  (`type` ∈ `bug-pattern | gotcha | convention | pitfall | process`) plus a
  human-readable `MEMORY.md` index, under the unified `.marvin/` working dir
  ([ADR-0007](0007-marvin-working-directory.md)). Committed to git, so lessons are
  shared with the team on clone.
- **Tool.** A deterministic `lessons` MCP tool with `action: add | search`. The
  tool owns slugging, the date stamp, the index line, and keyword search — capture
  and recall are **tool calls, not model self-curation**. This is the same
  reasoning as [ADR-0010](0010-tool-backed-contract-seal.md): a guarantee a tool
  can perform deterministically should not depend on the model remembering to
  perform it ("determinism by name").
- **Capture (write) at two points.** `marvin-debugger` on reflect
  (`bug-pattern`, [ADR-0020](0020-debugger-agent.md)); `task-deliver`'s
  retrospective step (`gotcha`/`convention`/`pitfall`/`process`), guarded against
  boilerplate — a routine task that taught nothing writes nothing.
- **Recall (read) at one point.** `task-start` intake (Step 1.3) searches the
  store, so a relevant prior lesson becomes a constraint, a test to add, or a
  non-goal **before** the spec is drafted.
- **Reconcile the dead field.** Remove `memory: project` from all agents: the
  shared store is the single memory layer. Native per-agent memory can be
  re-enabled later if a need for agent-private notes emerges.

### Why a shared `.marvin/` store and a tool — not native memory, not CLAUDE.md

- **vs. native per-agent `memory:`** — lessons are cross-cutting (a bug pattern a
  debugger finds should inform the next *spec author*), so one shared store beats
  N per-agent silos; and deterministic tool capture beats per-agent auto-curation
  that nothing was actually doing.
- **vs. CLAUDE.md** — CLAUDE.md is durable, human-authored project doctrine;
  lessons are append-mostly, machine-captured experience with a different
  lifecycle. Mixing them would bloat the always-loaded context and blur curation.

## Consequences

### Positive

- The pipeline gains its **first feedback loop** — execution experience flows back
  into future specs instead of evaporating at the PR.
- Lessons are **team-shared** via git and **deterministically** captured/recalled.
- Agent frontmatter is honest again — no capability declared but unused.

### Negative / accepted trade-offs

- A new convention and directory to maintain, and search is **keyword-only** (no
  semantic ranking) — accepted: the store is small by design and stays scannable.
- Capture quality depends on the skill/agent choosing to record a *genuine*
  lesson; the guards ("skip routine tasks", "at most one or two") keep the store
  from filling with noise, but this is judgment, not a proof.
- As with the other tools, a headless run without the MCP tool falls back to
  appending the `MEMORY.md` index by hand — the same availability caveat.
