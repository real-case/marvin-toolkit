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

## Step 0: Routing

Before intake, decide whether this request belongs here at all. Gather evidence from exactly four
cheap sources — no more:

1. **The request text** — `$ARGUMENTS`, or the user's answer if it was empty.
2. `git status --short` — is the change already written?
3. `git log --oneline -3` — what just happened on this branch?
4. **The spec directories listed in step 1.3** — read the frontmatter `slug` and `status` of
   anything that looks like this request. That list is not restated here; it lives in 1.3.

Then leave on exactly one of four paths.

**Hard rule: the router may not refuse work.** Every request exits on a path — "unclear" is not an
exit, and neither is a question back to the user about which command to use. When the evidence is
thin, default to **Path C** and keep authoring; intake will surface what the router could not see.

The one-PR test, its anti-heuristics, the worked examples and the board-card mechanics live in
`skills/task-start/references/routing.md` — read it on Path D, not before. Read it from the plugin:
the `skills/…` path resolves through all three entry points — chat and `/<command>` natively,
`/marvin:<command>` via the server's plugin-root preamble (ADR-0008).

### Path A: a spec already exists and can still be executed

Hand over and stop: `/marvin:task-implement <slug>`. Pass the **slug**, never a path —
`/marvin:task-implement` resolves a spec by slug or by branch itself.

Condition the hand-over on the found spec's frontmatter `status`, which is exactly what the target
accepts:

| `status` | Router action |
|----------|---------------|
| `ready`, `in-progress` | Hand over. Stop. |
| `draft` | **Resume it, do not re-author it.** Read the draft, then call the `spec` tool with `action: "resume"` and its `specPath`. Show the recorded state — the last step reached, any decisions recorded — and continue intake from there. A draft holds answers the user has already given: falling through to Path C would ask for them again and then write over them. |
| `shipped`, `superseded` | Fall through to **Path C** or **Path D** — that spec is history; the request in hand is new work. |

### Path B: no spec is warranted

Route out and stop, naming the command:

- `/marvin:commit` — the change is already written and needs committing.
- `/marvin:track-new` — a card, not a contract: an idea, a spike, a chore.
- `/marvin:debug` — a symptom with no confirmed cause and no agreed fix.
- `/marvin:refactor-audit`, `/marvin:refactor-smells`, `/marvin:refactor-plan` — a code-health read,
  or an ordered plan of behaviour-preserving steps.

Path B is **one-way**: it routes out only work that needs **no spec**. Work that arrives *from*
`/marvin:refactor-plan` came here because that command judged it **spec-sized** — it is spec-sized by
definition, so it takes Path C or D and is never handed back.

### Path C: one coherent spec

State the scope in one sentence, get a one-line confirmation from the user, then continue to Step 1.
This is also the default whenever the evidence is thin.

### Path D: several deliverables

Apply the one-PR test from `skills/task-start/references/routing.md`. Present the proposed slices as
a numbered list and get explicit confirmation of the split before proceeding. Then spec the **first**
slice here, create a board card for each remaining slice (mechanics in the same reference), and list
them under `## Deferred slices` in the spec you are about to write.

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
- **Existing specs** — call the `spec` MCP tool with `action: "list"`. It answers with the resolved spec directory and every spec in it — slug, title, status, and whether it is sealed — so you do not scan directories by hand or guess which one this project uses. Identify each spec by its `slug`, never by its number. Detect duplication and any sibling spec this task would depend on. The DoR gate **mechanically forbids** depending on an incomplete sibling (`depends_on` must name `shipped` specs), so you must know what exists and at what status. If the tool is unavailable, list `.marvin/task/` (the default home) and any host spec dir, and say that the enumeration was done by hand.
- `VISION.md` if present — future direction (informs variant evaluation).
- **Prior lessons** — call the `lessons` tool (`action: "search"`, keywords from the task) to recall lessons captured on past tasks and bug fixes in this repo (`.marvin/memory`). A relevant `bug-pattern` or `gotcha` becomes a constraint, a test to add, or an explicit non-goal — this is how the pipeline stops repeating mistakes (ADR-0021). If the tool is unavailable, skim `.marvin/memory/MEMORY.md` directly.
- **Host conventions** — discover, don't assume: the ADR/RFC directory and style (`docs/adr/`, `docs/decisions/`, `rfcs/`; MADR vs Nygard), `CONTRIBUTING`, the PR template, `.pre-commit-config`. These populate the spec's **host-bindings** block (`spec_location`, `decision_record`, `merge_obligations`, `gates`) so the artifact conforms to the host instead of importing marvin's layout.

