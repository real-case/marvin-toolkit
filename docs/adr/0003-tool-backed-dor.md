# ADR 0003 — Tool-backed Definition-of-Ready gate

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-13                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0002](0002-tool-backed-verification.md), `plugins/marvin/skills/task-start/SKILL.md`, `plugins/marvin/mcp/server/src/tools/spec.ts` |

## Context

`/marvin:task-start` produced a spec, then passed it through a **Definition-of-Ready (DoR)
checklist written as prose** — a list of `- [ ]` items the model ticked off by re-reading its
own draft. The independent check, `marvin-tm-spec-critic`, is **advisory and skippable** (it is
skipped when Task-tool is unavailable). So in the common path the only gate between a draft and
dispatch was a self-assessment run by the same context that wrote the spec — exactly the
confirmation bias the critic exists to counter.

The spec format compounded this. Only `Type:` and `Status:` were semi-machine-readable; the rest
was free-form prose with loosely-matched section names. Two specs could be structured differently
and both "pass". Meanwhile Phase 2 (`task-implement` / `marvin-tm-executor`) treats the spec as a
**complete instruction set** — "modify only the files the spec lists", "implement exactly what it
says". Nothing mechanically guaranteed the spec actually carried what Phase 2 depends on: an
authoritative file allowlist, a testable proof bound to each acceptance criterion, no unresolved
open questions, no half-filled template.

### The binding constraint

This is the same class of problem ADR-0002 identified for verification: a guarantee expressed as
prose holds only by the model's run-time discipline. "Every acceptance criterion is testable" and
"affected files are identified" are checkable properties — but a markdown checklist cannot enforce
them, and a self-grading author is the worst-positioned reader to catch what is missing.

## Decision

Move the **checkable** part of the DoR out of prose into a deterministic MCP tool, `spec`, in the
`marvin` server — and give the spec a structured format the tool can validate.

- **New spec format.** Real YAML frontmatter (lowercase keys: `slug`, `type`, `status`, `created`,
  `tracker`, `supersedes`, verified `stack`, `risk`/`severity`, discovered `test_command`) plus
  required sections. The **File Change Plan** is a table that is the *authoritative allowlist* of
  files Phase 2 may touch. **Acceptance Criteria** are a table where every row carries a
  `verified_by` proof. New required sections — Interface/Contract, Data & Config, Test Plan,
  Assumptions, Open Questions, Security/NFR — force the author to address the engineering contract
  (or write an explicit "N/A").
- **The `spec` tool** validates: required frontmatter keys + valid enums, all required sections
  present, the File Change Plan parses and its `edit`/`delete` targets exist on disk, ≥3 (feature)
  / ≥2 (bugfix) acceptance criteria each with a non-empty `verified_by`, Open Questions resolved to
  "none", and no leftover `{…}` placeholders. It returns `PASS` / `PASS WITH WARNINGS` / `FAIL`
  with a per-check breakdown and a machine-readable `spec-result` block.
- **`task-start` Step 8 runs the tool as the gate.** On `FAIL` it loops back; it never writes the
  spec. The human-judgment items the tool cannot assess (is the goal specific? is each
  `verified_by` *genuine*? does it contradict VISION.md?) remain a short checklist, and the
  semantic critic (`marvin-tm-spec-critic`) remains the complement — it judges meaning, the tool
  proves shape.
- **Lifecycle.** `status` moves `draft → ready → in-progress → shipped | superseded`
  (`task-implement` sets `in-progress`; `task-deliver` sets `shipped` and appends a `## Delivery`
  section). After DoR the spec's **content is immutable**; `status` and the appended Delivery
  section are the only mutable parts. Content changes require a new spec whose `supersedes:` points
  at the old one.

## Consequences

### Positive

- Spec completeness is a property checked by code with unit tests, not a self-graded checklist.
- The file allowlist and per-criterion proof (`verified_by`) are first-class and validated — the
  two largest sources of headless `⚠️ SPEC GAP`s become DoR failures instead.
- `stack` and `test_command` are captured and verified in Phase 1, so Phase 2 stops re-deriving
  them (same latency motive as ADR-0002).
- `status` lifecycle makes a shipped or superseded spec un-runnable, preventing accidental re-dispatch.

### Negative / accepted trade-offs

- The spec format changed: frontmatter keys are now lowercase YAML, and the format consumers
  (`task-implement`, `task-deliver`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `task-verify`)
  were updated in lock-step. Pre-existing specs predate the format and are **not** auto-migrated;
  the gate runs on specs authored under the new flow.
- The tool checks **shape, not semantics** — a non-empty `verified_by` can still be a bad proof.
  Mitigated by keeping the critic and the judgment checklist; the tool narrows, it does not replace
  judgment.
- DoR-logic changes now require a server rebuild and committed `dist/` (was a prose edit), and the
  `spec` tool's availability inside a headless `claude -p` run is not guaranteed — `task-start`
  falls back to a manual self-check and records the degradation, the same mitigation ADR-0002 uses.
