---
name: task-start
description: Start work on a task through a structured dialogue that produces immutable, testable specs for features and bug fixes. Drives exhaustive context capture — codebase grounding, verified stack, test harness, a file-change allowlist, interface/data/config contract, acceptance criteria bound to their proofs — runs a red-team critic, then a tool-backed Definition-of-Ready gate before dispatch. Use when the user says "start a task", "begin work on", "spec this out", "define the task", "/marvin:task-start", or before dispatching work to headless taskmaster agents. Output lands under specs/.
---

# Spec Create

Co-create a spec with the user through structured dialogue. The spec is the contract between
human intent (Phase 1) and AI execution (Phase 2) — it must be specific enough to implement
**headless**, with no access to this dialogue.

## Core principles

- **A spec that can't be tested is a wish.** Every acceptance criterion has a `verified_by` proof.
- **Understand before formalizing.** Surface ambiguity early through domain-specific questions, not templates.
- **The spec IS the plan.** "Chosen Approach" + "File Change Plan" replace a separate implementation plan — they contain enough for an autonomous agent to execute and bound exactly which files it may touch.
- **The spec is a validated contract, not prose.** Before dispatch it passes a mechanical gate (the `spec` tool), not just a self-read checklist.

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
- **Tracker reference**: fetch content via `gh issue view` for GitHub issues, or ask the user to paste content for other trackers. **Record the reference** — it becomes the spec's `tracker` field.
- **File path**: read the file

### 1.2 Determine task type

Ask the user directly if unclear:
- **Feature** — new functionality, enhancement, or refactoring
- **Bugfix** — something is broken

Refactoring goes through the **feature flow**. There is no separate refactoring flow.

### 1.3 Gather codebase context

Read in parallel — go beyond the obvious files, because the spec must be engineering-complete:
- `CLAUDE.md` — project conventions, architecture rules
- `README.md` — project overview
- `git log --oneline -10` — recent activity
- **Dependency manifest** — whatever the host actually uses: `package.json`, `pyproject.toml` / `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml` / `build.gradle`, `composer.json`, `Gemfile`, `*.csproj`, `mix.exs`, `pubspec.yaml`, … and a root `Makefile`. Detect by what is present — do not assume one of a fixed five. You will **verify** the stack-compliance marker against this, not guess it.
- **CI config** — `.github/workflows/*`, `.gitlab-ci.yml`, etc. — to learn which gates actually run, so acceptance criteria align with enforcement.
- **`specs/`** — list existing specs (`ls specs/` + read frontmatter). Detect duplication and any sibling spec this task would depend on. The DoR gate forbids depending on an incomplete sibling, so you must know what exists.
- `VISION.md` if present — future direction (informs variant evaluation).

### 1.4 Clarifying questions & dimension sweep

Ask **domain-specific** questions grounded in codebase knowledge. Never ask generic questions like "tell me more" or "can you elaborate?"

Good: "Will this be a new API route or an extension of the existing `/api/users` endpoint?"
Good: "The current auth flow uses JWT in httpOnly cookies — should the new endpoint follow that pattern?"
Bad: "Can you provide more details about the requirements?"

**One question at a time.** Get an answer, then proceed.

Before leaving intake, **consciously sweep these dimensions** and ask about any that are relevant and not yet settled (don't interrogate on irrelevant ones — name the ones you're skipping and why):

| Dimension | What to pin down |
|-----------|------------------|
| Interface / contract | new or changed signatures, routes, schemas, error cases |
| Callers / reverse-deps | who invokes or consumes the surface you change — grep for callers **now**, so the File Change Plan is complete before the critic, not after |
| Data & config | migrations, env vars, feature flags, config keys |
| Error handling | expected behavior on bad input / failure paths |
| Security | auth, crypto, PII, input parsing, infra exposure — if touched, suggest a follow-up `/marvin:sec-threat-model` |
| Backward-compat / public surface | does this change a consumed signature, route, schema, prompt name, or CLI? Sets the `breaking` flag; a breaking change may force a major version |
| Non-functional | performance budget, observability, rollout/rollback, a11y/i18n |
| Merge obligations | docs, CHANGELOG, version bump, committed build artefacts this repo requires (from CLAUDE.md) — each becomes a File Change Plan row |
| Scope boundaries | what is explicitly out |

