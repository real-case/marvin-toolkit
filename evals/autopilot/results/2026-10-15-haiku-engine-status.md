# Bench sandbox — haiku-engine-status (2026-10-15)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate, all runs: **91.7%** (11/12 files); ready 8/8; tier as expected 7/8
- Notional cost: **$12.74** (judge $0.05); wall time 87.7 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.52 | 6,294,618 | 8.3 min |
| clamp | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.44 | 6,679,073 | 12.5 min |
| slugify | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.37 | 5,994,385 | 9.5 min |
| slugify | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.35 | 5,096,057 | 8.7 min |
| csv-quotes | 1 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.98 | 3,882,688 | 8.2 min |
| csv-quotes | 2 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 1 in 1 | $2.16 | 6,636,655 | 10.7 min |
| duration | 1 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.86 | 8,635,384 | 13.4 min |
| duration | 2 | ready | standard / standard | 1/2 | green | 2 | 1 (0/1/0) | 0 in 0 | $2.06 | 7,200,421 | 16.5 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.69 (1) | — | $0.58 (1) | $0.17 (1) | $0.07 (1) |
| clamp | 2 | $0.81 (1) | — | $0.52 (1) | $0.08 (1) | $0.03 (1) |
| slugify | 1 | $0.73 (1) | — | $0.48 (1) | $0.13 (1) | $0.03 (1) |
| slugify | 2 | $0.83 (1) | — | $0.40 (1) | $0.10 (1) | $0.03 (1) |
| csv-quotes | 1 | $0.39 (1) | $0.15 (1) | $0.27 (1) | $0.14 (1) | $0.03 (1) |
| csv-quotes | 2 | $1.50 (2) | — | $0.43 (1) | $0.12 (1) | $0.10 (1) |
| duration | 1 | $1.03 (1) | $0.20 (2) | $0.47 (1) | $0.12 (1) | $0.04 (1) |
| duration | 2 | $1.13 (1) | $0.15 (1) | $0.35 (2) | $0.33 (2) | $0.11 (1) |

## Failing hidden tests

- duration #2: `test/duration.test.mjs` failed

## L3 comparison: haiku-engine-status against haiku-tier-guidance

**Decision: reject.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-tier-guidance (2026-10-12) | haiku-engine-status (2026-10-15) |
| Delivered runs | 8/8 | 8/8 |
| Hidden pass rate, delivered runs | 100.0% | 91.7% |
| Notional cost | $11.97 | $12.74 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 1/1, 1/1 |
| slugify | 1/1, 1/1 | 1/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 2/2 |
| duration | 2/2, 2/2 | 2/2, 1/2 |

- Pass rate held: no; rose, task by task: no
- Deliveries held: yes
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes

Reasons:
- hidden pass rate over delivered runs fell: 100.0% → 91.7%
