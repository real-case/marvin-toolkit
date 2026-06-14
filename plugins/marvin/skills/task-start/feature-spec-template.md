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

## File Change Plan
Authoritative allowlist. The implementer/executor MUST NOT touch files not listed here.
Every test named in an acceptance criterion's `verified_by` MUST appear here as a row.
`Satisfies` links a file to the acceptance criteria it implements — or "—" for infra rows
(docs, changelog, version bump) that satisfy no single criterion.

| ID | Path | Action | Intent | Satisfies | Anchor |
|----|------|--------|--------|-----------|--------|
| F1 | {path/to/existing/file} | edit | {what changes and why} | AC-1 | {file:line} |
| F2 | {path/to/new/file} | new | {why this file exists} | AC-2 | — |
| F3 | {path/to/test} | new | tests for AC-1, AC-2 | AC-1, AC-2 | — |

## Interface / Contract
The exact callable surface this introduces or changes — as a literal code block the implementer
copies, not prose to interpret. Function: signature + input/output types + thrown errors. API:
method, path, request/response shape, status codes. Schema: fields + types + constraints.
Write "N/A" only if the change adds no callable surface.

```{lang}
{exact signature(s) / route(s) / schema}
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

## Acceptance Criteria
Each criterion is observable from the outside, traced to the File-Change-Plan rows that implement
it, and bound to the proof that verifies it. Minimum 3. **At least one `verified_by` must be a real
test or command** — not every row may be "prose-review". A test path named here MUST also appear as
a File Change Plan row (the allowlist forbids the implementer from creating an unlisted file).

| ID | Given / When / Then | Implemented by | verified_by | Failure path |
|----|---------------------|----------------|-------------|--------------|
| AC-1 | Given {state}, when {action}, then {result} | F1, F3 | {test/path.ts::name \| npm run X \| prose-review} | {what the wrong behavior looks like} |
| AC-2 | {…} | {…} | {…} | {…} |
| AC-3 | {…} | {…} | {…} | {…} |

## Test Plan
- Harness: {test runner + command — matches frontmatter test_command}
- Test locations: {directory/convention where new tests live — grounded in existing neighbors}
- Conventions: {fixture/mocking/setup patterns observed in sibling tests, or "none"}

## Definition of Done
Merge-readiness beyond the acceptance criteria. Repo-specific obligations come from CLAUDE.md and
must appear as File Change Plan rows if they touch files.

- [ ] {test_command} green
- [ ] lint / type-check / build green
- [ ] docs / CHANGELOG updated (required if `breaking: true`) — or "N/A"
- [ ] repo-specific obligations (e.g. version bump + dist rebuild) — or "none"

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
