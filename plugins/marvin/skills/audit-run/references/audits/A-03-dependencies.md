# A-03 — Аудит зависимостей

> **Audit question.** Are the project's dependencies current, maintained and legally clean?

## 1. Role and task

You audit the dependency estate of a project you did not build: how far declared and resolved packages have drifted
from upstream, how likely each upstream still exists next year, whether the licence set fits how the product is
distributed. A run leaves the report, a disposition for **every** direct dependency, and §12's two handover tables.

## 2. Audit-specific parameters

| Parameter | Meaning | Default and derivation when unset |
|---|---|---|
| `PACKAGE_MANAGERS` | ecosystems and managers in play | derive from tracked manifests and lockfiles at `COMMIT_SHA`: `git ls-files \| grep -E '(^\|/)(package\.json\|package-lock\.json\|yarn\.lock\|pnpm-lock\.yaml\|requirements.*\.txt\|pyproject\.toml\|poetry\.lock\|uv\.lock\|go\.mod\|Cargo\.toml\|pom\.xml\|build\.gradle.*\|Gemfile\|composer\.json)$'`, refined by `package.json`'s `packageManager` field and the CI install step. Never ask |
| `LICENSE_POLICY` | allowed **and** forbidden SPDX ids — both lists, because the §5 tools that enforce a policy accept an allowlist only | look for an in-repo policy: `deny.toml` `[licenses]`, `.licenserc*`, `license-policy.json`, a CI licence step, the project's own `LICENSE`. If none, **ask the user**. With no answer apply the stated fallback — forbidden = `AGPL-3.0*`, `GPL-2.0*`, `GPL-3.0*`, `SSPL-1.0`, `BUSL-1.1`, `Elastic-2.0` **when the project's own licence is not itself copyleft**, and `allowed` = the ids of step 5's histogram minus `forbidden`, so an allowlist-shaped tool still has an input; unresolved and `UNKNOWN` are always reported; everything else is listed without a verdict — record it in *Границы достоверности* and apply T4's cap |
| `BUNDLE_BUDGET` | client-bundle ceiling, with unit | derive from `.size-limit.json`, the `size-limit`/`bundlesize` key in `package.json`, a Lighthouse CI `budget.json`, or webpack `performance.maxAssetSize`. If none, leave null: shares are computed against the measured production total and no "over budget" finding is filed |
| `BUNDLE_ARTIFACT` | path to an existing production bundle directory or a bundler `stats.json` | never produced by this audit (§11): take a tracked artefact directory present at `COMMIT_SHA` (`dist/`, `build/`, `.next/`), else ask the user to run their own build and pass the path. Unset and absent, step 6 is `not run` and T6 is not filed |

`BUSINESS_CONTEXT` (contract §2) names T3's critical dependencies and the distribution model behind T4's severity. Ask
before filing a licence finding; with no answer, apply T4's cap and say so.

## 3. Scope

### In scope

Direct and transitive dependencies of every manager in `PACKAGE_MANAGERS`; lockfile state; currency; duplicate and
conflicting resolutions; unused and undeclared packages; maintenance health; licences across the resolved tree;
per-package share of the client bundle; automated updating. Exclusions are `report-contract.md` §2's canonical set,
with no additions and one keep-in: **lockfiles**, which it drops and this audit reads as its resolved-version source.

### Out of scope

- **CVEs and supply-chain integrity** (install scripts, git or URL dependency sources, typosquatting, provenance) →
  **A-14**, linked through `blocks`: two majors behind is a currency finding here, vulnerable is a finding there.
  Vulnerability rows surface in nearly every tool of §5 and are collected only as the A-14 handover list, never filed
  here. The lockfile's own state — missing, competing, drifted — is the exception: it is filed here alone under T0,
  and A-14 keeps the install-script and non-registry-source half of that territory.
- **Runtime cost of a dependency** → **A-15** (bytes here, not time); **build and chunking architecture** → **A-13**;
  **pipeline speed of the update** → **A-17**; **internal cross-module dependencies** → **A-09**; **vendor spend** →
  **A-19**. **Container base images and OS packages** — uncovered by the family; say so in *Границы достоверности*.

## 4. Collection protocol

