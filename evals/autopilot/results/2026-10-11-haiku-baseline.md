# Bench sandbox — haiku-baseline (2026-10-11)

Costs are the Claude Code CLI's `total_cost_usd`: a **notional** API-price figure, not money
billed. Runs on a subscription are not charged per token.

- Tasks: clamp, slugify, csv-quotes, duration; repeats: 2
- Model override: haiku; judge: llm on haiku
- Rubric variant: none; roles variant: none
- Hidden pass rate: **100.0%** (12/12 files); ready 7/8; tier as expected 6/8
- Notional cost: **$13.53** (judge $0.10); wall time 99.1 min

| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |
|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|
| clamp | 1 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.12 | 4,968,106 | 7.4 min |
| clamp | 2 | ready | light / light | 1/1 | green | 1 | 0 (0/0/0) | 0 in 0 | $1.21 | 5,184,539 | 7.6 min |
| slugify | 1 | done (bench: rejected 3 times (last: gate)) | light / light | 1/1 | not green | 3 | 3 (3/0/0) | 0 in 0 | $1.06 | 4,996,646 | 8.6 min |
| slugify | 2 | ready | light / light | 1/1 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.41 | 6,180,214 | 10.1 min |
| csv-quotes | 1 | ready | standard / standard | 2/2 | green | 2 | 0 (0/0/0) | 2 in 1 | $2.01 | 7,346,471 | 15.1 min |
| csv-quotes | 2 | ready | light / standard ✗ | 2/2 | green | 2 | 1 (1/0/0) | 0 in 0 | $1.90 | 8,928,178 | 13.7 min |
| duration | 1 | ready | light / standard ✗ | 2/2 | green | 2 | 1 (1/0/0) | 0 in 0 | $2.71 | 9,645,757 | 19.8 min |
| duration | 2 | ready | standard / standard | 2/2 | green | 3 | 1 (1/0/0) | 1 in 1 | $2.10 | 9,891,662 | 16.8 min |

## Cost per role (notional)

| Task | # | planner | test-author | executor | verifier | retro |
|------|---|---|---|---|---|---|
| clamp | 1 | $0.39 (1) | — | $0.49 (1) | $0.17 (1) | $0.07 (1) |
| clamp | 2 | $0.66 (1) | — | $0.43 (1) | $0.10 (1) | $0.03 (1) |
| slugify | 1 | $0.37 (1) | — | $0.53 (3) | — | $0.15 (1) |
| slugify | 2 | $0.76 (1) | — | $0.50 (2) | $0.12 (1) | $0.04 (1) |
| csv-quotes | 1 | $1.08 (1) | $0.22 (2) | $0.54 (2) | $0.14 (1) | $0.03 (1) |
| csv-quotes | 2 | $0.89 (1) | — | $0.67 (2) | $0.19 (1) | $0.16 (1) |
| duration | 1 | $1.36 (1) | — | $1.02 (2) | $0.19 (1) | $0.13 (1) |
| duration | 2 | $0.38 (1) | $0.32 (2) | $1.04 (3) | $0.20 (1) | $0.15 (1) |