### 1.4 Clarifying questions & dimension sweep

Ask **domain-specific** questions grounded in codebase knowledge. Never ask generic questions like "tell me more" or "can you elaborate?"

Good: "Will this be a new API route or an extension of the existing `/api/users` endpoint?"
Good: "The current auth flow uses JWT in httpOnly cookies — should the new endpoint follow that pattern?"
Bad: "Can you provide more details about the requirements?"

**The intake has a budget: six questions for a feature, four for a bugfix.** A question counts
whether it is asked alone or inside a batch; a follow-up that only clarifies an answer already given
does not. The budget bounds what you may ask the **user** — it bounds nothing about what the spec
must contain, and it is never a licence to dispatch on less.

**Spend it in priority order:** scope and boundaries first, then security and data, then interface
and contract, then everything else. A budget exhausted early is then exhausted on the dimensions
that most often invalidate a spec, not on whatever surfaced first.

**Batch up to three questions per turn** — numbered, and only when they are genuinely
**independent**, each answerable in short form (a number, a word, or "default"). A question whose
wording depends on a previous answer stays sequential.

**At the cap, nothing is dropped.** Remaining uncertainty that is a *decision* becomes a recorded
assumption; remaining uncertainty that needs *investigation* sets `spike_required: true`. The budget
is not a route past the Open Questions rule in the Guidelines — an unresolved question is still a
reason to keep authoring.

**First, identify the task archetype(s)** and ask its 2–3 must-pin questions **out of the budget, not on top of it**: they are the highest-priority scope questions, so they are asked first and what remains of the budget covers the general sweep below. Archetypes are not exclusive — a task can be several (an API route that also runs a migration) — and a second archetype buys no second allowance: pin only what it genuinely leaves open.

| Archetype | Must pin down |
|-----------|---------------|
| API / endpoint | auth & authz, request/response contract + error codes, idempotency & rate limits, version/back-compat |
| Data migration | forward + rollback, online vs locking, backfill of existing rows, dual-write/read window |
| CLI | argument/flag contract, exit codes, stdout vs stderr, non-TTY / piped behavior |
| Library / public API | public surface + semver impact, runtime/peer-dep range, tree-shakeability |
| UI | states (loading / empty / error), a11y (keyboard/ARIA), i18n, responsive breakpoints |
| Infra / IaC | blast radius, least-privilege, secret handling, rollout/rollback + drift |
| AI / prompt | model + token budget/cost, eval/regression harness, failure/refusal handling, latency |

**Never spend a question on what the repository already answers.** Read the default instead. The
table names the artefact **class**, because every host keeps it somewhere else; the assumption you
record names the **concrete file you actually read** in that class:

| Do not ask about | Default |
|------------------|---------|
| the test runner and the command that runs it | assumes the pattern in the manifest / CI config read in 1.3 |
| lint and format conventions | assumes the pattern in the lint / format config |
| where tests live and their fixture style | assumes the pattern in the neighbouring tests you read |
| commit, branch and pull-request conventions | assumes the pattern in `CLAUDE.md` / `CONTRIBUTING` |
| decision-record style and location | assumes the pattern in the existing ADR / RFC directory |
| version bumps and committed build artefacts | assumes the pattern in `CLAUDE.md` |

**Every default you accept this way is recorded in `## Assumptions`** as "assumed X because Y;
correct now if wrong", where Y is the file you actually read (`package.json`,
`.github/workflows/validate-plugins.yml`, `docs/adr/`), never the class the table names. That is
what makes a bounded intake safe: the question you did not ask becomes a visible, correctable
statement in the artifact instead of a silent guess. The DoR gate reports an
Assumptions section reduced to "none" as an advisory warning for exactly this reason.

