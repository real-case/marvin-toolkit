# Tier-B trigger harness

Measures **discovery / triggering** for the marvin skills — the `TRIG-01…05`
items of the Skill Effectiveness Evaluation Checklist. This is the dynamic half
the static audit cannot reach: a clean static verdict proves a description is
*well-formed*, not that it *fires* on the right prompts.

## Why this exists

At startup Claude Code loads only each skill's `name` + `description`. From that
metadata alone it decides whether to read a skill's `SKILL.md`. Triggering is
therefore stochastic and the description carries the whole burden. This harness
reconstructs that decision, repeats it `≥3×` per query, and scores the observed
trigger rate against the checklist's `0.5` boundary.

## How it works

```
datasets/<skill>.json     query set: positives, near-miss negatives, competition; train/val split
        │
        ▼
run.mjs ── loads the metadata catalog (name+description only, via lib/catalog.mjs)
        ── asks a DECIDER "which skill loads first?" for each query × N runs
        ── scores per lib/score.mjs → results/<skill>/{grading,benchmark}.json
```

### Deciders (fidelity ladder)

| `--decider`  | What it does | Fidelity | Needs |
|--------------|--------------|----------|-------|
| `mock`       | Deterministic from each query's `mock_rate`. No model. | none — pipeline proof only | nothing |
| `api`        | Anthropic Messages API: model gets the catalog + query, names the skill it would load. | measures the **decision** the description drives | `ANTHROPIC_API_KEY`, Node 18+ |
| `claude-cli` | Real headless `claude -p` in a plugin-installed workspace; transcript inspected for the loaded skill. | **ground truth** (real auto-discovery) | `claude` on PATH, plugin installed in `--workspace` |

`api` is the portable default for CI-style measurement; `claude-cli` is the
end-to-end truth when you can stand up an installed-plugin workspace. `mock`
exists only so `self-test.mjs` can guard the harness with no network.

## Run it

```shell
npm run eval:self-test                                            # guard the harness (no network)
npm run eval:trigger                                              # mock sweep over every dataset
node evals/trigger/self-test.mjs                                  # the same guard, directly
node evals/trigger/run.mjs --skill commit --decider mock          # pipeline demo
ANTHROPIC_API_KEY=… node evals/trigger/run.mjs --skill all --runs 5 --decider api --model claude-sonnet-5
node evals/trigger/run.mjs --skill pr-create --decider claude-cli --workspace /path/with/plugin
```

Flags: `--skill <name|all>` · `--runs <n>` (≥3) · `--decider` · `--model` ·
`--workspace` · `--threshold <0..1>` (fraction of a group that must pass; default
`1.0` = strict per checklist) · `--concurrency`.

## Scoring → checklist items

Per query, `trigger_rate = (runs where the target skill was chosen) / runs`.
A query passes when the rate is on the intended side of `0.5`.

| Item | Group | Passes when | Severity |
|------|-------|-------------|----------|
| TRIG-01 | positives | every should-trigger query rate `> 0.5` | blocker |
| TRIG-02 | negatives | every near-miss rate `< 0.5` | major |
| TRIG-03 | competition (win) | target chosen `> 0.5` vs the named competitor | major |
| TRIG-04 | competition (lose) | target chosen `< 0.5` (a more specific skill wins) | major |
| TRIG-05 | split | validation pass-rate `≥` train − tolerance (0.15) | major |

Overall verdict: `ready` (TRIG-01 passes AND ≥90% of evaluated majors pass) ·
`not-ready` (blocker fails or majors <90%) · `not-evaluated` (no positives — e.g.
a `disable-model-invocation` skill, which never auto-triggers by design).

## Authoring a dataset

`datasets/commit.json` is the exemplar. Rules (from the checklist protocol §2):

- **8–10 positives + 8–10 negatives**, `≥3` runs each. Split **~60% train / ~40%
  validation**, fixed across iterations; tune descriptions only against train.
- **Realistic queries**: real file paths, casual phrasing, abbreviations,
  occasional typos, backstory ("my manager asked me to…"). Vary explicitness.
- **Negatives are near-misses** — share the skill's vocabulary but need something
  else (for `commit`: "squash the last 3 commits" is a rebase, not the workflow).
  Trivially-irrelevant negatives test nothing.
- **Substantive queries** — agents skip skills for one-step tasks, so a genuinely
  trivial query is a broken test regardless of the description.
- **Competition** queries name the sibling that should win (`winner`) and set
  `should_trigger` to whether *this* skill should win.
- `mock_rate` is optional and only consumed by `--decider mock`.

Validate any dataset with `validateDataset` (run the runner; it checks and warns).

## Enforced invariants

Both CI steps run on every leg and neither is allowed to fail, so these are rules
rather than guidance. They live in `scripts/lib/skill-datasets.mjs`; three are
reported by `scripts/lint-manifests.mjs` because they are obligations of the
shipped skill surface, and the rest by `self-test.mjs` because they belong to the
harness.

| Rule | Reported by |
|------|-------------|
| every skill has `datasets/<name>.json` | `lint-manifests` |
| a dataset's `disable_model_invocation` matches the skill's frontmatter | `lint-manifests` |
| the frontmatter value is canonical | `lint-manifests` |
| every dataset has a matching skill | `self-test` |
| a competition `winner` is reachable in the catalog | `self-test` |
| every negative and competition query carries a `note` | `self-test` |
| every query carries an explicit `mock_rate` | `self-test` |

**Canonical** means one of `true`, `false`, `"true"`, `"false"`, or an absent key.
That is the *intersection* of what the three readers of the flag accept, not their
union: `catalog.mjs` strips both quote styles and the server's ADR-0005 codec
accepts either, but the site's generator matches `"?true"?` with no `i` flag and no
single-quote alternative. So `'true'` would be human-run here and in `/marvin:help`
while the public catalog advertised the command as model-invocable, and `True`
would be human-run in Claude Code and unmarked everywhere else. Both are rejected.

**Reachable** is stricter than "is a skill directory": `catalogText` renders skills
only *and* filters human-run ones out, so a prompt without a `SKILL.md`
(`/marvin:reports`, `/marvin:dashboard`, `/marvin:help`, `/marvin:sec-report`) and a
human-run skill are equally unpickable by a decider. Name those in a negative's
`note` instead — a competition row against one passes for the wrong reason, because
`winner` is checked for presence by the schema and then read by nothing.

## Fidelity caveat

`mock` and `api` simulate the *decision* over metadata; only `claude-cli`
observes real Claude Code auto-discovery. Report which decider produced a number
(`benchmark.json.meta.decider` records it). A `ready` from `api` is strong
evidence, not proof — promote to `claude-cli` before calling a skill
`release-ready` on the checklist.
