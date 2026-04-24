---
description: Interactive spec co-creation — structured dialogue producing immutable, testable specs for features and bugfixes. Supports VISION.md integration, solution variants with stack/future markers, and Definition of Ready gate. Output lands in specs/ directory.
---

# Spec Create

Co-create a spec with the user through structured dialogue. The spec is the contract between human intent (Phase 1) and AI execution (Phase 2) — it must be specific enough to implement without further human input.

## Core principles

- **A spec that can't be tested is a wish.** Every requirement must have testable acceptance criteria.
- **Understand before formalizing.** Surface ambiguity early through domain-specific questions, not templates.
- **The spec IS the plan.** The "Chosen Approach" section replaces a separate implementation plan — it contains enough detail for an autonomous agent to execute.

## Input

`$ARGUMENTS` — one of:
- Free-form text description of the task
- Tracker reference (`PROJ-123`, `#42`, URL)
- File path to an existing description

If no arguments, ask the user what they want to build or fix.

---

## Step 1: Intake

Determine what the user wants and gather context.

### 1.1 Parse input

- **Text**: use as the raw requirement
- **Tracker reference**: fetch content via `gh issue view` for GitHub issues, or ask user to paste content for other trackers
- **File path**: read the file

### 1.2 Determine task type

Ask the user directly if unclear:
- **Feature** — new functionality, enhancement, or refactoring
- **Bugfix** — something is broken

Refactoring goes through the **feature flow**. There is no separate refactoring flow.

### 1.3 Gather codebase context

Read in parallel:
- `CLAUDE.md` — project conventions, architecture rules
- `README.md` — project overview
- `git log --oneline -10` — recent activity

### 1.4 Ask clarifying questions

Ask **domain-specific** questions grounded in codebase knowledge. Never ask generic questions like "tell me more" or "can you elaborate?"

Good: "Will this be a new API route or an extension of the existing `/api/users` endpoint?"
Good: "The current auth flow uses JWT tokens stored in httpOnly cookies — should the new endpoint follow the same pattern?"
Bad: "Can you provide more details about the requirements?"

One question at a time. Get an answer, then proceed.

### 1.5 Switch to the appropriate flow

Based on task type, continue with either **Feature Flow** (Step 2F) or **Bugfix Flow** (Step 2B).

---

## Feature Flow

### Step 2F: Context Mapping

Analyze the codebase and present findings to the user:

1. **Affected files and modules** — read the actual code, not just filenames
2. **Existing patterns** — how does the codebase currently handle similar functionality?
3. **Reusable components** — hooks, utilities, helpers that can be leveraged
4. **Potential conflicts** — areas where changes might cause side effects
5. **Constraints** — tech debt, architectural boundaries, performance requirements

If `VISION.md` exists in the project root, read it. Note future direction intent — this will inform variant evaluation.

Present the context map to the user. Let them correct if you're off target.

### Step 3F: Solution Variants

Generate **3–5 solution variants**. Each variant must be genuinely different — no strawmen.

**Variant generation rules:**
- Variant 1 — always the most conservative: current stack, proven patterns
- Variant 2 — must explore a fundamentally different architecture or approach
- Variant 3+ — trade-offs along any axis (performance, complexity, flexibility, effort)
- At least one variant must be NATIVE (no new dependencies)
- If all good solutions require extension — explain why and provide a native fallback
- **Anti-strawman check:** each variant must be superior in at least one dimension

**For each variant, present:**

```
### Variant {N}: {name}

{2-3 sentence description of the approach}

**Implementation sketch:**
1. {concrete step}
2. {concrete step}
3. {concrete step}

**Stack compliance:** ✅ NATIVE | ⚠️ EXTENSION | 🔴 EXPERIMENTAL
**Future alignment:** ✅ ALIGNED | ⚠️ NEUTRAL | ⛔ CONFLICTS WITH INTENT

| Dimension     | Rating                |
|---------------|----------------------|
| Effort        | S / M / L / XL       |
| Risk          | low / medium / high  |
| Reversibility | easy / moderate / hard |

**Pros:**
- {advantage}

**Cons:**
- {disadvantage}

**Stack extensions required:** (if any)
- {dependency} — {rationale}
```