Then, before leaving intake, **consciously sweep these dimensions**. A `read` row is answered by
reading the repository and never by asking — it draws nothing against the budget. An `ask` row is a
question: ask the ones that are relevant and not yet settled, and name the ones you're skipping and
why rather than interrogating on irrelevant ones.

| Dimension | Source | What to pin down |
|-----------|--------|------------------|
| Interface / contract | ask | new or changed signatures, routes, schemas, error cases |
| Callers / reverse-deps | read | who invokes or consumes the surface you change — grep for callers **now** (`rg`, `git grep`), so the contract's `files` are complete before the critic, not after |
| Data & config | ask | migrations, env vars, feature flags, config keys |
| Error handling | ask | expected behavior on bad input / failure paths |
| Concurrency / idempotency | ask | behavior under parallel calls, retries, partial failure; is the operation idempotent? |
| External dependencies | ask | failure / timeout / retry semantics of network or 3rd-party calls; circuit-breaking |
| Security | ask | auth, crypto, PII, input parsing, infra exposure — if touched, suggest a follow-up `/marvin:sec-threat-model` |
| Backward-compat / public surface | ask | does this change a consumed signature, route, schema, prompt name, or CLI? Sets the `breaking` flag; a breaking change may force a major version |
| Non-functional | ask | performance budget, observability, rollout/rollback, a11y/i18n |
| Test environment | read | does running the new tests need seed/fixture data, a DB/staging, or credentials? Read it from the CI configuration (a headless executor has none) |
| Cost / quota | ask | compute, API quota, or token budget this consumes (especially AI features) |
| New-dependency licence | ask | for an EXTENSION: is the dependency's licence compatible with this repo's policy? |
| Merge obligations | read | docs, CHANGELOG, version bump, committed build artefacts this repo requires — read them from `CLAUDE.md` or its equivalent; each becomes a `files` entry |
| Scope boundaries | ask | what is explicitly out |

### 1.5 Allocate and open the draft

**Do this before switching flows.** Everything from here on is written into a file that already
exists, so an intake interrupted at step 4 keeps the answers given at step 1.

1. **Allocate.** Call the `spec` MCP tool with `action: "next"` and the derived slug (lowercase,
   hyphens, e.g. `add-health-check-endpoint`). It answers with the resolved spec directory and how it
   was resolved (`config` / `detected` / `default`), the next ordering number already zero-padded to
   this directory's own width, the composed `<NNN>-{slug}.md` filename, and any existing spec whose
   slug collides. Do **not** compute the number, the padding, or the collision yourself — the tool
   owns all three (ADR-0037). The number lives **only in the filename**; `slug` stays the spec's
   identity (do not add the number to frontmatter — it is not part of the contract hash).
2. **Confirm the two judgements the tool cannot make.** The **directory**: propose the resolved one
   and confirm it; if the user wants a different one, record it as `spec.dir` in `.marvin/config.json`
   (via `/marvin:track-config`) or the next session resolves the old answer again, then re-run
   `action: "next"` so the number comes from the directory actually chosen. A **collision**: do not
   overwrite — ask whether this **supersedes** the existing spec (set `supersedes:` to the old slug
   and choose a new slug) or is a distinct task (choose a different slug).
3. **Open the draft.** Copy the **whole template** for the task type — `feature-spec-template.md` or
   `bugfix-spec-template.md` under `skills/task-start/references/` — to `<dir>/<NNN>-{slug}.md`, and
   fill only the three facts known now: `slug`, `type`, and `created` (today, `date +%F`). Copy it
   **whole**, not summarised: steps 5F/6B fill the sections in place, and a section that does not
   exist yet cannot be filled.
4. **Record it.** Call the `spec` tool with `action: "progress"`, `kind: "step"`,
   `source: "task-start"`, `step: "1.5"`, and the `draftPath`. That first entry is what a resumed
   session finds.

