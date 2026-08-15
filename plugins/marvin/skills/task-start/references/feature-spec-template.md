---
slug: {kebab-case-slug}
type: feature
status: draft
created: {YYYY-MM-DD}
tracker: {#issue | PROJ-123 | URL | none}
supersedes: {prior-slug | none}
stack: {verified stack(s), comma-separated, e.g. typescript, shell | none}
risk: {low | medium | high}
breaking: {true | false}
spike_required: false
test_command: {command that runs the tests, e.g. "npm test" | none}
---

# {Title}

## Goal
{what this task delivers, and why — one or two sentences}
Be specific: "add X for Y", never "improve X".

## Context
- Related patterns: {existing code this builds on — file:line}
- Callers / reverse-deps: {who calls or depends on the surface you change — file:line, or "none"}
- Constraints: {tech-debt, architectural boundaries, performance budgets}
- Sibling specs: {related entries under .marvin/task/ (or the host's spec dir), or "none"}

## Spec Contract
The authoritative, machine-validated contract (the `spec` DoR gate parses and schema-checks this
block). The implementer/executor may touch **only** the files listed in `files`; each criterion is
implemented by exactly its `implemented_by` rows and proven by its `oracle`. A test named in a
`kind: test` oracle MUST also appear as a `files` row — the allowlist forbids an unlisted file.
Use `<…>` for prose to fill; never leave a `{…}` placeholder (it parses as a YAML map and fails the
gate).

```yaml spec-contract
files:
  - id: F1
    path: path/to/existing/file.ts
    action: edit          # new | edit | delete
    intent: what changes and why
    satisfies: [AC1]      # the criteria this file implements, or "—" for infra rows
    anchor: path/to/existing/file.ts:42
  - id: F2
    path: path/to/new/file.ts
    action: new
    intent: why this file exists
    satisfies: [AC2]
  - id: F3
    path: test/path.test.ts
    action: new
    intent: tests for the criteria below
    satisfies: [AC1, AC2]
build_order: [F1, F2, F3]   # optional — deterministic order the executor applies the files
depends_on: []              # sibling spec slugs this depends on; each MUST be status: shipped (or [])
contract:
  kind: function            # function | route | schema | cli | event | none
  signature: |
    exactName(arg: ArgType): ReturnType   // throws WhichError
criteria:
  - id: AC1
    statement: Given <state>, when <action>, then <result>
    implemented_by: [F1, F3]
    oracle:
      kind: test            # test | command | prose-review
      ref: test/path.test.ts::the test name
      run: <exact command>  # optional — how to run THIS test alone. Without it the runner falls
                            # back to `gates.test_one` in .marvin/config.json, then to a narrow
                            # per-stack default, then records `not-run` rather than guessing.
    failure: what the wrong behaviour looks like
  - id: AC2
    statement: <observable behaviour>
    implemented_by: [F2, F3]
    oracle:
      kind: command
      ref: npm run build
    failure: <how it fails>
  - id: AC3
    statement: <observable behaviour>
    implemented_by: [F1]
    oracle:
      kind: prose-review    # at least one criterion must carry a non-prose-review oracle
    failure: <how it fails>
```

## Host Bindings
Discovered from **this repo**, not assumed (task-start populates these from the host's conventions).
Optional and advisory — the gate uses `spec_location` to resolve `depends_on`; the rest records where
the spec lives and what the host requires to merge. Fill with `<…>`, never `{…}`.

```yaml host-bindings
spec_location: .marvin/task/     # where specs/RFCs live (default .marvin/task/, or the host's own convention)
decision_record:                 # the host's ADR/RFC convention, if any
  style: <madr | nygard | none>
  path: docs/adr/
merge_obligations:               # what THIS host needs to merge (from CONTRIBUTING / CI)
  - <e.g. "ruff + mypy green (.pre-commit-config)">
gates:                           # the host's actual gate commands
  test: <the test command>
```

## Data & Config
{migrations, new env vars, feature flags, config keys — or "N/A"}
State a migration in both directions: forward and rollback.

## Chosen Approach
{The selected variant, concrete enough to implement without further human input.}

**Stack compliance:** NATIVE | EXTENSION | EXPERIMENTAL
**Future alignment:** ALIGNED | NEUTRAL | CONFLICTS | N/A

**Stack extensions required:**
- {dependency} — {rationale}   ({omit or "none" if NATIVE})

## Why this over alternatives
- Variant {N} (rejected): {reason grounded in a project constraint, not generic}
- Variant {N} (rejected): {reason}

## Test Plan
- Harness: {test runner + command — matches frontmatter test_command}
- Test locations: {directory/convention where new tests live — grounded in existing neighbors}
- Conventions: {fixture/mocking/setup patterns observed in sibling tests, or "none"}

## Definition of Done
Merge-readiness beyond the acceptance criteria. Host-specific obligations are whatever **this repo**
requires to merge — discovered from its `CONTRIBUTING`, CI config, or `CLAUDE.md`/equivalent — and
must appear as `files` rows in the contract if they touch files.

- [ ] {test_command} green
- [ ] lint / type-check / build green (whichever the host runs)
- [ ] docs / changelog updated if the host expects them (required if `breaking: true`) — or "N/A"
- [ ] host-specific merge obligations (e.g. a version bump, a committed build artefact, a generated file) — or "none"

## Non-goals
- {what is explicitly NOT in scope}

## Deferred slices
Slices split off from this task at the scope gate, each already a board card. The rows are
descriptive — the card is the work item, this list is the back-reference. Write `none` when nothing
was deferred: an unfilled section is reported by the DoR gate, an absent one is silent.

- {board id + one-line scope + why it is a separate PR, or none}

## Assumptions
{each decision taken under uncertainty — or "none"}
Record them so the implementer inherits the decisions rather than re-deciding them. Every default
the intake assumed instead of asking belongs here, written as "assumed X because Y; correct now if
wrong". "none" is an accepted value; the DoR gate records it as an advisory warning, not a failure.

## Open Questions
{any question still unresolved — MUST be "none" before DoR passes}
An open question is a reason to keep authoring, not to dispatch. A genuine unknown that needs
investigation is NOT an Assumption: set `spike_required: true` and resolve it (e.g. a spike via
`/marvin:track-new`) first.

## Security / NFR
{Does this touch auth, crypto, PII, input parsing, or infra? Note observability,
rollout/rollback, performance, a11y/i18n where relevant. "N/A — {one-line reason}" if none apply.}

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict (PASS | PASS WITH WARNINGS | BLOCK | UNABLE). The DoR gate reads the
verdict off the first non-empty line, so write the token in capitals there. It may lead the line
("BLOCK — resolved in this revision") or follow the critic's name
("marvin-tm-spec-critic — **PASS WITH WARNINGS**"); a lower-case mention inside prose is not read as
a verdict, and "none" is recognised only leading the line. NEEDS_CONTEXT is never recorded here — it
resolves on the re-dispatch or becomes UNABLE. Record any author override as
"Critic flagged X — override: Y". "none" if the critic step was skipped. A skipped critic and an
UNABLE verdict are both surfaced in the PR, never silent; record an UNABLE verbatim as
"UNABLE — {reason}".}

## Design Notes
{Nuances, warnings, "write it so it's easy to replace with X later".}

## Future Considerations
- {relationship to planned evolution / VISION.md}
- {edge cases deliberately deferred to separate tasks}
