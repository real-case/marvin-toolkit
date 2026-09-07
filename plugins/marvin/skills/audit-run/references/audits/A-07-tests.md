# A-07 — Test audit

> **Audit question.** Do the tests protect against regressions in what actually matters?

## 1. Role and task

You audit a suite you did not write, on a stack you must detect, and close one question: whether a green suite is
evidence that the expensive-to-break scenarios still work. Besides the report, a run leaves three artefacts in it — a
critical-scenario × test matrix, a mutation log naming every mutant applied, and one recorded pair of runs where
deliberately broken code turned a test red; that last is the proof of work, and without it the report ships at
`confidence: low`.

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2, whose canonical exclusion set (`RG_EXCLUDE`,
`GIT_EXCLUDE`, `EXCLUDE_RE`) this audit uses unchanged: it adds none and keeps test directories in, as its population.

| Parameter | Meaning | Default and derivation when unset |
|---|---|---|
| `CRITICAL_FLOWS` | the money, legal and irreversible scenarios, each with the code path it runs | derive from `BUSINESS_CONTEXT` when supplied; else build candidates from entry points matching `rg -l -i "${RG_EXCLUDE[@]}" -e payment -e charge -e refund -e invoice -e payout -e password -e token -e permission -e delete -e purge -e export -e consent`, then **ask the user to confirm the list before any severity call of §6**. No answer: use the derived list, name it as derived in *Границы достоверности*, cap `confidence` at `medium` |
| `HOTSPOTS` | A-04's ranking **of files**, churn × size over A-04's `HISTORY_WINDOW` (default 18 months). Arrives as values or as `A04_REPORT`, a path to the A-04 report. This audit needs modules, so it aggregates the file ranking to the module that owns each file and says so in *Методология*; it does not redefine the parameter | derive with the contract's `GIT_EXCLUDE` already in the shell: `git log --no-merges --since='18 months ago' --name-only --pretty=format: -- . "${GIT_EXCLUDE[@]}" \| sed '/^$/d' \| sort \| uniq -c \| sort -rn \| head -40`, joined to file length from `git ls-files -- . "${GIT_EXCLUDE[@]}" \| xargs wc -l`. Label it in the report **churn only over 18 months, not A-04's churn × complexity rank and not the same population**, and drop `confidence` one step |
| `WORK_DIR` | the scratch tree outside the audited repository that steps 6 and 7 mutate, and the destination of every artefact a runner writes | `WORK_DIR=$(mktemp -d)`, populated per §4 and removed with `rm -rf "$WORK_DIR"` at the end of the run |
| `CI_HISTORY_ACCESS` | how CI history is reachable: `gh`, a directory of exported logs, or `none` | probe `gh auth status` then `gh run list --limit 1`; else a user-supplied log path; else `none`, and step 4 degrades to the static proxy with every flake finding at `probable` or `hypothesis` |
| `TEST_COMMAND` | how each level is actually run | derive in order: CI workflow steps (`.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`), `npm pkg get scripts`, `Makefile`, `tox.ini`, `pyproject.toml`, the runner default. Record which source won; CI wins a disagreement |
| `MUTATION_MODULES` | the 2–3 modules the mutation run covers | widen in this order until the quota fills: (1) modules in both `CRITICAL_FLOWS` and the aggregated `HOTSPOTS`, ties broken by dependent count; (2) any module implementing a `CRITICAL_FLOWS` scenario, ranked by dependent count — payment and authorisation code is often stable and absent from a churn ranking; (3) the top aggregated `HOTSPOTS` modules, recorded as a substitution with its reason per §10 item 3. Two at `quick`, three at `standard`/`deep`; if `CRITICAL_FLOWS` itself is empty, ask. One qualifying module is a run of one with the `N` stated; none at all and MS is not computed — §9 then reports CFC alone and *Границы достоверности* says why. Print the ranking in *Методология* |

The audit runs with all six unset: the derivations always terminate, and `MUTATION_MODULES` never depends on the two
sets intersecting. Only `CRITICAL_FLOWS` stops to ask, continuing on a stated assumption when no answer arrives.

## 3. Scope

### In scope

Pyramid shape (cases and wall-clock time per level); what the tests assert; suite speed; suite stability; assertion
quality on a read sample; mutation score on a sample of critical modules; the deliberate-breakage experiment.

### Out of scope

- **Coverage as an end in itself** — no audit owns it; percentages appear once, in *Приложения*, «справочно».
- **Test code as code** (lint, complexity, duplication inside test files) → A-05. **Finding the hotspots** → A-04; they arrive here as `HOTSPOTS`. **Whether a newcomer can run the suite at all** → A-02.
- **Pipeline duration, retry policy, required checks, rollback** → A-17, which consumes this audit. **Whether types remove the need for a class of test** → A-06.
- **Load and benchmark suites** → A-15. **Abuse cases and security test design** → A-14. **Accessibility checks inside the suite** → A-21. **Personal data in fixtures** → A-22. **Whether an API contract is the right contract** → A-11; contract tests are counted and their assertions judged here, the contract is not.

## 4. Collection protocol

Commands are in §5; this section fixes the order, the output of each step, and the patterns that belong to no tool.
First derive and record `TEST_COMMAND`, then build the scratch copy that steps 6 and 7 mutate:
`WORK_DIR=$(mktemp -d) && git archive --format=tar HEAD | tar -x -C "$WORK_DIR"`, then give it **its own** dependencies
— `cp -R node_modules "$WORK_DIR/node_modules"`, `cp -R .venv "$WORK_DIR/.venv"`, or the stack's equivalent. Never a
symlink back into the repository: a suite run on mutated source regenerates clients and writes caches and `.pyc`
through such a link, and `rm -rf "$WORK_DIR"` restores none of it. Where a copy is too costly, link only immutable
package directories and point every cache at `$WORK_DIR` — `--cacheDirectory="$WORK_DIR/jest"`, Vite's `cacheDir`,
`PYTHONPYCACHEPREFIX`, `PRISMA_*`. The audited tree, sources and dependencies alike, is never the tree that mutates.

1. **Inventory.** Produces a table of level × test cases × files × wall-clock time, with framework and version per
   level. Classify a test by, in order: the runner's project/workspace name, the directory, a marker
   (`@pytest.mark.integration`, a build tag), the CI job — and record which rule decided. Count **cases, not files**,
   through the runner's own collection output: `pytest --collect-only -q -p no:cacheprovider`, `go test ./... -list
   '.*'`, `cargo test -- --list`. **Jest has no case-level collection-only mode** — `--listTests` reports files, not
   cases — so on Jest take the case count from `.numTotalTests` of the `--json` run this step already times, and
   `--listTests` for the file count, recording which number came from which. Time each level twice with
   `/usr/bin/time -p` and report both numbers with the cache state of each. Cost: two suite runs per level.
2. **Coverage by module, read against what matters.** Produces a per-module coverage table joined to `HOTSPOTS` and to
   the `CRITICAL_FLOWS` code paths, plus the list of critical paths at zero, every artefact outside the repository. The
   output is the intersection, never the headline: 90% on a module no critical flow touches answers nothing, and a
   critical path at zero is a finding before anything else is measured.
3. **Assertion quality on a sample.** Produces, per sampled test file, a verdict from {asserts behaviour, asserts
   existence only, asserts a snapshot only, asserts nothing, asserts the implementation}. Narrow with aggregates
   first — no-assertion files (`rg -c 'expect\(' <f>` = 0 while `rg -c '\b(it|test)\(' <f>` > 0), weak assertions
   (`rg -n 'toBeDefined\(|toBeTruthy\(|not\.toBeNull\(|assertIsNotNone'`), snapshot-only files
   (`rg -c 'toMatchSnapshot\(|toMatchInlineSnapshot\('`) — then **read** the §7 sample and classify by hand. A test
   asserting on mocks it configured itself, or on a call sequence rather than a result, asserts the implementation.
4. **Flakes.** Produces the re-run share over a declared window and a table of unstable tests with run ids. From `gh`
   (§5): share = runs with `run_attempt` > 1, or with differing conclusions on one `head_sha`, over total runs; name
   the tests with `gh run view <id> --log-failed`. Without access, use the static proxy and say so: retry
   configuration (`jest.retryTimes`, `--reruns`, Playwright `retries`), skipped tests (`rg -n '\.skip\(|xit\(|@pytest\.mark\.skip|t\.Skip\('`),
   and `git log --oneline -i --grep='flak\|rerun\|quarantin' -- <test dirs>`.
5. **Isolation.** Produces the list of unit-level tests with shared state, order dependence or real I/O, each tagged
   with which of the three it is. **Shared state**: aggregate the carriers — module-level mutable bindings, session-
   and module-scoped fixtures, writes to a fixed path or to the environment — with
   `rg -n '^(let|var|global) |beforeAll\(|@pytest\.fixture\(scope=.(session|module)|process\.env\[[^]]+\] *=|os\.environ\[[^]]+\] *=|/tmp/[a-z]' <unit dirs>`,
   then confirm by running the suspect file alone (`<TEST_COMMAND> <file>`) and again after the file touching the same
   symbol. Classification rule: passes alone and fails beside its neighbour, or the reverse, is **shared state**;
   passes in both and fails only reversed is **order dependence**; an aggregate hit surviving both runs is not filed.
   Order dependence: shuffle or run the files in reverse — `pytest -p no:cacheprovider $(ls tests/test_*.py | sort -r)`.
   Real I/O, through the §11 redactor: `rg -n -o '[a-zA-Z][a-zA-Z0-9+.-]*://[^/" ]*' <unit dirs> | sed -E
   's#://[^@]*@#://REDACTED@#' | rg -v 'localhost|127\.0\.0\.1|example\.(com|org)'`, and `rg -n 'createConnection\(|new
   Pool\(|psycopg2\.connect|mongoose\.connect|redis\.createClient'`, plus leaked handles from §5. Cross-check step 1: a
   "unit" level slower than 30 s per hundred cases is doing I/O somewhere.
6. **Mutation testing on `MUTATION_MODULES`.** Produces mutants applied / killed / survived / timed out / not covered
   and a score per module, each with its command. Run the framework **inside `$WORK_DIR`** — every one of them writes
   caches and reports. With no framework for the stack, or none installed, apply mutants by hand in `$WORK_DIR` (flip
   a comparison, negate a condition, drop a guard, change a boundary constant) — **exactly one mutant per run**, pinned
   to a line by the §5 harness and the file restored from the archive before the next, or survivors cannot be
   separated and the denominator cannot be counted. Record each as a `diff -u` hunk, run only the tests covering that
   module, score killed ÷ applied, then read the survivors, exclude equivalent mutants and report how many.
7. **The deliberate-breakage experiment.** Produces, for at least one `CRITICAL_FLOWS` scenario, a recorded pair of
   runs in `$WORK_DIR`: the covering test green on unmodified code, then red after one semantic mutation of the
   implementation, with both commands, both exit codes and the mutant diff. A scenario whose test stays green is not
   covered, whatever coverage says. Repeat in `CRITICAL_FLOWS` order to the §7 budget, and state how many flows were
   verified experimentally versus taken on the presence of a test.

## 5. Tools

| Tool | What it measures | Invocation | Fallback when absent |
|---|---|---|---|
| project runner (jest / vitest / pytest / go test / cargo test / rspec / phpunit / gradle) | cases, levels, run time, pass state | `/usr/bin/time -p npx --no-install jest --ci --json`; `pytest -q -p no:cacheprovider`; `go test ./... -count=1` | take the command from CI config; if the suite cannot run at all, count cases statically with `rg -c "${RG_EXCLUDE[@]}" -e '\bit\(' -e '\btest\(' -e '^\s*(async )?def test_\w*\('` — one pattern per `-e` and never one alternation, and the Python branch needs the `\w*` and the `def` anchor; a pattern that silently matches nothing makes a language with no cases manufacture findings on §6's no-test row — and mark every timing as not measured |
| coverage | per-module line/branch coverage, reference only | `npx --no-install jest --coverage --coverageReporters=json-summary --coverageDirectory="$WORK_DIR/cov"`; `COVERAGE_FILE="$WORK_DIR/.coverage" pytest --cov=<pkg> --cov-report=term-missing`; `go test ./... -coverprofile="$WORK_DIR/cover.out" && go tool cover -func="$WORK_DIR/cover.out"` | no coverage numbers: join tests to critical paths by reading imports and assertions, mark `probable`, and note that §9 does not depend on coverage |
| Stryker (JS/TS) | mutation score | in `$WORK_DIR`: `npx --no-install stryker run --mutate "src/<module>/**/*.ts"` | the on-demand path of `report-contract.md` §9 (`npx --yes -p @stryker-mutator/core@<pinned version> stryker run …`), else the manual harness below |
| mutmut / cargo-mutants / PIT | mutation score on Python / Rust / JVM | in `$WORK_DIR`: put `[mutmut]` + `paths_to_mutate=src/<module>/` in `$WORK_DIR/setup.cfg`, then `mutmut run` and `mutmut results` — mutmut 3.x has no `--paths-to-mutate` flag and the config file is the only selector that works on both 2.x and 3.x; `cargo mutants --file src/<module>.rs`; `mvn -q org.pitest:pitest-maven:<pinned version>:mutationCoverage -DtargetClasses='com.acme.<module>.*'` — the version coordinate is not optional: an unpinned `groupId:artifactId:goal` resolves the newest release from Central into `~/.m2`, which is the on-demand acquisition `report-contract.md` §9 governs, and a missing plugin downloads instead of falling through to the harness | the manual harness below |
| manual mutant harness (perl + diff + the runner) | mutation score on any stack, and step 7 | one mutant per run, pinned to a line: `perl -pi -e 's/>=/>/ if $. == <LINE>' "$WORK_DIR/<file>"; diff -u <orig> "$WORK_DIR/<file>"; (cd "$WORK_DIR" && <TEST_COMMAND>); echo $?`, then restore `$WORK_DIR/<file>` from the archive before the next mutant. Without the `$.` guard `-p` substitutes on every line and applies the whole batch at once | none needed — this **is** the universal fallback |
| `gh` (CI history) | re-run share, unstable test names | `gh api "repos/{owner}/{repo}/actions/runs?per_page=100" --paginate -t '{{range .workflow_runs}}{{printf "%.0f" .id}} {{.run_attempt}} {{.conclusion}} {{.head_sha}}{{"\n"}}{{end}}'` — `printf "%.0f"`, or the template prints the id in scientific notation and step 4 cannot feed it back to `gh run view` | exported logs if supplied, else the static proxy of step 4; record `gh` in `tools_unavailable` |
| runner diagnostics | leaked handles, order dependence, shard timing | `npx --no-install jest --detectOpenHandles --runInBand`; `npx --no-install jest --shard=1/4`; `npx --no-install vitest run --shard=1/4`; `go test -shuffle=on ./...` | reverse-order file list (step 5); `rg` for connection constructors |
| ripgrep | assertion and I/O aggregates | `rg -n --stats 'toMatchSnapshot\(' <test dirs>` | `grep -REn 'toMatchSnapshot\(' <test dirs>` |
| git | test inventory, churn on tests, flake proxy | `git ls-files '*test*' '*spec*'`; `git log --since=12.months --name-only --pretty=format: -- <test dirs>` | none needed |

Read each tool's real version from the tool — `npx --no-install jest --version` (or `npm ls jest --depth=0`),
`python -m pytest --version`, `gh --version`. A tool the project does not carry is acquired, or not, under
`report-contract.md` §9 alone; what did not run is listed in `tools_unavailable`.

## 6. Analysis rules and thresholds

| Condition | Threshold | Severity | Origin |
|---|---|---|---|
| A `CRITICAL_FLOWS` scenario with no test at any level | ≥ 1 scenario | **S1**, independent of any coverage figure | requirements |
| A `CRITICAL_FLOWS` scenario whose test stays green under the step-7 mutation | ≥ 1 scenario | **S1** — a test that cannot fail is scored as no test | requirements |
| Mutation score on a module implementing a critical flow | < 60% | **S1** | requirements |
| Mutation score on a sampled non-critical module | < 60% | S3 | derived |
| Flake share over the declared window | > 2% of runs | S2, raised to S1 when a flaky test guards a critical flow: it trains the team to re-run instead of read | derived |
| Full local suite wall-clock time | > 10 min | S3 | derived |
| Full local suite wall-clock time | > 30 min | S2 — past this it stops being run locally; confirm against step 4 before filing | derived |
| Sampled test files with no assertion at all | > 5% of the sample | S2; S1 for any such file that is the only test of a critical flow | derived |
| Sampled files whose only assertions are existence checks or snapshots | > 20% of the sample | S3, raised to S2 on a critical-flow module | derived |
| Unit-level tests doing real network or database I/O | ≥ 1 test | S2 — both the flake source and the reason level timings mean nothing | derived |
| Order dependence: passes in declared order, fails shuffled or reversed | ≥ 1 test | S2 | derived |
| Quarantined or permanently skipped tests | > 1% of cases / ≥ 1 on a critical flow | S3 / S1 | derived |
| Pyramid shape by case count | unit < 50% and e2e > 20% | S3, raised to S2 when a suite wall-clock row also holds | derived |

Overrides, in order: a threshold crossed only in code no `CRITICAL_FLOWS` scenario and no `HOTSPOTS` module reaches
drops one row under the contract's reachability rule; the three `requirements` rows are never discounted, criticality
being their premise; and no row is raised on a coverage percentage.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit for steps 3 and 5:** the test file; `N` and `C` are the contract's numbers for the `DEPTH` in force. With the mutation modules below this audit has two populations, so `coverage` takes the contract's semicolon-separated form with the test-file clause first; the two are never summed into one ratio.
- **Top-`N` ranking:** (1) test files whose covered paths intersect `CRITICAL_FLOWS`, in that order; (2) files covering the top `HOTSPOTS` modules — the file ranking aggregated per §2; (3) the largest remaining test files by line count. `C` is drawn from files in neither set.
- **Mutation sample:** modules, not files, fixed at 2–3 by `MUTATION_MODULES` rather than by `N`. Mutants per module in the manual harness: 5 / 10 / 20 by `DEPTH`; the framework's own default when one runs.
- **Step-7 budget:** 1 scenario at `quick`, 3 at `standard`, all of `CRITICAL_FLOWS` or 8 — whichever is smaller — at `deep`.
- **Audit-specific early stop:** the contract's control-sample stop, additionally requiring — inside the mutation loop, and there only — that a module be abandoned once the survivor count makes 60% unreachable for the mutants left; the threshold is already decided. Record the partial denominator and mark the module partial: §9 fixes how a censored score enters MS, so that two auditors stopping at different points still report the same number.
- **The step that cannot be sampled away:** step 7's recorded red run is never dropped for budget (§1).

## 8. Report additions

Frontmatter carries `audit_id: A-07` and `audit_name: Аудит тестов`. Three additions, each in exactly one place:

- **«Матрица покрытия критичных сценариев» (*Critical-scenario coverage matrix*) — inside §5 Детальные находки**,
  opening the section, because every incomplete row is an S1 finding and the matrix is the evidence those findings
  cite. Columns: сценарий | код-путь (`path:line`) | тест (`path:line`) | уровень | что утверждает ассерт | проверен
  поломкой (да / нет / не выбран) | находка (`F-A07-NN` or «—»).
- **«Нестабильные тесты» (*Unstable tests*) — inside §7 Приложения.** Columns: тест | прогонов в окне | падений |
  доля | первое и последнее наблюдение | источник (run ids, or the static proxy) | статус (в карантине / с ретраями /
  без обработки).
- **«Результаты mutation-прогона» (*Mutation run results*) — inside §7 Приложения.** Columns: модуль | инструмент и
  версия | применено | убито | выжило | timeout | без покрытия | эквивалентных исключено | score | полнота (полный /
  частичный, applied ÷ planned — an early-stopped module carries its partial denominator here) | команда. Beneath it,
  the step-7 log: the mutant as a `diff -u` hunk, the two commands, the two exit codes.

The reference coverage table also lives in §7, under a heading containing «справочно», and is the only place in the
report where a coverage percentage may appear.

## 9. Score

**Score = CFC × MS**, a fraction on 0.00–1.00, reported as a percentage with both factors shown. **CFC** = covered
scenarios ÷ `|CRITICAL_FLOWS|`, where a scenario counts as covered when a test exists **and** either it was in the
step-7 sample and went red under mutation, or it was outside the sample; a test that survived its mutation counts as
0. **MS** = the mean mutation score across `MUTATION_MODULES`, equivalent mutants excluded from the denominator; an
early-stopped module (§7) enters that mean at killed ÷ mutants-**applied**, marked partial in the score line and in
the §8 table; a module with no mutants applied is dropped and the mean's N stated; with none qualifying MS has no value
— report CFC alone, say so in *Границы достоверности*, cap `confidence` at `medium`. Report as `0.42 = 6/9 критичных
сценариев × 63% mutation score (billing частичный, 7/15 мутантов; 3 из 9 проверены поломкой)`. The justification names
the uncovered scenarios, the module that dragged MS down, and what would move it back. Bands for the prose only: ≥ 0.70
the suite protects the critical flows; 0.40–0.69 it protects some and the rest are unproven; < 0.40 the suite reports on
itself rather than on the product. Overall line coverage enters neither this formula nor the summary.

## 10. Failure modes of this audit

1. **Leading with the coverage percentage.** A repository at 85% coverage whose tests assert nothing reads as healthy.
   Countermeasure: §9 carries no coverage term, and the summary leads with CFC and MS.
2. **Treating a green suite as protection.** Tests that mock the system under test, regenerate their own snapshots, or
   assert only that a value is defined pass forever. Countermeasure: step 7 is mandatory, and "covered" without a
   recorded red run is filed as `hypothesis`, naming the breakage that would confirm it.
3. **Mutating the easy module.** Choosing `MUTATION_MODULES` by how fast their tests run yields a high MS about code
   nobody would miss. Countermeasure: the §2 widening order fixes the choice, criticality before churn; the ranking and
   the rung it stopped at are printed in *Методология*, and any substitution is recorded with its reason.
4. **A flake window too small to mean anything.** Twelve runs with one re-run reads as 8%. Countermeasure: file at
   `confirmed` only over ≥ 200 runs or ≥ 30 days, whichever yields more; below that, `probable` with the N stated.
5. **Counting files as tests.** File counts inflate the unit level and flatten the pyramid, and on Jest `--listTests` is
   exactly the file count. Countermeasure: step 1 takes cases from the runner's collection output, or from
   `.numTotalTests` where the runner offers none, and records which command produced each number.
6. **Timing a warm run.** A cached run reports three minutes for a suite that takes eleven cold, so §6's two wall-clock
   rows fire wrongly or not at all. Countermeasure: run twice, report both with their cache state.
7. **Counting equivalent mutants as survivors.** An unreachable or identical mutant depresses MS and manufactures an S1.
   Countermeasure: read every survivor in the sample, exclude the equivalents, and report how many you excluded.
8. **Reading a test's name as its behaviour.** `refunds_are_idempotent` proves nothing about idempotence.
   Countermeasure: «что утверждает ассерт» is filled from the assertion body only, never from the name.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Never apply a mutant to the audited tree, by hand or through a framework.** Steps 6 and 7 happen in `$WORK_DIR`: no
  `git stash`, no `git checkout --`, no `git apply`, no editor write into the repository, and no framework run outside
  `$WORK_DIR` — Stryker writes `.stryker-tmp/`, mutmut `.mutmut-cache`, PIT `target/pit-reports/`. Remove it at the end.
- **Never give the scratch copy a writable link into the audited tree.** A dependency directory reached through
  `$WORK_DIR` is still the audited project, and a suite run on mutated source writes into it. Copy it, or link only
  immutable package directories and redirect every cache to `$WORK_DIR` per §4.
- **Never run the suite with an update flag** — `jest -u`, `vitest -u`, `pytest --snapshot-update`, `cargo insta
  accept`, `go test -update`: they rewrite committed snapshots and the diff looks like the team's own work.
- **Never execute a suite whose config points at a shared, staging or production resource.** Read `.env*`, the runner
  config, compose files and CI env first; if the target is neither localhost nor an already-running ephemeral container,
  do not run that level — read it, record it as not executed. E2E suites send mail and charge cards.
- **Never print a test target's connection string.** Evidence for a non-local target is the config key's `path:line`
  plus scheme and host — never the line verbatim, never a DSN, never a value from `.env*`. Every URL scan of step 5
  passes through `sed -E 's#://[^@]*@#://REDACTED@#'` before its output reaches the report or the chat.
- **Do not provision to make a suite runnable**: no `docker compose up`, no `migrate`, no `db:seed`, no fixture loading.
  A level needing provisioning is recorded as not executed and its timing as not measured.
- **Redirect every artefact a runner writes** — coverage output, caches and reports go under `$WORK_DIR` by the flags of
  §4 and §5; a `coverage/` or `.pytest_cache/` left behind is a modification of the working tree.
- **Do not delete, skip, quarantine or repair a flaky test**; it is filed with a recommendation, never fixed here.

## 12. Dependencies

- **Input:** A-04 (hotspots and bus factor, as `HOTSPOTS` values or as `A04_REPORT`) and `BUSINESS_CONTEXT` (the
  source of `CRITICAL_FLOWS`, or the reason to ask the user). Neither blocks a run — §2 derives both when absent, and
  caps `confidence` at `medium` for a derived `CRITICAL_FLOWS` — and both absences are named in *Границы достоверности*.
- **Output:** critical-flow coverage → A-17 — the CFC and MS figures of §9, the flake share and unstable-test table of
  step 4, and the per-level run times of step 1; A-17 judges the pipeline running these tests and needs to know which of
  its gates are load-bearing. Both ends match `audit-index.md`: A-04's "Hands to" lists A-07, A-17's "Needs on input"
  lists A-07, and this audit's row reads `A-07 | A-04, BUSINESS_CONTEXT | critical-flow coverage → A-17`.

## 13. Nearest marvin command

`/marvin:task-verify`, deliberately absent from `audit-index.md`'s overlap table because the overlap is procedural
rather than territorial: `task-verify` runs the project's gates and records whether they passed, while this audit
assumes they passed and asks whether that means anything. Use it as an accelerator for two things only — a detected
runner command when `TEST_COMMAND` will not derive, and one timed, recorded suite run. Its `verification.md` is
evidence to re-verify with the commands of §5, never a section to paste; on a project not using marvin it is absent.
