# Audit index

The twenty-two audits, their files, their waves, and what each one needs and produces. This is
the routing table: `audit-run` resolves a request to exactly one row, `audit-plan` orders rows
into waves, `audit-summary` consolidates their reports.

Every spec lives at `skills/audit-run/references/audits/A-XX-<slug>.md`.

## The catalogue

| Id | Slug | Name | The question it closes | Wave |
|---|---|---|---|---|
| A-01 | `system-inventory` | Инвентаризация систем | What does the project physically consist of, and which parts are alive? | 0 |
| A-02 | `onboarding` | Onboarding-аудит | How much time and undocumented knowledge does a new developer need to make a first change? | 0 |
| A-03 | `dependencies` | Аудит зависимостей | Are the dependencies current, maintained and legally clean? | 0 |
| A-04 | `repo-history` | Анализ истории репозитория | Where are the problem areas, judged by how the code behaves over time? | 0 |
| A-05 | `static-analysis` | Статический анализ кода | What is the measurable state of the codebase, and is discipline enforced automatically? | 1 |
| A-06 | `type-safety` | Типобезопасность | Does the type system actually protect, or only appear to? | 1 |
| A-07 | `tests` | Аудит тестов | Do the tests protect against regressions in what actually matters? | 1 |
| A-08 | `dev-process` | Аудит процесса разработки | How does a change travel from idea to production, and where does it stall? | 1 |
| A-09 | `module-boundaries` | Границы модулей и граф зависимостей | Does the actual dependency structure match the declared architecture? | 2 |
| A-10 | `data-model` | Модель данных и миграции | Will the schema survive the product's growth, and are changes reversible? | 2 |
| A-11 | `api-contracts` | Контракты API | How predictable are the interfaces for consumers, and how safe to change? | 2 |
| A-12 | `integrations` | Внешние интеграции и отказоустойчивость | What happens when each external dependency fails? | 2 |
| A-13 | `frontend-architecture` | Фронтенд-архитектура | Does the client scale, or does each feature add entropy? | 2 |
| A-14 | `security` | Безопасность | Which paths lead to unauthorised access, leakage or data corruption? | 3 |
| A-15 | `performance` | Производительность | Where does the system spend time and resources out of proportion to value? | 3 |
| A-16 | `observability` | Наблюдаемость | Can an incident be investigated from telemetry alone? | 3 |
| A-17 | `cicd` | CI/CD и конвейер поставки | How fast, predictable and reversible is the path to production? | 3 |
| A-18 | `reliability` | Надёжность и восстановление | What happens when a component or data is lost, and how long is the way back? | 3 |
| A-19 | `cost` | Стоимость владения | Where does infrastructure money go, and what of it creates no value? | 3 |
| A-20 | `documentation` | Документация и распределение знаний | Which knowledge exists only in people's heads? | 4 |
| A-21 | `accessibility` | Доступность | Can a user with impairments complete the key scenarios? | 4 |
| A-22 | `privacy` | Приватность и соответствие требованиям | What personal data is processed, on what basis, and what happens on a deletion request? | 4 |

Waves express **data dependency, not importance**. Wave 0 has no inputs and runs first. Wave 4
may run alongside any other wave.

## Dependency matrix

Inputs arrive as **parameter values** — a path to a finished report, or the values copied out of
one — never as remembered context from another session.

**The two columns are one relation, read from both ends.** "Hands to" is derived from "Needs on
input": audit X hands to exactly the audits that name X. Do not edit one column alone — the
`audit-index.md` half of `test/audit-family.test.mjs` checks that every audit appears in the
matrix once, and each spec's section 12 is written against both directions of this table. The
source requirements state the two columns independently and disagree with themselves in five
cells; this table takes the input column as authoritative and completes the output column from
it. A-01 → A-17 is the one edge that is optional on the input side: A-17 takes A-01's environment
map when it exists and derives its own otherwise, so the pair is qualified in both columns rather
than treated as a wave dependency — A-17 stays in wave 3, behind A-07 and A-08.

