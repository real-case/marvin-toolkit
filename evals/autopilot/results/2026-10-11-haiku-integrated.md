# Bench sandbox — haiku-integrated (2026-10-11)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate: **58.3%** (7/12 files); ready 5/8; tier as expected 3/8
- Notional cost: **$7.74** (judge $0.00); wall time 51.6 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.30 | 5,570,238 | 9.4 min |
| clamp | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.89 | 4,641,728 | 6.4 min |
| slugify | 1 | done (bench: planner returned an unsealed spec) | — / light ✗ | 0/1 | not green | 0 | 0 (0/0/0) | 0 in 0 | $0.75 | 2,179,616 | 3.2 min |
| slugify | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $0.72 | 3,318,417 | 5.1 min |
| csv-quotes | 1 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.28 | 4,230,235 | 9.6 min |
| csv-quotes | 2 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.37 | 5,594,334 | 11.7 min |
| duration | 1 | done (bench: planner returned an unsealed spec) | — / standard ✗ | 0/2 | not green | 0 | 0 (0/0/0) | 0 in 0 | $0.66 | 1,947,746 | 3.3 min |
| duration | 2 | done (bench: planner returned an unsealed spec) | — / standard ✗ | 0/2 | not green | 0 | 0 (0/0/0) | 0 in 0 | $0.77 | 2,223,516 | 3.0 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.80 (1) | — | $0.36 (1) | $0.11 (1) | $0.03 (1) |
| clamp | 2 | $0.32 (1) | — | $0.45 (1) | $0.09 (1) | $0.03 (1) |
| slugify | 1 | $0.72 (2) | — | — | — | $0.03 (1) |
| slugify | 2 | $0.30 (1) | — | $0.27 (1) | $0.12 (1) | $0.03 (1) |
| csv-quotes | 1 | $0.63 (2) | — | $0.37 (1) | $0.23 (1) | $0.03 (1) |
| csv-quotes | 2 | $0.75 (1) | — | $0.40 (1) | $0.19 (1) | $0.03 (1) |
| duration | 1 | $0.62 (2) | — | — | — | $0.04 (1) |
| duration | 2 | $0.74 (2) | — | — | — | $0.03 (1) |

## Failing hidden tests

- slugify #1: `test/slugify.test.mjs` failed
- duration #1: `test/duration.test.mjs` failed
- duration #1: `test/duration-cli.test.mjs` failed
- duration #2: `test/duration.test.mjs` failed
- duration #2: `test/duration-cli.test.mjs` failed

## L3 comparison: haiku-integrated against haiku-baseline

**Decision: reject.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-baseline (2026-10-11) | haiku-integrated (2026-10-11) |
| Hidden pass rate | 100.0% | 58.3% |
| Notional cost | $13.53 | $7.74 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 1/1, 1/1 |
| slugify | 1/1, 1/1 | 0/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 2/2 |
| duration | 2/2, 2/2 | 0/2, 0/2 |

- Pass rate held: no; rose: no
- Regressed in every repeat: duration
- Cost within 1.15 × baseline: yes

Reasons:
- hidden pass rate fell: 100.0% → 58.3%
- regressed in every repeat: duration
