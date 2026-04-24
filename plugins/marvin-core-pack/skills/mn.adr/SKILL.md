---
name: architecture-decision-record
description: Create a structured Architecture Decision Record (ADR) capturing context, alternatives considered, the decision, and consequences in MADR / Nygard format. Use when the user says "write ADR", "record this decision", "document architecture choice", "capture the rationale", "create decision log", or right after committing to a significant technical choice (framework, database, protocol, pattern, migration). Produces numbered markdown files under docs/adr/.
disable-model-invocation: true
---

Create an Architecture Decision Record (ADR) to document a significant technical decision.

## Argument handling

- `/mn.adr <title>` — use the provided title as the decision topic
- `/mn.adr <title> --context <path>` — use research notes from the given file as additional input
- `/mn.adr` — ask the user what decision they want to document

## Phase 1: Discover existing ADRs and project conventions

1. Read project-level conventions:
    - `CLAUDE.md` and any files in `.claude/` — for coding standards, architectural constraints, naming conventions
    - `docs/` directory listing — check for existing RFCs, design docs, or architectural guidelines
2. Find existing ADR files:
   ```
   Glob("**/adr/**/*.md") and Glob("**/decisions/**/*.md")
   ```
3. If ADRs exist:
    - Read 2–3 recent ones to match the project's ADR **style, tone, and format**
    - Determine the next ADR number from the highest existing number
    - Note the directory where ADRs are stored — use the same location
4. If no ADRs exist: use `docs/adr/` as the default directory and the template from Phase 3

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

- Read any existing ADRs on related topics found in Phase 1
- Flag if this decision **supersedes**, **extends**, or **conflicts** with an existing ADR
- If superseding: note the old ADR number for update in Phase 4

## Phase 3: Draft the ADR

Use the template below. Fill in **all sections** with substantive content — no placeholders, HTML comments, or TODOs should remain in the final draft.

```markdown
# ADR-{NNN}: {Title}

## Status

{Proposed | Accepted | Deprecated | Superseded by ADR-XXX}

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
- Supersedes: ADR-XXX (if applicable)
- Related to: ADR-YYY (if applicable)}
```

### Template notes

- **Decision drivers** make the evaluation framework explicit. Readers can re-evaluate the decision against the same criteria if circumstances change.
- **How it addresses drivers** in alternatives ties each option back to the criteria, making the comparison structured rather than ad-hoc.
- **Risks and mitigations** is more actionable than a plain "Risks" list — it forces thinking about what to do if the risk materializes.
- **Related decisions** creates a navigable decision graph across ADRs.

## Phase 4: Review, iterate, and write

1. Present the full ADR draft to the user — do NOT write to disk yet
2. Ask: "What should I change? You can point to a specific section (e.g. 'rewrite Consequences') or approve as-is."
3. If the user requests changes:
    - Revise only the requested section(s)
    - Re-present the updated draft
    - Repeat until approved
4. After user approval:
    - Create the file at the determined path
    - If this ADR supersedes an existing one: update the old ADR's Status to `Superseded by ADR-{NNN}` and add today's date

## Quality checklist (self-check before presenting draft)

- [ ] Title is a short noun phrase describing the **decision**, not the problem
- [ ] Context explains **why** the decision is needed — not just what it is
- [ ] Decision drivers are explicit and specific to this project, not generic
- [ ] At least 2 alternatives are listed with honest pros/cons tied to the drivers
- [ ] Negative consequences and risks are included — no decision is free
- [ ] Risks have mitigations — even if the mitigation is "accept the risk"
- [ ] No placeholders, HTML comments, or TODOs remain
- [ ] ADR number doesn't conflict with existing ADRs
- [ ] If superseding another ADR, the old one is identified for update
- [ ] The ADR is consistent with conventions found in CLAUDE.md and existing ADRs
