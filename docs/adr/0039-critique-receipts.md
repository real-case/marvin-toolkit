# ADR 0039 — A critic's verdict is a receipt on disk, not a sentence in a transcript

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-08-15 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` service-file convention this amends with a sixth directory), [ADR-0017](0017-adversarial-critic-gates.md) (the advisory stance this preserves), [ADR-0024](0024-mcp-apps-widget-architecture.md) (the report envelope and the contracts package), [ADR-0022](0022-numbered-spec-files.md) (the `<NNN>-<slug>` filename convention reused here), [ADR-0038](0038-finding-identity-and-triage.md) (the sibling package that also widened `contracts/report.ts`) |

## Context

Two adversarial critics run in the task pipeline — `marvin-tm-spec-critic` before a spec is
written, `marvin-tm-diff-critic` before a PR is opened — and both produce a structured report and a
verdict. Neither survived the session. The spec critic's verdict was copied by hand into the spec's
`## Critic Verdict & Overrides` section as a word; the diff critic's existed only in the
conversation, and reached the PR body only because `/marvin:task-deliver` asks the caller to carry
it. Everything else the critic said — its blockers, its evidence, its out-of-scope inventory —
was gone the moment the session ended. A reviewer asking "what did the critic actually flag, and
did the author answer it?" had no artifact to open.

Marvin already has a viewer for exactly this: the `report` tool scans every document generated
under `.marvin/` into one envelope and renders it in `/marvin:reports`. The critics wrote nothing
into it, because they wrote nothing at all.

Adding a fifth group to that viewer surfaced a second problem, which is the reason this record
covers both. `ReportGroup` is enumerated at roughly thirty sites. Exactly one of them —
`GROUP_LABELS`, a total `Record<ReportGroup, string>` — fails the build when a member is forgotten.
`GROUP_ORDER`, the tool's scan-dirs literal, the `ReportDirs` interface, the widget's segment table
and a dozen prose sites accept a missing member in silence, so the omission does not fail a build:
it ships as a user-visible lie in a command description. `scripts/check-docs-drift.mjs` detects
only pre-ADR-0007 path spellings, `lint-manifests.mjs` checks manifests and frontmatter, and
nothing anywhere pinned the group set.

## Decision

### 1. A receipt is a markdown document under `.marvin/critique/`, and it is a report group

The calling session writes `.marvin/critique/<NNN>-<slug>.md` after a critic returns a terminal
verdict: the critic's report **verbatim**, followed by one fenced ` ```json critic-verdict ` block.
`<NNN>` is the highest existing leading-integer prefix in the directory plus one, `001` when empty
— the rule `skills/handoff/SKILL.md` already states and `storage/tasks.ts` already implements.
`<slug>` is the **spec's** slug, so a task's two receipts differ only by their sequence number.

`report` ingests the directory as the fifth `ReportGroup` through a `scanCritiqueReports` modelled
on the handoff scanner: a `document`-kind envelope, titled from the first heading, `generatedBy`
naming the critic, and a spec `LinkRef` on the receipt's `subject`. No new tool, no new prompt, no
new widget, and no `rerunCommand` — re-running a critic is a pipeline step, not a command a user
types.

**Receipts cannot live under `.marvin/task/`.** Three independent readers classify any non-
`verification.md` file there as a spec: `scanTaskReports` in `lib/reports.ts`, `specDigest` in
`lib/state.ts`, and `resolveSpecBySlug` in `storage/spec.ts`. A receipt placed there would appear
as a spec in the dashboard, in `/marvin:reports`, and to the DoR gate's `depends_on` resolver.

Unlike the security scan, this scan **skips nothing and pushes a note for nothing**. A security
report without a typed block is a legacy prose report the widget cannot render as findings; a
receipt without one is still a complete prose critique that renders perfectly as a document. The
`ScanNote` channel reaches the user as "skipped N file(s)", which would be false here.

### 2. The receipt carries two axes and no roll-up; the roll-up is derived, once