### 1.5 Switch to the appropriate flow

Based on task type, continue with either **Feature Flow** (Step 2F) or **Bugfix Flow** (Step 2B).

---

## Feature Flow

### Step 2F: Context Mapping

Analyze the codebase and present findings to the user:

1. **Affected files and modules** — read the actual code, not just filenames. This becomes the **File Change Plan**, so be precise about which files change and how.
2. **Callers / reverse-deps** — grep for who invokes or consumes each surface you change (`rg`, `git grep`). Every caller that must change is a File Change Plan row. A forgotten caller is the single largest source of an incomplete allowlist — find them here, before drafting, not in the critic.
3. **Recent churn** — `git log --oneline -5 -- <file>` for each affected file. Hotspots are risk signals; note them in Design Notes.
4. **Existing patterns** — how does the codebase currently handle similar functionality?
5. **Reusable components** — hooks, utilities, helpers that can be leveraged
6. **Potential conflicts** — areas where changes might cause side effects
7. **Constraints** — tech debt, architectural boundaries, performance requirements

**Verify the stack.** From the dependency manifest read in 1.3, confirm whether the work is solvable with the current stack (→ `NATIVE`), needs a new dependency (→ `EXTENSION`, list it), or is non-standard (→ `EXPERIMENTAL`). The marker must reflect the manifest, not an assumption.

**Discover the test harness.** Determine how this project runs tests (the command) and where tests live (the directory/naming convention). Then **read one or two neighboring tests** for the affected area to capture fixture/mocking/setup conventions — these become the spec's `test_command`, Test Plan, and the convention the executor follows. Knowing the command is not knowing the patterns. **Prefer the command the project declares** — a CI job, a `Makefile` target, a manifest script — over a guessed ecosystem default; for a stack you don't recognise, **ask the user** for the test command rather than guessing, since a wrong `test_command` poisons every downstream gate. If you cannot determine them, that is an Open Question — resolve it before DoR.

If `VISION.md` exists, note future-direction intent — it informs variant evaluation.

Present the context map to the user. Let them correct if you're off target.

### Step 3F: Solution Variants

Generate **3 solution variants by default** — expand to 5 only for high-uncertainty or
high-blast-radius tasks (wide solution space, hard-to-reverse decisions, security/data
surfaces). Each variant must be genuinely different — no strawmen.

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

Record the selected approach and the carried-forward `risk` rating for the spec frontmatter.

### Step 4.5F: Scope & Size Gate

Before crystallizing, sanity-check that this is **one pull request**.

- If the chosen approach implies a sprawling File Change Plan (many unrelated modules, multiple independent surfaces, or "and then also…" work), **split it.** Spec the first coherent slice now; record the remaining slices as sibling specs to author next (note them under Future Considerations).
- A spec the executor cannot implement without making scope decisions is too big — the executor is forbidden from making those decisions.

### Step 5F: Crystallization

Produce the full spec using the template from **Read `skills/task-start/feature-spec-template.md`**.

