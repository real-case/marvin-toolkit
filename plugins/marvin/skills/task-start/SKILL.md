---
name: task-start
description: Start work on a task through a structured dialogue that produces immutable, testable specs for features and bug fixes. Drives exhaustive context capture — codebase grounding, verified stack, test harness, a file-change allowlist, interface/data/config contract, acceptance criteria bound to their proofs — runs a red-team critic, then a tool-backed Definition-of-Ready gate before dispatch. Use when the user says "start a task", "begin work on", "spec this out", "define the task", "/marvin:task-start", "marvin start a new task", "marvin new task", or before dispatching work to headless taskmaster agents. Output lands under .marvin/task/.
---

# Spec Create

Co-create a spec with the user through structured dialogue. The spec is the contract between
human intent (Phase 1) and AI execution (Phase 2) — it must be specific enough to implement
**headless**, with no access to this dialogue.

## Core principles

- **A spec that can't be tested is a wish.** Every acceptance criterion has an `oracle` proof.
- **Understand before formalizing.** Surface ambiguity early through domain-specific questions, not templates.
- **The spec IS the plan.** "Chosen Approach" + the `spec-contract` block replace a separate implementation plan — they contain enough for an autonomous agent to execute and bound exactly which files it may touch.
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
- **Existing specs** — list specs in `.marvin/task/` (the default home) and any host spec dir (`specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`); read frontmatter. Spec files are named `<NNN>-<slug>.md` (numeric-prefixed so the directory sorts by creation order); identify each by its frontmatter `slug`, not the number. Detect duplication and any sibling spec this task would depend on. The DoR gate now **mechanically forbids** depending on an incomplete sibling (`depends_on` must name `shipped` specs), so you must know what exists and at what status.
- `VISION.md` if present — future direction (informs variant evaluation).
- **Prior lessons** — call the `lessons` tool (`action: "search"`, keywords from the task) to recall lessons captured on past tasks and bug fixes in this repo (`.marvin/memory`). A relevant `bug-pattern` or `gotcha` becomes a constraint, a test to add, or an explicit non-goal — this is how the pipeline stops repeating mistakes (ADR-0021). If the tool is unavailable, skim `.marvin/memory/MEMORY.md` directly.
- **Host conventions** — discover, don't assume: the ADR/RFC directory and style (`docs/adr/`, `docs/decisions/`, `rfcs/`; MADR vs Nygard), `CONTRIBUTING`, the PR template, `.pre-commit-config`. These populate the spec's **host-bindings** block (`spec_location`, `decision_record`, `merge_obligations`, `gates`) so the artifact conforms to the host instead of importing marvin's layout.

### 1.4 Clarifying questions & dimension sweep

Ask **domain-specific** questions grounded in codebase knowledge. Never ask generic questions like "tell me more" or "can you elaborate?"

Good: "Will this be a new API route or an extension of the existing `/api/users` endpoint?"
Good: "The current auth flow uses JWT in httpOnly cookies — should the new endpoint follow that pattern?"
Bad: "Can you provide more details about the requirements?"

**One question at a time.** Get an answer, then proceed.

**First, identify the task archetype(s)** and ask its 2–3 must-pin questions on top of the general sweep below. Archetypes are not exclusive — a task can be several (an API route that also runs a migration):

| Archetype | Must pin down |
|-----------|---------------|
| API / endpoint | auth & authz, request/response contract + error codes, idempotency & rate limits, version/back-compat |
| Data migration | forward + rollback, online vs locking, backfill of existing rows, dual-write/read window |
| CLI | argument/flag contract, exit codes, stdout vs stderr, non-TTY / piped behavior |
| Library / public API | public surface + semver impact, runtime/peer-dep range, tree-shakeability |
| UI | states (loading / empty / error), a11y (keyboard/ARIA), i18n, responsive breakpoints |
| Infra / IaC | blast radius, least-privilege, secret handling, rollout/rollback + drift |
| AI / prompt | model + token budget/cost, eval/regression harness, failure/refusal handling, latency |

Then, before leaving intake, **consciously sweep these dimensions** and ask about any that are relevant and not yet settled (don't interrogate on irrelevant ones — name the ones you're skipping and why):

