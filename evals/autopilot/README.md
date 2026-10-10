# Autopilot replay benchmark

The benchmark that gates every change to the autopilot pipeline's own process (plan Task 21,
decision D5, requirement R17). A role prompt, a rubric or a skill change is an "L3" proposal: it
reaches `dev` only as a pull request carrying a comparison against the current baseline on the
same suite, and only if that comparison passes the L3 gate below. Nothing here is auto-merged.

```
evals/autopilot/
├── suites/sandbox.yaml        # the synthetic suite: four tasks, two light, two standard
├── replay/sandbox/
│   ├── project/               # the base project every task's history starts from
│   └── tasks/<id>/
│       ├── reference/         # the reference change: implementation + hidden tests
│       └── spec.md            # the contract a careful planner would write (checks tier_expected)
└── results/<date>-<variant>.{json,md}   # committed bench results
```

## Running it

```shell
npm run build
MARVIN_PIPELINE_SANDBOX=1 MARVIN_PIPELINE_MODEL_OVERRIDE=haiku \
  node plugins/marvin/mcp/server/dist/marvin-pipe.js bench \
    --suite evals/autopilot/suites/sandbox.yaml --variant baseline --repeat 2
```

| Flag | Meaning |
|------|---------|
| `--suite <file>` | the suite manifest (required) |
| `--variant <name>` | kebab-case name of what is measured; the result file is `<date>-<variant>` |
| `--repeat <n>` | runs per task, default 2; the L3 gate needs at least 2 |
| `--tasks a,b` | a subset of the suite, in suite order |
| `--rubric <file>` | a rubric variant, written as the replay repository's `.marvin/pipeline/rubric.yaml` and deep-merged over marvin's default |
| `--roles-dir <dir>` | a role-prompt variant: a directory shaped like `plugins/marvin/pipeline/roles/` |
| `--baseline <result.json>` | appends the L3 comparison against that result to the markdown |
| `--judge llm\|auto` | the simulated user; `auto` answers with the children's own recommendations and runs no model |
| `--max-min`, `--max-usd` | per-run caps (60 min, $5 notional); a run past either is stopped and recorded `aborted` |
| `--out <dir>` | where results go, default the suite's `../results/` |
| `--work-dir <dir>` | where the replay repository and the runs live, default a fresh temp dir (kept for inspection) |

`marvin-pipe bench-compare --baseline a.json --candidate b.json [--out file.md]` applies the gate to
two existing results.

`bench` needs a logged-in `claude` and spends model usage, so it is not part of `npm test`.
`test/autopilot-bench.test.mjs` drives it end to end with the deterministic sandbox's fake children
instead, and `plugins/marvin/mcp/server/test/pipeline-bench.test.mjs` covers the parts, the gate
rule included.

## What one run is

1. **A fresh repository at the task's base.** The bench builds the replay repository once (below),
   then, per run, a bare origin whose `dev` is the task's base commit and a clone of it as the main
   checkout. The origin receives the base's history only, so no child can reach the reference
   commit or a hidden test through git.
2. **Bench mode.** Every process of the run gets `MARVIN_PIPELINE_SANDBOX=1`,
   `MARVIN_PIPELINE_BENCH=1` and `MARVIN_PIPELINE_FAKE_CI=green`. Bench mode adds no delivery
   mechanism of its own: the sandbox's `gh` shim and local bare origin already keep the executor's
   push and pull request off GitHub, and green fake CI is the plan's "the engine stubs CI to green".
   What bench mode adds is the `--roles-dir` seam (`MARVIN_PIPELINE_ROLES_DIR`), which the engine
   refuses outside it, as it refuses a model override outside sandbox mode. A model override, when
   set, applies to every child and to the judge; Fable is refused in every mode.
3. **The simulated user.** The bench plays the orchestrator through `init`, `start`, `await` and
   `judge`. Its policy is fixed: approve the spec as planned, cancel a halted run (so the retro
   still runs), proceed past a missing CI, retry one unverified PASS and cancel a second. Questions
   go to the judge. With `--judge llm` that is a headless `claude -p` with no tools, no MCP server
   and no settings, in an empty directory, given the task text and its ground truth but never the
   hidden tests; it runs on `opus` at effort `medium`, or on `MARVIN_PIPELINE_MODEL_OVERRIDE` in the
   sandbox. A failed judge call falls back to the child's recommendations and is counted.
4. **Hidden tests.** When the run ends, each `hidden_tests` file is copied from the reference
   commit into the run's worktree, replacing a file of the same name, and run through the base
   commit's `gates.test_one`, filled by the same `formatTestOne` the seal stage uses (the path is
   single-quoted through `lib/shell-quote.ts`). A file passes when its runner exits 0.

## Metrics

