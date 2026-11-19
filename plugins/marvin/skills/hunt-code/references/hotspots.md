# Hotspot ranking (CODE-P01…P07)

`hunt action: "hotspots"` ranks every in-scope file and cuts the list into batches. The order
is deterministic: the same commit, history window and coverage give the same list, so two runs
can be compared and a resumed run picks up where the last one stopped.

## Signals

| Signal | Source | Term in the score |
| --- | --- | --- |
| Churn | commits touching the file in `hunt.history_months` | `log2(1 + churn)` |
| Authors | distinct authors in the same window | `0.75 × log2(1 + authors)` |
| Fix commits | commits whose subject starts `fix`, `hotfix`, `bugfix`, `revert` or says `fixes` | `0.75 × min(fixes, 5)` |
| Size | lines in the working tree | `log2(1 + lines / 50)` |
| Recency | days since the last change | `1.5` within 30 days, `0.75` within 90, else `0` |
| Risk terms | auth, payment, token, password, permission, session, upload, webhook and similar, in the path or the first 256 KB | `1.25 × min(terms, 4)` |
| Audit state | `.marvin/hunt/coverage.json` | never `+1.5`, changed since audited `+1`, audit older than 90 days `+0.5`, audited recently `−2` |
| Test file | a test file with the same stem anywhere in the repository | `+1` when there is none |

Each term is a logarithm or a capped step so that no single signal dominates: a 5,000-line
file nobody touches does not outrank a 300-line payment handler fixed four times last month.
Ties break by path. Every hotspot carries its top four reasons (`why`), which the hunter is
shown so it knows what made the file interesting.

## Batches and coverage

`hunt.budgets.max_hotspots` caps the list and `hunt.budgets.batch_size` cuts it. The session
hunts one batch at a time and checkpoints it (`hunt action: "checkpoint"`, `step: "hunt"`,
`batch: N`). At `finalize`, every file of a checkpointed batch is written to `coverage.json`
with its blob hash, so the next run ranks it lower until it changes.
