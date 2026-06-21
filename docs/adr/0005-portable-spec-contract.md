# ADR 0005 — Portable, host-adaptive spec contract

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-14                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0003](0003-tool-backed-dor.md), [ADR-0004](0004-traceable-spec-contract.md), `plugins/marvin/skills/task-start/SKILL.md`, `plugins/marvin/mcp/server/src/tools/spec.ts`, `plugins/marvin/mcp/server/src/storage/frontmatter.ts` |

## Context

ADR-0003/0004 made the spec a tool-validated, traceable contract. But both were authored treating
**this** repository as the host: the gate, templates, and intake sweep assume marvin's own
scaffolding (`CLAUDE.md`, `VISION.md`, `specs/`, the committed-`dist` + version-triple merge
obligations) and a closed set of 5–6 stacks. `/marvin:task-start` ships in a plugin installed into
**foreign** codebases, where none of those hold. Auditing the Phase-1 → Phase-2 chain through that
lens surfaced two classes of defect.

1. **The gate fails open.** The `spec` tool parses the load-bearing structure — the File Change Plan
   and Acceptance Criteria tables — with substring-matched column headers over regex-split markdown.
   When a column is renamed or absent, the traceability check returns a single WARN, and the verdict
   is `PASS WITH WARNINGS` — a passing verdict — silently disabling the closed AC⇄files⇄tests graph
   that is the centrepiece of ADR-0004. The Interface/Contract code block is exempt from the
   placeholder check (so an unfilled `{signature}` ships), and a `verified_by` counts as a "real
   proof" if it is merely non-empty and not the literal word `prose-review`. In a foreign **headless**
   run, where the semantic critic is the first thing unavailable, the mechanical gate is the only
   arbiter — and it fails open exactly there.

2. **The command assumes the host instead of discovering it.** Output is hard-written to `specs/`;
   the Definition-of-Done template's examples are marvin's own (dist rebuild, version triple); stack
   and `test_command` detection is a closed 5–6-stack list; and existing host conventions (ADR/RFC
   layout, `CONTRIBUTING`, PR template, pre-commit config) are never read. The artefact clashes with,
   rather than conforms to, the host repository.

### The binding constraint

Two contracts were conflated:

- **Contract A** — `task-start` → `task-implement` / `marvin-tm-executor`. Internal to the plugin;
  legitimately strict in any repo, because marvin owns both ends.
- **Contract B** — the spec as an artefact living in the user's tree. Must adapt to the host:
  location, decision-record linkage, merge obligations, stack/gates.

ADR-0003/0004 made A strict but also baked host-specific assumptions into it, so the strictness
leaked into places the plugin does not own, while the parts that genuinely needed enforcing (the
traceability graph) failed open.

## Decision

Split the two contracts: make **A fail closed** and **B discovered**.

- **Fail closed.** The gate's load-bearing structure moves out of regex-parsed markdown tables into a
  single authoritative, schema-validated `spec-contract` YAML block (`files`, `criteria`,
  `build_order`, a typed `oracle`, `depends_on`). Real YAML parsing plus `zod` validation replace
  substring column matching: a missing field, a dangling cross-reference, an unfilled contract, or an
  all-`prose-review` proof set becomes a typed FAIL that no rename can bypass. The document
  frontmatter (identity + mutable lifecycle) stays as-is, and the hand-rolled frontmatter codec
  (`storage/frontmatter.ts`) is consolidated onto the same YAML parser.
- **Discover the host.** A `host-bindings` YAML block carries the spec location, the host's
  decision-record convention, merge obligations, and gate commands — all populated from a pre-draft
  discovery sweep (ADR/RFC directory, `CONTRIBUTING`, PR template, pre-commit) rather than assumed.
  Stack and `test_command` detection becomes open: detect by evidence, and an unknown stack is an
  Open Question, not a silent guess. The Definition-of-Done template is de-parochialised.
- **No compatibility window.** Legacy single-table specs FAIL with a migrate message (hard cutover);
  the format consumers (`task-implement`, `task-deliver`, `marvin-tm-executor`, `marvin-tm-spec-critic`,
  `marvin-tm-diff-critic`, `task-verify`) are updated in lock-step.
- **Coverage.** The intake sweep gains runtime dimensions — concurrency/idempotency, external-
  dependency failure/timeout, test-environment availability, cost/quota, new-dependency licence — and
  an **archetype router** (API / migration / CLI / library / UI / infra / AI) so questioning deepens
  by task shape instead of running one flat checklist.

### Phased rollout

| Milestone | Scope |
| --------- | ----- |
| **M1** | Gate **fail-closed on the current format** (this change: missing traceability columns and missing `breaking` → FAIL); open stack detection; discoverable output location |
| **M2** | `spec-contract` YAML block + `yaml` parser (frontmatter consolidated); **hard cutover**; format consumers in lock-step; the in-repo spec migrated |
| **M3** | `host-bindings` block + pre-draft host-convention discovery; `depends_on` sibling-status check |
| **M4** | Coverage dimensions + archetype router; immutability (contract hash + re-gate of the written file) |

This ADR is the umbrella decision; each milestone lands as its own PR referencing it. The defect
analysis and the full sequencing live with the PR series.

## Consequences

### Positive

- The strongest guarantee in the gate can no longer be disabled by a column rename; the gate is the
  sole arbiter in headless runs and now actually holds there.
- The plugin conforms to the host repository's conventions instead of imposing marvin's.
- Stacks beyond the blessed 5–6 are handled — detected or asked — not silently left unverified.
- Contract A's strictness and Contract B's adaptivity stop fighting: each lives in its own block.

### Negative / accepted trade-offs

- A new runtime dependency (`yaml`), bundled into `dist` — which surfaced the esbuild "Dynamic
  require of process is not supported" trap (yaml's CJS `require` in an ESM bundle); resolved with a
  `createRequire` banner in `tsup.config.ts`. ADR-0003's committed-`dist` + rebuild discipline
  continues, and DoR-logic changes still require a server rebuild. The frontmatter codec parses with
  the YAML **failsafe** schema so kanban task files keep string semantics (a round-trip test guards it).
- Hard cutover breaks pre-0007 specs with no auto-migration. Accepted: the only in-repo spec predates
  ADR-0004 and is a frozen, shipped historical record (`status: shipped`, never re-executed), so it
  stays as-is rather than being rewritten; the plugin has no external installed base of authored specs.
- More required structure raises the authoring bar for trivial specs — accepted for the same reason
  as ADR-0004: the pipeline targets headless dispatch, where under-specification dominates.
- The `spec` tool's (and now `yaml`'s) availability inside a headless `claude -p` run is still not
  guaranteed; `task-start` keeps the manual self-check fallback — now easier to eyeball against a
  YAML block than a regex-parsed table.
