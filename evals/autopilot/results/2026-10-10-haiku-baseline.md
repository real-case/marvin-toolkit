# Bench sandbox — haiku-baseline (2026-10-10)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, csv-quotes; repeats: 1
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate: **100.0%** (3/3 files); ready 2/2; tier as expected 1/2
- Notional cost: **$2.85** (judge $0.00); wall time 20.9 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.31 | 4,970,190 | 9.3 min |
| csv-quotes | 1 | ready | light / standard ✗ | 2/2 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.54 | 7,807,337 | 11.6 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.72 (1) | — | $0.40 (1) | $0.13 (1) | $0.08 (1) |
| csv-quotes | 1 | $0.60 (2) | — | $0.66 (2) | $0.19 (1) | $0.09 (1) |

## Acceptance notes

The Task 21 acceptance run: a 2-task subset (one light, one standard), `--repeat 1` (accepted for
acceptance; the L3 gate needs 2), every child and the judge on Haiku through
`MARVIN_PIPELINE_MODEL_OVERRIDE=haiku` under `MARVIN_PIPELINE_SANDBOX=1`. No child asked a
question, so the `llm` judge was never called (judge cost $0.00). The comparison below is the
result against itself, made with `marvin-pipe bench-compare`: it shows the gate's three clauses
passing and its refusal to decide on one repeat.

- **clamp**: the planner chose `risk: low`, tier `light` as expected; one executor iteration, verifier PASS, 1/1 hidden test file.
- **csv-quotes**: the planner also chose `risk: low`, so the run went `light` where the suite expects `standard`, and no sealed tests were written. The first planner session returned `spec_ready` before its spec carried a contract and was retried as a crash; executor 1 was rejected by the gate for leaving the spec and the metrics record uncommitted; executor 2 passed gates and the verifier; 2/2 hidden test files.

## L3 comparison: haiku-baseline against haiku-baseline

**Decision: inconclusive.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-baseline (2026-10-10) | haiku-baseline (2026-10-10) |
| Hidden pass rate | 100.0% | 100.0% |
| Notional cost | $2.85 | $2.85 |
| Repeats | 1 | 1 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1 | 1/1 |
| csv-quotes | 2/2 | 2/2 |

- Pass rate held: yes; rose: no
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes

Reasons:
- baseline ran clamp 1× (needs 2)
- baseline ran csv-quotes 1× (needs 2)
- candidate ran clamp 1× (needs 2)
- candidate ran csv-quotes 1× (needs 2)