`Critique` carries `critic`, `subject`, `judged_at`, and two `AxisVerdict` members — `compliance`
and `quality` — each holding a terminal verdict plus its blocker and warning counts. There is no
stored roll-up field. The ordering is stated normatively in the contract and implemented **exactly
once**, as `rollUp` in `lib/reports.ts`:

> `BLOCK` > `UNABLE` > `PASS WITH WARNINGS` > `PASS`

`BLOCK` outranks `UNABLE` because `BLOCK` carries an action and `UNABLE` carries none, and because
`task-deliver`'s draft-PR rule keys off `BLOCK`. Rolling a `BLOCK` + `UNABLE` pair up to `UNABLE`
would silently disarm the one enforcement this change promises not to weaken.

The writer of a receipt is a language model, which is the writer least able to guarantee an
invariant between three fields. Storing the roll-up would mean either rejecting a real critique
over a clerical slip, or silently overriding it so the file says one thing and the tool shows
another. Deriving it makes the disagreement unrepresentable, and costs one exported function.

`rollUp` is declared in `lib/reports.ts` rather than in the contracts package for a measured
reason: that module imports the contracts type-only and its unit tests compile it with
`packages: "external"`, so a value import would resolve to `dist/contracts/index.js`, which is not
committed — the parser tests would need a shared-package build to run. Declaring it in both places
would ship an unguarded duplicate of the one derivation this record argues about.

The schema is fail-closed in two directions. `NEEDS_CONTEXT` is **not** in the terminal verdict
enum, so a receipt cannot record a verdict the protocol says can never be final; and if either
axis is `UNABLE`, the `inability` object is required, so a receipt cannot claim the gate did not
run while declining to say why.

### 3. `subject` is the spec slug, always — there is no `subject_kind`

Each critic judges exactly one thing: the spec critic a spec, the diff critic the diff that
implements it. What was judged is therefore derivable from `critic`, and a second field recording
it would be one more value the writing model must keep consistent with the first — Decision 2's
defect in a smaller form. With `subject` fixed as the spec slug, the reports link and the summary
lookup key on one field whose content is not conditional.

The consequence is deliberate: the diff critic's **standalone mode** — a run with no spec, supported
by that agent's own prose — writes no receipt. It has no slug to hold, and a receipt carrying a
branch name in a field defined as a slug would be unusable by both consumers. A standalone run
still emits its axes in the report it returns.

### 4. The receipt is evidence, not a veto

A `BLOCK` receipt does not gate delivery. Enforcement stays exactly where prose already puts it:
`task-deliver` opens the PR as a **draft** when the diff critic's verdict arrives as `BLOCK` with
at least one surviving blocker. The receipt is written *after* that decision and nothing reads it
back to make one.

Two reasons, and the first is not a preference. [ADR-0017](0017-adversarial-critic-gates.md)'s
accepted trade-off is that semantic review is a complement to the deterministic gates, not a
replacement; promoting a receipt to a gate would overturn that record rather than extend it.
The second is structural: the session that writes the code also writes the receipt, so a receipt
that could block delivery would make the audited party the author of its own audit record — and a
control surface writable by any process that can write into `.marvin/`.

`test/critique-protocol.test.mjs` pins this behaviourally rather than by promise: the delivery
gate is run twice in one project root, once with a `BLOCK` receipt present and once with the
directory removed, and both the decision and the `deliver-gate` block must be identical. The
fixture is deliberately one the gate **ALLOWs** — a bare directory would short-circuit on the
missing artifact and return the same `BLOCK` either way, proving nothing.

### 5. The group set is machine-checked, so the sixth group cannot be added quietly

Two changes pay the enumeration debt and then keep it paid.

`isStale`'s negative two-group allowlist, whose default branch silently returned `false`, becomes a
total `export const DECAYS: Record<ReportGroup, boolean>`. A total record does not compile with a
missing member, so the next group must state its answer instead of inheriting one. `critique` is
`false`: a receipt is a dated judgement of one artifact at one moment and stays exactly as true a
year later, whereas a security scan claims a present-tense property of the tree.

