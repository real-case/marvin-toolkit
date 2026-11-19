# ADR 0053 — The bug hunter is a `hunt-*` command family over one deterministic tool

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-11-19 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0001](0001-single-plugin-consolidation.md) (one plugin, one server), [ADR-0006](0006-all-subagents-opus.md) (every subagent on opus), [ADR-0029](0029-refactoring-command-family.md) (read → plan → apply), [ADR-0038](0038-finding-identity-and-triage.md) (finding fingerprints), [ADR-0054](0054-hunt-ledger-and-flow-map.md) (the state this family writes) |

## Context

Marvin finds structural debt (`refactor-*`), security exposure (`sec-*`) and audit findings
(`audit-*`), but nothing looks for the defects a user would actually hit: a whitespace token
that signs in, a total that ignores a discount, a form that loses its input on error. The
requirements for a bug hunter (four checks — code, user behaviour, UX, design — plus triage, a
shared flow map, a findings ledger and a verification protocol) were written as a separate
plugin with its own shell scripts.

Two properties of the problem decide the shape. First, an LLM reading code produces plausible
bug reports faster than anyone can check them; the value is in the ones that survive an
independent challenge and a failing test, so the protocol that decides what survives must not
depend on a prompt being followed. Second, every check, every run and every person must agree
on what a finding *is* across time, or the same defect is reported again each week.

## Decision

1. **A command group inside the `marvin` plugin, not a second plugin.** The commands are
   `/marvin:hunt-*`, served by the one server (ADR-0001). The planned surface is eight
   commands: `hunt-init`, `hunt-code`, `hunt-behavior`, `hunt-ux`, `hunt-design`, `hunt-triage`,
   `hunt-status`, and `hunt-run`, which runs several checks in one pass and resumes an
   interrupted run. This decision ships the first four: `hunt-init`, `hunt-code`,
   `hunt-triage` (skill-backed) and `hunt-status` (an inline tool wrapper).
2. **One MCP tool, `hunt`, owns every mechanical step.** Fourteen actions — `init`,
   `preflight`, `baseline`, `hotspots`, `checkpoint`, `flows`, `record`, `verdict`, `set-status`,
   `link`, `triage`, `finalize`, `report`, `status` — replace the shell scripts of the
   requirements. Every write under `.marvin/hunt/`, every git read, the hotspot order, a
   finding's identity and the verification protocol's transitions are TypeScript with a strict
   zod input. The skills decide what to look at and what is a defect; the tool decides what a
   decision does to the shared state and refuses what the protocol forbids.
3. **The verification protocol is enforced by the tool.** No ruling by a finding's own producer.
   A skeptic's ruling is recorded and changes nothing; the referee decides. A `bug`, `perf` or
   `spec-drift` finding is confirmed only by a reproducing test that fails with
   `failure_kind: real-defect` and names its test path; a passing test rejects the hypothesis; a
   mixed result is `flaky`. A `ux-issue`, `design-deviation` or `a11y` finding is confirmed by the
   referee only with a named rule and a screenshot or recording. Only a person's ruling confirms,
   rejects or closes anything outright. The table is in
   `skills/hunt-code/references/verification-protocol.md` and in `planVerdict`.
4. **Four read-only agents, each on `opus`** (ADR-0006): `marvin-hunt-cartographer` (flow map),
   `marvin-hunt-hunter` (claims for one hotspot batch), `marvin-hunt-skeptic` (tries to disprove
   one claim) and `marvin-hunt-referee` (rules between them). Each pins `tools: Read, Glob, Grep,
   Bash`. The calling session writes the reproducing tests; no agent writes a file.
5. **Detect-only in this release.** `hunt.authority.mode` exists in the configuration with the
   single value `detect-only`, and `tickets`, `fixes` and `max_fixes` are recorded but unused.
   No `hunt-*` command edits product code, commits or pushes. Reproducing tests are left in the
   working tree, uncommitted, marked as expected failures in the runner's own vocabulary.
6. **Hotspots are a deterministic score.** Churn, authors, fix commits, size, recency, risk terms
   in the path or content, audit state from `coverage.json`, and the absence of a test file, each
   as a logarithm or a capped step, ties broken by path, cut into batches. The same commit,
   history window and coverage give the same order, so runs can be compared and resumed.

## Consequences

- A hunt is reproducible to the extent the code allows: the scope, the hotspot order and every
  ruling are on disk with the commit they were made at.
- The model cannot talk a finding into `confirmed`. That is the point, and it also means a real
  bug without a writable reproduction stays a candidate or `suspected` until a person confirms
  it.
- Seventeen tools instead of sixteen, fourteen agents instead of ten, and a ninth command group.
- The runtime checks (`hunt-behavior`, `hunt-ux`, `hunt-design`) need a running application and
  a browser driver; they are later phases and reuse the flow map, the ledger and the protocol
  unchanged.
- A `hunt` group is not yet a `ReportGroup` of the `report` tool: adding one touches the pinned
  enumerations ADR-0039 lists, and is left for the phase that adds the runtime checks.

## Alternatives considered

- **A separate plugin with its own server and shell scripts**, as the requirements were written.
  Rejected: ADR-0001 consolidated four plugins into one for exactly the prefix and server
  duplication this would bring back, and shell scripts would put the protocol's rules in prose
  again.
- **Extend `refactor-*` or `audit-*`.** Rejected: both judge structure or process, are read-only
  by contract, and have no notion of proving a claim by running code. The vocabulary would blur.
- **Let the agents write the ledger directly.** Rejected: a malformed line, a reused id or a
  self-confirmed finding would be one prompt deviation away. Validation at the tool is cheaper
  than detection after the fact.