Per run: outcome (`ready`, `done` with the halt reason, `aborted`, `limited`, `error`), the
assigned tier against `tier_expected`, hidden test files passed over run, gates green, executor
iterations, rejections by source (gate, verifier, CI), question judgments and the questions in
them, notional cost and cache reads per role and in total, the judge's notional cost, and wall time.
Per result: the pooled hidden pass rate (files passed over files run, every run of every task),
ready runs, tier matches, total notional cost and wall time.

**Cost is notional.** Every cost figure is the Claude Code CLI's `total_cost_usd`, which prices the
tokens at API rates. On a subscription nothing is billed per token, so the figure is a comparable
measure of model usage between variants, not money spent.

A run that hits the account's usage limit (a child classified `limited`, or the judge refused) is
recorded `limited`, and the bench stops there rather than retrying: the remaining runs are not made
and the result says so under `stopped`.

## The L3 gate

`l3Gate(baseline, candidate)` in `src/pipeline/bench.ts`, a pure function. With every task run at
least twice on both sides, the candidate is **accepted** when all three hold:

1. the hidden pass rate does not fall;
2. no task regresses in every repeat, a repeat regressing when its hidden ratio is below the mean
   of that task's baseline ratios; and
3. the total notional cost is at most baseline × 1.15, or the pass rate rose.

Otherwise it is **rejected**, with the failing clauses as reasons. It is **inconclusive**, never
accepted, when the suites or task sets differ, a task ran fewer than twice on either side, or any
run is incomplete (`limited`, `aborted`, `error`): such a run measured the environment, not the
variant.

Known bias, from the plan: a reference change's tests may name internals the pipeline is free to
choose differently. The synthetic suite keeps that small by stating every tested name and error
type in the task text, but the bench still measures change between variants, not absolute quality.

## Why a synthetic suite

The plan's suite replayed six merged pull requests of the first consumer project. That project is
out of scope here, and replaying marvin-toolkit's own history instead is impractical:

- **The engine reads `.marvin/config.json` from the run's base commit** (`runConfig`), and
  marvin-toolkit has never committed one: no historic commit carries `gates` or a `pipeline` block.
  A run on such a base gets the defaults, so no bootstrap installs `node_modules` into the run
  worktree and the writing roles get no command allowlist, and a main checkout whose ignored config
  holds those settings is refused at prepare, because the base does not hold them. Making a
  historic base runnable means rewriting it, which is no longer a replay.
- **The gates take about 20 minutes.** marvin-toolkit's own `verify` runs the whole workspace
  build and test suite; a pipeline run gates at least twice, and the L3 gate wants every task twice
  per variant, so a four-task comparison would spend hours in gates alone.
- **The reference changes are large.** marvin's merged PRs typically touch skills, a server tool,
  the committed `dist/` and the widget bundle together, far past the light tier and into territory
  where a hidden-test ratio says little.

The replay repository is therefore generated at bench time from a committed fixture, the way the
deterministic sandbox's is (`test/fixtures/autopilot-sandbox/`): a small Node library with its own
`.marvin/config.json` (gates `node --test`, a `pipeline` block) whose history holds, per task, a base
commit and a reference commit adding the implementation and the hidden tests. Commits carry a fixed
identity and clock, so the history and its SHAs are the same on every machine. `base_sha` and
`reference` name the tags the builder sets (`bench/<id>/base`, `bench/<id>/reference`); each task's
base is the previous task's reference, so the history is linear like a real one.

| Task | Tier expected | Why | Hidden tests |
|------|---------------|-----|--------------|
| `clamp` | light | one function, risk low, 2 files | 1 file |
| `slugify` | light | one function, risk low, 2 files | 1 file |
| `csv-quotes` | standard | changes a parser another module depends on: risk medium | 2 files |
| `duration` | standard | new module, re-export, CLI, docs, two test files: 6 files | 2 files |

`tier_expected` is checked against each task's reference spec by the same `readSignals` and
`tierFor` that `marvin-pipe assess` runs (`pipeline-bench.test.mjs`); what a run's planner assigns
is the measurement.

### Adding a task

Add `replay/sandbox/tasks/<id>/reference/` (whole files, as they stand after the change) and
`spec.md`, then a suite entry with `base_sha: bench/<id>/base`, `reference: bench/<id>/reference`,
the task text, the ground truth, the hidden tests and the expected tier. Append it: inserting a
task earlier changes every later task's base. The task text must name every API the hidden tests
call; the ground truth answers what a planner would reasonably ask and must not quote the tests.

## Results

Results are committed under `results/`: the JSON is the record a later comparison reads, and the
markdown is the table a proposal PR quotes. A result from fewer than two repeats documents a run;
it cannot accept a proposal.
