# Writing an audit specification

Every audit in the family is one file, `skills/audit-run/references/audits/A-XX-<slug>.md`,
holding the half that differs between audits. The half that does not — report skeleton, finding
schema, severity scale, evidence rules, sampling budget, release procedure, base prohibitions —
lives in `report-contract.md` and `pdf-release.md` and is never restated here.

This file is the template and the acceptance checklist. Use it to add an audit, and to review one.

## The rule that decides what goes where

A sentence belongs in the spec when it would be **wrong or absent** for another audit. A sentence
that is true of every audit belongs in the contract, and a copy of it here is drift waiting to
happen: two copies of a threshold table, edited once, is precisely how a family of audits stops
producing comparable reports.

Restating a contract rule for emphasis is allowed exactly where the audit's own risk section
explains why *this* audit gets it wrong. Anywhere else, point at the contract.

## Language

Spec prose is **English**, like every other authored surface in this plugin. Russian appears
only where the spec names a literal string the report must emit — a report section title, a
finding field label — because `report-contract.md` pins those and the report's own language is
the `LANG` parameter.

## Template

```markdown
# A-XX — <Audit name>

> **Audit question.** <one sentence, the question this audit closes>

## 1. Role and task
<who is executing and what one question they close. Two to four sentences. Name what a
successful run leaves behind besides the report.>

## 2. Audit-specific parameters
<a table of THIS audit's parameters on top of the ten standard ones in report-contract.md §2:
name, meaning, and how to derive it when unset. Every audit-specific parameter must be
derivable or explicitly askable — a parameter with no fallback blocks a run.>

## 3. Scope
### In scope
<what the audit covers>
### Out of scope
<what it does not, each item naming the audit that does cover it, or saying that nothing does>

## 4. Collection protocol
<the numbered procedure: commands, files, order. This is the longest section and the one that
makes the audit reproducible. Each step says what it produces and what it costs.>

## 5. Tools
<a table: tool, what it measures, the exact invocation, and the fallback when it is absent.
Every audit must be executable with nothing but git, the shell and the project's own toolchain;
a step that requires an unavailable tool degrades, it does not stop the run.>

## 6. Analysis rules and thresholds
<the numeric thresholds and the severity they imply, as a table with exactly these columns:

| Condition | Threshold | Severity | Origin |
|---|---|---|---|

`Origin` is `requirements` when the source requirements fix that number or that severity, and
`derived` when the spec chose it. It is not decoration: `requirements` means the row may not be
re-severitised to resolve a conflict with a neighbouring audit, and `derived` means it may. A
threshold with no number is not a threshold. Name the cases that override a row, and where a
neighbouring audit files the same condition, cite that audit's row instead of restating it.>

## 7. Budget and stopping
<open with the line "Deltas from `report-contract.md` §8 only.", then give only those deltas:
this audit's sampling unit, how the top N is ranked, and any audit-specific early stop.

An early stop is written as a CONJUNCT to the contract's, never as a re-worded copy of it:
"the contract's control-sample stop, additionally requiring <x>". Retyping the contract's own
condition is how it gets inverted — one spec did exactly that in review — and a spec that
carries its own copy stops tracking the contract the day the contract changes.>

## 8. Report additions
<the sections this audit adds inside §5 Детальные находки and §7 Приложения of the standard
report, each with its column set or shape>

## 9. Score
<the audit's own score: its formula, its unit, and WHAT the justification must name — which
quantity dominates, what moved it, what would move it back. The length rule ("two to four
sentences") belongs to report-contract.md §3 and is not restated here.>

## 10. Failure modes of this audit
<what an auditor executing this audit will get wrong, and the countermeasure for each. This is
the section that carries the requirements document's warnings; it is not padding.>

## 11. Audit-specific prohibitions
<prohibitions beyond report-contract.md §9, and only those. Empty is not allowed: every audit
has at least one way to do damage that the general list does not name.>

## 12. Dependencies
<what arrives on input as a parameter, and what this audit hands to which later audits>

## 13. Nearest marvin command
<the nearest existing marvin command, if any, and the boundary between them. Named so a reader
is not surprised by two reports over the same territory. The audit stays self-contained: it may
use the command as an accelerator, and treats its output as evidence to verify, never as a
section to paste.>
```

## Acceptance checklist

A spec is ready when every line holds. Review a new spec against this list before it ships.

- [ ] The audit question is one sentence and is answerable with the protocol below it
- [ ] Every audit-specific parameter has a derivation rule or an explicit "ask the user"
- [ ] The spec works with every optional parameter unset
- [ ] "Не входит" is present, non-empty, and routes each excluded item somewhere
- [ ] The collection protocol is numbered, ordered, and each step names its output
- [ ] Every command in the spec is real: correct binary, correct flags, and it runs on a project
      that has that tool
- [ ] Every tool has a fallback for when it is absent
- [ ] Every threshold carries a number, a severity and an `Origin` of `requirements` or `derived`
- [ ] No threshold contradicts a neighbouring audit's row for the same condition; where two
      audits can see one condition, exactly one files it and the other cites it
- [ ] The sampling unit and the top-N ranking are named, and a unit the contract defines
      (`operations`) is used with the contract's definition rather than a local one
- [ ] Section 7 opens with the deltas-only line and its early stop is a conjunct, not a copy
- [ ] Every parameter shared with another audit carries that audit's definition, not a second one
- [ ] Tooling is acquired by the contract's §9 policy; the spec states no policy of its own
- [ ] Path exclusions reference the contract's canonical set rather than re-encoding it, and
      any ripgrep glob the spec does add is `**/`-prefixed
- [ ] The report additions say where in the standard skeleton they go
- [ ] The score has a formula, not an adjective
- [ ] The risks section names at least one concrete way this audit produces a false result
- [ ] The prohibitions section is non-empty and adds to the contract rather than repeating it
- [ ] Dependencies match `audit-index.md` in both directions
- [ ] Nothing in the spec restates the report skeleton, the finding schema, the severity scale,
      the evidence rules or the release procedure
- [ ] No claim that requires context from another session
- [ ] Every cross-reference resolves: a contract reference names the file and a section the
      contract actually has (`report-contract.md` §1…§10, no sub-numbering); a reference to the
      spec's own section is written bare
- [ ] The file is between 150 and 250 lines. Over the ceiling means a condition belongs to
      another audit, or a paragraph is restating the contract
- [ ] Run on a sample repository, the spec yields a result that is neither empty nor a hundred
      unranked observations

## Adding an audit to the family

1. Write `audits/A-XX-<slug>.md` from the template above.
2. Add the row to `audit-index.md`: catalogue, dependency matrix, and — if it overlaps one — the
   marvin-command table.
3. If it needs a new sampling unit or a new machine-register value, change `report-contract.md`
   and say so in the commit: the contract is shared, and a value added for one audit is a value
   every audit and `audit-summary` must accept.
4. Do not add a new skill. The family is three commands; a twenty-third audit is a file.
