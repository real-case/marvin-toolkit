# ADR 0027 — Tool-backed ADR lifecycle

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-07-02                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0002](0002-tool-backed-verification.md) / [ADR-0010](0010-tool-backed-contract-seal.md) (the "determinism by name" doctrine), [ADR-0005](0005-portable-spec-contract.md) (host-adaptive artifact locations), [ADR-0007](0007-marvin-working-directory.md) (`.marvin/config.json`), [ADR-0024](0024-mcp-apps-widget-architecture.md) (shared data contracts), [ADR-0026](0026-configurable-status-model.md) (fail-closed config read-modify-write), `docs/proposals/toolbox-expansion.md` (D1, WP1–WP2) |

## Context

The `adr` skill drafts a well-formed record through dialogue, but every guarantee around
that draft is prose the model may or may not follow: "determine the next ADR number from
the highest existing number", "update the old ADR's Status to Superseded", "no
placeholders remain". These are exactly the operations ADR-0002 and ADR-0010 call
**"determinism by name"** — a promised guarantee whose enforcement depends on the model
performing mechanical work (numbering, cross-file link pairing, status stamping, corpus
consistency checks) that a script performs correctly every time and a model only usually.
The lifecycle around creation is missing entirely: no ratification step, no supersession
mechanics, no corpus lint, no index regeneration.

Two facts about ADR corpora in the wild shape the mechanics:

1. **Location varies.** marvin's own records live in `docs/adr/`; other hosts use
   `docs/decisions/` or a top-level `adr/`. The spec pipeline already solved this class of
   problem with host-adaptive discovery (ADR-0005) — the ADR corpus needs the same.
2. **Header style varies.** marvin's records carry a **table-style** header
   (`| Status | **Accepted** … |`, `| Date | … |`, paired `Supersedes` / `Superseded by`
   rows), while the MADR/Nygard lineage — including the template marvin's own `adr` skill
   emits on foreign projects — uses **heading-style** sections (`## Status`, `## Date`).
   A tool that parses only one style is useless on half the repos it lands in.

## Decision

**Every deterministic ADR-lifecycle guarantee moves into an `adr` MCP tool**; prose keeps
only what needs judgement (drafting content, review dialogue). The tool ships six actions
— `next | list | index | audit | accept | supersede` — over one corpus module.

1. **Host-adaptive corpus resolution** (the ADR-0005 pattern): the `adr.dir` key of
   `.marvin/config.json` wins when set; otherwise the first existing of `docs/adr/`,
   `docs/decisions/`, `adr/` is detected; otherwise `docs/adr/` is the default. The `adr`
   config block (`dir`, `index_file`) is read through the same fail-closed config path the
   kanban tools use (ADR-0026): an invalid block falls back to defaults with a warning,
   and keys owned by other tools survive every read-modify-write.
2. **A tolerant dual-style parser** reads both header styles into one record shape —
   `{number, slug, title, status, date, supersedes, superseded_by, path}`. Number and slug
   come from the `NNNN-<slug>.md` filename; status/date/links come from the header table
   or the `## Status` / `## Date` sections. A file the parser cannot read (no title, no
   status, an out-of-vocabulary status) is **surfaced per file through a malformed
   channel** — the kanban precedent — never silently dropped and never fatal to the rest
   of the corpus.
3. **The status vocabulary is the closed set** `proposed | accepted | deprecated |
   superseded | rejected`. Parsing is tolerant of decoration (`**Accepted** (solo
   maintainer sign-off)`, `Superseded by ADR-0031`); the stored value is always one of the
   five.
4. **Authority lives at the gates, not the draft.** Creation becomes model-invocable — a
   tool-created or skill-drafted record **always lands `proposed`**, so a wrong draft
   costs nothing. Ratification (`accept`), rollback (`supersede`), and project-memory sync
   are **human-gated at the skill layer** (WP2 ships those skills with
   `disable-model-invocation: true`). The tool itself validates fail-closed but trusts its
   caller — the human-only contract is a surface property, exactly as with the other
   mutating marvin tools.
5. **`accept` runs a readiness gate first**, then stamps: the record must be `proposed`,
   contain no `{…}` template placeholders outside code spans, carry the required sections
   (Context, Decision, Consequences), and every `ADR-NNNN` cross-reference in it must
   resolve within the corpus. Only then are status and date stamped — a surgical edit of
   the header fields in the record's own style.
6. **Supersession is a new record plus paired link flips — the old record's content is
   never edited.** `supersede` either creates a `proposed` skeleton at the next number or
   pairs an existing successor record; the successor gains the `Supersedes` link, and the
   old record's status flips to `superseded` with a `Superseded by` link. Body prose of
   the superseded record stays byte-identical: history is preserved, only the header
   fields move.
7. **`index` regenerates a corpus index between managed markers**
   (`<!-- marvin:adr-index:start -->` / `<!-- marvin:adr-index:end -->`), so hand-written
   prose around the block survives every regeneration. The target is `adr.index_file`
   when configured, else an existing `README.md` inside the corpus directory; with no
   target the action skips gracefully. A first run on a marker-less file appends the
   managed block.
8. **`audit` lints the whole corpus** and reports typed findings with severities:
   unparseable files, invalid status, duplicate numbers, numbering holes, dangling
   `ADR-NNNN` references, broken supersede pairs (one-way links, a `superseded` status
   with no link, a link without the status), `{…}` placeholder residue, and a stale or
   unmanaged index. Errors fail the audit; warnings (holes, residue in a still-`proposed`
   draft, index staleness) inform without failing it.
9. **An `AdrRecord` zod contract joins the shared contracts** (ADR-0024 data-first
   staging) together with the list/audit payload schemas; the tool returns
   `structuredContent` built from them alongside its text rendering, feeding the future
   dashboard (WP6) and widget family.

## Consequences

- The lifecycle guarantees are now code with tests — numbering cannot collide, supersede
  links cannot go one-way, an unfilled skeleton cannot be accepted — instead of prompt
  discipline (the ADR-0002/0010 payoff).
- The corpus module works on foreign repos: both header styles parse, all three
  conventional locations resolve, and a hand-rolled corpus degrades one file at a time
  through the malformed channel rather than wholesale.
- Lifecycle changes now require a server rebuild and committed `dist/` (accepted — the
  standing trade-off of every tool-backed gate since ADR-0002).
- The dual-style parser is deliberately heuristic: exotic formats (YAML-frontmatter MADR,
  status badges) land in the malformed channel rather than being guessed at. Surfacing
  beats guessing; support can widen later without a schema break.
- WP1 ships the mechanics only. Until WP2 lands the `adr-*` skills, the mutating actions
  are reachable without the human-gate surface — mitigated by the fail-closed validation
  and the `accept` readiness gate, and closed by WP2's `disable-model-invocation`
  frontmatter.
- `.marvin/config.json` gains its second tool-owned block (`adr`, after `gates`),
  confirming the ADR-0026 merge-over-raw-JSON write path as the house pattern for
  multi-tool config ownership.
