# ADR 0014 — Tool-backed delivery gate

| Field         | Value                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Status        | **Accepted** (solo maintainer sign-off)                                                                                              |
| Date          | 2026-06-16                                                                                                                          |
| Supersedes    | —                                                                                                                                   |
| Superseded by | —                                                                                                                                   |
| Related       | [ADR-0004](0004-tool-backed-verification.md) (the verify tool / `verification.md`), [ADR-0012](0012-tool-backed-contract-seal.md) (seal), [ADR-0013](0013-tool-backed-scope-gate.md) (scope) |

## Context

ADR-0004's `verify` tool writes `verification.md` with a machine-readable
`verify-result` block (verdict + per-gate status). But `task-deliver`'s pre-flight
read that verdict in _prose_: "Check `verification.md`… if the verdict is FAIL,
stop." The model decided whether to proceed by eyeballing the report — it can
misread a verdict, or proceed on a FAIL. The delivery refusal — the whole point of
the pipeline's last gate — depended on model discipline, even though the verdict
was already a machine-readable field sitting in the artifact.

## Decision

Add **`action: "gate"`** to the `verify` tool. Instead of running gates, it reads
`.marvin/task/verification.md`, parses the `verify-result` block, and returns a
`deliver-gate` decision:

- **ALLOW** — verdict PASS or PASS WITH WARNINGS;
- **BLOCK** — verdict FAIL, missing file, or an absent / unparseable verdict
  (`isError` is set on BLOCK).

`task-deliver` Step 1 calls it instead of reading the prose. Because the same tool
**writes and reads** the `verify-result` format, the delivery decision cannot drift
from what verify recorded.

## Consequences

### Positive

- The delivery refusal is now deterministic — a parsed field, not a prose read.
- Write and read share one format (the verify tool owns both) → no drift, the same
  property that makes the seal gate sound (ADR-0012).
- Completes the trio of implementation-time gates moved from prose to tools: seal
  (ADR-0012), scope (ADR-0013), delivery (this one).

### Negative / accepted trade-offs

- The gate trusts the recorded verdict; it does not re-check freshness (whether
  code changed since verify ran). In the chained task-implement → verify → deliver
  flow the verdict is fresh; a standalone deliver after further edits should re-run
  verify first. A freshness check (`verification.md` vs working-tree mtime) is a
  possible future enhancement.
- `task-deliver` keeps a prose fallback for when the tool is unavailable, refusing
  on FAIL / missing — never delivering unverified.
