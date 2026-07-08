---
name: adr
description: Draft a structured Architecture Decision Record (ADR) capturing context, alternatives considered, the decision, and consequences in MADR / Nygard format. Use when the user says "write ADR", "record this decision", "document architecture choice", "capture the rationale", "create decision log", or right after committing to a significant technical choice (framework, database, protocol, pattern, migration). Numbering, target path, and the corpus index come from the `adr` MCP tool; drafts always land with status `proposed` — ratification is the separate human-run `/marvin:adr-accept`.
---

Draft an Architecture Decision Record (ADR) documenting a significant technical decision.

The deterministic mechanics — next number, target path, corpus discovery, index regeneration —
belong to the **`adr` MCP tool** (from the `marvin` server, ADR-0027). This skill owns only the
judgement work: gathering context, weighing alternatives, and writing the prose. Never hand-number
a record or hand-maintain the index.

A draft **always lands with status `proposed`** — never `accepted`. Authority lives at the gates:
ratification is `/marvin:adr-accept`, rollback is `/marvin:adr-supersede`, both human-run.

## Argument handling

- `/marvin:adr <title>` — use the provided title as the decision topic
- `/marvin:adr <title> --context <path>` — use research notes from the given file as additional input
- `/marvin:adr` — ask the user what decision they want to document

## Phase 1: Discover the corpus and project conventions

1. Call the `adr` MCP tool with `{"action": "list"}` — it resolves the corpus location
   (config `adr.dir` → detected `docs/adr/` / `docs/decisions/` / `adr/` → default `docs/adr/`)
   and returns every existing record with number, title, and status. Note records related to
   this decision, and any malformed files it reports.
2. If records exist, read 2–3 recent ones to match the corpus's **style, tone, and header
   format** — marvin-style table headers (`| Status | … |`) and MADR-style sections
   (`## Status`) both parse; new records should match their neighbours. If the corpus is
   empty, use the template in Phase 3 as-is.
3. Read project-level conventions: `CLAUDE.md` and any files in `.claude/` — coding standards,
   architectural constraints, naming conventions; check `docs/` for related RFCs or design docs.
4. Call the `adr` MCP tool with `{"action": "next", "title": "<working title>"}` — it returns
   the reserved number and the exact target path (`<dir>/NNNN-<slug>.md`). Use both verbatim.

## Phase 2: Gather decision context from the codebase

### 2a. Understand what's affected

1. Ask the user (if not already clear) what alternatives they're choosing between
2. If `--context <path>` was provided, read that file — treat it as pre-research input and skip questions the research already answers

### 2b. Analyze the codebase

Run these in parallel where possible:

- **Dependencies:** Read `package.json`, `go.mod`, `requirements.txt`, `Cargo.toml`, or equivalent — note versions of relevant packages
- **Usage patterns:** `Grep` for imports/usages of the technologies or patterns being evaluated
- **Project structure:** `ls` or `tree` of key directories to understand the scope of impact (how many modules/packages are affected)
- **Config files:** Read configs relevant to the decision — `tsconfig.json`, `.eslintrc`, bundler config, `docker-compose.yml`, CI/CD pipeline files (`Dockerfile`, `.github/workflows/`, `.gitlab-ci.yml`)
- **Git history:** `git log --oneline -20` for recent context; `git log --oneline --all -- <relevant-path>` if the decision targets a specific area

### 2c. Check for conflicts with existing decisions

- Read the existing records that Phase 1 flagged as related
- Flag if this decision **supersedes**, **extends**, or **conflicts** with an existing ADR
- If it supersedes one: do **not** edit the old record and do not hand-write the link pair.
  Draft the new record normally; after it lands, point the user at `/marvin:adr-supersede`,
  which pairs the two records and flips the old status deterministically (its content is
  never touched)

## Phase 3: Draft the ADR

