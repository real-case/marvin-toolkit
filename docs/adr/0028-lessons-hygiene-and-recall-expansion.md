# ADR 0028 — Lessons v2: hygiene surface and recall/capture expansion

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-07-02                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0021](0021-lessons-feedback-loop.md) (the store and tool this extends), [ADR-0020](0020-debugger-agent.md) (the first writer), [ADR-0023](0023-pr-command-family.md) (`task-fix-pr` → `pr-resolve`), [ADR-0024](0024-mcp-apps-widget-architecture.md) (shared data contracts), [ADR-0026](0026-configurable-status-model.md) (the per-key counts doctrine), `plugins/marvin/mcp/server/src/tools/lessons.ts` |

## Context

[ADR-0021](0021-lessons-feedback-loop.md) gave the pipeline its first backward
channel: a git-committed `.marvin/memory/` store behind a deterministic
`lessons` tool (`add | search`), captured at two points (`marvin-debugger` on
reflect, `task-deliver`'s retrospective) and recalled at one (`task-start`
intake). The toolbox-expansion inventory (2026-07) found the loop lopsided:

1. **Recall was too narrow.** Only the *spec author* looked back. The flows
   that actually write code — `task-implement`, `sec-fix`, the headless
   `marvin-tm-executor`, and `marvin-tm-review-fixer` — never consulted the
   store, so a captured gotcha informed the next spec but not the hands that
   typed the next fix.
2. **Capture missed the PR-review channel.** A reviewer flagging the same
   class of mistake across threads is exactly the "recurring pattern" signal
   ADR-0021 wants persisted, yet the resolve flow recorded nothing.
3. **The store had no hygiene surface.** No counts, no way to remove a stale
   or duplicated lesson short of hand-editing two files in sync (the lesson
   file *and* its `MEMORY.md` index line), and `add` happily wrote the same
   lesson twice — `uniqueSlug` deduplicates *filenames* (`foo`, `foo-2`), not
   *content*, so repeated captures silently accumulate as near-copies.
4. **No human door.** Search, add, and any future maintenance were reachable
   only by driving the tool by name; every other tool-backed surface has a
   `/marvin:*` prompt.

A naming correction is recorded here: the expansion plan named `task-fix-pr`
as the new capture point, but [ADR-0023](0023-pr-command-family.md) had
already renamed that command — its successor is **`pr-resolve`**, and that is
where the capture step lives.

## Decision

**Widen the ADR-0021 loop on both ends and give the store a maintenance
surface. The storage model and keyword search stay exactly as built.**

1. **Recall expands from one point to four.** A search-first step is added to
   `task-implement` (pre-flight, next to reading the spec and CLAUDE.md),
   `sec-fix` (intake, after parsing the finding), and the two code-writing
   agents (`marvin-tm-executor` reads the store as part of Read Spec;
   `marvin-tm-review-fixer` as part of loading PR context). Each is a small
   prose step calling `lessons` `search` with keywords from the work at hand;
   a hit is a constraint on the implementation, not a suggestion. Degradation
   stays the ADR-0021 caveat — skim `MEMORY.md` directly, or skip silently in
   a headless run without the tool. (`refactor-apply` joins this list when the
   refactor family lands, ADR-0029.)
2. **Capture adds the PR-review channel.** `pr-resolve` gains a retrospective
   step with the same anti-boilerplate guards ADR-0021 gives `task-deliver`:
   routine feedback — typos, one-off nits — writes **nothing**; a lesson is
   captured only when the review reveals a recurring pattern, an unknown
   convention, or a repeated reviewer expectation; **at most one or two** per
   resolve pass, `source: "PR #<n>"`.
3. **Hygiene lives in the tool, not in model discipline** (the ADR-0010
   "determinism by name" reasoning, again):
   - **`stats`** — counts by type and by tag, returned as text *and* as
     `structuredContent` conforming to a new shared `LessonsStats` contract
     (ADR-0024 data-first staging; the planned dashboard consumes it). The
     closed type taxonomy is emitted per key even at 0 — the per-key counts
     doctrine of [ADR-0026](0026-configurable-status-model.md); tags are an
     open vocabulary, so only occurring tags appear.
   - **`prune`** — with no argument it *lists* candidates (lessons older than
     180 days; near-duplicate title pairs) and deletes nothing. Deleting takes
     an explicit `slug` **and** explicit confirmation: an elicitation form on
     capable hosts, `confirm: true` elsewhere (the `archive`-action pattern).
     Deletion removes the lesson file *and* its `MEMORY.md` index line in one
     operation, so the pair can never drift.
   - **Near-duplicate guard on `add`** — the tool searches before writing:
     a title that slug-collides with, or has high word overlap with, an
     existing lesson answers with a warning naming the existing slug
     **instead of writing**; `force: true` overrides deliberately. Capture
     flows are thereby idempotent-ish by default and double-writes become an
     explicit choice.
4. **Browse surface.** A `/marvin:lessons` prompt — an inline-body thin
   wrapper in the kanban style — maps chat asks onto
   `search | add | stats | prune`, so humans drive the store without knowing
   the tool's argument names.
5. **Keyword search stays; no embeddings.** The similarity used by the dedup
   guard and the duplicate lister is deterministic word overlap on titles —
   cheap, explainable, and sufficient because the store is *small by design*
   (ADR-0021), and `prune` now actively keeps it that way.

## Consequences

### Positive

- The feedback loop now reaches **every write path**: spec authoring, feature
  implementation, security fixes, headless execution, and review resolution
  all recall before writing code, and both delivery and review-resolution
  capture after.
- The store is **maintainable without hand-editing**: counts, a candidate
  list, and a guarded delete that keeps file and index consistent.
- The dashboard's lessons feed is ready as a typed contract before any widget
  exists — the ADR-0024 staging discipline.

### Negative / accepted trade-offs

- The dedup guard is a **heuristic** (title word overlap): a false positive
  costs one retry with `force: true`; a false negative degrades to today's
  behavior. Accepted — the guard warns, it never blocks silently.
- Stale-candidate age (180 days) is a judgment constant, not project
  configuration, and `prune` only ever *lists* — a human decides what dies.
  Config-driven thresholds can come later if a real need appears.
- Capture quality still depends on the skill choosing a *genuine* lesson —
  the guards are prose, not proofs (unchanged from ADR-0021).
- More wiring points to keep in sync (four recall sites, two capture sites) —
  mitigated by every site delegating to the same tool with the same
  degradation caveat, so a change to the store touches one module.
