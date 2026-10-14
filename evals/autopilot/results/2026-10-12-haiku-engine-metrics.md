# Bench sandbox — haiku-engine-metrics (2026-10-12)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate, all runs: **75.0%** (9/12 files); ready 7/8; tier as expected 7/8
- Notional cost: **$11.35** (judge $0.06); wall time 72.8 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.81 | 2,617,231 | 4.4 min |
| clamp | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.68 | 7,773,052 | 10.9 min |
| slugify | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.83 | 4,191,757 | 7.1 min |
| slugify | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.18 | 4,388,338 | 6.9 min |
| csv-quotes | 1 | ready | standard / standard | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.50 | 6,511,224 | 11.4 min |
| csv-quotes | 2 | done (bench: planner's spec fails the Definition of Ready) | — / standard ✗ | 0/2 | not green | 0 | 0 (0/0/0) | 0 in 0 | $2.21 | 5,582,988 | 7.1 min |
| duration | 1 | ready | standard / standard | 2/2 | green | 2 | 0 (0/0/0) | 0 in 1 | $1.36 | 6,413,893 | 12.0 min |
| duration | 2 | ready | standard / standard | 1/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.79 | 7,439,409 | 12.9 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.26 (1) | — | $0.34 (1) | $0.13 (1) | $0.07 (1) |
| clamp | 2 | $1.01 (1) | — | $0.47 (1) | $0.10 (1) | $0.09 (1) |
| slugify | 1 | $0.39 (1) | — | $0.30 (1) | $0.12 (1) | $0.03 (1) |
| slugify | 2 | $0.67 (2) | — | $0.35 (1) | $0.14 (1) | $0.03 (1) |
| csv-quotes | 1 | $0.31 (1) | $0.17 (1) | $0.48 (1) | $0.22 (1) | $0.31 (2) |
| csv-quotes | 2 | $2.09 (3) | — | — | — | $0.12 (1) |
| duration | 1 | $0.36 (1) | $0.20 (2) | $0.61 (2) | $0.15 (1) | $0.04 (1) |
| duration | 2 | $0.94 (1) | $0.10 (1) | $0.51 (1) | $0.20 (1) | $0.03 (1) |

## Failing hidden tests

- csv-quotes #2: `test/csv.test.mjs` failed
- csv-quotes #2: `test/report-quoted.test.mjs` failed
- duration #2: `test/duration.test.mjs` failed

## L3 comparison: haiku-engine-metrics against haiku-tier-guidance

**Decision: reject.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-tier-guidance (2026-10-12) | haiku-engine-metrics (2026-10-12) |
| Delivered runs | 8/8 | 7/8 |
| Hidden pass rate, delivered runs | 100.0% | 90.0% |
| Notional cost | $11.97 | $11.35 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 1/1, 1/1 |
| slugify | 1/1, 1/1 | 1/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 0/2 (not delivered) |
| duration | 2/2, 2/2 | 2/2, 1/2 |

- Pass rate held: no; rose, task by task: no
- Deliveries held: no
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes

Reasons:
- hidden pass rate over delivered runs fell: 100.0% → 90.0%
- delivered runs fell: 8/8 → 7/8
