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

<!-- Writing rules (delete this comment). One fact, one place: a requirement lives in the contract,
as a criterion or a file intent, and prose refers to it by id (F3, AC2) without restating it. A
requirement found only in prose is a defect, because nothing proves it. Measurements, probes and
provenance go to the evidence sidecar, and the critic's narrative stays in its receipt. Size budget:
3 KB + 400 B per file + 500 B per criterion; the DoR gate warns above it. -->

## Goal
{what this task delivers, and why — one or two sentences}

## Context
Pointers, not evidence: each bullet is a `path:line` and one clause. Optional on the light tier
(`risk: low` and at most five files).

- {Pattern to follow: path/to/sibling.ts:42}
- {Callers of the changed surface: path/to/caller.ts:17, or none}
- {Evidence: .marvin/task/runs/<slug>.evidence.md, or none}

## Spec Contract
The authoritative contract, parsed and schema-checked by the `spec` DoR gate and sealed by
`contract_sha`. The implementer may touch **only** the files in `files`. A test named in a
`kind: test` oracle MUST also be a `files` row. Use `<…>` for prose to fill; a `{…}` placeholder
parses as a YAML map and fails the gate. Delete the `#` comments below once filled: the contract
carries no rationale, history or evidence.

Field limits:

- `statement`: at most 30 words, as Given/When/Then, one behaviour per criterion (the gate warns
  over 40).
- `failure`: one sentence naming a wrong implementation the oracle catches, not a negation of the
  statement.
- `intent`: at most two sentences on what changes in this file (the gate warns over 60 words). A
  test file's intent names the criteria it covers and any non-obvious fixture.
- `contract.signature`: the exact surface, with no comments that restate criteria.
- `oracle.run`: omit it when `gates.test_one` in `.marvin/config.json` derives it.
- `satisfies`: optional. `implemented_by` is the hand-written direction; a declared `satisfies`
  list must agree with it, or the gate fails.

```yaml spec-contract
files:
  - id: F1
    path: path/to/existing/file.ts
    action: edit          # new | edit | delete
    intent: <what changes in this file>
    anchor: path/to/existing/file.ts:42
  - id: F2
    path: path/to/new/file.ts
    action: new
    intent: <what this new file holds>
  - id: F3
    path: test/path.test.ts
    action: new
    intent: <covers AC1 and AC2; name any non-obvious fixture>
build_order: [F1, F2, F3]   # optional
depends_on: []              # sibling spec slugs; each MUST be status: shipped
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
    failure: <a wrong implementation this test catches>
  - id: AC2
    statement: Given <state>, when <action>, then <result>
    implemented_by: [F2, F3]
    oracle:
      kind: command
      ref: npm run build
    failure: <a wrong implementation this command catches>
  - id: AC3
    statement: Given <state>, when <action>, then <result>
    implemented_by: [F1]
    oracle:
      kind: prose-review    # at least one criterion must carry a non-prose-review oracle
    failure: <a wrong implementation a reviewer would catch>
```

## Chosen Approach
Only what the contract cannot carry.

**Stack compliance:** {NATIVE | EXTENSION | EXPERIMENTAL} — {new dependency and why, or none}

- {Order: the sequence of work, when it is not obvious from build_order}
- {Traps: what an implementer would get wrong, with the F/AC id it affects}
- {Rejected: variant because of a project constraint (at most three lines)}

## Non-goals
- {what is explicitly NOT in scope}

## Assumptions
{each default taken instead of asking — or "none"}
Write each as "assumed X because Y; correct now if wrong", limited to defaults the contract does not
already show. "none" is an accepted value; the DoR gate records it as an advisory warning, not a
failure.

## Data & Config
Optional: keep this section only when there is a migration, environment variable, flag or config
key, and state a migration in both directions.

- {migration, variable, flag or config key, with forward and rollback}

## Security / NFR
Optional, but required when `risk: high` or when the change touches auth, crypto, PII or input
parsing; the DoR gate warns when a `risk: high` spec has none.

- {the concern, and the criterion or file that addresses it}

## Deferred slices
Optional: keep this section only when slices were deferred at the scope gate. Each row is a board
card already created.

- {board id + one-line scope + which one-PR condition failed}

## Open Questions
{any question still unresolved — MUST be "none" before DoR passes}
A genuine unknown that needs investigation is NOT an Assumption: set `spike_required: true` and
resolve it (e.g. a spike via `/marvin:track-new`) first.

## Critic Verdict & Overrides
{VERDICT — receipts NNN, NNN; override: finding because reason}
One line. The DoR gate reads the verdict off the first non-empty line, so write the token in
capitals there (`PASS`, `PASS WITH WARNINGS`, `BLOCK`, `UNABLE — <reason>`), or "none — critic
skipped". NEEDS_CONTEXT is never recorded here. The critic's narrative stays in its receipt under
`.marvin/critique/`.
</content>
</invoke>
