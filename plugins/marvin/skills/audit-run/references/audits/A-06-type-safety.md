# A-06 — Type safety

> **Audit question.** Does the type system actually protect the data entering the system, or does it only appear to?

## 1. Role and task

You audit the *protective value* of a type system, not its presence. The one question you close is whether a green type-check is evidence about the values flowing through the
program, or a statement about the fraction of the program the checker was allowed to see. Two artefacts survive beside the report and are handed on as parameter values: the
**boundary map** (every place external data enters, with a protection level) and the **escape table** (escapes per module, with a trend).

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `TYPE_REGIME` | which branch runs: `gradual` \| `nominal` \| `untyped` | derived in step 0 from the extension histogram and the presence of a checker config. Never asked. |
| `TSCONFIG_PATHS` | the checker configurations that define what is checked | `git ls-files '*tsconfig*.json' '*jsconfig.json' '*mypy.ini' '*pyrightconfig.json' '*phpstan.neon*' '*psalm.xml*' '*sorbet/config' '*pyproject.toml' "${GIT_EXCLUDE[@]}"` — **every pattern begins with `*`**, because a git pathspec that does not is anchored at the repository root and cannot see `packages/api/mypy.ini`, which is where a monorepo keeps it. Take the root config plus every one a workspace package references. An empty result is itself a step-1 finding. |
| `SCHEMA_SOURCES` | machine-readable schemas that could generate types | `git ls-files '*.graphql' '*.gql' '*.proto' '*.avsc' '*schema.prisma' '*openapi*.y*ml' '*openapi*.json' '*swagger*.y*ml' '*.schema.json' '*codegen.*' '*buf.gen.yaml' "${GIT_EXCLUDE[@]}"` — same anchoring rule and the same exclusions, and here is what it costs: unstarred, `schema.prisma` misses `prisma/schema.prisma` and `openapi*.y*ml` misses `docs/openapi.yaml`, so a Prisma project reports "no schema sources" and step 5 never runs. Empty is a valid result and is the input to step 5. |
| `BOUNDARY_LIST` | the places external data enters the system | derived in step 3 from the six boundary classes, seeded from A-01's component register when supplied. Ask the user **only** for boundaries invisible in code (a queue written by an external worker, a partner file drop); continue without an answer and record the gap. |
| `COVERAGE_TARGET` | the coverage percentage the project holds itself to | `95` (§6, the coverage row). When the repo pins its own — an `--at-least` in a script or in CI — use that **and** report against 95 as well. |
| `ESCAPE_HISTORY_POINTS` | revisions the escape trend is sampled at | `6`, spaced evenly over the last 12 months or the repository's life if shorter; `3` at `DEPTH=quick`, `12` at `deep`. Step 2's loop derives its offsets from this value; two points is the floor. |

## 3. Scope

### In scope

Checker configuration; escapes from typing; the typing of system boundaries; type generation from schemas; runtime validation of input; whether the type-check blocks in CI. Three
regimes, decided in step 0 and stated in *Методология*:

- `gradual` — TypeScript, annotated Python, PHP with PHPStan/Psalm, Ruby with Sorbet, Flow. The full protocol runs.
- `nominal` — Go, Java, Kotlin, C#, Rust, Swift. Steps 1, 5, 6 shrink to the checker's own settings and step 2 targets that language's escapes (`interface{}`; raw types, `Object`,
  `@SuppressWarnings("unchecked")`; `dynamic`; `unsafe`); steps 3, 4, 7 run unchanged.
- `untyped` — plain JavaScript, unannotated Python, Ruby without Sorbet. The audit becomes an audit of **contract checks**: steps 3, 4, 5, 7 run in full, step 1 covers
  `checkJs`/JSDoc or their absence, step 2 counts unvalidated `JSON.parse` sites. See §10 item 5.

### Out of scope

Exploitability of an unvalidated input — injection, authorisation bypass, mass assignment → **A-14**. API contract shape, versioning and consumer compatibility → **A-11**; the
database schema and its migrations → **A-10**. Lint-rule coverage, complexity, duplication, dead code and every **linter** suppression (`eslint-disable`, `noqa`, `phpcs:ignore`) →
**A-05**, which files those; this audit counts only the type-checker suppressions of §6, `# type: ignore` among them, and keeps of the rest only the type-related rules and unused
*type* exports. Currency, health and licences of the type packages and validators → **A-03**; the runtime cost of validation → **A-15**. Form and client-state architecture →
**A-13**, leaving only whether form input is typed and validated; whether the validators are themselves tested → **A-07**; pipeline speed and reversibility → **A-17**, leaving only
whether the type-check blocks a merge. Readability and ergonomics of the type definitions: **no audit covers this**, and `report-contract.md` §5 gives the disposition.

