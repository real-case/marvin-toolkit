---
slug: {kebab-case-slug}
type: feature
status: ready
created: {YYYY-MM-DD}
tracker: {#issue | PROJ-123 | URL | none}
supersedes: {prior-slug | none}
stack: {verified primary stack, e.g. typescript | none}
risk: {low | medium | high}
test_command: {command that runs the tests, e.g. "npm test" | none}
---

# {Title}

## Goal
{1–2 sentences — what and why. Specific: "add X for Y", never "improve X".}

## Context
- Related patterns: {existing code this builds on — file:line}
- Constraints: {tech-debt, architectural boundaries, performance budgets}
- Sibling specs: {related entries under specs/, or "none"}

## File Change Plan
Authoritative allowlist. The implementer/executor MUST NOT touch files not listed here.

| Path | Action | Intent | Anchor |
|------|--------|--------|--------|
| {path/to/new/file} | new | {why this file exists} | — |
| {path/to/existing/file} | edit | {what changes and why} | {file:line} |

## Interface / Contract
{Exact callable surface this introduces or changes. Function: signature + input/output
types + thrown errors. API: method, path, request/response shape, status codes. Schema:
fields + types + constraints. Write "N/A" only if the change adds no callable surface.}

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
Each criterion is observable from the outside and bound to the proof that verifies it.
Minimum 3. `verified_by` names a test, a command, or "prose-review" — never empty.

| ID | Criterion | verified_by | Failure path |
|----|-----------|-------------|--------------|
| AC-1 | {specific, observable behavior} | {test/path.ts::name | command | prose-review} | {what the wrong behavior looks like} |
| AC-2 | {…} | {…} | {…} |
| AC-3 | {…} | {…} | {…} |

## Test Plan
- Harness: {test runner + command — matches frontmatter test_command}
- Test locations: {directory/convention where the new tests live}
- Fixtures / setup: {data, mocks, or environment needed — or "none"}

## Non-goals
- {what is explicitly NOT in scope}

## Assumptions
{Decisions made under uncertainty, recorded so the implementer inherits them rather than
re-deciding. "none" if there are none.}

## Open Questions
{Unresolved questions. MUST be "none" before the DoR gate passes — an open question is a
reason to keep authoring, not to dispatch.}

## Security / NFR
{Does this touch auth, crypto, PII, input parsing, or infra? Note observability,
rollout/rollback, performance, a11y/i18n where relevant. "N/A — {one-line reason}" if none apply.}

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict (PASS | PASS WITH WARNINGS | BLOCK). Record any author
override as "Critic flagged X — override: Y". "none" if the critic step was skipped.}

## Design Notes
{Nuances, warnings, "write it so it's easy to replace with X later".}

## Future Considerations
- {relationship to planned evolution / VISION.md}
- {edge cases deliberately deferred to separate tasks}