**No DoR-family action may run against the 1.5 skeleton.** The rule is pinned on the UNFILLED state,
not on the `draft` status: the filled draft still carries `status: draft` right up to step 9, and
that is exactly the file steps 7F/7B are supposed to gate. Three mechanical reasons the skeleton is
ungateable:

- `action: "dor"` FAILs on the template's own residue and on its example `files` paths.
- `action: "scope"` diffs the working tree against the template's example allowlist.
- `action: "seal"` is the dangerous one. The skeleton carries the template's `spec-contract` block,
  so the seal takes its no-`contract_sha` branch and answers **PASS WITH WARNINGS** — a reassuring
  verdict about a file in which nothing has been authored. Being the only DoR-family answer that is
  not an obvious failure, it is the one that gets believed.

So: **the first legitimate DoR-family call is step 7F/7B on the filled draft.** `status: draft` does
not fail it — the gate only tests that the status is in its vocabulary, and `draft` is in it.

Then, based on task type, continue with either **Feature Flow** (Step 2F) or **Bugfix Flow**
(Step 2B).

**Two different writes, and they do not overlap.** Resolved answers go into the **draft's prose
sections** as they resolve — that is the content. The **journal** records only pipeline position:
which step completed, which approach was chosen. Keep `detail` to one line of position and choice,
and never paste a credential, a token or customer data into it — in a host layout that keeps specs
in a tracked directory, the journal is tracked with them.

---

## Feature Flow

**Record each step as it completes.** After finishing steps 2F through 8F, call the `spec` tool with
`action: "progress"`, `kind: "step"`, `source: "task-start"`, the step id, and a one-line `detail`.
Add a `kind: "decision"` entry for the approach chosen at 4F and for the split confirmed at 4.5F.
The answers themselves go into the draft's prose sections as they resolve — the journal records
**position, not content** — and `detail` stays one line of position and choice, never a pasted
credential, token or customer datum.

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

Before crystallizing, apply the one-PR test from `skills/task-start/references/routing.md` to the
chosen approach.

- If it fails, **stop and present the slices** as a numbered list, then let the user pick one of
  exactly two options. Proceed on neither without an answer:
  1. **Slice now** — spec the first slice here, create a board card for each remaining slice
     (mechanics in the same reference), and list them under `## Deferred slices` in this spec.
  2. **Keep the scope** — record the user's one-line rationale in `## Design Notes` and continue.
- A spec the executor cannot implement without making scope decisions is too big — the executor is forbidden from making those decisions.

### Step 5F: Crystallization

Produce the full spec from the **feature-spec template** at `skills/task-start/references/feature-spec-template.md` — fill the draft already at that path (the file step 1.5 created and recorded in the journal), fill every `{…}` placeholder, **and delete the unbraced guidance lines that sit beside them**. Do not copy the template over that file: it holds every answer the user has given since step 1.5, and re-copying destroys them silently. That guidance is addressed to you, not to the finished spec: it carries no braces, so no gate can see it, and a spec that ships with it reads as half-filled. The template holds the whole feature scaffold (frontmatter, the `spec-contract` and `host-bindings` YAML blocks, and every prose section listed below). Read it from the plugin: the `skills/…` path resolves through all three entry points — chat and `/<command>` natively, `/marvin:<command>` via the server's plugin-root preamble (ADR-0008).

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

Suggest notes based on dialogue context (deliberately-excluded scope), VISION.md (relationship to planned evolution), and edge cases discovered during context mapping. The user decides what to include. Slices deferred at Step 4.5F do **not** belong here — they are board cards, listed under `## Deferred slices`.

### Step 7F: Definition of Ready — mechanical gate (tool first)

Run the deterministic gate **before** the critic. It is free, fast, and catches shape errors the expensive opus critic should not burn a pass on. The critic only ever sees shape-valid specs.