**Stack compliance markers:**
| Marker | Meaning |
|--------|---------|
| ✅ NATIVE | Fully solvable with current stack, no new dependencies |
| ⚠️ EXTENSION | Requires a new dependency or pattern, but approach is valid |
| 🔴 EXPERIMENTAL | Non-standard approach, high risk or immature dependency |

**Future alignment markers** (based on VISION.md, if it exists):
| Marker | Meaning |
|--------|---------|
| ✅ ALIGNED | Matches the direction from VISION.md |
| ⚠️ NEUTRAL | Does not affect future plans |
| ⛔ CONFLICTS WITH INTENT | Blocks or complicates future evolution |

If `VISION.md` does not exist, skip future alignment markers entirely.

### Step 4F: Approach Selection

Present the variants and wait for the user's decision. The user may:
- **Select** a variant as-is
- **Combine** elements from multiple variants
- **Reject all** and redirect — go back to Step 3F with new constraints

If two variants are tied on all practical dimensions and VISION.md exists, use future alignment as the tiebreaker. If a future-aligned variant costs significantly more, flag it but do not select it automatically.

Record the selected approach and rationale for rejected alternatives.

### Step 5F: Crystallization

Produce the full spec using the template from **Read `skills/mn.spec-create/feature-spec-template.md`**.

Fill in all sections from the dialogue context:
- **Goal** — from intake
- **Context** — from context mapping
- **Chosen Approach** — from variant selection
- **Why this over alternatives** — rejected variants with reasons
- **Acceptance Criteria** — minimum 3, each specific and testable
- **Non-goals** — explicit scope boundaries discussed during dialogue

Present the draft to the user. Iterate until they approve.

### Step 6F: Future Considerations

Before finalizing, suggest notes for the Future Considerations section based on:
- Dialogue context — what was discussed but deliberately excluded from scope
- VISION.md — how the current task relates to planned evolution
- Discovered edge cases — things that surfaced during context mapping but are out of scope

Present suggestions. The user decides what to include.

### Step 7F: Critic Review

Before running the DoR checklist, invoke the `marvin-tm-spec-critic` agent via Task-tool, passing the drafted spec content.

- **Verdict `BLOCK`** — present blockers to the user, loop back to the relevant step (usually 2F, 3F, or 5F). Do not proceed to DoR.
- **Verdict `PASS WITH WARNINGS`** — show warnings to the user; they decide whether to revise or proceed. If proceeding, record the override in the spec (e.g., a "Critic override" note in Future Considerations).
- **Verdict `PASS`** — proceed to the DoR gate.

If Task-tool is unavailable, skip this step and note it in the spec's audit trail.

### Step 8F: Definition of Ready Gate

Validate the spec against this checklist. **Every item must pass.**

- [ ] Goal is specific (not "improve" but "add X for Y")
- [ ] Task type is specified (feature)
- [ ] Affected files / modules are identified
- [ ] Specific approach is chosen with rationale for rejected alternatives
- [ ] Stack compliance marker is set
- [ ] Stack extensions (if any) are listed with rationale
- [ ] Acceptance criteria — at least 3, each testable
- [ ] Non-goals are explicitly stated
- [ ] Future considerations are filled in
- [ ] No contradictions with VISION.md (if it exists)
- [ ] No dependencies on incomplete tasks

**If any item fails:** tell the user which items failed and loop back to the relevant step. Do not write the spec.

**If all items pass:** derive a slug from the spec title (lowercase, hyphens, e.g., `add-health-check-endpoint`). Write the spec to `specs/{slug}.md`. Confirm the file path to the user.

The spec is **immutable** after passing the DoR gate. If changes are needed later, create a new spec through Phase 1.

---

## Bugfix Flow

### Step 2B: Reproduction

Help the user establish a reliable reproduction path:

1. **What happens vs. what should happen** — get specifics, not "it crashes"
2. **Find the shortest trigger** — a failing test is ideal. If not: curl command, REPL snippet, UI steps
3. **Identify conditions** — environment, data state, timing. Is it always reproducible or intermittent?
4. **Frequency** — always / intermittent / rare

If the bug cannot be reproduced, gather logs and traces. Do not proceed to root cause without evidence.

### Step 3B: Root Cause Analysis

Trace the bug to its source using structured analysis:

1. **Read the execution path** — the function where the error occurs, its callers and callees
2. **Check history** — `git log --oneline -10 -- <file>`, `git blame -L <start>,<end> <file>`
3. **Form hypotheses** with evidence:

```
Hypothesis 1 (most likely): {description}
  Evidence for: {what supports this}
  Evidence against: {what contradicts}
  Verify by: {specific action}
```

4. **Verify the top hypothesis** — re-read code, add targeted logging, or write a minimal test
5. **Confirm root cause** — document the specific files, lines, and mechanism

**Common root-cause categories to consider:**
- Null/undefined where data is expected
- Type mismatch or schema drift
- Race condition / timing issue
- State mutation by unexpected caller
- Environment delta (works locally, fails elsewhere)
- Off-by-one / boundary edge case
- Dependency change or API break

### Step 4B: Severity Assessment

Classify the bug:
| Severity | Criteria |
|----------|----------|
| **Critical** | Data loss, security vulnerability, complete feature unavailable |
| **High** | Core feature broken, no workaround |
| **Medium** | Feature degraded, workaround exists |
| **Low** | Cosmetic, minor UX issue |

Identify blast radius: how many users/flows are affected.

### Step 5B: Fix Approach

Determine the fix:
1. **Minimal fix** — only changes needed to resolve the root cause
2. **Regression test specification** — what input triggers the bug, what the correct output should be, where the test file should live
3. **Sibling patterns** — search the codebase for the same bug pattern elsewhere (`git grep`, `rg`)
4. If the fix is obvious, record it directly. If multiple valid approaches exist, present variants as in the feature flow (Step 3F)

### Step 6B: Crystallization

Produce the full spec using the template from **Read `skills/mn.spec-create/bugfix-spec-template.md`**.

Fill in all sections. The **Regression Test Specification** section is mandatory — it is a required acceptance criterion.

Present to user. Iterate until approved.

### Step 7B: Critic Review

Before running the DoR checklist, invoke the `marvin-tm-spec-critic` agent via Task-tool, passing the drafted bugfix spec content. Apply the same verdict rules as in the feature flow (Step 7F):

- `BLOCK` → loop back (usually 3B root-cause or 5B fix-approach)
- `PASS WITH WARNINGS` → user decides; record override if proceeding
- `PASS` → proceed to DoR

### Step 8B: Definition of Ready Gate

Validate against this checklist. **Every item must pass.**

- [ ] Task type is specified (bugfix)
- [ ] Reproduction steps are described and reproducible
- [ ] Root cause is confirmed with evidence
- [ ] Severity is defined
- [ ] Fix approach is minimal (only changes needed for the fix)
- [ ] Regression test specification is included
- [ ] Regression test must fail on current code and pass after fix
- [ ] Acceptance criteria — at least 1 beyond "bug is fixed"
- [ ] Non-goals are explicitly stated
- [ ] No dependencies on incomplete tasks

**If any item fails:** tell the user and loop back. **If all pass:** write to `specs/{slug}.md`. Spec is immutable.

---

## Guidelines

- **One question at a time.** Don't overwhelm with a wall of questions.
- **Ground everything in the codebase.** Read actual code before suggesting patterns or constraints.
- **Flag assumptions explicitly.** When you make an assumption about a requirement, say so.
- **The user decides.** Present trade-offs and let the user choose. Never select a variant unilaterally.
- **Reject untestable criteria.** "It should be intuitive" → what specific behavior makes it intuitive?
- **Keep it conversational.** This is a dialogue, not a form. Adapt to the user's communication style.
- **No generic filler.** Every section must contain specific, actionable content or be omitted.
