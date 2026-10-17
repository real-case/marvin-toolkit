# Bench sandbox — haiku-seal-fix (2026-10-11)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate: **75.0%** (9/12 files); ready 5/8; tier as expected 4/8
- Notional cost: **$11.38** (judge $0.00); wall time 87.2 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | done (bench: planner crashed) | — / light ✗ | 0/1 | not green | 0 | 0 (0/0/0) | 0 in 0 | $0.99 | 3,254,818 | 6.9 min |
| clamp | 2 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $0.93 | 4,592,777 | 7.1 min |
| slugify | 1 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.41 | 7,076,721 | 10.8 min |
| slugify | 2 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.21 | 5,194,284 | 8.9 min |
| csv-quotes | 1 | ready | light / standard ✗ | 2/2 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.96 | 9,218,634 | 14.4 min |
| csv-quotes | 2 | done (bench: executor returned invalid output (dispute: done must not carry a dispute)) | standard / standard | 2/2 | green | 3 | 2 (1/1/0) | 0 in 0 | $2.30 | 9,593,321 | 19.4 min |
| duration | 1 | done (bench: planner crashed) | — / standard ✗ | 0/2 | not green | 0 | 0 (0/0/0) | 0 in 0 | $1.03 | 3,651,122 | 8.2 min |
| duration | 2 | ready | light / standard ✗ | 2/2 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.55 | 6,832,350 | 11.5 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.96 (2) | — | — | — | $0.03 (1) |
| clamp | 2 | $0.29 (1) | — | $0.38 (2) | $0.13 (1) | $0.13 (1) |
| slugify | 1 | $0.64 (1) | — | $0.42 (2) | $0.10 (1) | $0.25 (2) |
| slugify | 2 | $0.60 (1) | — | $0.44 (2) | $0.09 (1) | $0.09 (1) |
| csv-quotes | 1 | $0.94 (1) | — | $0.66 (2) | $0.19 (1) | $0.17 (1) |
| csv-quotes | 2 | $1.04 (1) | $0.14 (1) | $0.87 (4) | $0.22 (1) | $0.04 (1) |
| duration | 1 | $0.98 (2) | — | — | — | $0.05 (1) |
| duration | 2 | $0.79 (1) | — | $0.56 (1) | $0.17 (1) | $0.03 (1) |

## Failing hidden tests

- clamp #1: `test/clamp.test.mjs` failed
- duration #1: `test/duration.test.mjs` failed
- duration #1: `test/duration-cli.test.mjs` failed

## L3 comparison: haiku-seal-fix against haiku-baseline

**Decision: reject.**

| | Baseline | Candidate |
|---|---|---|
| Variant | haiku-baseline (2026-10-11) | haiku-seal-fix (2026-10-11) |
| Hidden pass rate | 100.0% | 75.0% |
| Notional cost | $13.53 | $11.38 |
| Repeats | 2 | 2 |

| Task | Baseline hidden ratios | Candidate hidden ratios |
|------|------------------------|-------------------------|
| clamp | 1/1, 1/1 | 0/1, 1/1 |
| slugify | 1/1, 1/1 | 1/1, 1/1 |
| csv-quotes | 2/2, 2/2 | 2/2, 2/2 |
| duration | 2/2, 2/2 | 0/2, 2/2 |

- Pass rate held: no; rose: no
- Regressed in every repeat: none
- Cost within 1.15 × baseline: yes

Reasons:
- hidden pass rate fell: 100.0% → 75.0%