| Audit | Needs on input | Hands to |
|---|---|---|
| A-01 | — | component register, environment map, `SCOPE_*` → A-02, A-03, A-04, A-06, A-08, A-09, A-10, A-11, A-12, A-16, A-17 (the environment map only), A-19 |
| A-02 | A-01 | onboarding log → A-20 |
| A-03 | A-01 | dependency register → A-14, A-15 |
| A-04 | A-01 | hotspots, bus factor, temporal coupling → A-05, A-07, A-09, A-20 |
| A-05 | A-04 | code metrics, hotspot read-out → A-06, A-09, A-13 |
| A-06 | A-01, A-05 | boundary map → A-11, A-13, A-14 |
| A-07 | A-04, `BUSINESS_CONTEXT` | critical-flow coverage → A-17 |
| A-08 | A-01 | process metrics → A-17, A-20 |
| A-09 | A-01, A-04, A-05 | module graph and rules → A-13 |
| A-10 | A-01 | data schema, index and migration register → A-14, A-15, A-18, A-22 |
| A-11 | A-01, A-06 | operation inventory and contracts → A-12, A-14 |
| A-12 | A-01, A-11 | failure matrix → A-16, A-18 |
| A-13 | A-05, A-06, A-09 | frontend map, component catalogue → A-15, A-21 |
| A-14 | A-03, A-06, A-10, A-11 | security risks → A-22 |
| A-15 | A-03, A-10, A-13 | bottlenecks → A-19 |
| A-16 | A-01, A-12 | telemetry gaps → A-18 |
| A-17 | A-07, A-08, A-01's environment map when available | delivery metrics → A-18, A-19 |
| A-18 | A-10, A-12, A-16, A-17 | SPOF, RTO/RPO → A-19 |
| A-19 | A-01, A-15, A-17, A-18 | — |
| A-20 | A-02, A-04, A-08 | — |
| A-21 | A-13 | — |
| A-22 | A-10, A-14 | — |

**A missing input never blocks a run.** When a prerequisite report was not supplied, the audit
derives what it can for itself, records in *Границы достоверности* which input was absent and
what that weakens, and lowers `confidence` accordingly. An audit that refuses to start because a
predecessor is missing is worse than an audit that runs honestly at `medium`.

## Audits that may not apply

- **A-13** and **A-21** are skipped when the project has no user interface. Say so and produce no
  report rather than producing an empty one.
- **A-06** applies to gradually typed languages. On an untyped stack it becomes an audit of
  contract checks at the boundaries; the spec says how.
- **A-19** and parts of **A-16**, **A-17**, **A-18** need access beyond the repository. Without
  it they run over what is in code and configuration, and the report says which questions could
  not be answered.

## Where each audit meets an existing marvin command

The audits are **self-contained**: each carries its own collection protocol and does not call
another command to do its work. This table exists so a run can tell the user what already exists
beside it, and so a reader is not surprised to see two reports about the same territory. An
existing command may be used as an accelerator when it is faster than running the tool directly,
but its output is evidence to verify, never a section to paste.

| Audit | Nearest command | How they differ |
|---|---|---|
| A-02 | `/marvin:onboard` | `onboard` introduces marvin in a project; A-02 measures time-to-first-run and counts undocumented steps |
| A-03 | `/marvin:sec-deps` | `sec-deps` ranks vulnerabilities; A-03 measures currency, maintenance health, licences and bundle weight, and defers CVEs to A-14 |
| A-04, A-05 | `/marvin:refactor-audit`, `/marvin:refactor-smells` | the refactor family produces an actionable register scoped to remediation; A-04/A-05 produce measured distributions, thresholds and trends over history |
| A-09 | `/marvin:refactor-audit` | A-09 checks the graph against **declared** architecture rules and drafts machine-checkable rules for CI |
| A-14 | `/marvin:sec-scan`, `/marvin:sec-secrets` | `sec-scan` is the OWASP-aligned scan; A-14 additionally builds the role × resource × operation matrix and the per-endpoint ownership check |
| A-17 | `/marvin:sec-ci` | `sec-ci` audits pipeline security; A-17 measures delivery — duration, flake share, rollback time, environment parity |
| A-20 | `/marvin:adr-coverage`, `/marvin:docs-search` | A-20 tests documentation for **truth**, not presence, and crosses it with bus factor |

## Choosing when the request is vague

"Проведи аудит проекта" is a request for the **programme**, not for one audit: route it to
`audit-plan`. A request naming a subject ("аудит зависимостей", "посмотри на тесты", "насколько
мы готовы к инциденту") resolves to one row above. When two rows fit, name both and ask; when the
request names a subject no row covers, say so rather than stretching the nearest audit over it.
