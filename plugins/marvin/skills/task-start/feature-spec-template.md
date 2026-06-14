---
slug: {kebab-case-slug}
type: feature
status: ready
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
{1–2 sentences — what and why. Specific: "add X for Y", never "improve X".}

## Context
- Related patterns: {existing code this builds on — file:line}
- Callers / reverse-deps: {who calls or depends on the surface you change — file:line, or "none"}
- Constraints: {tech-debt, architectural boundaries, performance budgets}
- Sibling specs: {related entries under specs/, or "none"}

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
spec_location: specs/            # where this host keeps specs/RFCs (discovered, not assumed)
decision_record:                 # the host's ADR/RFC convention, if any
  style: <madr | nygard | none>
  path: docs/adr/
merge_obligations:               # what THIS host needs to merge (from CONTRIBUTING / CI)
  - <e.g. "ruff + mypy green (.pre-commit-config)">
gates:                           # the host's actual gate commands
  test: <the test command>
```

## Data & Config
{Migrations (direction + rollback), new env vars, feature flags, config keys. "N/A" if none.}

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

## Assumptions
{Decisions made under uncertainty, recorded so the implementer inherits them rather than
re-deciding. "none" if there are none.}

## Open Questions
{Unresolved questions. MUST be "none" before the DoR gate passes — an open question is a
reason to keep authoring, not to dispatch. A genuine unknown that needs investigation is NOT an
Assumption: set `spike_required: true` and resolve it (e.g. via `/marvin:kanban-spike`) first.}

## Security / NFR
{Does this touch auth, crypto, PII, input parsing, or infra? Note observability,
rollout/rollback, performance, a11y/i18n where relevant. "N/A — {one-line reason}" if none apply.}

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict (PASS | PASS WITH WARNINGS | BLOCK). Record any author
override as "Critic flagged X — override: Y". "none" if the critic step was skipped — and a
skipped critic is surfaced in the PR, never silent.}

## Design Notes
{Nuances, warnings, "write it so it's easy to replace with X later".}

## Future Considerations
- {relationship to planned evolution / VISION.md}
- {edge cases deliberately deferred to separate tasks}