Run the `spec` tool (`mcp__plugin_marvin_marvin__spec`), passing the draft's `specPath` and the project root. The drafted spec is a file on disk from step 1.5, so the gate reads it there rather than taking an inline `specContent` copy — the one instruction whose input changed when the write moved forward. `status: draft` does not fail the gate; the finalize step flips it. It deterministically verifies: required frontmatter keys + valid enums (including `breaking` and `spike_required: false`), all required prose sections present (including **Definition of Done**), and the **`spec-contract` YAML block** — parsed by `yaml` and schema-validated **fail-closed**: every `files` `edit`/`delete` path exists on disk, ≥3 criteria each with a typed `oracle`, the **traceability triple** (every criterion's `implemented_by` names real `files` ids, every `satisfies` points at a real criterion, every `kind: test` oracle's path is an allowlisted `files` entry, ≥1 non-prose-review oracle), a bugfix carries a `regression: true` criterion, Open Questions resolved to "none", and no leftover `{…}` placeholders (which parse as YAML maps and trip the schema).

- **FAIL** — show the failing checks, loop back to the relevant step (usually 2F, 3F, or 5F), fix, re-run. **Do not invoke the critic and do not write the spec.**
- **PASS / PASS WITH WARNINGS** — proceed to the critic; address or consciously accept warnings.
- If the `spec` tool is unavailable, self-check the same list manually and note the degradation in Design Notes.

### Step 8F: Critic Review (semantic)

On a shape-valid spec, invoke the `marvin-tm-spec-critic` agent via Task-tool, passing the drafted spec content. The critic judges what the tool cannot: that the contract's `files` name the *real* integration points, that each `oracle` is *genuine* (not a restatement of the criterion), and that rejected variants are not strawmen.

- **Verdict `BLOCK`** — present blockers, loop back to the relevant step (usually 2F, 3F, or 5F), then **re-run Step 7F** before returning here. Do not write the spec.
- **Verdict `PASS WITH WARNINGS`** — show warnings; the user decides whether to revise or proceed. If proceeding, record the override in **Critic Verdict & Overrides**.
- **Verdict `PASS`** — proceed to finalize.
- **Verdict `NEEDS_CONTEXT`** — the critic could not judge yet and named the exact input it lacks (the spec content itself, a cited file that exists but it could not read, a listing that came back empty). Supply that input and re-dispatch the critic **once**, stating in the dispatch that this is the re-dispatch for the `NEEDS_CONTEXT` it raised — it enters with a fresh context and cannot see the earlier turn. A second `NEEDS_CONTEXT` is treated as `UNABLE`.
- **Verdict `UNABLE`** — the critic could not judge and could not name what would fix that. It is **not** a pass. Record it verbatim as `UNABLE — <reason>` in **Critic Verdict & Overrides**, show the critic's Blocker / Attempted / Recommendation to the user, and let the user decide whether to proceed.

Record the verdict in the spec's **Critic Verdict & Overrides** section — that section is the carrier for **this** critic, and `/marvin:task-deliver` renders it on the PR's **Spec critic** line (the diff critic gets its own line, from `/marvin:task-implement`). Record only a terminal verdict: `PASS`, `PASS WITH WARNINGS`, `BLOCK` or `UNABLE`. If Task-tool is unavailable, write "none — critic skipped" there **and** carry that fact forward so the PR reads "⚠️ critic skipped" — a skipped semantic gate is never silent. An `UNABLE` verdict is carried the same way and reads "⚠️ critic UNABLE — <reason>".

### Step 9F: Finalize & write

1. **Judgment items** the gates cannot assess:
   - [ ] Goal is specific (not "improve" but "add X for Y")
   - [ ] Specific approach is chosen with rationale for rejected alternatives
   - [ ] Each acceptance criterion is genuinely provable by its stated `oracle` (not merely non-empty)
   - [ ] Stack-compliance marker reflects the verified manifest
   - [ ] No contradiction with VISION.md (if it exists)
   - [ ] No dependency on an incomplete sibling spec (from 1.3)

   If any item fails, loop back (and re-run Step 7F after editing). Do not write the spec.

2. **The directory** — settled at step 1.5, with the user. Nothing to re-decide here.

3. **The slug and the number** — allocated at step 1.5 through `action: "next"`. The draft already
   sits at `<chosen-dir>/<NNN>-{slug}.md`; do not allocate a second one.

