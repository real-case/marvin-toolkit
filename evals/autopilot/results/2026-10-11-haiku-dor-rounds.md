# Bench sandbox — haiku-dor-rounds (2026-10-11)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate, all runs: **100.0%** (12/12 files); ready 8/8; tier as expected 5/8
- Notional cost: **$10.75** (judge $0.07); wall time 78.8 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.08 | 3,974,802 | 7.6 min |
| clamp | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.87 | 4,628,152 | 5.7 min |
| slugify | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.44 | 6,193,113 | 10.0 min |
| slugify | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.56 | 8,719,856 | 11.0 min |
| csv-quotes | 1 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.10 | 5,332,647 | 8.6 min |
| csv-quotes | 2 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.24 | 5,750,921 | 10.3 min |
| duration | 1 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.35 | 5,039,162 | 8.3 min |
| duration | 2 | ready | standard / standard | 2/2 | green | 2 | 0 (0/0/0) | 0 in 1 | $2.11 | 9,120,747 | 17.2 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.58 (1) | — | $0.39 (1) | $0.09 (1) | $0.03 (1) |
| clamp | 2 | $0.31 (1) | — | $0.46 (1) | $0.08 (1) | $0.03 (1) |
| slugify | 1 | $0.84 (1) | — | $0.48 (1) | $0.09 (1) | $0.03 (1) |
| slugify | 2 | $0.98 (2) | — | $0.44 (1) | $0.10 (1) | $0.04 (1) |
| csv-quotes | 1 | $0.37 (1) | — | $0.49 (1) | $0.20 (1) | $0.03 (1) |
| csv-quotes | 2 | $0.42 (1) | — | $0.50 (1) | $0.28 (1) | $0.03 (1) |
| duration | 1 | $0.66 (2) | — | $0.45 (1) | $0.16 (1) | $0.08 (1) |
| duration | 2 | $0.68 (1) | $0.26 (2) | $0.83 (2) | $0.13 (1) | $0.21 (1) |

## L3 comparison: haiku-dor-rounds against haiku-baseline

**Decision: accept.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-baseline (2026-10-11) | haiku-dor-rounds (2026-10-11) |
| Delivered runs | 7/8 | 8/8 |
| Hidden pass rate, delivered runs | 100.0% | 100.0% |
| Notional cost | $13.53 | $10.75 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 1/1, 1/1 |
| slugify | 1/1 (not delivered), 1/1 | 1/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 2/2 |
| duration | 2/2, 2/2 | 2/2, 2/2 |

- Pass rate held: yes; rose, task by task: no
- Deliveries held: yes
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes
