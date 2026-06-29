---
name: handoff
description: Capture the full context of the current work into a durable handoff document and emit a paste-ready prompt to continue in a fresh session. Use when the user says "create a handoff", "hand off this work", "continue this in a new session", "prep context for the next session", "I'll continue later", "продолжить в новой сессии", or when wrapping up a phase of work that will resume in another session.
---

# Handoff

Capture everything a **fresh session** needs to continue the current work, write it to a durable document under `.marvin/handoff/`, and emit a short paste-ready prompt that points the new session at it.

## Core principle

**The next session has zero memory of this conversation.** The handoff must be self-sufficient: every objective, decision, file path, and next step the new session needs — and nothing it would have to re-derive or re-decide. Ground it in *inspected* state (git, files, artifacts), never in assumption. Synthesize the conversation; do not dump the transcript.

## Input

`$ARGUMENTS` — optional focus note or slug hint (e.g. "emphasize the migration risk" or a phrase for the filename). If given, weave it in; otherwise infer the objective from the conversation.

## Workflow

### 1. Inspect the real state

Run read-only commands and base every claim on their output:

```bash
git branch --show-current
git status --short
git log --oneline -10
git diff --stat                       # uncommitted
# on a topic branch, also the branch's full diff vs its base:
git diff <base>...HEAD --stat
gh pr view --json number,url,state,baseRefName 2>/dev/null   # open PR, if any
date -u +"%Y-%m-%dT%H:%M:%SZ"                                # for the `created` frontmatter
```

Detect pipeline / working-dir artifacts that carry context:
- `.marvin/task/` — the active spec (`<NNN>-<slug>.md`) and `verification.md`
- `.marvin/handoff/` — any existing handoff for this work (see step 3)
- a plan file under the session's plan directory, if one was produced
- relevant lessons in `.marvin/memory/` (ADR-0021)

### 2. Reconstruct the narrative

From **this** session, distill — concisely:

- **Objective** — what the work ultimately aims to achieve.
- **Where we are** — the phase/step just completed and what remains.
- **Decisions and their rationale** — including alternatives considered and *why they were rejected*, so the next session does not relitigate settled choices.
- **Constraints, conventions, gotchas** discovered along the way.
- **Open questions** — anything deferred or needing a human decision.

### 3. Allocate the handoff file

Write to `.marvin/handoff/<NNN>-<slug>.md`:
- `<NNN>` — zero-padded sequence = highest existing leading-integer prefix in `.marvin/handoff/` + 1 (`001` when empty), mirroring the spec/ADR numbering convention (ADR-0022). Filename-only ordering; the slug is the identity.
- `<slug>` — short kebab-case of the objective (or derived from `$ARGUMENTS`).
- Create `.marvin/handoff/` if it does not exist.

If a recent handoff for the **same** work already exists, offer to **update it in place** rather than creating a near-duplicate.

### 4. Write the handoff document

Open the file with a **YAML frontmatter block**, then the markdown body. The frontmatter is
machine-readable (ADR-0024) — it powers `/marvin:handoff-list` and the handoff widget, so fill
it from the *inspected* state, not prose. Then write the body using the structure below —
self-contained, skimmable, factual. Drop body sections that don't apply:

```markdown
---
id: "<NNN>"                 # the zero-padded sequence from step 3 (quote it)
slug: <slug>                # the kebab-case slug from step 3 (matches the filename)
objective: <one line>       # quote if it contains a colon or other YAML-special char
branch: <branch>            # from `git branch --show-current`
base: <base>                # omit this line entirely if not on a topic branch
pr_url: <url>               # omit this line entirely if there is no open PR
spec_slug: <slug>           # omit unless a .marvin/task/ spec backs this work
created: "<ISO-8601 UTC>"   # the `date -u …` output from step 1 (quote it)
---

# Handoff — <objective, one line>

> Generated <branch> @ <short-sha>. Read this top-to-bottom, then resume at **Next steps**.

## Objective
<1–3 sentences: what we're building/fixing and why.>

## Status
<Current phase. What is DONE vs. PENDING. One-line "you are here".>

## Repository state
- Branch: `<branch>` (base: `<base>`)
- Uncommitted: <summary of git status, or "clean">
- Recent commits: <sha — subject> …
- Tests / verify: <PASS|FAIL|not run — how to run>
- Open PR: <url or "none">

## Key context & decisions
- <decision> — <why>. (rejected: <alternative> because <reason>)
- …

## Relevant files
- `path/to/file.ext:line` — <why it matters>
- Spec: `.marvin/task/<NNN>-<slug>.md` (if any)
- Plan / verification: <paths, if any>

## Next steps
1. <the first concrete action the new session should take>
2. …

## Constraints & gotchas
- <conventions to follow, things to avoid, environment quirks>

## Open questions
- <anything needing a human decision>
```

Cite the real paths, SHAs, and PR URLs gathered in step 1 — no invented state. No AI/automation attribution. Keep the frontmatter `objective` in sync with the `# Handoff — …` title; the `pr_url`/`base`/`spec_slug` lines are present only when those facts exist.

### 5. Emit the paste-ready prompt

Print a short fenced block for the user to copy into the new session — the file carries the detail, so keep this tight:

```text
Continue work on <objective>. Full context is in `.marvin/handoff/<NNN>-<slug>.md` —
read that file first, then resume at its "Next steps". Repo is on branch `<branch>`.
```

Then confirm the written path and a one-line summary of what was captured.

## Guidelines

- **Inspect, don't assume.** Every state claim traces to a command you ran or a file you read.
- **Write for a cold reader.** The next session can't ask you a follow-up — anticipate what it needs.
- **Capture *why*, not just *what*.** Decisions plus rejected options are what prevent the next session from going in circles.
- **Synthesize, don't transcribe.** A tight high-signal brief beats a wall of history; point to artifacts (spec, plan, PR) instead of pasting them.
- **One handoff per work-thread.** Prefer updating the existing handoff over spawning near-duplicates.