4. **Re-check the collision, and skip the draft this run created.** Call `action: "next"` once more
   with the same slug and match its reported collision against the draft's exact filename: a run
   that does not skip the draft this run created collides with itself, every time. A collision on
   any *other* file means a parallel session claimed the slug or the number while intake was
   running — renumber or rename the draft, then record the new path in the journal
   (`action: "progress"`, with the new `draftPath`).

5. **Write & seal.** This is an **edit of the file already on disk**, not a write of a new one.
   Confirm `created` is today and `tracker`/`supersedes` are recorded, then
   **flip `status: draft` to `status: ready`** in the frontmatter.
   Then **re-run the `spec` tool on the written file** (pass
   `specPath` — the verdict must be PASS or PASS WITH WARNINGS, the same pair Step 7F accepts), and
   stamp `contract_sha:` from the result's `contractSha` into the frontmatter. This binds the written
   artifact to a passing gate and seals the immutable contract: later tampering of the block is
   caught by re-hashing. Append a final `kind: "step"` journal entry and confirm the path to the user.

**Immutability.** After the DoR gate the spec's **content is immutable**. The only mutable parts are lifecycle metadata: `status` (advanced by later phases) and an appended `## Delivery` section (PR link, added at delivery). If content must change, create a **new** spec whose `supersedes:` points to this one. The stamped `contract_sha` makes this enforceable, not merely conventional: `/marvin:task-implement` re-verifies the seal via the `spec` tool (`action: "seal"`) on read and refuses a spec whose contract was edited after sealing.

---

## Bugfix Flow

**Record each step as it completes** — steps 2B through 8B, exactly as the Feature Flow states it
above: a `kind: "step"` entry per completed step, a `kind: "decision"` entry for the fix approach
chosen at 5B, answers into the draft's prose and position into the journal, `detail` one line and
never a credential, token or customer datum.

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
5. **One pull request** — apply the one-PR test from `skills/task-start/references/routing.md` to
   items 1–3 taken together. Sibling patterns (item 3) are the usual producer of slices: the
   root-cause fix is this spec, each sibling that fails the test is a board card listed under
   `## Deferred slices`.

### Step 6B: Crystallization

Produce the full spec from the **bugfix-spec template** at `skills/task-start/references/bugfix-spec-template.md` — fill the draft already at that path (the file step 1.5 created and recorded in the journal), fill every `{…}` placeholder, **and delete the unbraced guidance lines that sit beside them** (same rule as Step 5F: the guidance is for the author, and no gate can see it once it ships). Do not copy the template over that file — same reason as 5F: it would destroy the answers gathered since 1.5. The template holds the whole bugfix scaffold (frontmatter, Problem / Expected / Reproduction, Root Cause Analysis, the `spec-contract` and `host-bindings` YAML blocks, Fix Approach, Regression Test Specification, and the rest). Read it from the plugin: the `skills/…` path resolves through all three entry points — chat and `/<command>` natively, `/marvin:<command>` via the server's plugin-root preamble (ADR-0008).

Fill **every** section (write "N/A"/"none" deliberately), including frontmatter (`slug`, `created`, `tracker`, `supersedes`, verified `stack`, `severity`, discovered `test_command`), the **`spec-contract` block** (the `files` allowlist + `criteria`), and the prose sections. **One criterion MUST carry `regression: true`** — it asserts the regression test fails on pre-fix code and passes after; the test it names in its `oracle` must be a `files` entry.

Present to user. Iterate until approved.

### Step 7B: Definition of Ready — mechanical gate (tool first)

Run the `spec` tool **before** the critic (same rationale as Step 7F). Pass the draft's `specPath` — the file step 1.5 opened — plus the project root, not an inline `specContent` copy. For bugfix it additionally expects the Root Cause Analysis, Fix Approach, Regression Test Specification, and Definition of Done sections, ≥2 criteria, a criterion marked `regression: true`, plus the traceability triple — the regression test named in its `oracle` must be an allowlisted `files` entry.

- **FAIL** → show failing checks, loop back (usually 3B or 5B), fix, re-run. **Do not invoke the critic and do not write.**
- **PASS / PASS WITH WARNINGS** → proceed to the critic.
- Tool unavailable → self-check manually, note in Design Notes.

### Step 8B: Critic Review (semantic)

On a shape-valid spec, invoke `marvin-tm-spec-critic` via Task-tool with the drafted bugfix spec. Apply the same verdict rules as Step 8F and record the verdict in **Critic Verdict & Overrides**:

- `BLOCK` → loop back (usually 3B root-cause or 5B fix-approach), then **re-run Step 7B** before returning.
- `PASS WITH WARNINGS` → user decides; record override if proceeding.
- `PASS` → proceed to finalize.
- `NEEDS_CONTEXT` → supply the input the critic named and re-dispatch it **once**, stating that it is the re-dispatch; a second `NEEDS_CONTEXT` is treated as `UNABLE` (full definitions in Step 8F).
- `UNABLE` → never a pass; record it verbatim as `UNABLE — <reason>` and let the user decide whether to proceed.

If Task-tool is unavailable, write "none — critic skipped" and carry it forward so `/marvin:task-deliver` renders it on the PR's **Spec critic** line. An `UNABLE` verdict is carried the same way.

### Step 9B: Finalize & write

1. **Judgment items:**
   - [ ] Root cause is confirmed with evidence (not a guess)
   - [ ] Fix approach is minimal (only the root-cause change)
   - [ ] The regression test will fail on current code and pass after the fix
   - [ ] At least one acceptance criterion beyond "bug is fixed"
   - [ ] No dependency on an incomplete sibling spec

   If any item fails, loop back (and re-run Step 7B after editing). Do not write.
2. **The directory and the collision** — both settled at step 1.5. Re-check the collision once with
   `action: "next"`, and **skip the draft this run created**, matched by its exact filename; a
   collision on any other file means a parallel session claimed the slug while intake ran, so
   renumber or rename and record the new path in the journal.
3. **The number** — allocated at step 1.5. The draft already carries it; do not allocate a second one.
4. **Write & seal** — **same as 9F item 5**: an in-place edit of the draft that must
   **flip `status: draft` to `status: ready`**, re-running the `spec` tool on the written file
   (PASS or PASS WITH WARNINGS,
   the same pair Step 7B accepts), stamping `contract_sha` from the result, appending a final journal
   entry, and confirming the path.

**Immutability** — same carve-out as the feature flow.

---

## Guidelines

- **Ask within the budget.** Six questions for a feature, four for a bugfix, at most three per turn and only when independent (step 1.4). What the repository answers is read, not asked, and every default read that way is recorded in **Assumptions**.
- **Ground everything in the codebase.** Read actual code before suggesting patterns or constraints.
- **Verify, don't guess.** Stack compliance and `test_command` come from the manifest and the test config you read — never assumed.
- **The contract's `files` are the allowlist.** The executor may touch only listed files. If it's incomplete, the executor will either guess or stall — both are failures.
- **Flag assumptions explicitly.** Put decisions-under-uncertainty in **Assumptions**; put anything unresolved in **Open Questions** — and Open Questions must be "none" before DoR passes. A genuine unknown that needs *investigation* (not a decision) is neither: set `spike_required: true` and resolve it first (e.g. a spike via `/marvin:track-new`). Do not launder unknowns into Assumptions to slip past the gate — the `spec` tool blocks on `spike_required: true` for exactly this reason.
- **Trace every criterion.** Each criterion names the `files` ids that implement it (`implemented_by`) and a typed `oracle`; each file names the criteria it serves (`satisfies`). A `kind: test` oracle's path must be an allowlisted `files` entry. This closed graph is what lets Phase 2 execute without inferring the mapping.
- **The user decides.** Present trade-offs and let the user choose. Never select a variant unilaterally.
- **Reject untestable criteria.** "It should be intuitive" → what specific behavior, proven by what test?
- **Keep it conversational.** This is a dialogue, not a form. Adapt to the user's communication style.
- **No generic filler.** Every section must contain specific, actionable content or an explicit "N/A"/"none".
