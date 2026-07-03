---
name: adr-supersede
description: Properly roll back an accepted Architecture Decision Record — a new record supersedes the old one via the adr tool, which pairs the links both ways and flips the old record's status without ever editing its content. Human-run by design; the model never invokes this on its own.
disable-model-invocation: true
---

# ADR Supersede

Retire a decision **the right way**: not by editing or deleting the old record, but by pairing
it with a successor. The old record's history stays byte-identical except for its header —
status flips to `superseded` with a link to the successor; the successor carries the
`Supersedes` link back. This is a human gate of the ADR lifecycle (ADR-0027): the user runs it
deliberately.

The pairing mechanics live in the **`adr` MCP tool** — its `supersede` action validates
fail-closed and performs the two-sided link flip atomically per file. Never hand-edit statuses
or supersede links.

## Input

`$ARGUMENTS` — the record being superseded (number or title fragment), optionally with the
replacement: a new title, or the number of an existing record to pair as successor.

## Workflow

### 1. Identify the old record

- Call the `adr` MCP tool with `{"action": "list"}`; resolve `$ARGUMENTS` (number first, then
  title). With no argument, ask which decision is being rolled back.
- Confirm the pick with the user when it came from a fragment — a supersession on the wrong
  record rewrites the wrong history.

### 2. Choose the successor mode

Exactly one of two shapes — ask if the user hasn't said:

- **New replacement decision** (the common case): call
  `{"action": "supersede", "number": <old>, "title": "<new decision title>"}`.
  The tool creates a `proposed` skeleton at the next free number with the `Supersedes` link
  already in place, and flips the old record. The skeleton deliberately carries `{…}`
  placeholders so the accept gate refuses it until it is actually written.
- **Pair an existing record** (the replacement was already drafted, e.g. via `/marvin:adr`):
  call `{"action": "supersede", "number": <old>, "successor": <new>}`.
  The tool adds the `Supersedes` link to the successor (idempotent if present) and flips the
  old record.

### 3. After the flip

- If the tool notes the corpus index is stale, call `{"action": "index"}` to refresh it.
- **Skeleton mode:** offer to fill the successor's sections now — context (why the old
  decision no longer holds), the new decision, consequences — following the drafting bar of
  `/marvin:adr` (substantive content, no placeholders left). Then point at
  `/marvin:adr-review` and, when ready, `/marvin:adr-accept` — the successor starts
  `proposed` like every draft.
- Report the outcome: old record (now `superseded`, content untouched), successor (number,
  path, status).

### 4. If the tool refuses — explain, never bypass

| Refusal | Meaning | Path |
|---------|---------|------|
| already superseded | The record was rolled back before; the tool names the successor | Nothing to do — a further change supersedes the *successor* instead |
| requires exactly one of `title` / `successor` | Both or neither replacement modes given | Pick one mode (step 2) |
| cannot supersede itself | `successor` equals the old number | Name a different successor |
| title yields no usable slug | The new title has no latin letters/digits | Re-title the successor |
| record cannot be parsed | Malformed header on either side | Repair per `/marvin:adr-audit`'s per-file reason, then retry |
| target file already exists | The next number's filename is taken | Run `/marvin:adr-audit` — usually a numbering duplicate to resolve first |

Never work around a refusal by hand-editing statuses or links — one-way supersede pairs are
exactly the corruption the audit exists to catch.

## Guidelines

- **The old record is history — never edit its content.** Rationale, alternatives, and
  consequences stay as they were decided; only the header moves, and only via the tool.
- **Superseding ≠ deleting.** A superseded record remains part of the decision graph; the
  index keeps listing it with its successor.
- **A withdrawn draft is not a supersession.** For a `proposed` record that is simply wrong,
  edit or remove the draft — supersession is for decisions that carried authority
  (`accepted`, or a `deprecated` one being formally replaced).
- **One supersession per run.** Chains (A→B→C) are built one deliberate step at a time.