Fill **every** section from the dialogue context — write "N/A" / "none" deliberately rather than leaving a section blank or a `{placeholder}` unfilled:
- **Frontmatter** — `slug`, `created` (today, `date +%F`), `tracker`, `supersedes`, verified `stack` (comma-separated if polyglot), `risk`, `breaking` (true|false — public-surface impact), `spike_required` (false unless a genuine unknown remains), discovered `test_command`
- **Goal** — from intake
- **Context** — from context mapping, including callers/reverse-deps and sibling specs
- **File Change Plan** — the authoritative allowlist: one row per file with an `ID` (F1, F2…), `Action` (new/edit/delete), `Intent`, `Satisfies` (the AC IDs it implements, or "—" for infra rows: docs, changelog, version bump), and an `Anchor` (file:line) where it helps. **Every test named in an acceptance criterion MUST be a row here** — the allowlist forbids the executor from creating an unlisted file.
- **Interface / Contract** — the exact surface as a **literal code block** (signatures/routes/schemas/errors) the implementer copies, not prose — or "N/A" if no callable surface
- **Data & Config** — migrations/env/flags, or "N/A"
- **Chosen Approach** + **Why this over alternatives** (rejected variants with reasons)
- **Acceptance Criteria** — minimum 3, each with an `ID`, the **Implemented by** File-Change-Plan IDs, a real `verified_by` (test path, command, or "prose-review") and a failure path. **At least one criterion must carry a non-prose-review proof.**
- **Test Plan** — harness, test locations, fixture/mocking conventions from neighboring tests
- **Definition of Done** — merge-readiness beyond ACs: gates green plus repo-specific obligations (docs/CHANGELOG/version bump/committed build artefacts) from CLAUDE.md, each a File Change Plan row if it touches a file
- **Non-goals** — explicit scope boundaries discussed during dialogue
- **Security / NFR** — or "N/A — {reason}"

Present the draft to the user. Iterate until they approve.

### Step 6F: Future Considerations

Suggest notes based on dialogue context (deliberately-excluded scope), VISION.md (relationship to planned evolution), and edge cases discovered during context mapping. The user decides what to include. Record any deferred split-off slices from Step 4.5F here.

### Step 7F: Definition of Ready — mechanical gate (tool first)

Run the deterministic gate **before** the critic. It is free, fast, and catches shape errors the expensive sonnet critic should not burn a pass on. The critic only ever sees shape-valid specs.

