---
name: adr-sync
description: Regenerate the marker-managed "Architecture decisions" digest in the project's CLAUDE.md from the accepted Architecture Decision Records — one line per decision, so the project memory always reflects the ratified corpus. Shows the diff and asks before writing. Human-run by design; the model never invokes this on its own.
disable-model-invocation: true
---

# ADR Sync

Project memory sync: distill the **accepted** decision records into a compact digest inside the
host project's `CLAUDE.md`, between managed markers, so every future session starts aware of the
ratified decisions without reading the whole corpus. This is a human gate of the ADR lifecycle
(ADR-0027): the user runs it deliberately, sees the diff, and confirms before anything is
written.

The digest lives between:

```
<!-- marvin:adr-digest:start -->
<!-- marvin:adr-digest:end -->
```

Only the block between the markers is ever regenerated — surrounding prose survives untouched.

## Scope rule

**Accepted records only.** `proposed` records carry no authority yet; `superseded`,
`deprecated`, and `rejected` ones carry it no longer. A record that was superseded since the
last sync **drops out** of the digest on regeneration — that is the point of syncing.

## Workflow

### 1. Read the corpus

Call the `adr` MCP tool with `{"action": "list"}` and keep the `accepted` records (the
structured payload carries status, title, and path per record). None accepted → say so and
stop; an empty digest is not worth a managed block.

### 2. Build the digest

One line per accepted record — a link and a one-line summary:

```markdown
| ADR | Decision | In one line |
|-----|----------|-------------|
| [0007](docs/adr/0007-marvin-working-directory.md) | Unified `.marvin/` working directory | Every generated service file lives under one hidden root, one subdir per command group. |
```

- Link paths come from the tool's payload (project-root-relative — correct for a root-level
  `CLAUDE.md`).
- The one-liner is judgement work: read each record's Decision section and compress it to one
  sentence a newcomer can act on. Reuse still-accurate lines from an existing digest — stable
  lines make stable diffs.
- Keep corpus order (by number). A long corpus stays one row per record — the digest is a map,
  not a mirror.

### 3. Place the block

- **Markers exist** in `CLAUDE.md` → regenerate strictly between them.
- **No markers yet** → propose where to add the block (near existing architecture/decisions
  prose, else at the end of the file), show the exact insertion, and let the user adjust the
  spot. Add a short heading above the block (e.g. `## Architecture decisions`) only when
  inserting fresh — never duplicate a heading the file already has.
- **No `CLAUDE.md` at all** → offer to create a minimal one holding just the heading and the
  managed block; create nothing without confirmation.

### 4. Diff, confirm, write

Non-negotiable: **show the diff and get explicit confirmation before writing.**

1. Present the change as before/after of the managed block (or the insertion point), plus a
   one-line summary: records added, dropped (with why — superseded? deprecated?), reworded.
2. Ask for confirmation. "No" ends the run with nothing written; section-level tweaks
   (rewording a summary line) are applied and re-shown.
3. On yes, write `CLAUDE.md` — touching only the managed block (plus the heading when freshly
   inserting).
4. Confirm what happened and remind that re-running after future acceptances keeps the digest
   honest; suggest re-syncing after every `/marvin:adr-accept` / `/marvin:adr-supersede`.

## Guidelines

- **Never edit outside the markers.** Whatever else `CLAUDE.md` needs is another command's
  job; hand-written prose around the block is sacred.
- **Digest, not duplicate.** One line per decision; rationale, alternatives, and consequences
  stay in the records. The block ends up dozens of lines, not hundreds.
- **The corpus is the source of truth.** Do not "fix" the digest by hand-adding a decision
  that has no accepted record — draft and ratify it first (`/marvin:adr`,
  `/marvin:adr-accept`), then sync.
- **Do not confuse the marker families.** `marvin:adr-digest` (this block, in `CLAUDE.md`) and
  `marvin:adr-index` (the corpus index the `adr index` action maintains) are separate managed
  blocks with separate owners.