| Dimension | What to pin down |
|-----------|------------------|
| Interface / contract | new or changed signatures, routes, schemas, error cases |
| Callers / reverse-deps | who invokes or consumes the surface you change — grep for callers **now**, so the contract's `files` are complete before the critic, not after |
| Data & config | migrations, env vars, feature flags, config keys |
| Error handling | expected behavior on bad input / failure paths |
| Concurrency / idempotency | behavior under parallel calls, retries, partial failure; is the operation idempotent? |
| External dependencies | failure / timeout / retry semantics of network or 3rd-party calls; circuit-breaking |
| Security | auth, crypto, PII, input parsing, infra exposure — if touched, suggest a follow-up `/marvin:sec-threat-model` |
| Backward-compat / public surface | does this change a consumed signature, route, schema, prompt name, or CLI? Sets the `breaking` flag; a breaking change may force a major version |
| Non-functional | performance budget, observability, rollout/rollback, a11y/i18n |
| Test environment | does running the new tests need seed/fixture data, a DB/staging, or credentials? (a headless executor has none) |
| Cost / quota | compute, API quota, or token budget this consumes (especially AI features) |
| New-dependency licence | for an EXTENSION: is the dependency's licence compatible with this repo's policy? |
| Merge obligations | docs, CHANGELOG, version bump, committed build artefacts this repo requires (from CLAUDE.md) — each becomes a `files` entry |
| Scope boundaries | what is explicitly out |

### 1.5 Switch to the appropriate flow

Based on task type, continue with either **Feature Flow** (Step 2F) or **Bugfix Flow** (Step 2B).

---

## Feature Flow

### Step 2F: Context Mapping

Analyze the codebase and present findings to the user:

1. **Affected files and modules** — read the actual code, not just filenames. This becomes the contract's `files`, so be precise about which files change and how.
2. **Callers / reverse-deps** — grep for who invokes or consumes each surface you change (`rg`, `git grep`). Every caller that must change is a `files` entry. A forgotten caller is the single largest source of an incomplete allowlist — find them here, before drafting, not in the critic.
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

Produce the full spec using the template below — copy its structure to the chosen spec path and fill every `{…}` placeholder. (The template is inlined here, not a separate file, so it resolves identically through all three doors.)