Run the `spec` tool (`mcp__plugin_marvin_marvin__spec`), passing the drafted spec as `specContent` and the project root. It deterministically verifies: required frontmatter keys + valid enums (including `breaking` and `spike_required: false`), all required sections present (including **Definition of Done**), the File Change Plan parses and its `edit`/`delete` paths exist on disk, ≥3 acceptance criteria each with a non-empty `verified_by`, the **traceability triple** (every criterion's *Implemented by* names real plan IDs, every File-Change-Plan *Satisfies* points at a real criterion, every `verified_by` test is an allowlisted path, and ≥1 criterion carries a real proof), Open Questions resolved to "none", and no leftover `{…}` placeholders.

- **FAIL** — show the failing checks, loop back to the relevant step (usually 2F, 3F, or 5F), fix, re-run. **Do not invoke the critic and do not write the spec.**
- **PASS / PASS WITH WARNINGS** — proceed to the critic; address or consciously accept warnings.
- If the `spec` tool is unavailable, self-check the same list manually and note the degradation in Design Notes.

### Step 8F: Critic Review (semantic)

On a shape-valid spec, invoke the `marvin-tm-spec-critic` agent via Task-tool, passing the drafted spec content. The critic judges what the tool cannot: that the File Change Plan names the *real* integration points, that each `verified_by` is *genuine* (not a restatement of the criterion), and that rejected variants are not strawmen.

- **Verdict `BLOCK`** — present blockers, loop back to the relevant step (usually 2F, 3F, or 5F), then **re-run Step 7F** before returning here. Do not write the spec.
- **Verdict `PASS WITH WARNINGS`** — show warnings; the user decides whether to revise or proceed. If proceeding, record the override in **Critic Verdict & Overrides**.
- **Verdict `PASS`** — proceed to finalize.

Record the verdict in the spec's **Critic Verdict & Overrides** section. If Task-tool is unavailable, write "none — critic skipped" there **and** carry that fact forward so `/marvin:task-deliver` surfaces "⚠️ critic skipped" in the PR — a skipped semantic gate is never silent.

### Step 9F: Finalize & write

1. **Judgment items** the gates cannot assess:
   - [ ] Goal is specific (not "improve" but "add X for Y")
   - [ ] Specific approach is chosen with rationale for rejected alternatives
   - [ ] Each acceptance criterion is genuinely provable by its stated `verified_by` (not merely non-empty)
   - [ ] Stack-compliance marker reflects the verified manifest
   - [ ] No contradiction with VISION.md (if it exists)
   - [ ] No dependency on an incomplete sibling spec (from 1.3)

   If any item fails, loop back (and re-run Step 7F after editing). Do not write the spec.

2. **Choose the location.** The spec lands in the user's tree, so it follows the **host's** layout, not marvin's. Detect an existing convention — `specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`, or a directory named in the host's `CONTRIBUTING` — and propose it; fall back to `specs/` only when none exists. Confirm the directory with the user. If a non-`specs/` location is chosen, note that `/marvin:task-implement` and `/marvin:task-deliver` currently resolve `specs/` by default, so the explicit path must be passed until those commands are made location-aware.

3. **Slug collision.** Derive the slug (lowercase, hyphens, e.g. `add-health-check-endpoint`). If `<chosen-dir>/{slug}.md` already exists, do **not** overwrite: ask the user whether this **supersedes** the existing spec (set `supersedes:` to the old slug and choose a new slug) or is a distinct task (choose a different slug).

4. **Write.** Confirm `created` is today, `status: ready`, `tracker`/`supersedes` recorded. Write to `<chosen-dir>/{slug}.md`. Confirm the path to the user.

**Immutability.** After the DoR gate the spec's **content is immutable**. The only mutable parts are lifecycle metadata: `status` (advanced by later phases) and an appended `## Delivery` section (PR link, added at delivery). If content must change, create a **new** spec whose `supersedes:` points to this one.

---

## Bugfix Flow

### Step 2B: Reproduction

Help the user establish a reliable reproduction path:

1. **What happens vs. what should happen** — get specifics, not "it crashes"
2. **Find the shortest trigger** — a failing test is ideal. If not: curl command, REPL snippet, UI steps
3. **Identify conditions** — environment, data state, timing. Always reproducible or intermittent?
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
5. **Confirm root cause** — document the specific files, lines, and mechanism. This drives the **File Change Plan**.

**Common root-cause categories to consider:**
- Null/undefined where data is expected
- Type mismatch or schema drift
- Race condition / timing issue
- State mutation by unexpected caller
- Environment delta (works locally, fails elsewhere)
- Off-by-one / boundary edge case
- Dependency change or API break

Also discover the **test harness** (command + location) as in Step 2F — the regression test depends on it.

### Step 4B: Severity Assessment

Classify the bug (this becomes the `severity` frontmatter field):
| Severity | Criteria |
|----------|----------|
| **Critical** | Data loss, security vulnerability, complete feature unavailable |
| **High** | Core feature broken, no workaround |
| **Medium** | Feature degraded, workaround exists |
| **Low** | Cosmetic, minor UX issue |

Identify blast radius: how many users/flows are affected. If the bug already corrupted data, note whether cleanup/backfill is in scope or an explicit non-goal.

### Step 5B: Fix Approach

Determine the fix:
1. **Minimal fix** — only changes needed to resolve the root cause. This is the File Change Plan; a long list signals the fix is not minimal.
2. **Regression test specification** — what input triggers the bug, what the correct output is, where the test lives.
3. **Sibling patterns** — search for the same bug pattern elsewhere (`git grep`, `rg`).
4. If the fix is obvious, record it directly. If multiple valid approaches exist, present variants as in the feature flow (Step 3F).

### Step 6B: Crystallization

Produce the full spec using the template from **Read `skills/task-start/bugfix-spec-template.md`**.

Fill **every** section (write "N/A"/"none" deliberately), including frontmatter (`slug`, `created`, `tracker`, `supersedes`, verified `stack`, `severity`, discovered `test_command`), the **File Change Plan**, and acceptance criteria with real `verified_by`. The **Regression Test Specification** is mandatory — it is a required acceptance criterion, and AC-2 must assert the test fails on pre-fix code and passes after.

Present to user. Iterate until approved.

### Step 7B: Definition of Ready — mechanical gate (tool first)

Run the `spec` tool **before** the critic (same rationale as Step 7F). Pass `specContent` = draft plus project root. For bugfix it additionally expects the Root Cause Analysis, Fix Approach, Regression Test Specification, and Definition of Done sections, and ≥2 acceptance criteria each with a `verified_by`, plus the traceability triple — the regression test named in `verified_by` must be an allowlisted File Change Plan row.

- **FAIL** → show failing checks, loop back (usually 3B or 5B), fix, re-run. **Do not invoke the critic and do not write.**
- **PASS / PASS WITH WARNINGS** → proceed to the critic.
- Tool unavailable → self-check manually, note in Design Notes.

### Step 8B: Critic Review (semantic)

On a shape-valid spec, invoke `marvin-tm-spec-critic` via Task-tool with the drafted bugfix spec. Apply the same verdict rules as Step 8F and record the verdict in **Critic Verdict & Overrides**:

- `BLOCK` → loop back (usually 3B root-cause or 5B fix-approach), then **re-run Step 7B** before returning.
- `PASS WITH WARNINGS` → user decides; record override if proceeding.
- `PASS` → proceed to finalize.

If Task-tool is unavailable, write "none — critic skipped" and carry it forward so `/marvin:task-deliver` surfaces it in the PR.

### Step 9B: Finalize & write

1. **Judgment items:**
   - [ ] Root cause is confirmed with evidence (not a guess)
   - [ ] Fix approach is minimal (only the root-cause change)
   - [ ] The regression test will fail on current code and pass after the fix
   - [ ] At least one acceptance criterion beyond "bug is fixed"
   - [ ] No dependency on an incomplete sibling spec

   If any item fails, loop back (and re-run Step 7B after editing). Do not write.
2. **Location & slug collision** — same handling as 9F (discover the host's convention; default `specs/`).
3. **Write** — `status: ready`, write to `<chosen-dir>/{slug}.md`, confirm path.

**Immutability** — same carve-out as the feature flow.

---

## Guidelines

- **One question at a time.** Don't overwhelm with a wall of questions.
- **Ground everything in the codebase.** Read actual code before suggesting patterns or constraints.
- **Verify, don't guess.** Stack compliance and `test_command` come from the manifest and the test config you read — never assumed.
- **The File Change Plan is the allowlist.** The executor may touch only listed files. If it's incomplete, the executor will either guess or stall — both are failures.
- **Flag assumptions explicitly.** Put decisions-under-uncertainty in **Assumptions**; put anything unresolved in **Open Questions** — and Open Questions must be "none" before DoR passes. A genuine unknown that needs *investigation* (not a decision) is neither: set `spike_required: true` and resolve it first (e.g. via `/marvin:kanban-spike`). Do not launder unknowns into Assumptions to slip past the gate — the `spec` tool blocks on `spike_required: true` for exactly this reason.
- **Trace every criterion.** Each acceptance criterion names the File-Change-Plan rows that implement it (*Implemented by*) and a proof (`verified_by`); each plan row names the criteria it serves (*Satisfies*). A test in `verified_by` must be an allowlisted plan row. This closed graph is what lets Phase 2 execute without inferring the mapping.
- **The user decides.** Present trade-offs and let the user choose. Never select a variant unilaterally.
- **Reject untestable criteria.** "It should be intuitive" → what specific behavior, proven by what test?
- **Keep it conversational.** This is a dialogue, not a form. Adapt to the user's communication style.
- **No generic filler.** Every section must contain specific, actionable content or an explicit "N/A"/"none".
