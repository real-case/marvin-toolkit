---
name: adr-accept
description: Ratify a proposed Architecture Decision Record — flip it to accepted with a date stamp, through the adr tool's fail-closed readiness gate (no placeholders, required sections present, cross-references resolve). Human-run by design; the model never invokes this on its own.
disable-model-invocation: true
---

# ADR Accept

Ratify **one `proposed` record**: `proposed → accepted`, stamped with today's date. This is the
human gate of the ADR lifecycle (ADR-0027) — the user runs this command deliberately; nothing
else flips a record to `accepted`.

The mechanics live in the **`adr` MCP tool**: its `accept` action runs a readiness gate
**fail-closed** and writes nothing on refusal. This skill's job is to identify the right record,
invoke the action, and turn a refusal into a fix path.

## Input

`$ARGUMENTS` — the record to ratify: a number (`31`, `0031`) or a title fragment.

## Workflow

### 1. Identify the record

- Call the `adr` MCP tool with `{"action": "list"}`.
- Resolve `$ARGUMENTS` against the corpus (number first, then title). With no argument, show
  the `proposed` records and ask which one to ratify; with none, say so and stop.
- Confirm the pick with the user when it came from a fragment — ratification must never land
  on the wrong record.

### 2. Ratify

Call the `adr` MCP tool with `{"action": "accept", "number": <n>}`.

On success the tool stamps status **and** date in the record's own header style and reports
both. If it notes the corpus index is now stale, call `{"action": "index"}` to refresh it.
Report the result: record, new status, date, path.

### 3. If the gate refuses — explain and route, never bypass

The tool reports **all** gate failures at once. Translate each into its fix:

| Refusal | Meaning | Fix |
|---------|---------|-----|
| template placeholder(s) left | `{…}` slots outside code spans — unfinished sections | Fill the placeholders with real content; `/marvin:adr-review` gives a full defect list |
| required section(s) missing | No `## Context`, `## Decision`, or `## Consequences` | Add the missing section(s) with substantive content |
| unresolved cross-reference(s) | The record cites an `ADR-NNNN` that is not in the corpus | Fix the number if it's a typo; drop or redirect the reference otherwise |
| record is not `proposed` | Already `accepted` (no-op), or `superseded` / `deprecated` / `rejected` | Nothing to ratify; a changed decision needs a **new** record (`/marvin:adr`, then `/marvin:adr-supersede` if it replaces this one) |
| record cannot be parsed | Malformed header — no title, no status, or an out-of-vocabulary status | Repair the header in either supported style; `/marvin:adr-audit` shows the per-file reason |

**Never work around the gate** — do not hand-edit the Status field, and do not "fix" a record by
weakening it (deleting a failing section or reference instead of completing it). The gate exists
so that only finished records carry authority. After fixing, run this command again; suggest
`/marvin:adr-review` first when more than one refusal came back.

## Guidelines

- **One record per run.** Batch ratification hides mistakes; each acceptance is a deliberate
  human act.
- **Ratification is not review.** This command checks readiness mechanically; whether the
  decision is *right* is `/marvin:adr-review`'s judgement work. Offer it when the user seems
  unsure.
- **Do not edit content here.** Beyond what the tool stamps, this command changes nothing —
  fixes happen in the record via the author (or `/marvin:adr-review`'s formal fixes), then the
  gate runs again.
