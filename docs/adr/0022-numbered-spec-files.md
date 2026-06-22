# ADR 0022 — Numeric-prefixed spec filenames

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-22                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` working dir), [ADR-0005](0005-portable-spec-contract.md) (host-adaptive spec location), [ADR-0003](0003-tool-backed-dor.md) (the `spec` DoR gate resolves `depends_on`), `plugins/marvin/skills/task-start/SKILL.md`, `plugins/marvin/mcp/server/src/tools/spec.ts` |

## Context

The `task-*` spec pipeline wrote each spec to `<spec-dir>/<slug>.md` — the slug as
the bare filename. Because the slug is a content-derived kebab string, a directory
listing of `.marvin/task/` sorted **alphabetically by topic**, not by the order
specs were created. There was no at-a-glance way to see which spec came first,
how many exist, or what the "next" one would be — the chronology that a reviewer,
the maintainer, or a future batch-dispatch run actually wants was invisible.

The repo already had a working precedent for ordered, file-per-item artifacts:
ADRs are `NNNN-<slug>.md` and the kanban tracker writes `NNN[-<tracker>]--<slug>.md`
with a sequence allocated deterministically by `nextSeq()` in
`storage/tasks.ts`. Specs were the odd domain out.

The constraint that made this non-trivial: the **slug is the spec's identity**,
not the filename. `depends_on` and `supersedes` reference siblings *by slug*; the
`spec` DoR gate resolves a `depends_on` entry by joining `<dir>/<slug>.md`;
`task-implement` / `task-deliver` / `task-verify` resolve a spec from a slug
argument or a `task/<slug>` branch name. Naively prefixing the filename with a
number would have broken every one of those exact-path lookups.

## Decision

**Write spec files with a zero-padded numeric ordering prefix — `<NNN>-<slug>.md` —
and make every slug→file lookup prefix-tolerant. The number is a filename-only
ordering affordance; the `slug` remains the immutable identity.**

1. **Allocation (creation side, `task-start`).** At finalize (Steps 9F/9B) the
   number is the **highest leading-integer prefix already present** in the chosen
   spec directory plus one, zero-padded to at least 3 digits (`001` when the dir
   is empty; a wider width is matched when the host dir already uses one, e.g. a
   4-digit RFC convention). Allocation is prose-driven by the model — consistent
   with the existing architecture, where the model writes the spec file and the
   `spec` tool only validates it. Specs are authored one at a time in an
   interactive dialogue, so a scan-max-plus-one allocation needs no atomicity
   guarantee.

2. **Identity stays the slug.** The number is **not** added to frontmatter and is
   **not** part of the `contract_sha`. The seal ([ADR-0010](0010-tool-backed-contract-seal.md))
   hashes the `spec-contract` block, so prefixing the filename leaves the seal,
   immutability, and `supersedes` chains untouched.

3. **Resolution (read side).** Slug→file lookup matches `^(\d+-)?<slug>\.md$` —
   an exact `<slug>.md` (legacy, unnumbered) is preferred, otherwise the first
   `<NNN>-<slug>.md`. The match is anchored on the *full* slug plus `.md`, so it
   is unambiguous even for slugs that themselves begin with digits. In the `spec`
   tool this is the `resolveSpecBySlug()` helper used by the `depends_on` gate; in
   the three `task-*` skills it is described in prose.

## Consequences

- `ls .marvin/task/` now reads top-to-bottom in creation order; the count and the
  next number are obvious at a glance.
- **Legacy specs keep working.** The `(\d+-)?` optional prefix means an existing
  un-numbered `<slug>.md` still resolves — no migration of in-flight specs is
  forced, and host repos that keep specs as bare slugs are unaffected.
- The convention is **not** mechanically enforced by the `spec` gate: a spec
  written without a prefix still passes DoR (the gate validates content and the
  slug, not the filename). Ordering is a workflow affordance, not a contract
  invariant — matching how ADR/kanban numbering is conventional rather than gated.
- Three numbering schemes now coexist by domain — ADRs (`NNNN-`), kanban
  (`NNN[-tracker]--`), specs (`NNN-`). They are deliberately distinct domains
  ([ADR-0001](0001-single-plugin-consolidation.md) keeps `task-*` and `kanban-*`
  separate); the shared idea is "a sortable integer prefix," not one shared format.
