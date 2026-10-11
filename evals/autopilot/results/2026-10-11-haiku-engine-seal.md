# Bench sandbox — haiku-engine-seal (2026-10-11)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate: **83.3%** (10/12 files); ready 7/8; tier as expected 5/8
- Notional cost: **$9.11** (judge $0.00); wall time 64.1 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.12 | 4,780,888 | 7.4 min |
| clamp | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.72 | 3,389,811 | 5.4 min |
| slugify | 1 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.17 | 6,068,991 | 8.6 min |
| slugify | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.84 | 3,855,198 | 7.0 min |
| csv-quotes | 1 | ready | light / standard ✗ | 2/2 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.59 | 7,025,127 | 11.0 min |
| csv-quotes | 2 | done (bench: planner's spec fails the Definition of Ready) | — / standard ✗ | 0/2 | not green | 0 | 0 (0/0/0) | 0 in 0 | $0.81 | 2,341,361 | 4.5 min |
| duration | 1 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.10 | 5,059,375 | 8.6 min |
| duration | 2 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.77 | 8,054,986 | 11.7 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.37 (1) | — | $0.48 (1) | $0.16 (1) | $0.10 (1) |
| clamp | 2 | $0.31 (1) | — | $0.28 (1) | $0.09 (1) | $0.03 (1) |
| slugify | 1 | $0.39 (1) | — | $0.56 (2) | $0.10 (1) | $0.12 (1) |
| slugify | 2 | $0.24 (1) | — | $0.42 (1) | $0.15 (1) | $0.03 (1) |
| csv-quotes | 1 | $0.82 (1) | — | $0.54 (2) | $0.19 (1) | $0.04 (1) |
| csv-quotes | 2 | $0.70 (2) | — | — | — | $0.11 (1) |
| duration | 1 | $0.35 (1) | $0.16 (1) | $0.38 (1) | $0.18 (1) | $0.03 (1) |
| duration | 2 | $0.99 (1) | — | $0.62 (1) | $0.13 (1) | $0.03 (1) |

## Failing hidden tests

- csv-quotes #2: `test/csv.test.mjs` failed
- csv-quotes #2: `test/report-quoted.test.mjs` failed

## L3 comparison: haiku-engine-seal against haiku-baseline

**Decision: reject.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-baseline (2026-10-11) | haiku-engine-seal (2026-10-11) |
| Hidden pass rate | 100.0% | 83.3% |
| Notional cost | $13.53 | $9.11 |
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
