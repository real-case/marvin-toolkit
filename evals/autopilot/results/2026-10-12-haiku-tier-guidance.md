# Bench sandbox — haiku-tier-guidance (2026-10-12)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate, all runs: **100.0%** (12/12 files); ready 8/8; tier as expected 7/8
- Notional cost: **$11.97** (judge $0.00); wall time 92.0 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.45 | 5,523,959 | 9.1 min |
| clamp | 2 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $0.91 | 4,441,622 | 6.8 min |
| slugify | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.24 | 4,300,933 | 8.2 min |
| slugify | 2 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.18 | 6,385,769 | 9.1 min |
| csv-quotes | 1 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.83 | 7,635,349 | 14.7 min |
| csv-quotes | 2 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.89 | 7,030,866 | 16.0 min |
| duration | 1 | ready | standard / standard | 2/2 | green | 2 | 1 (1/0/0) | 0 in 0 | $2.09 | 10,576,236 | 17.1 min |
| duration | 2 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.38 | 6,814,044 | 11.0 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.75 (1) | — | $0.47 (1) | $0.16 (1) | $0.07 (1) |
| clamp | 2 | $0.31 (1) | — | $0.48 (2) | $0.08 (1) | $0.04 (1) |
| slugify | 1 | $0.56 (1) | — | $0.43 (1) | $0.17 (1) | $0.07 (1) |
| slugify | 2 | $0.46 (1) | — | $0.48 (2) | $0.12 (1) | $0.11 (1) |
| csv-quotes | 1 | $1.02 (1) | — | $0.59 (1) | $0.19 (1) | $0.03 (1) |
| csv-quotes | 2 | $1.05 (1) | $0.17 (1) | $0.41 (1) | $0.19 (1) | $0.08 (1) |
| duration | 1 | $0.85 (2) | $0.16 (1) | $0.64 (2) | $0.23 (1) | $0.20 (1) |
| duration | 2 | $0.50 (1) | $0.14 (1) | $0.52 (1) | $0.14 (1) | $0.09 (1) |

## L3 comparison: haiku-tier-guidance against haiku-dor-rounds

**Decision: accept.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-dor-rounds (2026-10-11) | haiku-tier-guidance (2026-10-12) |
| Delivered runs | 8/8 | 8/8 |
| Hidden pass rate, delivered runs | 100.0% | 100.0% |
| Notional cost | $10.75 | $11.97 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 1/1, 1/1 |
| slugify | 1/1, 1/1 | 1/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 2/2 |
| duration | 2/2, 2/2 | 2/2, 2/2 |

- Pass rate held: yes; rose, task by task: no
- Deliveries held: yes
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes
