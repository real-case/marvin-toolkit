# Bench sandbox — haiku-risk-callers (2026-10-12)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate, all runs: **91.7%** (11/12 files); ready 8/8; tier as expected 8/8
- Notional cost: **$11.29** (judge $0.00); wall time 86.6 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.20 | 5,507,155 | 7.6 min |
| clamp | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.55 | 2,416,025 | 4.6 min |
| slugify | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.25 | 4,830,420 | 9.8 min |
| slugify | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.18 | 4,721,783 | 7.6 min |
| csv-quotes | 1 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.62 | 6,342,968 | 18.3 min |
| csv-quotes | 2 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $2.31 | 10,065,681 | 19.8 min |
| duration | 1 | ready | standard / standard | 1/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $2.06 | 5,188,944 | 10.3 min |
| duration | 2 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.12 | 5,596,030 | 8.6 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.67 (1) | — | $0.41 (1) | $0.09 (1) | $0.03 (1) |
| clamp | 2 | $0.33 (1) | — | $0.11 (1) | $0.08 (1) | $0.03 (1) |
| slugify | 1 | $0.73 (1) | — | $0.39 (1) | $0.10 (1) | $0.03 (1) |
| slugify | 2 | $0.76 (1) | — | $0.30 (1) | $0.09 (1) | $0.03 (1) |
| csv-quotes | 1 | $0.40 (1) | $0.12 (1) | $0.77 (1) | $0.29 (1) | $0.03 (1) |
| csv-quotes | 2 | $0.93 (1) | $0.16 (1) | $0.95 (1) | $0.24 (1) | $0.03 (1) |
| duration | 1 | $1.34 (3) | $0.09 (1) | $0.41 (1) | $0.19 (1) | $0.03 (1) |
| duration | 2 | $0.38 (1) | $0.12 (1) | $0.41 (1) | $0.17 (1) | $0.03 (1) |

## Failing hidden tests

- duration #1: `test/duration.test.mjs` failed

## L3 comparison: haiku-risk-callers against haiku-tier-guidance

**Decision: reject.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-tier-guidance (2026-10-12) | haiku-risk-callers (2026-10-12) |
| Delivered runs | 8/8 | 8/8 |
| Hidden pass rate, delivered runs | 100.0% | 91.7% |
| Notional cost | $11.97 | $11.29 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 1/1, 1/1 |
| slugify | 1/1, 1/1 | 1/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 2/2 |
| duration | 2/2, 2/2 | 1/2, 2/2 |

- Pass rate held: no; rose, task by task: no
- Deliveries held: yes
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes

Reasons:
- hidden pass rate over delivered runs fell: 100.0% → 91.7%
