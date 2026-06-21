# ADR 0011 — Tool-backed scope-allowlist gate

| Field         | Value                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                                                                                                 |
| Date          | 2026-06-16                                                                                                                              |
| Supersedes    | —                                                                                                                                       |
| Superseded by | —                                                                                                                                       |
| Related       | [ADR-0010](0010-tool-backed-contract-seal.md) (tool-backed seal), [ADR-0005](0005-portable-spec-contract.md) (the `files` allowlist), [ADR-0002](0002-tool-backed-verification.md) (tool-backed verify) |

## Context

The spec-contract `files` array is the authoritative allowlist of files an
implementation may touch (ADR-0005). `task-implement` enforced it in prose
("modify only the files in the spec's `files` list", "no scope expansion"), and
the `marvin-tm-diff-critic` agent reported scope-creep among its semantic
findings. But "is every changed file in the allowlist?" is pure set math —
`git diff --name-only` ⊆ `files[].path`. Leaving it to model discipline plus a
non-deterministic agent means an out-of-scope file can slip through (the model
forgets, or the critic is unavailable in a headless run). The mechanical check
should be deterministic; the agent should keep only the part that needs judgment.

## Decision

Add **`mode: "scope"`** to the `spec` tool. Given a spec (path/inline) and a
project root, it parses the contract block's `files`, computes the working-tree
change set (`git diff --name-only <base>` + untracked, default base `HEAD`), and
fails closed on any changed file outside the allowlist:

- diff ⊆ allowlist → **PASS**;
- out-of-scope files → **FAIL** (listed);
- not a git repo → **PASS WITH WARNINGS** (unchecked);
- malformed / absent contract → **FAIL**.

Two carve-outs keep it honest, not brittle:

- **`.marvin/` artifacts and the spec file are excluded** — marvin's own
  working-directory output is never "scope creep".
- **`allow: [...]` override** — a legitimately-discovered out-of-allowlist file is
  recorded as a SPEC GAP and passed in `allow`, so the gate fails _closed with an
  explicit, auditable override_ rather than silently blocking the SPEC GAP
  protocol.

`task-implement` (Step 6F) and `marvin-tm-executor` (§3) call it before the merge
point; `marvin-tm-diff-critic` keeps the _semantic_ half (is an in-allowlist
change _doing_ something out of scope?).

## Consequences

### Positive

- The allowlist is now mechanically enforced, with tests — not prompt discipline,
  and not dependent on the critic being available.
- Same pattern as ADR-0002 (verify), ADR-0003 (DoR), ADR-0010 (seal):
  deterministic gates around the non-deterministic implementation step.
- The `allow` valve keeps the SPEC GAP protocol working — discoveries are
  explicit and auditable, not silent.

### Negative / accepted trade-offs

- The `spec` tool now runs `git` (a new side-effecting dependency for one mode);
  it degrades to PASS WITH WARNINGS outside a repo.
- The change set is the working-tree diff vs `base` (default `HEAD`) — a flow that
  commits mid-task must pass the task base branch as `base` to capture committed
  changes.
- This is the mechanical half only; semantic scope creep (an allowed file misused)
  remains the critic's job.
- One gate of the original three remains in prose — the delivery-verdict gate
  (`task-deliver` parsing `verification.md`) — a candidate for the same treatment.
