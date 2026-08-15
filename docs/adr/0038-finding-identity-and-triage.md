# ADR 0038 — A finding has an identity that survives the next scan

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-08-15 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0024](0024-mcp-apps-widget-architecture.md) (the `audit-report` block and the contracts package this extends), [ADR-0029](0029-refactoring-command-family.md) (the numbered findings registers whose accumulation forces the live-set rule), [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` service-file convention), [ADR-0030](0030-toolbox-dashboard-and-usage-log.md) (the dashboard whose security area this constrains, and the self-ignoring-directory precedent) |

## Context

Re-running `/marvin:sec-scan` produced a fresh report with no relationship to the previous one.
`SCAN-3` in Monday's report and `SCAN-3` in Friday's were different findings that happened to share
an ordinal: ids are assigned by severity order within a single run, so inserting one critical
finding renumbered everything below it. There was no way to answer "what is new since last week",
which is the only question that matters once a project has more than a handful of findings.

Severity had the mirror problem. Four separate bullets — in `marvin-auditor`, `marvin-refactor-auditor`,
`refactor-audit` and `refactor-smells` — each said severity is contextual and gave one example, with
no shared scale between them. Two auditor agents and two refactor skills therefore ranked the same
finding differently by construction. The eight `sec-*` scanners had no such guidance at all.

## Decision

### 1. Identity is a fingerprint computed at assembly, and it excludes the line number

Every `ReportFinding` carries a required `fingerprint`: sha256 over the report kind, the normalised
file path, the category and the title slug joined by NUL, truncated to 16 hex characters. It is
filled at the two construction sites in `lib/reports.ts` and nowhere else, and it is required rather
than optional because it is computable from the finding alone — a construction site that omits it is
a defect, and the compile error is the forcing function.

**Line numbers are deliberately excluded.** Including them would change a finding's identity every
time anything above it moved, which is most commits — exactly the churn a durable identity exists to
suppress. The cost is real and accepted: two findings sharing kind, path, category and title collapse
into one identity. The report's own `id` still separates them within a run.

### 2. The extension lands on `ReportFinding`, never on `Finding`

`ReportFinding` is assembled server-side and never parsed from disk, so extending it is one file plus
compiler errors at its call sites. `Finding` in `contracts/audit.ts` is parsed from every
`audit-report` block on disk, and its runtime mirror validates inside `AuditReportSchema`, whose
failure returns `{kind: "invalid"}`. A new required field there would therefore invalidate on-disk
reports in three readers at once: `scanSecurityReports` drops the report from `/marvin:reports`,
`readAllAuditReports` moves it to `malformed` so it vanishes from `/marvin:sec-report`, and
`findingsFromAuditBlock` removes it from the dashboard. Identity is a read-side derivation and
belongs on the read-side type.

### 3. Reconciliation reads on every call and writes only behind an explicit flag

`report` gains a second action, `triage`, which reconciles the live findings against a baseline at
`.marvin/report/triage.json` into three states — `new`, `persisting`, `regressed` — plus a `resolved`
roll-up. Both actions run the reconciliation, so the widget and the terminal never disagree about a
finding's identity; only `snapshot: true` writes.

That is a flag rather than a third action because `_meta.ui.resourceUri` binds at **tool** level:
every action inherits the widget whether it wants one or not, so an action-keyed write would be
reachable by any host that merely opens the panel. The baseline would then be consumed by looking at
it — every finding recorded as seen, and the next triage reporting nothing new no matter what
changed. A default-false flag makes the write one seam that one test pins.

`resolved` is a roll-up and **not** a fourth `TriageState` member: a resolved finding has no row in
any current report, so a fourth member would force the tool to synthesise a `ReportFinding` for
something that exists nowhere on disk.

`nextBaseline` retains a fingerprint that has left the live set, with `present: false` and its
original `firstSeen`, rather than deriving the next baseline from the live set alone. Without that
retention a reappearance classifies as `new`, and `regressed` is unreachable decoration.

`report`'s input schema also becomes `.strict()` — the second tool after `spec`. The argument is
directional: a mistyped flag that leaves `snapshot` false is harmless, but a caller who *intends*
`snapshot: true` and mistypes the key gets a successful-looking call that wrote nothing, after which
every later triage reports the entire finding set as new. The silent no-op that looks like success is
the failure worth an error message.

### 4. `AuditKind` gains `gate` and `fix`

`sec-gate` and `sec-fix` could not emit a schema-valid `audit-report` block, because the enum held
exactly the eight members the eight block-emitting scanners use. Both now emit one, strictly inside
their existing "if the user asks to keep a record" branches — the gate runs on the commit path and
stays quiet by default.

The widening is **read-compatible in one direction only**. An eight-member block still parses under a
ten-member enum, but a `gate`- or `fix`-kind report written under this version parses as `invalid`
against an older server and is dropped by all three readers with only a skip-note. The enum has a
deliberate runtime mirror in `lib/reports.ts`; the two must be widened in the same commit, and
`SEC_TITLES` is a total record precisely so the compiler enforces it.

A `fix` record describes a vulnerability that was already closed, so the assembly suppresses
`fixCommand` for that kind alone — a `/marvin:sec-fix fix F1` chip would ask the fix skill to fix its
own record. `gate` keeps its command: `/marvin:sec-fix gate SCAN-1` is a legitimate suggestion.

### 5. The live set: the newest register per `(kind, slug)`, and never a `fix` record

The report families do not share one lifecycle, so the live set is decided per family rather than per
directory.

The scanners that answer "what is wrong here" — `scan`, `secrets`, `deps`, `iac`, `ci`,
`threat-model`, `compliance`, `pentest`, and the commit-path `gate` — each write one **fixed
filename**, so a re-run overwrites and the report **is** current state. Every one of their envelopes
counts.

`sec-fix` is the exception in the same directory, and the reason the rule is stated per kind rather
than per group. It writes `fix-<slug>.md`, one accumulating file per closed vulnerability, and §4
above is explicit that its findings **record what was fixed**. A record of a closed vulnerability is
not a claim about the present, so a `fix` envelope is excluded from the live set outright. Counted,
every vulnerability the project ever fixed would report `new` once and `persisting` on every triage
afterwards, `resolved` could never fire for it, and the roll-up would keep printing a closed critical
at its original severity — the failure this section exists to prevent, arriving through the group it
exempts. Filename scoping is the wrong instrument here: no `sec-fix` run supersedes an earlier fix
record, so "newest per slug" would keep all of them. This is the live-set counterpart of §6's
judgement for the dashboard (`NON_POSTURE_KINDS` in `lib/state.ts`), and the two now agree that a fix
record is not present-tense state. `gate` needs no exclusion here: it is one overwritten file whose
findings are genuinely still open. The envelope carries the kind only in `generatedBy`, so
`lib/reports.ts` exports the single value (`SEC_FIX_GENERATED_BY`, typed `` `sec-${AuditKind}` ``)
that `lib/triage.ts` compares against, and a renamed enum member breaks the build rather than the
exclusion.

The refactor registers write `NNN-<kind>-<slug>.md` on one monotonic sequence and every one of them
gets an envelope, so that directory is a history. Treating it as current state would make `resolved`
unreachable for half the corpus — a finding fixed after `001-audit-core.md` still sits in
`001-audit-core.md` and would report `persisting` forever — and would put one fingerprint into the
baseline twice per re-audit. Only the highest-numbered register per `(kind, slug)` is live,
tie-broken by `generatedAt`.

Findings in a superseded register, and in every fix record, are left **unreconciled** — no `state`,
no `firstSeen` — rather than relabelled. Absent means "not reconciled", which is the honest third
answer this design leans on throughout, and it is also why `state` and `firstSeen` are optional:
`parseRegisterFindings` returns `ReportFinding[]` to the dashboard, which has no baseline and no
envelope and cannot know either value.

### 6. The dashboard's security area excludes `gate` and `fix`

`auditDigest` picks the Security area from the newest `.marvin/security/*.md` whose block parses, over
a filename filter of `() => true`. A gate record is written on the commit path, so it is usually the
newest file there. Giving `sec-gate` a block would therefore have switched the dashboard's stated
security posture from "the last full scan found this" to "the last pre-commit check saw this on the
diff" — a different claim about the project, arriving with no message, no version signal and no way
for a user to tell which they were looking at. `findingsFromAuditBlock` now returns `null` for those
two kinds, which is `newestArea`'s existing "not a report of this kind, keep looking" contract.

Both kinds stay fully visible in `/marvin:reports` and `/marvin:sec-report`, where a report is one row
among many rather than the single chosen area.

### 7. One severity rubric, with anchored examples

`skills/sec-scan/references/severity-rubric.md` is the single scale: a spine of blast radius ×
likelihood × cost to reverse, five rows, and two stated adjustments (an unreachable instance drops
exactly one row, never to `info`; a defect on a value- or trust-carrying path is promoted exactly one
row). Each row carries two anchors, one security and one code-health, because the rubric is read from
both families and a security-only anchor set cannot rank a dependency tangle.

The five producers reach it differently, and the difference is not stylistic. `sec-scan`, `sec-gate`,
`sec-fix`, `refactor-audit` and `refactor-smells` reference it by the ADR-0008 bare path, which
resolves through all three entry points. The two auditor **agents** inline a condensed copy instead:
an agent body is loaded standalone with no plugin-root preamble, so a `skills/…` path there resolves
against the working directory and silently fails to open, leaving the agent with no guidance at all
and nothing to report it. The linter cannot catch that — it only checks that a `skills/…` path
resolves — so a grep-based acceptance criterion pins it instead.

## Consequences

- **Positive.** "What is new since last week" is answerable. A finding keeps its identity across
  renumbering, reordering and unrelated edits above it. `sec-gate` and `sec-fix` become first-class
  producers. Five producers rank on one scale with concrete anchors instead of four unanchored
  bullets. The contract carries everything a future widget slice needs, with no further schema change.
- **Negative.** Two findings identical in kind, path, category and title collapse into one identity.
  A `gate`/`fix` report is not readable by an older server. `.marvin/report/` sits beside the four
  group directories the tool scans and reads to a maintainer as a fifth group without being one —
  mitigated by a doc comment on `ServerEnv.reportDir` and a row in the working-directory tables.
- **Behaviour change worth stating.** The dashboard's Security area now skips `gate` and `fix`
  reports. A project that keeps gate records sees the last full scan there, not the newest file.
- **Behaviour change worth stating.** A `fix` record is listed and readable like any other report but
  is never triaged: its findings carry no `state` and no `firstSeen`, and they never enter the
  baseline. The triage roll-up therefore counts open findings only, which is the question it asks.
- **Deferred.** The reports widget renders none of the three new fields yet. `FindingRow` is
  untouched and no visual baseline moves; a state badge and a `new` filter are the follow-on slice,
  which is the contract → tool → widget staging ADR-0024 prescribes.

## Alternatives considered

- **Including line numbers in the fingerprint.** Rejected: the identity would change on most commits,
  which is the churn the identity exists to suppress.
- **Extending `Finding` instead.** Rejected: a new required field invalidates every `audit-report`
  block on disk, in three readers at once.
- **A fourth `TriageState` member, `resolved`.** Rejected: it would require fabricating a
  `ReportFinding` for something that exists in no report.
- **Writing the baseline on every `triage` call.** Rejected: the tool is widget-bound at tool level,
  so opening the panel would consume the baseline.
- **Treating every refactor register as live, and documenting the consequence.** Rejected: a
  documented defect in the mechanism whose whole purpose is to answer "what is still open" is not a
  smaller change than the ten-line scoping rule that avoids it.
- **Scoping `fix` records by filename, as the refactor registers are scoped.** Rejected: it does not
  work and it names the wrong problem. Each `fix-<slug>.md` covers a different vulnerability, so
  none supersedes another and "newest per slug" keeps all of them; and a fix record would still be
  read as a claim about the present when it is a record of the past. The kind is the defect, so the
  kind is the exclusion.
- **Letting a `fix` record count as live and documenting the consequence.** Rejected for the same
  reason as its refactor twin above, one degree worse: a closed critical would report `persisting`
  forever with `resolved` unreachable, so the mechanism would answer "what is still open" with
  findings that are, by their own text, already shut.
- **Letting the dashboard's security area become whichever report is newest.** Rejected: it costs a
  user their only at-a-glance security number with nothing on screen to say the meaning changed.
- **A blanket rubric reference across all eight block-emitting `sec-*` skills.** Rejected: six of them
  have no severity guidance to correct, so it would mix an expansion into a correction.