Steps 1–7 follow the source protocol's order, with 1b added for lockfile state; all but 4 cover the whole population
(4 is sampled, §7) and 1, 4, 5 cost registry calls. Baseline: `PACKAGE_MANAGERS`, `git rev-parse HEAD`,
`git status --porcelain` dirt, each lockfile's date (`git log -1 --format=%cs -- package-lock.json`), and
`[ -d node_modules ] && echo present || echo absent`. §11 forbids creating a tree, so **absent is the normal starting
state**: tools needing one are marked † in §5 and recorded in `tools_unavailable`, a licence set measured without one
holds `confidence` at `medium` or below, and counts come from the **lockfile**.

**1. Direct dependencies with major/minor/patch lag.** †`npm outdated --long --json || true` per workspace (exit 1
means "outdated", not failure; with no install tree it prints `MISSING` as every current version, so take the fallback
instead); manager-independent fallback, one registry call each:
`for p in $(jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' package.json); do printf '%s\t%s\n' "$p" "$(npm view "$p" version 2>/dev/null)"; done`.
*Produces:* per direct dependency — declared range, resolved, latest, `major_lag`, `minor_lag`, `patch_lag`, and a
runtime / build / test class from its manifest section. Feeds §8 and §9.

**1b. Lockfile state.** Which lockfiles are tracked (`git ls-files` over §2's names), which are present but ignored
(`printf '%s\n' <§2's lockfile names> | git check-ignore -v --stdin || true`; exit 1 means none is), and where two
managers claim one ecosystem. Name-level manifest-vs-lock drift, no install required:
`comm -13 <(jq -r '(.packages."" // {}) | (.dependencies // {}) + (.devDependencies // {}) | keys[]' package-lock.json | sort -u) <(jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' package.json | sort -u)`
— on `lockfileVersion: 1` take the lock's root set from `.dependencies | keys[]`; registry hosts from
`jq -r '.. | .resolved? // empty | select(test("^https?://"))' package-lock.json | awk -F/ '{print $3}' | sort -u`,
whose `select` drops a workspace link — its `resolved` is a relative path, not a host. Quoted as hosts only (§11).
*Produces:* per manager — lockfile committed / ignored / absent, competing lockfiles, declared names unresolved in the
lock, distinct `resolved` hosts. Feeds T0.

**2. Transitive tree: duplicates, conflicts, depth.** †`npm ls --all --json 2>/dev/null || true` for peers and depth;
duplicates from the lockfile, never from the install tree:
`jq -r '(.packages // {}) | to_entries[] | select(.key | startswith("node_modules/")) | [(.key | split("node_modules/") | last), (.value.version // "?")] | @tsv' package-lock.json | sort -u | cut -f1 | uniq -c | sort -rn | head -30`.
`lockfileVersion: 1` has no `.packages` and the unguarded form exits 5 — read the nested tree instead:
`jq -r 'def d: to_entries[] | .key as $n | .value | ([$n, (.version // "?")]), ((.dependencies // {}) | d); (.dependencies // {}) | d | @tsv' package-lock.json`.
*Produces:* resolved package count, the duplicate table (package → distinct versions), the unmet-peer list, and
maximum depth as the longest `node_modules/` nesting.

**3. Dead dependencies, both directions.** Declared-but-unimported: `npx --yes depcheck@1.4.7 --json`, or
`for p in $(jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' package.json); do printf '%s\t%s\n' "$(git grep -l -F "$p" -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.mjs' '*.cjs' '*.vue' | wc -l)" "$p"; done | sort -n`
— a zero is a candidate, never a verdict (R3). Imported-but-undeclared:
`git grep -hoE "(from|require\()[[:space:]]*['\"][^'\"]+['\"]" -- '*.ts' '*.tsx' '*.js' '*.jsx' | grep -oE "['\"][^'\"]+['\"]" | tr -d "\"'" | grep -v '^[./]' | awk -F/ '/^@/{print $1"/"$2; next} {print $1}' | sort -u`,
then `comm -23` against the declared set plus the runtime's built-ins. *Produces:* removal candidates with evidence,
and undeclared imports with their importing file.

**4. Health of each significant dependency.** Over the §7 sample, one registry call per package — what `DEPTH`
budgets: `npm view "$p" time.modified maintainers deprecated repository.url --json`. The registry carries **no
archival state**: parse `owner/repo` from `repository.url` and ask the host,
`gh repo view "$owner/$repo" --json isArchived,archivedAt,pushedAt`; without `gh`, `git ls-remote "$url" HEAD`
liveness plus the README's deprecation banner; with neither, `deprecated` alone, recording `archived: unknown`, never
`false`, so T2's `S1` override cannot fire on a missing signal. *Produces:* per package — last release, months since,
maintainer count, deprecated flag, archived true/false/unknown, successor or none.

**5. Licences of the whole tree against policy.** The floor needs no install tree: take every distinct
`(name, version)` from the lockfile (step 2's pass; other managers through the same `jq`/`grep` route), then
`npm view "$p@$v" license --json` once per distinct package — step 4's per-package cost, over the whole tree. Where a
tree exists, †`npx --yes license-checker@25.0.1 --production --json` (plus a run without `--production`) adds file
evidence; †`npx --yes license-compliance@4.0.0 --production --format json --allow "<allowed, `;`-separated>" || true` checks
conformance — it exits 1 on a violation and knows allowlists only, which is why §2 requires an allowed list. Resolve
`UNKNOWN` and dual expressions against the package's own `LICENSE` where one is on disk; otherwise the id stays
`UNKNOWN` and R4's cap applies. *Produces:* the licence histogram, and the violation list — package, version, licence,
the policy list it hit, whether it is on the distributed path, and which route produced it.

**6. Bundle contribution by package (frontend only).** Over an **existing** production artefact only —
`BUNDLE_ARTIFACT` when supplied, else a tracked artefact directory; §11 forbids producing one:
`npx --yes source-map-explorer@2.5.3 '<artefact>/**/*.js' --json` where sourcemaps exist, else
`find <artefact> -name '*.js' -exec wc -c {} + | sort -n | tail -20` and `gzip -c … | wc -c`. With no artefact, record
the step in `tools_unavailable` and skip it. *Produces:* production JS bytes raw and gzipped, per-package share as a
percentage, the ranked heavy list.

**7. State of automated updating.** `git ls-files | grep -iE 'dependabot|renovate'` for configuration;
`gh pr list --state open --limit 100 --json number,title,author,createdAt` for the backlog, counting bot-authored
rows; without `gh`, `git log --since='12 months ago' --format='%s' | grep -icE 'dependabot|renovate|bump '` plus the
baseline lockfile date. *Produces:* bot configured yes/no with schedule and grouping, open bot PR count, oldest open
bot PR in days, merged updates over 12 months.

## 5. Tools

The floor is `git`, `jq`, POSIX and one registry call per package — no file in a bare checkout answers the currency or
licence question. **† marks a row reading an installed `node_modules/`**: §11 forbids creating one, so without a tree
those rows go to `tools_unavailable` and the fallback beside them measures. An `npx --yes <tool>@<version>` cell is the
on-demand form; acquisition follows `report-contract.md` §9, and each pin is the version this spec was written against.

| Tool | Measures (step) | Invocation | Fallback when absent |
|---|---|---|---|
| †`npm outdated` | direct lag (1) | `npm outdated --long --json \|\| true` | the `npm view "$p" version` loop of step 1 — also the route with no install tree, where the tool prints `MISSING` |
| †`npm ls` | resolved tree, peers, depth (2) | `npm ls --all --json 2>/dev/null \|\| true` | the `jq` pass over `package-lock.json` in step 2, in its `.packages` or `lockfileVersion: 1` form |
| `npm view` | health metadata, licences (4, 5) | `npm view "$p" time.modified maintainers deprecated repository.url --json`; `npm view "$p@$v" license --json` | †`node_modules/$p/package.json`; else release date recorded unavailable and the licence `UNKNOWN` |
| `gh repo view` | archived flag, successor (4) | `gh repo view "$owner/$repo" --json isArchived,archivedAt,pushedAt` | `git ls-remote "$url" HEAD` liveness plus the README's deprecation banner; else `archived: unknown` |
| `depcheck`, `knip` | declared-but-unused, unused exports (3) | `npx --yes depcheck@1.4.7 --json`; `npx --yes knip@6.34.0 --reporter json \|\| true` | each other, then the `git grep -l -F` loop of step 3 |
| †`license-checker` | licences of the tree (5) | `npx --yes license-checker@25.0.1 --production --json` | the lockfile + `npm view "$p@$v" license --json` pass of step 5 |
| †`license-compliance` | conformance to an allowlist (5) | `npx --yes license-compliance@4.0.0 --production --format json --allow "MIT;ISC;…" \|\| true` (exit 1 = non-compliant; no deny option exists) | `license-checker`, then step 5's registry pass, with conformance to `forbidden` computed here |
| bundle analyzer | per-package share (6) | `npx --yes source-map-explorer@2.5.3 '<artefact>/**/*.js' --json`; or `npx --yes webpack-bundle-analyzer@5.3.2 <stats.json> --mode json --report "$OUTPUT_DIR/bundle.json" -O` over an existing stats file (`--mode static` emits an interactive treemap and opens a browser) | `find <artefact> -name '*.js' -exec wc -c {} +` plus `gzip -c … \| wc -c`; with no artefact, step 6 is `not run` |
| `pip-audit`, `uv` | Python resolved set, lag and tree (1, 2) | `pip-audit --format json` (its CVE rows go to A-14 unread here); `uv pip list --outdated --format json`, `uv pip tree` — both read a resolved environment | `pip list --outdated --format=json`, `pipdeptree --json-tree`; with no environment, parse `uv.lock`/`requirements*.txt` and query PyPI once per name |
| `gh pr list` | bot backlog (7) | `gh pr list --state open --limit 100 --json number,title,author,createdAt` | the `git log --grep` count of step 7; else ask the user |
| stack equivalents | currency and tree, non-npm ecosystems (1, 2) | `yarn outdated --json` (**Yarn 1 only**: Berry removed it, and `yarn upgrade-interactive` is interactive and mutating, forbidden by §11 — on Berry use `yarn npm info "$p" --fields version --json` once per direct dependency, `yarn info --all --recursive --json` covering the tree half only and carrying no `latest`); `pnpm outdated`, `pnpm list --depth Infinity`; `poetry show --outdated`, `poetry show --tree`; `go list -m -u all`, `go mod graph`; `cargo outdated`, `cargo tree --duplicates`; `mvn versions:display-dependency-updates`, `mvn dependency:tree`; `bundle outdated --parseable` (installed gem set); `composer outdated --format=json`, `composer show --tree` | parse manifest and lockfile with `git`/`jq`/`grep` as in §4, then query each name once against its registry |
| stack equivalents | unused and licences, non-npm ecosystems (3, 5) | `deptry .`, `pip-licenses --format=json` (resolved environment); `go mod tidy -diff` (read-only, **Go >= 1.23**; older toolchains reject the flag — fall back to `go mod why -m` per module plus step 3's import diff), `go-licenses report ./...`; `cargo udeps` (nightly, optional), `cargo deny check licenses`; `mvn dependency:analyze`; †`pnpm licenses list`; `composer licenses --format=json`; `license_finder` where installed | the `git grep` import-vs-declare diff of step 3; licences from step 5's lockfile + registry pass, and from each installed package's manifest and `LICENSE` where a tree exists |

## 6. Analysis rules and thresholds

A dependency is **critical** when it is a runtime dependency that either sits on a flow named in `BUSINESS_CONTEXT` or
is in the top decile by importing-module count (`git grep -l -F "$p" | wc -l`).

| Id | Condition | Threshold | Severity | Origin | Overrides |
|---|---|---|---|---|---|
| T0 | lockfile missing, competing or drifted (step 1b) | for a manager in `PACKAGE_MANAGERS`: `committed_lockfiles == 0`, or `>= 2` lockfiles for one ecosystem, or `>= 1` declared dependency unresolved in the lock | `S2` | `derived` | `S1` when the project is deployed from source (CI installs at deploy, no published artefact); `S3` when the manager serves a dev-tooling workspace only; a `resolved` host outside the manager's default registry is a separate `S3`, raised to `S2` when nothing in the repo configures that host |
| T1 | direct dependency behind on majors | `major_lag >= 2` | `S2` | `requirements` | `S1` when the major in use is out of support or has no security branch; `S3` when the package is test-only and not shipped |
| T2 | no upstream release for a long period | `months_since_last_release > 24` | `S3` | `requirements` | `S2` when the package is critical; `S1` when critical, archived and without a named successor — never on `archived: unknown` |
| T3 | single maintainer on a critical dependency | `maintainers == 1` and critical | `S2` | `requirements` | `S1` combined with T2; not filed at all for a non-critical package — it goes to the appendix table instead |
| T4 | licence outside `LICENSE_POLICY` | `forbidden_on_distributed_path >= 1` distinct packages | `S1` | `requirements` | `S3` when the licence resolves but is in neither list; `S3` with `confidence: probable` when it stays `UNKNOWN`, or when no `LICENSE` file was readable (R4); **capped at `S2` whenever `LICENSE_POLICY` was assumed rather than supplied**, with the cap named in the finding |
| T5 | one package resolved at many versions | `distinct_versions >= 3` | `S3` | `requirements` | `S2` when the package carries process-global state (runtime registry, polyfill, singleton client) or its combined share crosses T6; inapplicable on Go, which resolves one version per module — say so rather than reporting zero |
| T6 | one package dominates the bundle | `package_bytes / total_production_js > 10%` | `S3` | `requirements` | `S2` when the total also exceeds `BUNDLE_BUDGET`; not filed when `BUNDLE_BUDGET` is null **and** no production artefact was measured |

No `S0` here: the worst outcome is legal exposure or forced re-engineering, `S1` on contract §5's scale. **A
transitive package is never filed alone** — name the ancestor (`npm ls "$p"`, `go mod why -m "$m"`) and act on it. **A
workspace repeat is one finding.**

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit:** the dependency; `N` and `C` apply to **step 4** alone, over the direct dependencies, a transitive
  package entering only on T5, T6 or a T4 violation. **Top-`N`**, in order: runtime before build before test, then
  importing-module count, bundle share and `major_lag` descending. **`C`** is drawn from transitive packages.
- **Early stop:** the contract's control-sample stop, additionally requiring that every package crossing T1, T4, T5 or
  T6 has already been health-checked. Name the stop in *Границы достоверности*.
- **Coverage:** the unit is `direct deps`, `<analysed>` counts health-checked direct dependencies, the method is
  `top-N direct + C transitive controls`. The resolved total is context for *Методология*, never the denominator: step
  4 never sampled the transitive tree.

## 8. Report additions

| Addition | Goes in | Shape |
|---|---|---|
| Currency table | report §7 *Приложения* | one row per direct dependency, all of them: `пакет \| текущая \| последняя \| отставание \| риск (не обновлять) \| риск обновления \| усилие на обновление`. `отставание` is the `major.minor.patch` lag; `риск (не обновлять)` lists the threshold ids crossed, or `—`; `риск обновления` is `низкий`/`средний`/`высокий` with its basis stated — breaking changes between the resolved and the latest major, step 2's unmet peers for that package, whether upstream ships a migration guide, the call-site count as blast radius; `усилие на обновление` is person-days on that same basis, never a guess. Threshold-crossing rows are cited as evidence by the §5 finding that files them |
| Lockfile state | report §7 *Приложения*; one finding per manager in §5 *Детальные находки* when T0 fires | one row per manager, from step 1b: `менеджер \| lock-файл \| закоммичен \| конкурирующие \| дрейф с манифестом \| хосты реестров`. The drifted names and the non-default hosts are the finding's `evidence` |
| Removal candidates | report §5 *Детальные находки* | one finding over the whole set, with per-package evidence from step 3. Above ten packages the finding keeps the count and the summed effort and the list moves to §7 *Приложения* |
| Licence violations | report §5 *Детальные находки* | one finding per licence class, not per package, with the affected packages as `evidence`; the per-package licence inventory and the histogram go to §7 *Приложения* |
| Disposition split | report §7 *Приложения* | a two-column table `обновить сейчас \| зафиксировать и жить` placing **every** direct dependency exactly once, each justified in one line citing that package's `риск обновления` and `усилие на обновление`. This discharges R1; a report without it is incomplete |

## 9. Score

- **Freshness index `F`** = median over direct dependencies with a known latest version of
  `major_lag + minor_lag/100`. Unit: majors. Report `n`, the p90, the maximum and the source command; with no latest
  for most of the set, `F` is `null` and the report says why.
- **Blocking licence problems `B`** = count of **distinct packages** on the distributed path whose licence is in
  `LICENSE_POLICY.forbidden`, plus those still `UNKNOWN` after step 5. Unit: packages. Name the route that produced
  the ids — registry, install tree, or both — with the unresolved count; when neither answered for most of that path,
  `B` is `null` with the reason, never `0`, which would claim a clean tree nobody read.

Headline for report §2 *Итоговая оценка*: `A-03: freshness F = <x.xx> majors (n = <n>, p90 = <y>),
licence blockers B = <b>`. The justification names the distribution's shape (a low median with a long tail is not a
uniformly stale project), the largest contributor to `F`, and whether `B` used a supplied policy or the §2 fallback.

## 10. Failure modes of this audit

- **R1 — "update everything".** Every lag row becomes a finding, effort is never costed, and the register sums to a
  number nobody will spend. *Counter:* file a lag row only when it crosses a §6 threshold; carry `effort_days` and
  §8's `риск обновления` from the upstream's breaking-change list, step 2's unmet peers and the call-site count — the
  risk of updating is what makes "pin and live with it" defensible; fill §8's disposition table.
- **R2 — "latest" is not "correct".** `npm outdated` reports the `latest` dist-tag, possibly a major nobody has
  adopted or one a peer range blocks. *Counter:* check `npm view "$p" dist-tags --json` and step 2's unmet peers
  before filing T1; a package held back by a peer constraint is one finding about the constraint, not `n` about
  dependents.
- **R3 — the grep said zero, so it is dead.** A package reached through a config string, a bundler plugin, a
  `postinstall` script or a convention-based loader has no import; removing it breaks the build. *Counter:* re-search
  each candidate across config, CI and non-source files; recommend "verify, then remove" at `confidence: probable`.
- **R4 — licence taken from a metadata field.** The `license` key — in a manifest or in the registry's answer — is
  stale, absent or dual on a meaningful share of packages, so a T4 filed on it alone is an invented legal claim.
  *Counter:* nothing above `S3` without reading the package's own `LICENSE` and quoting its path; with no install tree
  T4 caps at `S3` and `B` carries the unresolved count.
- **R5 — the wrong bundle denominator.** A share measured over a development build, or one counting sourcemaps and
  legacy chunks, makes T6's 10% meaningless. *Counter:* measure production JS only, record the artefact's provenance
  and date, and treat a missing artefact as `not run`.

## 11. Audit-specific prohibitions

Beyond contract §9.

- **Never run a command that resolves, installs, updates or deduplicates:** `npm install/ci/update`, `npm dedupe`,
  `npm audit fix`, `yarn install/up`, `yarn upgrade-interactive`, `pnpm install/update`, `pip install`,
  `uv sync/lock/add`, `poetry add/update`, `cargo update`, `go get`, `go mod tidy` **without** `-diff` (that form
  rewrites `go.mod` and `go.sum`; `go mod tidy -diff` only prints the changes and is the form this audit uses),
  `bundle update`, `composer update/require`. *Instead:* §5's read-only forms — an absent `node_modules/` is not a
  reason to install, it is §5's † branch.
- **Never regenerate or repair a lockfile to make a tool succeed.** Record the refusing tool in `tools_unavailable`
  and take its fallback; the lockfile's own state is measured in step 1b and filed under T0.
- **Never build the project to obtain a bundle to measure.** A build needs the install tree the first bullet forbids,
  and every bundler writes inside the repository whatever `--out-dir` says (`node_modules/.cache`, `.vite/`, `.next/`,
  `.turbo/`, `*.tsbuildinfo`). *Instead:* measure an existing artefact, or have the user run their own build and pass
  the path or `stats.json` as `BUNDLE_ARTIFACT`; with neither, step 6 is `not run` (R5).
- **Never remove a dependency to prove it is unused**, and never edit a manifest to test a resolution. *Instead:* step
  3's two-direction evidence plus R3's confirming search.
- **Never let a helper tool write outside `OUTPUT_DIR`** — no analyser report dropped beside the code it measured.
- **Never print registry credentials.** `.npmrc`, `.yarnrc.yml`, `~/.netrc`, `pip.conf` and `settings.xml` carry auth
  tokens beside the registry URLs this audit quotes: quote the host and the file path, never the token or a prefix.

## 12. Dependencies

**Input — A-01.** The component register: which manifests and workspaces are alive, which are vendored or dead, and
the `SCOPE_*` values derived from it. Absent, derive the manifest set from the §4 baseline, record the omission in
*Границы достоверности*, and hold `confidence` at `medium` or below.

**Output — A-14 and A-15.** A-14 receives the resolved dependency list, the licence inventory, the maintenance-health
table and the unfiled CVE list; A-15 the bundle-share table, the heavy-package ranking and the duplicate register.

## 13. Nearest marvin command

`/marvin:sec-deps` ranks known vulnerabilities and licence risk with remediation in view; A-03 measures currency,
maintenance health, licence conformance and bundle weight, and defers every CVE to A-14. Use it as an accelerator —
its output is evidence to verify against §5's commands, never a section to paste; say so in *Методология* if both ran.