`test/report-groups.test.mjs` derives the group set from the `ReportGroup` enum read as text and
asserts it, as sets, against `GROUP_ORDER`, `GROUP_LABELS`, the scan-dirs literal, `ReportDirs`,
the widget's `GROUPS` table, and the keys of `DECAYS`; then it requires each of twelve pinned prose
files to mention every group name. The prose half is a **mention check** and is documented as one:
it cannot see whether the mention sits in the sentence that enumerates groups, and a file could
satisfy it by accident for a word like `task`. A stronger check would pin the wording of twelve
files, which is the brittleness that makes people delete guards. The weaker check catches the
failure that actually happens — a new group name appearing nowhere in a file that enumerates groups
— and catches it in all twelve at once.

### 6. `.marvin/research-results/` does not become a report group

The directory is recorded as **write-only**: `marvin-researcher` is forbidden from reading its own
notes back, because a cached lookup is exactly the stale answer the agent exists to avoid, and
`CLAUDE.md` already states "Not ingested by the `report` tool". Building a viewer over a corpus
whose premise is that it must not be consulted would put a surface in front of the user that
invites the failure the design prevents. If this is ever revisited, the change is to the write-only
property first and to `ReportGroup` second, in that order.

## Consequences

- Every critique the pipeline runs leaves an artifact a tool can read, in the viewer that already
  lists everything else marvin generates, with no new command to learn.
- Both critic bodies now carry two axis lines beside the single `**Verdict:**` line, which is
  preserved as their roll-up. All four existing verdict readers keep working unchanged.
- The task summary gains at most one link per critic, through the existing `links` channel. A
  first-class `TaskSummary` field was rejected: it would change a third contract, add a row to the
  summary widget, and move nine committed darwin baselines, to display what `/marvin:reports`
  already renders in full.
- A sixth report group is now cheap to add correctly and expensive to add incorrectly. The guard
  test is the checklist; its pinned prose list is extended whenever a new file starts enumerating
  groups.
- `.marvin/critique/` writes no self-ignoring `.gitignore`, unlike `.marvin/usage`,
  `.marvin/preview` and `.marvin/export`. Those are local or derived; receipts are review records
  with the same shareability as `.marvin/handoff/` and `.marvin/security/`, neither of which
  self-ignores. Whether a project commits them is that project's `.gitignore` decision.
- Two independent `<NNN>` sequences now live under `.marvin/` — specs and receipts — and look
  identical in a path. That is a real readability cost, accepted as the price of matching the
  handoff convention rather than inventing a third filename shape. A shared numbering helper
  becomes worth writing when a third sequence appears.
- Receipts are not retrofitted. The verdicts of past critiques exist only in transcripts, which is
  the problem being fixed.

## Alternatives considered

- **Store the roll-up in the block and validate it against the axes.** Rejected: it asks the least
  reliable writer in the system to maintain an invariant between three fields, and gives no good
  answer when it fails. Deriving the value makes the disagreement unrepresentable.
- **A first-class `TaskSummary.critique` field.** Rejected: a third contract, a widget row and nine
  visual baselines, for a datum the reports viewer already renders.
- **Receipts under `.marvin/task/`.** Rejected: three independent readers would classify them as
  specs.
- **Make a `BLOCK` receipt a delivery veto.** Rejected: it would overturn ADR-0017 rather than
  extend it, and would let the audited party author its own audit record. Available later, but only
  through an ADR that addresses both — most plausibly by having a fresh session, not the
  implementing one, write the receipt.
- **Append the JSON block without touching the critics' verdict sections.** Rejected: it would
  leave two verdict models in one document with no stated relation between them, and every reader
  would have to guess which wins.
- **Pay the enumeration debt without the guard test.** Rejected: the debt was discovered by
  re-measuring a survey that was itself already stale. A checklist that has failed once is not the
  control for the next group.
- **Declare `rollUp` in the contracts package.** Rejected on a measurement, not a preference: it
  would make the parser unit tests depend on an uncommitted shared-package build.