Use the template below (or the corpus's own established format from Phase 1). Fill in **all
sections** with substantive content — no `{…}` placeholders, HTML comments, or TODOs may remain:
the `accept` readiness gate refuses a record with placeholder residue, missing required sections
(Context, Decision, Consequences), or cross-references that don't resolve.

```markdown
# ADR-{NNNN}: {Title}

## Status

Proposed

## Date

{YYYY-MM-DD}

## Context

{Explain the forces at play: technical constraints, business requirements, team size/skills,
timeline pressure, existing technical debt. Write for someone reading this 2 years from now
who has no context beyond the codebase.}

## Decision drivers

{Explicit list of criteria used to evaluate alternatives. Examples:
- Must support SSR with Next.js App Router
- Bundle size impact < 5 KB gzipped
- Team familiarity — at least 2 developers have production experience
- Active maintenance — recent releases, responsive issue tracker}

## Decision

{State the decision in 1–2 sentences using active voice: "We will use X for Y."
Then explain the rationale — why this option best satisfies the decision drivers above.}

## Alternatives considered

### Option A: {name}
- **How it addresses drivers:** ...
- **Pros:** ...
- **Cons:** ...

### Option B: {name}
- **How it addresses drivers:** ...
- **Pros:** ...
- **Cons:** ...

{Add more options if they were seriously considered. Do not list options that were
trivially dismissed — only those that had a real chance.}

## Consequences

### Positive
- ...

### Negative
- ...

### Risks and mitigations
- Risk: ... → Mitigation: ...

## Related decisions

{List related ADRs if any. "None" is acceptable.
- Related to: ADR-YYYY (if applicable)}
```

### Template notes

- **Status is always `Proposed`** — the draft's correctness costs nothing until ratification.
  Never write `Accepted` (that is `/marvin:adr-accept`'s job) and never pre-fill supersede
  links (that is `/marvin:adr-supersede`'s job).
- **Decision drivers** make the evaluation framework explicit. Readers can re-evaluate the decision against the same criteria if circumstances change.
- **How it addresses drivers** in alternatives ties each option back to the criteria, making the comparison structured rather than ad-hoc.
- **Risks and mitigations** is more actionable than a plain "Risks" list — it forces thinking about what to do if the risk materializes.
- **Related decisions** creates a navigable decision graph across ADRs — every `ADR-NNNN`
  reference must point at a record that actually exists (the audit lints dangling references).

## Phase 4: Review, iterate, and write

1. Present the full ADR draft to the user — do NOT write to disk yet
2. Ask: "What should I change? You can point to a specific section (e.g. 'rewrite Consequences') or approve as-is."
3. If the user requests changes:
    - Revise only the requested section(s)
    - Re-present the updated draft
    - Repeat until approved
4. After user approval:
    - Write the file at the exact path `adr next` returned in Phase 1 (re-run
      `{"action": "next", "title": "<final title>"}` first if the title changed or the
      conversation was long enough that another record may have landed meanwhile)
    - Call the `adr` MCP tool with `{"action": "index"}` to refresh the corpus index
      (it maintains a marker-managed block and skips gracefully when the corpus has no
      index target)
5. Close by naming the two follow-up gates: `/marvin:adr-review` for a grounded review of the
   draft, and `/marvin:adr-accept` (human-run) to ratify it. If the decision replaces an
   existing record, point at `/marvin:adr-supersede` instead of editing the old file.

## Quality checklist (self-check before presenting draft)

- [ ] Title is a short noun phrase describing the **decision**, not the problem
- [ ] Context explains **why** the decision is needed — not just what it is
- [ ] Decision drivers are explicit and specific to this project, not generic
- [ ] At least 2 alternatives are listed with honest pros/cons tied to the drivers
- [ ] Negative consequences and risks are included — no decision is free
- [ ] Risks have mitigations — even if the mitigation is "accept the risk"
- [ ] No placeholders, HTML comments, or TODOs remain (the accept gate will refuse them)
- [ ] Number and path came from `adr next` — never hand-numbered
- [ ] Status reads `Proposed` — ratification and supersession stay with their human-run commands
- [ ] Every referenced ADR number exists in the corpus
- [ ] The ADR is consistent with conventions found in CLAUDE.md and existing records
