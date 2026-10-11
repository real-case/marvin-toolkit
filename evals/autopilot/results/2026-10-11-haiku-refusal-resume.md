# Bench sandbox — haiku-refusal-resume (2026-10-11)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate: **83.3%** (10/12 files); ready 7/8; tier as expected 6/8
- Notional cost: **$11.49** (judge $0.00); wall time 78.1 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.96 | 4,951,221 | 7.2 min |
| clamp | 2 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.22 | 5,778,589 | 9.4 min |
| slugify | 1 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.32 | 5,261,598 | 9.6 min |
| slugify | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.25 | 4,625,862 | 7.3 min |
| csv-quotes | 1 | ready | light / standard ✗ | 2/2 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.50 | 5,668,178 | 12.7 min |
| csv-quotes | 2 | done (bench: planner returned an unsealed spec) | — / standard ✗ | 0/2 | not green | 0 | 0 (0/0/0) | 0 in 0 | $1.94 | 4,035,977 | 7.5 min |
| duration | 1 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.66 | 7,652,509 | 12.4 min |
| duration | 2 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.65 | 7,317,362 | 12.0 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.39 (1) | — | $0.37 (1) | $0.11 (1) | $0.09 (1) |
| clamp | 2 | $0.64 (1) | — | $0.41 (2) | $0.12 (1) | $0.04 (1) |
| slugify | 1 | $0.76 (1) | — | $0.28 (2) | $0.14 (1) | $0.15 (1) |
| slugify | 2 | $0.68 (2) | — | $0.39 (1) | $0.15 (1) | $0.03 (1) |
| csv-quotes | 1 | $0.94 (1) | — | $0.32 (2) | $0.14 (1) | $0.10 (1) |
| csv-quotes | 2 | $1.91 (2) | — | — | — | $0.03 (1) |
| duration | 1 | $0.55 (1) | $0.15 (1) | $0.75 (1) | $0.15 (1) | $0.05 (1) |
| duration | 2 | $0.90 (1) | $0.11 (1) | $0.49 (1) | $0.12 (1) | $0.03 (1) |

## Failing hidden tests

- csv-quotes #2: `test/csv.test.mjs` failed
- csv-quotes #2: `test/report-quoted.test.mjs` failed

## L3 comparison: haiku-refusal-resume against haiku-baseline

**Decision: reject.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-baseline (2026-10-11) | haiku-refusal-resume (2026-10-11) |
| Hidden pass rate | 100.0% | 83.3% |
| Notional cost | $13.53 | $11.49 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 1/1, 1/1 |
| slugify | 1/1, 1/1 | 1/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 0/2 |
| duration | 2/2, 2/2 | 2/2, 2/2 |

- Pass rate held: no; rose: no
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes

Reasons:
- hidden pass rate fell: 100.0% → 83.3%