````md
---
slug: {kebab-case-slug}
type: feature
status: ready
created: {YYYY-MM-DD}
tracker: {#issue | PROJ-123 | URL | none}
supersedes: {prior-slug | none}
stack: {verified stack(s), comma-separated, e.g. typescript, shell | none}
risk: {low | medium | high}
breaking: {true | false}
spike_required: false
test_command: {command that runs the tests, e.g. "npm test" | none}
---

# {Title}

## Goal
{1–2 sentences — what and why. Specific: "add X for Y", never "improve X".}

## Context
- Related patterns: {existing code this builds on — file:line}
- Callers / reverse-deps: {who calls or depends on the surface you change — file:line, or "none"}
- Constraints: {tech-debt, architectural boundaries, performance budgets}
- Sibling specs: {related entries under .marvin/task/ (or the host's spec dir), or "none"}

## Spec Contract
The authoritative, machine-validated contract (the `spec` DoR gate parses and schema-checks this
block). The implementer/executor may touch **only** the files listed in `files`; each criterion is
implemented by exactly its `implemented_by` rows and proven by its `oracle`. A test named in a
`kind: test` oracle MUST also appear as a `files` row — the allowlist forbids an unlisted file.
Use `<…>` for prose to fill; never leave a `{…}` placeholder (it parses as a YAML map and fails the
gate).

```yaml spec-contract
files:
  - id: F1
    path: path/to/existing/file.ts
    action: edit          # new | edit | delete
    intent: what changes and why
    satisfies: [AC1]      # the criteria this file implements, or "—" for infra rows
    anchor: path/to/existing/file.ts:42
  - id: F2
    path: path/to/new/file.ts
    action: new
    intent: why this file exists
    satisfies: [AC2]
  - id: F3
    path: test/path.test.ts
    action: new
    intent: tests for the criteria below
    satisfies: [AC1, AC2]
build_order: [F1, F2, F3]   # optional — deterministic order the executor applies the files
depends_on: []              # sibling spec slugs this depends on; each MUST be status: shipped (or [])
contract:
  kind: function            # function | route | schema | cli | event | none
  signature: |
    exactName(arg: ArgType): ReturnType   // throws WhichError
criteria:
  - id: AC1
    statement: Given <state>, when <action>, then <result>
    implemented_by: [F1, F3]
    oracle:
      kind: test            # test | command | prose-review
      ref: test/path.test.ts::the test name
    failure: what the wrong behaviour looks like
  - id: AC2
    statement: <observable behaviour>
    implemented_by: [F2, F3]
    oracle:
      kind: command
      ref: npm run build
    failure: <how it fails>
  - id: AC3
    statement: <observable behaviour>
    implemented_by: [F1]
    oracle:
      kind: prose-review    # at least one criterion must carry a non-prose-review oracle
    failure: <how it fails>
```

## Host Bindings
Discovered from **this repo**, not assumed (task-start populates these from the host's conventions).
Optional and advisory — the gate uses `spec_location` to resolve `depends_on`; the rest records where
the spec lives and what the host requires to merge. Fill with `<…>`, never `{…}`.

```yaml host-bindings
spec_location: .marvin/task/     # where specs/RFCs live (default .marvin/task/, or the host's own convention)
decision_record:                 # the host's ADR/RFC convention, if any
  style: <madr | nygard | none>
  path: docs/adr/
merge_obligations:               # what THIS host needs to merge (from CONTRIBUTING / CI)
  - <e.g. "ruff + mypy green (.pre-commit-config)">
gates:                           # the host's actual gate commands
  test: <the test command>
```

## Data & Config
{Migrations (direction + rollback), new env vars, feature flags, config keys. "N/A" if none.}

## Chosen Approach
{The selected variant, concrete enough to implement without further human input.}

**Stack compliance:** NATIVE | EXTENSION | EXPERIMENTAL
**Future alignment:** ALIGNED | NEUTRAL | CONFLICTS | N/A

**Stack extensions required:**
- {dependency} — {rationale}   ({omit or "none" if NATIVE})

## Why this over alternatives
- Variant {N} (rejected): {reason grounded in a project constraint, not generic}
- Variant {N} (rejected): {reason}

## Test Plan
- Harness: {test runner + command — matches frontmatter test_command}
- Test locations: {directory/convention where new tests live — grounded in existing neighbors}
- Conventions: {fixture/mocking/setup patterns observed in sibling tests, or "none"}

## Definition of Done
Merge-readiness beyond the acceptance criteria. Host-specific obligations are whatever **this repo**
requires to merge — discovered from its `CONTRIBUTING`, CI config, or `CLAUDE.md`/equivalent — and
must appear as `files` rows in the contract if they touch files.

- [ ] {test_command} green
- [ ] lint / type-check / build green (whichever the host runs)
- [ ] docs / changelog updated if the host expects them (required if `breaking: true`) — or "N/A"
- [ ] host-specific merge obligations (e.g. a version bump, a committed build artefact, a generated file) — or "none"

## Non-goals
- {what is explicitly NOT in scope}

## Assumptions
{Decisions made under uncertainty, recorded so the implementer inherits them rather than
re-deciding. "none" if there are none.}

## Open Questions
{Unresolved questions. MUST be "none" before the DoR gate passes — an open question is a
reason to keep authoring, not to dispatch. A genuine unknown that needs investigation is NOT an
Assumption: set `spike_required: true` and resolve it (e.g. via `/marvin:kanban-spike`) first.}

## Security / NFR
{Does this touch auth, crypto, PII, input parsing, or infra? Note observability,
rollout/rollback, performance, a11y/i18n where relevant. "N/A — {one-line reason}" if none apply.}

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict (PASS | PASS WITH WARNINGS | BLOCK). Record any author
override as "Critic flagged X — override: Y". "none" if the critic step was skipped — and a
skipped critic is surfaced in the PR, never silent.}

## Design Notes
{Nuances, warnings, "write it so it's easy to replace with X later".}

## Future Considerations
- {relationship to planned evolution / VISION.md}
- {edge cases deliberately deferred to separate tasks}
````

Fill **every** section from the dialogue context — write "N/A" / "none" deliberately rather than leaving a section blank or a `{placeholder}` unfilled:
- **Frontmatter** — `slug`, `created` (today, `date +%F`), `tracker`, `supersedes`, verified `stack` (comma-separated if polyglot), `risk`, `breaking` (true|false — public-surface impact), `spike_required` (false unless a genuine unknown remains), discovered `test_command`
- **Goal** — from intake
- **Context** — from context mapping, including callers/reverse-deps and sibling specs
- **Spec Contract** (the ` ```yaml spec-contract ` block) — the machine-validated heart of the spec, parsed and schema-checked by the gate:
  - `files` — the authoritative allowlist: one entry per file with `id` (F1, F2…), `path`, `action` (new/edit/delete), `intent`, `satisfies` (the AC ids it implements, or "—" for infra rows: docs, changelog, version bump), optional `anchor` (file:line). **Every test named in a `kind: test` oracle MUST be a `files` entry** — the allowlist forbids the executor from creating an unlisted file.
  - `criteria` — minimum 3, each with an `id` (AC1…), a `statement`, `implemented_by` (the `files` ids), a typed `oracle` (`kind: test | command | prose-review`, plus a `ref` for the first two) and a `failure` path. **At least one criterion must carry a non-prose-review oracle.**
  - `contract` — the exact callable surface as `kind` (function/route/schema/cli/event) + a literal `signature` the implementer copies; `kind: none` if there is no callable surface.
  - `build_order` (optional) — the order the executor applies the files.
  - `depends_on` (optional) — sibling spec slugs this task depends on; the gate **fails** unless each is `status: shipped`.
- **Host Bindings** (the ` ```yaml host-bindings ` block) — discovered, not assumed: `spec_location` (where this host keeps specs), `decision_record` (its ADR/RFC convention), `merge_obligations` (from CONTRIBUTING/CI), `gates` (the host's commands). Advisory — it conforms the artifact to the host, and `spec_location` resolves `depends_on`.
- **Data & Config** — migrations/env/flags, or "N/A"
- **Chosen Approach** + **Why this over alternatives** (rejected variants with reasons)
- **Test Plan** — harness, test locations, fixture/mocking conventions from neighboring tests
- **Definition of Done** — merge-readiness beyond ACs: gates green plus repo-specific obligations (docs/CHANGELOG/version bump/committed build artefacts) from CLAUDE.md, each a `files` entry if it touches a file
- **Non-goals** — explicit scope boundaries discussed during dialogue
- **Security / NFR** — or "N/A — {reason}"

Present the draft to the user. Iterate until they approve.

### Step 6F: Future Considerations

Suggest notes based on dialogue context (deliberately-excluded scope), VISION.md (relationship to planned evolution), and edge cases discovered during context mapping. The user decides what to include. Record any deferred split-off slices from Step 4.5F here.

### Step 7F: Definition of Ready — mechanical gate (tool first)

Run the deterministic gate **before** the critic. It is free, fast, and catches shape errors the expensive opus critic should not burn a pass on. The critic only ever sees shape-valid specs.

Run the `spec` tool (`mcp__plugin_marvin_marvin__spec`), passing the drafted spec as `specContent` and the project root. It deterministically verifies: required frontmatter keys + valid enums (including `breaking` and `spike_required: false`), all required prose sections present (including **Definition of Done**), and the **`spec-contract` YAML block** — parsed by `yaml` and schema-validated **fail-closed**: every `files` `edit`/`delete` path exists on disk, ≥3 criteria each with a typed `oracle`, the **traceability triple** (every criterion's `implemented_by` names real `files` ids, every `satisfies` points at a real criterion, every `kind: test` oracle's path is an allowlisted `files` entry, ≥1 non-prose-review oracle), a bugfix carries a `regression: true` criterion, Open Questions resolved to "none", and no leftover `{…}` placeholders (which parse as YAML maps and trip the schema).

- **FAIL** — show the failing checks, loop back to the relevant step (usually 2F, 3F, or 5F), fix, re-run. **Do not invoke the critic and do not write the spec.**
- **PASS / PASS WITH WARNINGS** — proceed to the critic; address or consciously accept warnings.
- If the `spec` tool is unavailable, self-check the same list manually and note the degradation in Design Notes.

### Step 8F: Critic Review (semantic)

On a shape-valid spec, invoke the `marvin-tm-spec-critic` agent via Task-tool, passing the drafted spec content. The critic judges what the tool cannot: that the contract's `files` name the *real* integration points, that each `oracle` is *genuine* (not a restatement of the criterion), and that rejected variants are not strawmen.

- **Verdict `BLOCK`** — present blockers, loop back to the relevant step (usually 2F, 3F, or 5F), then **re-run Step 7F** before returning here. Do not write the spec.
- **Verdict `PASS WITH WARNINGS`** — show warnings; the user decides whether to revise or proceed. If proceeding, record the override in **Critic Verdict & Overrides**.
- **Verdict `PASS`** — proceed to finalize.

Record the verdict in the spec's **Critic Verdict & Overrides** section. If Task-tool is unavailable, write "none — critic skipped" there **and** carry that fact forward so `/marvin:task-deliver` surfaces "⚠️ critic skipped" in the PR — a skipped semantic gate is never silent.

### Step 9F: Finalize & write

1. **Judgment items** the gates cannot assess:
   - [ ] Goal is specific (not "improve" but "add X for Y")
   - [ ] Specific approach is chosen with rationale for rejected alternatives
   - [ ] Each acceptance criterion is genuinely provable by its stated `oracle` (not merely non-empty)
   - [ ] Stack-compliance marker reflects the verified manifest
   - [ ] No contradiction with VISION.md (if it exists)
   - [ ] No dependency on an incomplete sibling spec (from 1.3)

   If any item fails, loop back (and re-run Step 7F after editing). Do not write the spec.

2. **Choose the location.** marvin's own home for specs is `.marvin/task/` — use it by default. But if the host repo already keeps specs by a convention of its own — `specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`, or a directory named in the host's `CONTRIBUTING` — prefer that, so the artifact conforms to the host instead of importing marvin's layout. Propose the chosen directory and confirm it with the user. `/marvin:task-implement` and `/marvin:task-deliver` search `.marvin/task/` first, then those host conventions, so either location resolves automatically.

3. **Slug collision.** Derive the slug (lowercase, hyphens, e.g. `add-health-check-endpoint`). Check the chosen dir for an existing file whose slug part matches — i.e. any `{slug}.md` or `<NNN>-{slug}.md`. If one exists, do **not** overwrite: ask the user whether this **supersedes** the existing spec (set `supersedes:` to the old slug and choose a new slug) or is a distinct task (choose a different slug).

4. **Allocate the ordering number.** Spec files are written with a numeric prefix so the directory sorts by creation order: `<NNN>-{slug}.md`. Compute `<NNN>` as the **highest leading-integer prefix already present** in `<chosen-dir>` (across `*.md`) **plus one**, zero-padded to **at least 3 digits** (start at `001` when none exist; match a wider width if the dir already uses one — e.g. host RFC dirs). The number lives **only in the filename** — `slug` stays the spec's identity (do not add it to frontmatter; it is not part of the contract hash).

5. **Write & seal.** Confirm `created` is today, `status: ready`, `tracker`/`supersedes` recorded. Write to `<chosen-dir>/<NNN>-{slug}.md`, then **re-run the `spec` tool on the written file** (pass `specPath`, not the inline draft — it must still PASS), and stamp `contract_sha:` from the result's `contractSha` into the frontmatter. This binds the written artifact to a passing gate and seals the immutable contract: later tampering of the block is caught by re-hashing. Confirm the path to the user.

**Immutability.** After the DoR gate the spec's **content is immutable**. The only mutable parts are lifecycle metadata: `status` (advanced by later phases) and an appended `## Delivery` section (PR link, added at delivery). If content must change, create a **new** spec whose `supersedes:` points to this one. The stamped `contract_sha` makes this enforceable, not merely conventional: `/marvin:task-implement` re-verifies the seal via the `spec` tool (`mode: "seal"`) on read and refuses a spec whose contract was edited after sealing.

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

Dispatch the **`marvin-debugger`** agent (via Task-tool) with the reproduction from Step 2B and the symptom. It runs hypothesis-driven analysis in an isolated, evidence-first context and returns a structured report — **Evidence · Hypotheses · Root Cause (confirmed, at `file:line`) · Fix Approach · Regression Test · Siblings · Lesson** — that maps directly onto this spec's Root Cause Analysis, Fix Approach, and Regression Test Specification sections. (The full methodology lives in the agent; `/marvin:debug` is its other door — there is no third copy here to drift.)

- **Root cause confirmed** → carry its findings into Step 6B; the confirmed mechanism drives the **File Change Plan**.
- **UNCONFIRMED** → the agent returns its best-supported hypothesis and the exact next step. Resolve it first — an unconfirmed root cause is an **Open Question** (or `spike_required: true`), not a spec ready to dispatch.
- The agent captures a `bug-pattern` lesson on reflect, so the next task recalls it at intake (ADR-0021).

If Task-tool is unavailable, run the analysis inline following the `marvin-debugger` methodology: read the execution path and callers, check history (`git log` / `git blame`), rank 2–3 evidence-backed hypotheses, verify the top one, and confirm the mechanism at specific files and lines.

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

Produce the full spec using the template below — copy its structure to the chosen spec path and fill every `{…}` placeholder. (The template is inlined here, not a separate file, so it resolves identically through all three doors.)

````md
---
slug: {kebab-case-slug}
type: bugfix
status: ready
created: {YYYY-MM-DD}
tracker: {#issue | PROJ-123 | URL | none}
supersedes: {prior-slug | none}
stack: {verified stack(s), comma-separated, e.g. typescript, shell | none}
severity: {critical | high | medium | low}
spike_required: false
test_command: {command that runs the tests, e.g. "npm test" | none}
---

# {Short bug description}

## Problem
{What happens — observed behavior.}

## Expected Behavior
{What should happen instead.}

## Reproduction Steps
1. {exact step}
2. {exact step}
3. {observed result}

**Frequency:** always | intermittent | rare

## Root Cause Analysis
- Affected code: {files and lines}
- Cause: {the specific mechanism, supported by evidence — not a guess}
- Callers / blast radius: {who exercises the affected path — file:line, or "none"}
- Impact scope: {what else may be affected}

## Severity & Impact
{Severity from frontmatter, plus blast radius: how many users / flows are affected.}

## Spec Contract
The authoritative, machine-validated contract (the `spec` DoR gate parses and schema-checks this
block). The implementer/executor may touch **only** the files in `files`; a minimal fix touches
few. The regression test MUST be a `files` row, and **one criterion MUST carry `regression: true`**
(it asserts the test fails on pre-fix code and passes after). Use `<…>` for prose to fill; never
leave a `{…}` placeholder (it parses as a YAML map and fails the gate).

```yaml spec-contract
files:
  - id: F1
    path: path/to/file.ts
    action: edit          # new | edit | delete
    intent: the minimal change that fixes the root cause
    satisfies: [AC1]
    anchor: path/to/file.ts:42
  - id: F2
    path: test/path.test.ts
    action: new
    intent: regression test (see Regression Test Specification)
    satisfies: [AC1, AC2]
depends_on: []              # sibling spec slugs this depends on; each MUST be status: shipped (or [])
criteria:
  - id: AC1
    statement: Given the trigger, when run after the fix, then correct behaviour
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: test/path.test.ts::the test name
    failure: reproduces as before
  - id: AC2
    statement: The regression test fails on pre-fix code and passes after the fix
    implemented_by: [F2]
    regression: true        # mandatory for a bugfix — the red→green proof
    oracle:
      kind: test
      ref: test/path.test.ts::the test name
    failure: passes before the fix → the test does not exercise the bug
```

## Host Bindings
Discovered from **this repo**, not assumed. Optional and advisory — the gate uses `spec_location` to
resolve `depends_on`; the rest records where the spec lives and what the host requires to merge. Fill
with `<…>`, never `{…}`.

```yaml host-bindings
spec_location: .marvin/task/     # where specs/RFCs live (default .marvin/task/, or the host's own convention)
decision_record:
  style: <madr | nygard | none>
  path: docs/adr/
merge_obligations:
  - <e.g. "ruff + mypy green (.pre-commit-config)">
gates:
  test: <the test command>
```

## Fix Approach
{The minimal change that addresses the root cause — nothing else. No adjacent refactoring.}

**Why this over alternatives:** (if alternatives existed)
- {alternative}: {reason for rejection}

## Regression Test Specification
**Test type:** unit | integration | e2e
**Test location:** {path to test file — MUST match its `files` row in the contract}
**What test verifies:** {specific behavior}
**Test must fail before fix:** yes (mandatory)

## Definition of Done
- [ ] regression test red before fix, green after
- [ ] {test_command} green
- [ ] lint / type-check / build green (whichever the host runs)
- [ ] host-specific merge obligations (e.g. a version bump, a committed build artefact) — or "none"

## Non-goals
- {what we explicitly do NOT fix in this task}

## Assumptions
{Decisions made under uncertainty. "none" if there are none.}

## Open Questions
{MUST be "none" before the DoR gate passes. A genuine unknown that needs investigation is NOT an
Assumption: set `spike_required: true` and resolve it first.}

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict; any author override. "none" if skipped — a skipped critic is
surfaced in the PR, never silent.}

## Design Notes
{Related bugs, workarounds to remove, potential side effects of the fix.}
````

Fill **every** section (write "N/A"/"none" deliberately), including frontmatter (`slug`, `created`, `tracker`, `supersedes`, verified `stack`, `severity`, discovered `test_command`), the **`spec-contract` block** (the `files` allowlist + `criteria`), and the prose sections. **One criterion MUST carry `regression: true`** — it asserts the regression test fails on pre-fix code and passes after; the test it names in its `oracle` must be a `files` entry.

Present to user. Iterate until approved.

### Step 7B: Definition of Ready — mechanical gate (tool first)

Run the `spec` tool **before** the critic (same rationale as Step 7F). Pass `specContent` = draft plus project root. For bugfix it additionally expects the Root Cause Analysis, Fix Approach, Regression Test Specification, and Definition of Done sections, ≥2 criteria, a criterion marked `regression: true`, plus the traceability triple — the regression test named in its `oracle` must be an allowlisted `files` entry.

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
2. **Location & slug collision** — same handling as 9F (default `.marvin/task/`; honor the host's convention if it has one; collision check is slug-based across `{slug}.md` / `<NNN>-{slug}.md`).
3. **Allocate the ordering number** — same as 9F: `<NNN>` = highest leading-integer prefix in `<chosen-dir>` + 1, zero-padded to ≥3 digits.
4. **Write & seal** — `status: ready`, write to `<chosen-dir>/<NNN>-{slug}.md`, re-run the `spec` tool on the written file (must PASS), stamp `contract_sha` from the result, confirm path.

**Immutability** — same carve-out as the feature flow.

---

## Guidelines

- **One question at a time.** Don't overwhelm with a wall of questions.
- **Ground everything in the codebase.** Read actual code before suggesting patterns or constraints.
- **Verify, don't guess.** Stack compliance and `test_command` come from the manifest and the test config you read — never assumed.
- **The contract's `files` are the allowlist.** The executor may touch only listed files. If it's incomplete, the executor will either guess or stall — both are failures.
- **Flag assumptions explicitly.** Put decisions-under-uncertainty in **Assumptions**; put anything unresolved in **Open Questions** — and Open Questions must be "none" before DoR passes. A genuine unknown that needs *investigation* (not a decision) is neither: set `spike_required: true` and resolve it first (e.g. via `/marvin:kanban-spike`). Do not launder unknowns into Assumptions to slip past the gate — the `spec` tool blocks on `spike_required: true` for exactly this reason.
- **Trace every criterion.** Each criterion names the `files` ids that implement it (`implemented_by`) and a typed `oracle`; each file names the criteria it serves (`satisfies`). A `kind: test` oracle's path must be an allowlisted `files` entry. This closed graph is what lets Phase 2 execute without inferring the mapping.
- **The user decides.** Present trade-offs and let the user choose. Never select a variant unilaterally.
- **Reject untestable criteria.** "It should be intuitive" → what specific behavior, proven by what test?
- **Keep it conversational.** This is a dialogue, not a form. Adapt to the user's communication style.
- **No generic filler.** Every section must contain specific, actionable content or an explicit "N/A"/"none".