## 4. Collection protocol

Read-only throughout; one scratch directory outside the audited repository holds every generated artefact: `TMP=$(mktemp -d)`. Commands are the TypeScript form; §5 gives the
per-stack equivalent and the fallback for each tool. **The exclusions are the contract's**: `report-contract.md` §2's canonical set, as `"${GIT_EXCLUDE[@]}"` on each `git grep` /
`git ls-files` pathspec and `"${RG_EXCLUDE[@]}"` on each ripgrep run, with no addition of this audit's own. Step 5 is the one deliberate exception: it reads the generated files the
contract excludes, because their freshness is what it measures.

**Step 0 — Establish the regime.** Produces `TYPE_REGIME`, the checker binary with its real version, the applicability decision. Take the extension histogram with
`git ls-files -- . "${GIT_EXCLUDE[@]}" | awk -F. 'NF>1 {print $NF}' | sort | uniq -c | sort -rn | head -20` — the regime is decided over the population every later count uses — and the checker with `[ -x node_modules/.bin/tsc ] && node_modules/.bin/tsc --version`; absent
means `tools_unavailable`, not a lower verdict.

**Step 1 — Compiler configuration.** Produces one row per config in `TSCONFIG_PATHS`: the compile verdict, every flag below, the excluded paths, and the ratio of files the checker
reads to files present. Every `tsc` run carries `--noEmit` **and** `--tsBuildInfoFile "$TMP/tsbuildinfo"` — the first so no `.js` is emitted beside the sources, the second so no `tsconfig.tsbuildinfo` is dropped into the tree (§11). The verdict is
`node_modules/.bin/tsc -p tsconfig.json --noEmit --tsBuildInfoFile "$TMP/tsbuildinfo" 2>"$TMP/tsc.log"; echo $?` — an exit code and a diagnostic count, and nothing more than that
(§10 item 3). Then `-p tsconfig.json --showConfig > "$TMP/effective.json"` (it resolves `extends`) and `jq '.compilerOptions' "$TMP/effective.json"` for `strict`, `noImplicitAny`,
`strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`, `useUnknownInCatchVariables`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck`, `allowJs`/`checkJs`, and `jq '{include, exclude, files}'` for the exclusions. The reach ratio counts the
output of the verdict line with `--listFiles` appended, filtered through `$EXCLUDE_RE` (`report-contract.md` §2), against `git ls-files '*.ts' '*.tsx' '*.mts' "${GIT_EXCLUDE[@]}" | wc -l`, less the files named
by `git grep -l '@ts-nocheck' -- '*.ts' '*.tsx' '*.mts' "${GIT_EXCLUDE[@]}"` — three counts, one population, or the ratio is meaningless.

**Step 2 — Escape census.** Produces total and per-module counts for `any`, unnarrowed `unknown`, `as`, `as unknown as`, `@ts-ignore`, `@ts-expect-error` and the non-null
assertion; density per 1000 non-blank lines; and a trend over `ESCAPE_HISTORY_POINTS` revisions. Count with `git grep -cP '<pattern>' -- '*.ts' '*.tsx' "${GIT_EXCLUDE[@]}"` —
**`-P`, never `-E`**, for the reason and with the substitution §5's ripgrep row gives. The patterns, in turn:

- `any` — `:\s*any\b|<any>|\bas any\b|any\[\]|Array<any>`
- `unknown` — `\bas unknown as\b|:\s*unknown\b`, which yields *candidates*; the narrowing test below decides which of them are escapes
- `as` — `(^|[^\w$])as +(?!const[^\w$])[A-Za-z_$]`: the keyword, with `as const` excluded **by name**. An uppercase-initial class excludes it too, but silently drops `as string`,
  `as number`, `as boolean`, `as object` along with it — the commonest casts in the language, caught by nothing else here
- suppressions — `@ts-(ignore|expect-error)`; the non-null assertion needs `rg --pcre2`

**The narrowing test.** A `: unknown` or `as unknown` candidate counts as an escape unless a guard over that identifier appears within 20 lines below it in the same file: `typeof`,
`instanceof`, `in`, an `x is T` predicate, or a validator call (`.parse(`, `.safeParse(`, `validateSync`). `as unknown as` is never narrowing. Classify by comparing line numbers
between the candidate grep and a guard grep, then confirm the classifier on the `C` sample and publish its false-positive rate beside the count, like any other pattern here.

`git grep` reads a revision directly, so the trend needs no checkout. It greps `'*.ts' '*.tsx'` under the same exclusions as the head census, or the series measures one population
while being compared against another:

```bash
rg --pcre2 "${RG_EXCLUDE[@]}" -n '[\w)\]]!(?![=~])' -g '*.ts' -g '*.tsx'     # non-null assertion
git grep -cP '\bas any\b|:\s*any\b' -- '*.ts' '*.tsx' "${GIT_EXCLUDE[@]}" \
  | awk -F: '{split($1,p,"/"); a[p[1]"/"p[2]]+=$2} END {for (k in a) printf "%6d  %s\n", a[k], k}' | sort -rn
N=${ESCAPE_HISTORY_POINTS:-6}; [ "$N" -ge 2 ] || N=2         # 3 at DEPTH=quick, 12 at deep
for i in $(seq 0 $((N-1))); do m=$(( 12 * i / (N-1) )); sha=$(git rev-list -1 --before="$m months ago" HEAD); [ -n "$sha" ] || continue
  e=$(git grep -cP '\bas any\b|:\s*any\b' "$sha" -- '*.ts' '*.tsx' "${GIT_EXCLUDE[@]}" | awk -F: '{s+=$NF} END{print s+0}')
  l=$(git grep -cE '.' "$sha" -- '*.ts' '*.tsx' "${GIT_EXCLUDE[@]}" | awk -F: '{s+=$NF} END{print s+0}'); printf '%sm %s esc=%s loc=%s\n' "$m" "$sha" "$e" "$l"; done
```

**Step 3 — Boundaries.** Produces the boundary map: per boundary its class, entry point `file:line`, declared static type, its provenance, and whether a runtime check stands there.
The six classes are fixed, each found with `git grep -nP '<p>' -- '*.ts' '*.tsx' "${GIT_EXCLUDE[@]}"` — `-P` for step 2's reason, the database row's pattern carrying a `\b` of its
own:

| Class | Pattern | What makes it a finding |
|---|---|---|
| API responses | `\.json\(\)\|axios\.\|fetch\(\|got\(\|req\.body\|request\.json\(\|@(Body\|Query)\(` | `res.json()` is `Promise<any>`; an inbound body typed by assertion |
| Database responses | `\$queryRaw\|knex\.raw\|sequelize\.query\|\bdb\.query\(\|cursor\.execute\(` | a raw query whose row type is hand-declared or `any` |
| Environment variables | `process\.env[.\[]\|os\.environ\|os\.getenv` | direct reads with no validated config module |
| Forms | `FormData\|useForm\(\|formData\.get\(` | a form value cast rather than parsed |
| Route parameters | `useParams\(\|searchParams\|@Param\(` | `string \| undefined` narrowed by assertion |
| localStorage / queues | `localStorage\.\|sessionStorage\.\|JSON\.parse\(`, and `-i` over `kafka\|amqp\|sqs\|pubsub\|bullmq` | `JSON.parse` assigned to a declared type with no check |

**Step 4 — Runtime validation.** Produces, per boundary: the validator with its version, whether the value is *parsed* (rejected on mismatch) or merely *cast*, and the external
inputs with no runtime check at all. Validators: `git grep -nE "from ['\"](zod|valibot|yup|io-ts|superstruct|ajv|class-validator|joi)" -- . "${GIT_EXCLUDE[@]}"` (Python:
`git grep -nE '^(from|import) (pydantic|marshmallow|cerberus)' -- '*.py' "${GIT_EXCLUDE[@]}"`). Call sites: `git grep -nE '\.safeParse\(|\.parse\(|validateSync|ajv\.compile' -- . "${GIT_EXCLUDE[@]}"`. Versions:
`jq -r '.dependencies, .devDependencies' package.json`.

**Step 5 — Generation versus duplication.** Produces, per `SCHEMA_SOURCES` entry: generated or hand-written, the generator and its config, and a drift verdict with the check that
produced it. Find generated files with `git grep -lE '@generated|Code generated by|DO NOT EDIT'` — this step reads them on purpose, so its pathspec drops the contract's
`generated/` exclusion. Compare `git log -1 --date=short --format='%ad %h'` on the schema against the generated file; where a generator exists, regenerate **into `$TMP` only**:
`npx --yes openapi-typescript@7.13.0 openapi.yaml -o "$TMP/api.d.ts" && diff -u src/types/api.d.ts "$TMP/api.d.ts"`.

**Step 6 — CI enforcement.** Produces the file and line of the type-check step, whether it blocks, and whether it runs the same strictness as local.
`git grep -nE 'tsc|type-?check|mypy|pyright|phpstan|psalm|srb tc' -- '.github' '.gitlab-ci.yml' 'package.json' "${GIT_EXCLUDE[@]}"`, then
`git grep -nE 'continue-on-error|allow_failure|\|\| true' -- '.github' "${GIT_EXCLUDE[@]}"`, then optionally
`gh api repos/{owner}/{repo}/branches/<base>/protection --jq '.required_status_checks.contexts'`.

**Step 7 — Consolidate and score.** Produces `TC`, `PB` and `TSS` of §9, the three appendix tables of §8, and the ranked findings.

## 5. Tools

Acquisition is `report-contract.md` §9's policy and no other; the versions pinned below are what this spec was written against.

| Tool | What it measures | Invocation | Fallback when absent |
|---|---|---|---|
| `tsc` | effective config, whether the tree compiles, which files are checked | `node_modules/.bin/tsc -p tsconfig.json --noEmit --tsBuildInfoFile "$TMP/tsbuildinfo"`, the same line with `--listFiles` appended, and `-p tsconfig.json --showConfig`. `--noEmit` on every one of them: `--listFiles` alone still compiles and writes a `.js` beside every source file it lists | parse `tsconfig.json` by hand (`sed 's,//.*,,'` before `jq`) and follow `extends` manually; record `tsc` in `tools_unavailable` |
| `type-coverage` | share of expressions with a known type | `npx --no-install type-coverage --detail -p tsconfig.json`, else `npx --yes type-coverage@2.30.1 --detail -p tsconfig.json` (`--strict`; `--at-least 95` reproduces a CI gate) | the escape-density proxy of §9, labelled an estimate and never called "type coverage" |
| `ts-prune` | exported types nobody imports — dead type surface that flatters coverage | `npx --no-install ts-prune -p tsconfig.json`, else `npx --yes ts-prune@0.10.3 -p tsconfig.json` | `git grep -n 'export \(type\|interface\)' -- '*.ts' '*.tsx' "${GIT_EXCLUDE[@]}"` plus a reverse-import search over the sample |
| typescript-eslint `no-unsafe-*` | whether the unsafe-value rules exist, and their violation count | detect: `npx --no-install eslint --print-config src/index.ts \| jq '.rules \| keys[] \| select(startswith("@typescript-eslint/no-unsafe"))'`; count: the project's own lint script with `-f json` into `$TMP` | if the rules are off, that *is* the finding — do not enable them in the repo; use the step-2 census |
| ripgrep + `git grep` | the escape census: PCRE throughout — for the non-null assertion, and because `git grep -E` runs the platform's POSIX engine, which on macOS (git 2.50.1, Apple Git-155) ignores `\b` and answers zero silently instead of erroring; per-file and per-revision counts over tracked files only, so vendored trees never enter a metric | `rg --pcre2 "${RG_EXCLUDE[@]}" -n '[\w)\]]!(?![=~])' -g '*.ts' -g '*.tsx'`; `git grep -cP '<pattern>' [<sha>] -- '*.ts' '*.tsx' "${GIT_EXCLUDE[@]}"` | a git built without PCRE refuses `-P` loudly, which is recoverable. Substitute per pattern: `\b` → a leading `(^\|[^A-Za-z0-9_$])` and a trailing `([^A-Za-z0-9_$]\|$)`, `\s` → `[[:space:]]`; for the `as` pattern drop the lookahead and filter `as const` out of `-nE` output with `grep -v`. `git grep -nE '[A-Za-z0-9_)]!\.'` catches only `x!.y`, so that number is a lower bound and is reported as one; last resort `grep -rnE '<pattern>' --include='*.ts' --include='*.tsx' .` filtered through `grep -vE "$EXCLUDE_RE"` (`report-contract.md` §2) |
| `jq` | reading `--showConfig`, `package.json`, config dumps | `jq '.compilerOptions.strict' "$TMP/effective.json"` | `node -e 'console.log(JSON.stringify(require("./package.json").dependencies))'`, or read and quote the file |
| mypy / pyright / PHPStan / Psalm / Sorbet | non-TypeScript gradual checkers: strictness, imprecision, `mixed` usage, sigil level | every cache redirected out of the audited tree (§11): `mypy --strict --cache-dir "$TMP/mypy-cache" --txt-report "$TMP/mypy" src`; `XDG_CACHE_HOME="$TMP" npx --yes pyright@1.1.413 --outputjson`; `vendor/bin/phpstan analyse --level 9 --error-format=json -c "$TMP/phpstan.neon"` (that file sets `tmpDir` and includes the project's config); `vendor/bin/psalm --stats --no-cache`; `bundle exec srb tc` | annotation-density proxy plus a census of `# type: ignore`, `mixed`, `@psalm-suppress`, `git grep -c '# typed:' -- '*.rb' "${GIT_EXCLUDE[@]}"` |
| `openapi-typescript`, `graphql-codegen`, `buf`, `prisma` | schema → type drift; schema validity | regenerate into `$TMP` and `diff -u` (step 5); `npx --yes prisma@7.10.0 validate` | compare `git log -1 --date=short` on the schema against the generated file, and check whether CI regenerates |
| `gh` | whether the type-check is a *required* status check | `gh api repos/{owner}/{repo}/branches/<base>/protection --jq '.required_status_checks.contexts'` | read the CI config and mark enforcement unverified; that finding alone drops to `confidence: probable` |

## 6. Analysis rules and thresholds

| Condition | Threshold | Severity | Origin |
|---|---|---|---|
| Type coverage below `COVERAGE_TARGET` | < `COVERAGE_TARGET`, default 95 | S3 while within 5 points of the target, S2 within 20, S1 beyond — and never lighter than the absolute floor, S2 below 90 and S1 below 75. A project pinning 98 and measuring 96 files an S3: the band is relative, so no shortfall is ever unfileable | derived |
| `any` reaching a system boundary | one occurrence | S2 | requirements |
| External input with no runtime validation | one boundary class | S1 | requirements |
| Type-checker suppression (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `# type: ignore`, `@psalm-suppress`) with no justification comment | each site; separately, ≥ 30% of this audit's own suppression population unjustified | S3 per site; S2 at the 30% share | derived |
| `strict: false`, or `strictNullChecks: false`, in a project of `TSCONFIG_PATHS` | 1 project | S2 | derived |
| A strict subflag disabled while `strict` is on, or `noUncheckedIndexedAccess: false` | each flag | S3 | derived |
| `skipLibCheck: true` | 1 config | S4; S3 when the project publishes its own `.d.ts` to consumers | derived |
| Source files the checker never reads (`exclude`, `@ts-nocheck`, `allowJs` without `checkJs`) | > 5% / > 20% | S2 / S1 | derived |
| Type-check absent from CI, or present but non-blocking | 1 pipeline | S2; S1 when the unread-file share is also above 20% | derived |
| Types hand-duplicated from a `SCHEMA_SOURCES` entry with no drift check | per schema | S2; S1 when a diff demonstrates actual drift | derived |
| Protected-boundary share `PB` | < 80% / < 50% | S2 / S1 | derived |
| `unknown` narrowed by assertion instead of a check (`as T` straight off `unknown` or off `JSON.parse`) | each site | S2 on a boundary, S3 internally | derived |
| `unknown` declared and consumed with no narrowing at all, by step 2's narrowing test | each site | S3; S2 on a boundary | derived |

**The suppression population is partitioned, not shared.** That row counts the type-checker directives it names and nothing else, `# type: ignore` among them; linter suppressions
(`eslint-disable`, `noqa`, `phpcs:ignore`) are **A-05**'s row, filed there at the same per-site severity and the same 30% share, and this audit files none of them.

**The justified-`any` rule.** An `any`, a suppression or an assertion is *justified* — not a finding, aggregated into a single `S4` observation — when a comment on the same line or
within the three lines above names the external cause (an untyped dependency by name, a documented upstream defect with a link, a value handed to a validator on the next line)
**and** the value does not leave the module untyped. Everything else is an escape: two identical sites differing only by whether someone wrote that sentence are two different
findings, and §10 item 1 is why. Severity moves per `report-contract.md` §5; the context is named in the evidence.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only. **Sampling unit: the system boundary** — `N` counts boundaries read in full, `C` is the control draw from outside the top `N`. **Top-`N`
ranking**, in order: boundaries carrying untrusted external data; boundaries on the money, authentication or credential paths named by `BUSINESS_CONTEXT`; boundaries in the modules
with the highest escape density from step 2; boundaries whose type is generated from a schema. **The escape census is not sampled** — it is a cheap aggregate over 100% of tracked
files; what `C` verifies there is the patterns themselves, per §10 item 2. **Early stop:** the contract's control-sample stop, additionally requiring that all six boundary classes have
three boundaries read.

## 8. Report additions

Frontmatter carries `audit_id: A-06` and `audit_name: Типобезопасность`. Three additions, each in exactly one place:

1. **Карта границ системы** — the full table in **§7 Приложения**. Columns: `Граница` | `Класс` (one of the six) | `Точка входа` (`file:line`) | `Статический тип` | `Источник типа`
   (generated / hand-written / inferred / `any`) | `Рантайм-валидация` (validator or "нет") | `Уровень защиты` (`защищена` / `частично` / `не защищена`); every `не защищена` row is
   repeated verbatim as the evidence of the **§5 Детальные находки** finding that reports it.
2. **Таблица побегов по модулям** — the full table plus the trend in **§7 Приложения**. Columns: `Модуль` | `any` | `unknown (без сужения)` | `as` | `as unknown as` |
   `@ts-ignore` | `@ts-expect-error` | non-null | всего | на 1000 строк | обоснованных; the trend adds one row per sampled revision (date, SHA, escapes, non-blank lines,
   density), and the five densest modules are quoted in the **§5** finding.
3. **Эффективная конфигурация проверки** — one row per `TSCONFIG_PATHS` entry with the compile verdict, every flag of step 1 and the checked/present file ratio, in **§7
   Приложения**, as the evidence for §6's configuration findings: the strict flags, the disabled subflags, `skipLibCheck`, the files never read.

## 9. Score

```
TC  = type coverage, per cent                             (type-coverage --detail, or the checker's equivalent)
PB  = 100 × (2·protected + 1·partial) / (2 × boundaries)   protected-boundary share, per cent
TSS = round((TC + PB) / 2)
```

Unit: percentage points on 0–100. A boundary is `protected` when a runtime check rejects a mismatch **and** the static type derives from that check or from the schema; `partial`
when a non-`any` static type exists with no runtime check, or a check sits under a hand-written type nobody verified against it; `unprotected` otherwise. Report as
`TSS 61% (TC 88%, PB 34%)` — **never the composite alone**: the parts fail independently, and a high `TC` over a low `PB` is a codebase whose green build says nothing about the
data it receives. The justification names the component carrying the loss, the boundary class dragging `PB` down, and the two cheapest upgrades. When `TC` is a proxy (no coverage
tool, or `TYPE_REGIME=untyped`, where it becomes the share of boundaries with a machine-checkable contract) or fewer than five boundaries exist, mark the score an estimate.

## 10. Failure modes of this audit

1. **Reading laziness as intent, or intent as laziness.** An `any` wrapping an untyped third-party library is a different artefact from one that ends an argument with the compiler.
   Countermeasure: the §6 justified-`any` rule, applied by *reading* the sample.
2. **Regex counts presented as escape counts.** `: any` matches inside strings, comments and JSDoc; `as ` matches `import x as y`; the `!` pattern matches `!=` written without
   spaces. A pattern also fails *downward*: a word boundary the engine does not implement returns a confident zero. Countermeasure: open `C` hits per pattern and publish its
   false-positive rate, and prove every census pattern against a line holding one known match before believing a count of zero.
3. **A number quoted without the conditions that produced it.** A green `tsc --noEmit` says nothing about how much of the tree was read; `type-coverage` moves with `--strict` and
   the ignore list. Countermeasure: print the checked/present ratio beside every compile result and record each invocation beside its number.
4. **A boundary map built only from grep.** Queue consumers, webhooks, feature-flag payloads and SDK callbacks can be invisible to a pattern search. Countermeasure: cross-check
   `BOUNDARY_LIST` against A-01, ask for what code cannot show, list the unreachable ones.
5. **Filing "no TypeScript" as a finding.** On an `untyped` stack the absence of a type system is the premise, not the defect. Countermeasure: file unvalidated boundaries; adopting
   types is at most one `S3` finding carrying a migration cost.
6. **Validation that does not validate, and generation assumed fresh.** A discarded `safeParse` result, a schema applied after the value was used, a validator exercised only in
   tests; an `@generated` header proves how a file was made, not when. Countermeasure: read each `protected` boundary's call site for a rejecting failure branch, and settle drift
   with step 5's dates or a regeneration diff into `$TMP` — with neither, write `confidence: hypothesis` and name the check.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9:

- **Do not run a generator that writes into the repository** — `prisma generate`, `graphql-codegen` on the project's config, `protoc` into the source tree, `npm run generate`,
  `openapi-typescript -o <repo path>`. Redirect into `$TMP` and diff, or use step 5's dates.
- **Do not compile, and do not let a checker leave its cache in the audited tree.** `tsc` reaches this audit only through `--noEmit`, which `--listFiles` and `--showConfig` do not
  imply. Every gradual checker writes a cache into the working directory by default: redirect mypy with `--cache-dir "$TMP/mypy-cache"`, `tsc` with
  `--tsBuildInfoFile "$TMP/tsbuildinfo"`, PHPStan with a `tmpDir` in a `$TMP` config, Psalm with `--no-cache`. A `.mypy_cache/` left behind is an edit.
- **Do not populate a missing `node_modules` to make a checker runnable** — no `npm ci`, no `npm i -D`, no `pip install`, no `composer require`. A checker that cannot run is
  recorded in `tools_unavailable` and its step falls back to the `git grep` census.
- **Do not edit `tsconfig.json`, `eslint.config.*`, `.eslintrc`, `mypy.ini` or any checker config** to obtain a stricter measurement. Use write-free CLI overrides —
  `tsc -p tsconfig.json --noEmit --strict --tsBuildInfoFile "$TMP/tsbuildinfo"`, the build-info flag included for the reason above — `eslint --print-config`, or a throwaway config
  in `$TMP`.
- **Do not read `.env`, `.env.local` or any secrets export** while auditing environment-variable typing. Use `.env.example`, the config schema, the CI variable declarations and the
  `process.env.X` sites — this audit needs the variable *names*.
- **Do not execute the application, its dev server or its test suite** to observe validation at runtime. Read the validator call sites and the tests that cover them instead.
- **Do not `git blame` the suppressions.** This is where the contract's ban on evaluating people meets a concrete temptation, because every `@ts-ignore` has an author. Escapes
  belong to modules; the trend runs over revisions, never over people.

## 12. Dependencies

**On input**: **A-01** — the component register and `SCOPE_*`, which seed `BOUNDARY_LIST` and say which components are alive; absent, derive boundaries from step 3's search alone
and record the weakening. **A-05** — code metrics, the lint configuration's state and the linter-suppression counts, a population disjoint from this audit's type-checker census
rather than an overlapping one; absent, step 2 stands alone. **On output:** **A-11** takes the boundary map and the generated-versus-hand-written verdict per schema source,
**A-13** its form, route-parameter and browser-storage rows with their protection levels, and **A-14** the external inputs with no runtime validation as the untrusted-input
surface. A missing input never blocks the run — `audit-index.md` states the rule.

## 13. Nearest marvin command

`audit-index.md` lists no marvin command against A-06. The nearest is **`/marvin:task-verify`**, whose `verify` tool runs the project's own type-check gate: it answers "does it
compile", which is step 1's exit code and nothing more — no coverage, no escape census, no boundary map. Use it as an accelerator for that one result, and treat its output as
evidence to verify, never a section to paste. **`/marvin:refactor-smells`** may surface `any` usage in a scoped register, a remediation list rather than a measured distribution;
**`/marvin:sec-scan`** overlaps only on the consequence of an unvalidated input, handed here to A-14.
