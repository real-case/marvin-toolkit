# ADR 0010 — Tool-backed contract-seal verification

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status        | **Accepted** (solo maintainer sign-off)                                                                                                          |
| Date          | 2026-06-16                                                                                                                                       |
| Supersedes    | —                                                                                                                                                |
| Superseded by | —                                                                                                                                                |
| Related       | [ADR-0003](0003-tool-backed-dor.md) (tool-backed DoR), [ADR-0005](0005-portable-spec-contract.md) (M4 — the `contract_sha` seal), [ADR-0002](0002-tool-backed-verification.md) (tool-backed verify) |

## Context

ADR-0005 M4 (alpha.10) introduced `contract_sha`: the `spec` tool stamps a SHA-256
fingerprint of the spec-contract block into the spec frontmatter at DoR time, so later
tampering of the immutable contract is detectable by re-hashing. The _stamping_ is
deterministic — the tool computes it. But the _check_ was prose. `task-implement` Step 2
read:

> **Immutability check** — if the frontmatter carries `contract_sha`, re-hash the
> `spec-contract` block (SHA-256, first 16 hex of the trimmed block) and compare.

That instruction asks the **model** to compute a SHA-256 by hand. An LLM cannot do this
reliably — it will hallucinate a plausible digest or skip the step. The seal was therefore
_deterministic to stamp but non-deterministic to verify_: the tamper gate it promised
existed only on paper. This is the **"determinism by name"** anti-pattern — a guarantee
whose enforcement depends on the model performing an operation it cannot perform.

## Decision

Move the seal check from prose into the `spec` tool as **`mode: "seal"`**. Given a spec
(path or inline), it parses the frontmatter, extracts the spec-contract block, recomputes
the hash with the **same `contractHash` function the DoR gate uses to stamp**, and
compares:

- match → **PASS** (seal intact);
- mismatch → **FAIL** (`TAMPERED` — block edited after sealing);
- no `contract_sha` stamped → **PASS WITH WARNINGS** (unsealed — nothing to verify);
- no contract block → **FAIL**.

`task-implement` Step 2 now calls `spec` with `mode: "seal"` instead of asking the model to
hash; `task-start`'s description of the check is updated to match. Reusing `contractHash`
means stamp and verify can never drift.

## Consequences

### Positive

- The tamper gate is now real: a deterministic comparison in code, with tests, not prompt
  discipline.
- Stamp and verify share one hashing function — no algorithm drift between sealing and
  checking.
- Same pattern as ADR-0002 (verify) and ADR-0003 (DoR): load-bearing control-flow
  guarantees live in tools, not prose.

### Negative / accepted trade-offs

- Another `spec`-tool mode to maintain; precedence and behaviour are documented.
- The check depends on the tool being available; `task-implement` falls back to reporting
  the spec **unverified** (never guessing a hash) when it is not.
- Two further prose checks remain in the same family — the file-allowlist **scope gate**
  and the **delivery-verdict** gate — and are candidates for the same treatment; this ADR
  covers only the seal.
