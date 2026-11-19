---
name: hunt-triage
description: Triage the bug-hunter ledger across every run — merge duplicates, fold repeated defects into one systemic finding, re-verify findings whose code changed, rank what is open by severity, confidence and journey priority, and write one report under .marvin/hunt/reports/. Use when the user says "triage the findings", "разбери найденные баги", "which bugs matter most?", "hunt report", "clean up the hunt ledger", or after one or more /marvin:hunt-code runs. Reads code only to re-verify; never fixes anything.
---

# Triage the hunt ledger

Turn everything the hunts have recorded into one ranked, deduplicated list a team can act on.
The ledger is `.marvin/hunt/findings.jsonl`, append-only: triage never rewrites it, it adds
rulings, links and statuses through the `hunt` MCP tool from the `marvin` server.

## Workflow

### 1. Read the groups

Call `hunt` with `action: "triage"`. It returns the open findings, ranked (TRI-07: severity,
confidence, the priority of the journey they hit, how many files they touch, id), and three
lists for you to work through:

- **possible duplicates** — same category and primary file, different fingerprint;
- **systemic candidates** — same category and title in several files;
- **stale** — open findings whose files changed since they were last seen.

An empty ledger → say so and suggest `/marvin:hunt-code`.

### 2. Duplicates (TRI-01)

For each group, read both findings. If they describe one defect, link the weaker to the
stronger: `hunt` `action: "link"`, `id: <weaker>`, `links: { duplicate_of: <stronger> }`, then
close it with `action: "verdict"`, `verdict: { stage: "human", ruling: "reject", by:
"hunt-triage", reasoning: "duplicate of <stronger>" }` **only after the person agrees** — a
human-stage ruling is the person's. Without agreement, leave the link and say so.

### 3. Systemic patterns (TRI-04)

When several findings share one root cause, pick the clearest as the root and link the rest:
`links: { root_cause: <root> }`. Report the root with the number of occurrences, not each
copy.

### 4. Re-verify stale findings (TRI-06)

For each stale finding, read the cited lines at HEAD. If the defect is gone, tell the person
and offer `action: "set-status"`, `status: "fixed"` for a confirmed one, or a human `reject`
for a candidate. If it is still there, leave it. Do not rerun reproducing tests unless the
person asks; that is `/marvin:hunt-code`'s job.

### 5. Report

Call `hunt` with `action: "report"`. It writes `.marvin/hunt/reports/<stamp>-triage.md` and
`latest.md` with the summary, bugs by severity, UX and accessibility, design deviations,
systemic patterns, flow-map gaps, suspected findings and coverage. Then give the person:

- the top five open confirmed findings, each with id, severity, one line and where it is;
- what you linked or proposed to close, and what needs their decision;
- the counts of suspected and candidate findings still waiting for proof.

## What needs the person

A human ruling (`stage: "human"`: confirm, reject, wont-fix) records a decision as the
person's. Propose them; record one only when the person said so in this conversation. Links
and the report are yours to write.

## Rules

- Never edit product code, the ledger file or the reports by hand. Every change is a `hunt`
  call.
- Below-floor and low-confidence findings stay in the ledger and out of the ranking; do not
  promote them.
