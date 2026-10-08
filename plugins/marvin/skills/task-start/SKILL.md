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
**Pipeline mode:** see *Input* below.

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

**Pipeline mode:** see *Path A* below.

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
**Pipeline mode:** see *Path B* below.

### Path C: one coherent spec

State the scope in one sentence, get a one-line confirmation from the user, then continue to Step 1.
This is also the default whenever the evidence is thin.
**Pipeline mode:** see *Path C and D* below.

### Path D: several deliverables

Apply the one-PR test from `skills/task-start/references/routing.md`. Present the proposed slices as
a numbered list and get explicit confirmation of the split before proceeding. Then spec the **first**
slice here, create a board card for each remaining slice (mechanics in the same reference), and list
them under `## Deferred slices` in the spec you are about to write.
**Pipeline mode:** see *Path C and D* below.

## Step 1: Intake

Determine what the user wants and gather context.

### 1.1 Parse input

**Pipeline mode:** see *Tracker* below.

- **Text**: use as the raw requirement
- **Tracker reference**: fetch content via `gh issue view` for GitHub issues, or ask the user to paste content for other trackers. **Record the reference** — it becomes the spec's `tracker` field.
- **File path**: read the file

### 1.2 Determine task type

**Pipeline mode:** see *Task type* below.

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
- **Host conventions** — discover, don't assume: the ADR/RFC directory and style (`docs/adr/`, `docs/decisions/`, `rfcs/`; MADR vs Nygard), `CONTRIBUTING`, the PR template, `.pre-commit-config`. They live **once per project in `.marvin/config.json`**, never in a spec: `spec.dir` (ADR-0037), `adr.dir` (ADR-0027), `gates` (ADR-0009) and `merge_obligations` (a list of strings: what this host needs to merge, such as a version bump or a committed build artefact). Read the config first. When any of these keys is absent, **propose the missing ones once**, as one block, including a `gates.test_one` template that runs a single test (for example `npx vitest run {file} -t "{name}"`; the oracle runner substitutes `{file}` and `{name}`). Write them only after the user confirms, as a read-modify-write that keeps every other key. With `gates.test_one` configured, no criterion needs its own `oracle.run`. A spec written before this rule may still carry a `host-bindings` block; the gate keeps accepting it, but a new spec does not write one.
  **Pipeline mode:** see *Host conventions* below.

### 1.4 Clarifying questions & dimension sweep

Ask **domain-specific** questions grounded in codebase knowledge. Never ask generic questions like "tell me more" or "can you elaborate?"

Good: "Will this be a new API route or an extension of the existing `/api/users` endpoint?"
Good: "The current auth flow uses JWT in httpOnly cookies — should the new endpoint follow that pattern?"
Bad: "Can you provide more details about the requirements?"

**The intake has a budget: six questions for a feature, four for a bugfix.** A question counts
whether it is asked alone or inside a batch; a follow-up that only clarifies an answer already given
does not. The budget bounds what you may ask the **user** — it bounds nothing about what the spec
must contain, and it is never a licence to dispatch on less.
**Pipeline mode:** see *Questions* below.

**Spend it in priority order:** scope and boundaries first, then security and data, then interface
and contract, then everything else. A budget exhausted early is then exhausted on the dimensions
that most often invalidate a spec, not on whatever surfaced first.

**Batch up to three questions per turn** — numbered, and only when they are genuinely
**independent**, each answerable in short form (a number, a word, or "default"). A question whose
wording depends on a previous answer stays sequential.
**Pipeline mode:** see *Questions* below.

**At the cap, nothing is dropped.** Remaining uncertainty that is a *decision* becomes a recorded
assumption; remaining uncertainty that needs *investigation* sets `spike_required: true`. The budget
is not a route past the Open Questions rule in the Guidelines — an unresolved question is still a
reason to keep authoring.
**Pipeline mode:** see *Unknowns* below.

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
   **Pipeline mode:** see *Spec directory and slug* below.
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
3. **Recent churn** — `git log --oneline -5 -- <file>` for each affected file. Hotspots are risk signals; note them as traps in Chosen Approach.
4. **Existing patterns** — how does the codebase currently handle similar functionality?
5. **Reusable components** — hooks, utilities, helpers that can be leveraged
6. **Potential conflicts** — areas where changes might cause side effects
7. **Constraints** — tech debt, architectural boundaries, performance requirements

**Verify the stack.** From the dependency manifest read in 1.3, confirm whether the work is solvable with the current stack (→ `NATIVE`), needs a new dependency (→ `EXTENSION`, list it), or is non-standard (→ `EXPERIMENTAL`). The marker must reflect the manifest, not an assumption.

**Discover the test harness.** Determine how this project runs tests (the command) and where tests live (the directory/naming convention). Then **read one or two neighboring tests** for the affected area to capture fixture/mocking/setup conventions — these become the spec's `test_command` and the convention the executor follows; a non-obvious test design (a mutation to catch, a fixture the test needs) goes into the test file's `intent`. Knowing the command is not knowing the patterns. **Prefer the command the project declares** — a CI job, a `Makefile` target, a manifest script — over a guessed ecosystem default; for a stack you don't recognise, **ask the user** for the test command rather than guessing, since a wrong `test_command` poisons every downstream gate. If you cannot determine them, that is an Open Question — resolve it before DoR.
**Pipeline mode:** see *Test harness* below.

If `VISION.md` exists, note future-direction intent — it informs variant evaluation.

Present the context map to the user. Let them correct if you're off target.
**Pipeline mode:** see *Context map* below.

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

**Pipeline mode:** see *Variants* below.

Present the variants and wait for the user's decision. The user may:
- **Select** a variant as-is
- **Combine** elements from multiple variants
- **Reject all** and redirect — go back to Step 3F with new constraints

If two variants are tied on all practical dimensions and VISION.md exists, use future alignment as the tiebreaker. If a future-aligned variant costs significantly more, flag it but do not select it automatically.

Record the selected approach and the carried-forward `risk` rating for the spec frontmatter.

### Step 4.5F: Scope & Size Gate

Before crystallizing, apply the one-PR test from `skills/task-start/references/routing.md` to the
chosen approach. **A plan with more than 15 files or more than 12 criteria must present the split
explicitly** even when the test seems to hold: the size does not decide the split, but it obliges
you to show one and let the user reject it.
**Pipeline mode:** see *Size gate* below.

- If the test fails, or the size threshold is crossed, **stop and present the slices** as a
  numbered list, then let the user pick one of exactly two options. Proceed on neither without an
  answer:
  1. **Slice now** — spec the first slice here, create a board card for each remaining slice
     (mechanics in the same reference), and list them under `## Deferred slices` in this spec.
  2. **Keep the scope** — record the user's one-line rationale in `## Chosen Approach` and continue.
- A spec the executor cannot implement without making scope decisions is too big — the executor is forbidden from making those decisions.

### Step 5F: Crystallization

Produce the full spec from the **feature-spec template** at `skills/task-start/references/feature-spec-template.md` — fill the draft already at that path (the file step 1.5 created and recorded in the journal), fill every `{…}` placeholder you keep, **and delete the unbraced guidance lines and the writing-rules comment that sit beside them**. Do not copy the template over that file: it holds every answer the user has given since step 1.5, and re-copying destroys them silently. That guidance is addressed to you, not to the finished spec: it carries no braces, so no gate can see it, and a spec that ships with it reads as half-filled. Read it from the plugin: the `skills/…` path resolves through all three entry points — chat and `/<command>` natively, `/marvin:<command>` via the server's plugin-root preamble (ADR-0008).

**Every fact lives in one place, and every section has a reader.** The target is the size budget
`3 KB + 400 B per file + 500 B per criterion`, which the DoR gate warns above. Write under these
rules:

- **One fact, one place.** A requirement lives in the contract, as a criterion or a file intent.
  Prose refers to it by id (`F3`, `AC2`) and never restates it. A requirement found only in prose is
  a defect, because nothing proves it: move it into the contract.
- **Chosen Approach carries only what the contract cannot.** That means the order of work, the traps
  an implementer would fall into, cross-cutting decisions, the stack-compliance marker and at most
  three rejected alternatives, each with the project constraint that rejects it.
- **Context is pointers, not evidence.** Each bullet is a `path:line` and one clause.
- **Evidence goes to a sidecar.** Measurements, probes and provenance go to
  `<spec dir>/runs/<slug>.evidence.md` (`.marvin/task/runs/` by default), cited from Context in one
  line. The `runs/` subdirectory is invisible to every spec enumerator, so the sidecar is never
  mistaken for a spec.
- **The critic's narrative goes to the receipt.** Critic Verdict & Overrides is one line: the
  verdict, the receipt numbers and any override.
- **The contract fields have limits**, stated in the template: a `statement` of at most 30 words as
  Given/When/Then, a `failure` line that names a wrong implementation rather than negating the
  statement, an `intent` of at most two sentences, a `signature` with no comments restating
  criteria, no `oracle.run` when `gates.test_one` derives it, and no rationale, history or evidence
  anywhere in the block, because `contract_sha` seals it.
- **Optional sections are written only when they apply.** Data & Config when there is a migration,
  variable, flag or config key. Security / NFR when `risk: high` or the change touches auth, crypto,
  PII or input parsing. Deferred slices when slices were deferred. Delete the section otherwise;
  do not write "N/A".

Fill the sections the draft keeps:
- **Frontmatter** — `slug`, `created` (today, `date +%F`), `tracker`, `supersedes`, verified `stack` (comma-separated if polyglot), `risk`, `breaking` (true|false — public-surface impact), `spike_required` (false unless a genuine unknown remains), discovered `test_command`
- **Goal** — one or two sentences
- **Context** — pointers from context mapping, including callers and the evidence sidecar; optional on the light tier (below)
- **Spec Contract** (the ` ```yaml spec-contract ` block) — the machine-validated heart of the spec, parsed and schema-checked by the gate:
  - `files` — the authoritative allowlist: one entry per file with `id` (F1, F2…), `path`, `action` (new/edit/delete), `intent`, optional `anchor` (file:line). Merge obligations from the config (docs, changelog, version bump, committed build artefacts) are `files` rows when they touch a file. **Every test named in a `kind: test` oracle MUST be a `files` entry** — the allowlist forbids the executor from creating an unlisted file. `satisfies` is optional: the gate derives it from `implemented_by`, and a declared list that disagrees is a FAIL.
  - `criteria` — minimum 3, each with an `id` (AC1…), a `statement`, `implemented_by` (the `files` ids), a typed `oracle` (`kind: test | command | prose-review`, plus a `ref` for the first two) and a `failure` path. **At least one criterion must carry a non-prose-review oracle.** An obligation that used to sit in a Definition of Done or a Test Plan, such as a test that must be watched to fail, becomes a criterion, a `failure` line or a test file's `intent`.
  - `contract` — the exact callable surface as `kind` (function/route/schema/cli/event) + a literal `signature` the implementer copies; `kind: none` if there is no callable surface.
  - `build_order` (optional) — the order the executor applies the files.
  - `depends_on` (optional) — sibling spec slugs this task depends on; the gate **fails** unless each is `status: shipped`.
- **Chosen Approach** — the rules above
- **Non-goals** — explicit scope boundaries discussed during dialogue, as a short list
- **Assumptions** — defaults taken instead of asking, limited to those the contract does not show

**The light tier.** A spec with `risk: low` and at most five files may omit Context, and Step 8F
dispatches the critic once rather than up to twice.

Present the draft to the user. Iterate until they approve.
**Pipeline mode:** see *Draft approval* below.

### Step 6F: Follow-ups

Suggest follow-ups based on the dialogue (deliberately excluded scope), `VISION.md`, and edge cases discovered during context mapping. The user decides which to keep, and each one they keep becomes a board card through `/marvin:track-new` — never a spec section, because nothing reads a list of future work inside a sealed spec. Slices deferred at Step 4.5F are already cards and are listed under `## Deferred slices`.
**Pipeline mode:** see *Follow-ups* below.

### Step 7F: Definition of Ready — mechanical gate (tool first)

Run the deterministic gate **before** the critic. It is free, fast, and catches shape errors the expensive opus critic should not burn a pass on. The critic only ever sees shape-valid specs.

Run the `spec` tool (`mcp__plugin_marvin_marvin__spec`), passing the draft's `specPath` and the project root. The drafted spec is a file on disk from step 1.5, so the gate reads it there rather than taking an inline `specContent` copy — the one instruction whose input changed when the write moved forward. `status: draft` does not fail the gate; the finalize step flips it. It deterministically verifies: required frontmatter keys + valid enums (including `breaking` and `spike_required: false`), the required prose sections present (Goal, Chosen Approach, Non-goals, Open Questions), and the **`spec-contract` YAML block** — parsed by `yaml` and schema-validated **fail-closed**: every `files` `edit`/`delete` path exists on disk, ≥3 criteria each with a typed `oracle`, the **traceability triple** (every criterion's `implemented_by` names real `files` ids, every `satisfies` points at a real criterion, **the two directions agree** — a declared `satisfies` list that denies a criterion naming it is a FAIL — every `kind: test` oracle's path is an allowlisted `files` entry, ≥1 non-prose-review oracle), a bugfix carries a `regression: true` criterion, Open Questions resolved to "none", and no leftover `{…}` placeholders (which parse as YAML maps and trip the schema). It also checks what can be known about grounding and oracles without judgement: a `path:line` citation past the end of its file FAILs (`cite-lines`), an oracle command naming a file that neither exists nor is planned FAILs (`oracle-paths`), a test-name filter starting with `-` FAILs because the runner parses it as an option and exits with an error (`oracle-filter`), and a whole-suite oracle or a real oracle with no `failure:` line warns (`oracle-narrow`, `oracle-failure`). Fix these before dispatching the critic: a pass spent on them is a pass not spent on meaning.

- **FAIL** — show the failing checks, loop back to the relevant step (usually 2F, 3F, or 5F), fix, re-run. **Do not invoke the critic and do not write the spec.**
- **PASS / PASS WITH WARNINGS** — proceed to the critic; address or consciously accept warnings.
It also warns, never fails, on size: a spec over the budget (`spec-size`), a criterion `statement` over 40 words (`ac-length`), a file `intent` over 60 words (`intent-length`), and a `risk: high` spec with no Security / NFR section (`security-nfr`). Treat a size warning as a request to delete restatement, not to argue for the length.

- If the `spec` tool is unavailable, self-check the same list manually and note the degradation in Assumptions.
  **Pipeline mode:** see *Spec tool* below.

**Record the call** (ADR-0043). After the gate answers — every time it answers, including each re-run the Step 8F sweep prescribes — call the `metrics` tool on the `marvin` server with `action: "record"`, `kind: "gate-call"`, `gate: "dor"`, `source: "task-start"`, `step: "7F"`, the spec's `slug`, its `verdict`, and `call` incremented per run (`1` for the first). Whether the gate passed on its first call is a metric that lives nowhere else once the session is compacted, and the call costs one tool round-trip.

### Step 8F: Critic Review (semantic)

On a shape-valid spec, invoke the `marvin-tm-spec-critic` agent via Task-tool, passing the drafted spec content **and its size budget**: the spec's bytes and `3 KB + 400 B per file + 500 B per criterion` computed for its contract, so the critic can report an over-budget spec. The critic judges what the tool cannot: that the contract's `files` name the *real* integration points, that each `oracle` is *genuine* (not a restatement of the criterion), and that rejected variants are not strawmen.

**Before every dispatch — the deterministic sweep.** A dispatch costs minutes; each check below
costs seconds and each has cost a real critic round. Run all four before the first dispatch and
again before any re-dispatch:

1. **Step 7F again** if you edited the draft at all — a fix that broke the contract's shape is
   caught in about a second, and the critic must never spend a pass on shape.
2. **The configured gates against the project's real ones.** Read `.github/workflows/*`,
   `package.json` scripts or the `Makefile` and confirm that `gates` in `.marvin/config.json` and
   the contract's merge-obligation rows name every job that actually runs. A CI job nobody names is
   a blocker the critic will find and a `grep` finds for free.
3. **Every shell snippet you wrote into the spec, re-read for its exit code.** A chain like
   `… && exit 1 || exit 0` exits 0 on exactly the drift it was written to detect. That is a real
   finding from an instrumented run, and it was introduced by the previous round's own fix.
4. **The defect class you just repaired, re-checked everywhere else in the contract.** Half the
   blockers of rounds 2 and 3 in that run were created by the fix for round 1 and round 2 — the
   loop fed itself. When you correct one back-reference, transpose the whole graph.

**Record each dispatch and its verdict** (ADR-0043). Immediately before the dispatch, call the `metrics` tool with `action: "record"`, `kind: "critic-dispatch"`, `critic: "marvin-tm-spec-critic"`, `source: "task-start"`, `step: "8F"`, the spec's `slug` and the `pass` number — `1` for the first dispatch, `2` for the second; a `NEEDS_CONTEXT` re-dispatch reuses its pass number. When a terminal verdict arrives, record `kind: "critic-verdict"` with the same `critic` and `pass`, the `verdict`, and the `blockers` and `warnings` counts from the critic's block or report. The pair is what makes the time inside a critic dispatch and the passes before a terminal verdict measurable without a clock in the model; compaction destroys the in-session count, and each call costs one round-trip. **Read the dispatch answer's Budget line before dispatching.** The tool judges the `pass` against the budget below, telling the light tier from the spec's own frontmatter and contract: `final` means say in the prompt that this is the last dispatch, and `exceeded` means do not dispatch at all — go to the user's choice described under the budget. The line survives compaction; the count in your context does not.

- **Verdict `BLOCK`** — present blockers, loop back to the relevant step (usually 2F, 3F, or 5F), then **re-run Step 7F** before returning here. Do not write the spec. This is a **loop with a budget** — see below.
- **Verdict `PASS WITH WARNINGS`** — show warnings; the user decides whether to revise or proceed. If proceeding, record the override in **Critic Verdict & Overrides**.
- **Verdict `PASS`** — proceed to finalize.
- **Verdict `NEEDS_CONTEXT`** — the critic could not judge yet and named the exact input it lacks (the spec content itself, a cited file that exists but it could not read, a listing that came back empty). Supply that input and re-dispatch the critic **once**, stating in the dispatch that this is the re-dispatch for the `NEEDS_CONTEXT` it raised — it enters with a fresh context and cannot see the earlier turn. A second `NEEDS_CONTEXT` is treated as `UNABLE`.
- **Verdict `UNABLE`** — the critic could not judge and could not name what would fix that. It is **not** a pass. Record it verbatim as `UNABLE — <reason>` in **Critic Verdict & Overrides**, show the critic's Blocker / Attempted / Recommendation to the user, and let the user decide whether to proceed.
  **Pipeline mode:** see *Critic* below.

**Resolve a finding by editing the lines it names.** Do not add a paragraph that explains the fix,
and do not park a warning in the spec: the receipt under `.marvin/critique/` already records how
each finding was handled. A `[redundancy]` finding is resolved by deleting the restatement, a
`[prose-only]` finding by moving the requirement into the contract, and a `[drift]` finding by
deleting the copy that contradicts the contract. A spec that grows on every round is the failure
this rule exists to stop.

**Critic budget — two dispatches per spec, one on the light tier.** This step is a loop and it used to have no limit at
all; one instrumented run spent four dispatches and 34.8 minutes here, which is where the budget
comes from. Counted in dispatches, not in rounds, because that is the unit that costs minutes:

- **First dispatch → `BLOCK`.** Fix precisely what the blockers name and nothing adjacent, run the
  sweep above, re-run Step 7F, and dispatch **once** more. Say in the prompt that this is the second
  and final dispatch, and list what you changed: the critic enters with a fresh context, cannot see
  its first report, and tightens its own output budget on a stated re-dispatch.
- **Second dispatch → `BLOCK`.** Stop. Present the surviving blockers to the user together with what
  you changed, and let them choose: revise once more without a critic, or record the survivors as an
  override in **Critic Verdict & Overrides** and proceed. A third dispatch against the same spec is
  banned — past the second it re-derives rather than converges, and the user's judgement is both
  faster and better informed than a third opinion.
  **Pipeline mode:** see *Critic* below.
- A `NEEDS_CONTEXT` re-dispatch does **not** spend the budget: it answers missing input rather than
  retrying a failed attempt, and keeps its own one-shot allowance.
- **The light tier** (`risk: low` and at most five files) gets one dispatch. A `BLOCK` on it goes
  straight to the user's choice described for the second dispatch above.

Record the verdict in the spec's **Critic Verdict & Overrides** section as one line — the verdict, the receipt numbers and any override (`PASS WITH WARNINGS — receipts 046, 047; override: <finding> because <reason>`). That section is the carrier for **this** critic, and `/marvin:task-deliver` renders it on the PR's **Spec critic** line (the diff critic gets its own line, from `/marvin:task-implement`). Record only a terminal verdict: `PASS`, `PASS WITH WARNINGS`, `BLOCK` or `UNABLE`. If Task-tool is unavailable, write "none — critic skipped" there **and** carry that fact forward so the PR reads "⚠️ critic skipped" — a skipped semantic gate is never silent. An `UNABLE` verdict is carried the same way and reads "⚠️ critic UNABLE — <reason>".

Where the critic emitted a ` ```json critic-verdict ` block, route on the **roll-up** computed from its two axes (`BLOCK` > `UNABLE` > `PASS WITH WARNINGS` > `PASS`); where it did not, route on the `**Verdict:**` line exactly as above.

**Then write the receipt** (ADR-0039). After the verdict is recorded above — that section stays the DoR gate's carrier and is not replaced — save the critic's report **verbatim**, followed by its ` ```json critic-verdict ` block, to `.marvin/critique/<NNN>-<slug>.md`:

- `<NNN>` is the highest existing leading-integer prefix in `.marvin/critique/` plus one, `001` when the directory is empty or absent — the same rule `skills/handoff/SKILL.md` states for its own sequence. Create the directory on first write.
- `<slug>` is the spec slug, and the block's `subject` is that **same** slug. It is the key `/marvin:reports` links on and `/marvin:task-summary` looks up, so a receipt whose `subject` is anything else is orphaned from its task.

Three rules make the receipt trustworthy:

1. **Terminal verdicts only.** A `NEEDS_CONTEXT` gets no receipt until its single re-dispatch resolves; write the receipt for the resolved run.
2. **A critic that emitted no block gets no receipt**, and the PR line renders exactly as specified above — the receipt adds evidence, it never invents a verdict.
3. **The receipt is a record, never an input.** It is written after the decision, and nothing reads it back to make one.

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
   **Pipeline mode:** see *Finalize* below.

**Immutability.** After the DoR gate the spec's **content is immutable**. The only mutable parts are lifecycle metadata: `status` (advanced by later phases) and an appended `## Delivery` section (PR link, added at delivery). If content must change, create a **new** spec whose `supersedes:` points to this one. The stamped `contract_sha` makes this enforceable, not merely conventional: `/marvin:task-implement` re-verifies the seal via the `spec` tool (`action: "seal"`) on read and refuses a spec whose contract was edited after sealing.

---

## Bugfix Flow

**Record each step as it completes** — steps 2B through 8B, exactly as the Feature Flow states it
above: a `kind: "step"` entry per completed step, a `kind: "decision"` entry for the fix approach
chosen at 5B, answers into the draft's prose and position into the journal, `detail` one line and
never a credential, token or customer datum.

### Step 2B: Reproduction

**Pipeline mode:** see *Reproduction* below.

Help the user establish a reliable reproduction path:

1. **What happens vs. what should happen** — get specifics, not "it crashes"
2. **Find the shortest trigger** — a failing test is ideal. If not: curl command, REPL snippet, UI steps
3. **Identify conditions** — environment, data state, timing. Always reproducible or intermittent?
4. **Frequency** — always / intermittent / rare

If the bug cannot be reproduced, gather logs and traces. Do not proceed to root cause without evidence.

### Step 3B: Root Cause Analysis

**Pipeline mode:** see *Root cause* below.

Dispatch the **`marvin-debugger`** agent (via Task-tool) with the reproduction from Step 2B and the symptom. It runs hypothesis-driven analysis in an isolated, evidence-first context and returns a structured report — **Evidence · Hypotheses · Root Cause (confirmed, at `file:line`) · Fix Approach · Regression Test · Siblings · Lesson** — that maps directly onto this spec's Root Cause Analysis, Fix Approach, and Regression Test Specification sections. (The full methodology lives in the agent; `/marvin:debug` is its other door — there is no third copy here to drift.)

- **Root cause confirmed** → carry its findings into Step 6B; the confirmed mechanism drives the **File Change Plan**.
- **UNCONFIRMED** → the agent returns its best-supported hypothesis and the exact next step. Resolve it first — an unconfirmed root cause is an **Open Question** (or `spike_required: true`), not a spec ready to dispatch.
  **Pipeline mode:** see *Unknowns* below.
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
   **Pipeline mode:** see *Variants* and *Size gate* below.
5. **One pull request** — apply the one-PR test from `skills/task-start/references/routing.md` to
   items 1–3 taken together. Sibling patterns (item 3) are the usual producer of slices: the
   root-cause fix is this spec, each sibling that fails the test is a board card listed under
   `## Deferred slices`.

### Step 6B: Crystallization

Produce the full spec from the **bugfix-spec template** at `skills/task-start/references/bugfix-spec-template.md` — fill the draft already at that path (the file step 1.5 created and recorded in the journal), fill every `{…}` placeholder, **and delete the unbraced guidance lines that sit beside them** (same rule as Step 5F: the guidance is for the author, and no gate can see it once it ships). Do not copy the template over that file — same reason as 5F: it would destroy the answers gathered since 1.5. The template holds the whole bugfix scaffold (frontmatter, Problem / Expected / Reproduction, Root Cause Analysis, the `spec-contract` YAML block, Fix Approach, Regression Test Specification, and the rest). The writing rules of Step 5F apply unchanged: one fact in one place, evidence in the sidecar, the contract-field limits, traps and at most one rejected alternative in Fix Approach, and Deferred slices only when slices were deferred. Read it from the plugin: the `skills/…` path resolves through all three entry points — chat and `/<command>` natively, `/marvin:<command>` via the server's plugin-root preamble (ADR-0008).

Fill every section the draft keeps, including frontmatter (`slug`, `created`, `tracker`, `supersedes`, verified `stack`, `severity`, discovered `test_command`), the **`spec-contract` block** (the `files` allowlist + `criteria`), and the prose sections. **One criterion MUST carry `regression: true`** — it asserts the regression test fails on pre-fix code and passes after; the test it names in its `oracle` must be a `files` entry.

Present to user. Iterate until approved.
**Pipeline mode:** see *Draft approval* below.

### Step 7B: Definition of Ready — mechanical gate (tool first)

Run the `spec` tool **before** the critic (same rationale as Step 7F). Pass the draft's `specPath` — the file step 1.5 opened — plus the project root, not an inline `specContent` copy. For bugfix it additionally expects the Problem, Reproduction Steps, Root Cause Analysis, Fix Approach and Regression Test Specification sections, ≥2 criteria, a criterion marked `regression: true`, plus the traceability triple — the regression test named in its `oracle` must be an allowlisted `files` entry.

- **FAIL** → show failing checks, loop back (usually 3B or 5B), fix, re-run. **Do not invoke the critic and do not write.**
- **PASS / PASS WITH WARNINGS** → proceed to the critic.
- Tool unavailable → self-check manually, note the degradation in Assumptions.
  **Pipeline mode:** see *Spec tool* below.

Record the call as Step 7F does: `metrics` tool, `action: "record"`, `kind: "gate-call"`, `gate: "dor"`, `source: "task-start"`, `step: "7B"`, the `slug`, the `verdict`, and `call` incremented per run.

### Step 8B: Critic Review (semantic)

On a shape-valid spec, invoke `marvin-tm-spec-critic` via Task-tool with the drafted bugfix spec. Run the same **deterministic sweep** before every dispatch, apply the same **dispatch budget** (two, or one on the light tier, where a bugfix qualifies with `severity: low` and at most five files), the same **resolution rule** (edit the lines a finding names; add no explanatory paragraph), the same verdict rules as Step 8F, record each dispatch and its terminal verdict through the `metrics` tool exactly as Step 8F does (`critic-dispatch` before, `critic-verdict` after, `step: "8B"`), and record the verdict in **Critic Verdict & Overrides**:

- `BLOCK` → loop back (usually 3B root-cause or 5B fix-approach), then **re-run Step 7B** before returning.
- `PASS WITH WARNINGS` → user decides; record override if proceeding.
- `PASS` → proceed to finalize.
- `NEEDS_CONTEXT` → supply the input the critic named and re-dispatch it **once**, stating that it is the re-dispatch; a second `NEEDS_CONTEXT` is treated as `UNABLE` (full definitions in Step 8F).
- `UNABLE` → never a pass; record it verbatim as `UNABLE — <reason>` and let the user decide whether to proceed.
  **Pipeline mode:** see *Critic* below.

If Task-tool is unavailable, write "none — critic skipped" and carry it forward so `/marvin:task-deliver` renders it on the PR's **Spec critic** line. An `UNABLE` verdict is carried the same way.

**Write the receipt** exactly as Step 8F states it: on a terminal verdict, and only where the critic emitted a ` ```json critic-verdict ` block, save the report verbatim plus that block to `.marvin/critique/<NNN>-<slug>.md` with `subject` set to this spec's slug. Route on the block's roll-up where there is one, on the `**Verdict:**` line where there is not. The receipt is a record, never an input to the decision just made.

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
  **Pipeline mode:** see *Questions* below.
- **Ground everything in the codebase.** Read actual code before suggesting patterns or constraints.
- **Verify, don't guess.** Stack compliance and `test_command` come from the manifest and the test config you read — never assumed.
- **The contract's `files` are the allowlist.** The executor may touch only listed files. If it's incomplete, the executor will either guess or stall — both are failures.
- **Flag assumptions explicitly.** Put decisions-under-uncertainty in **Assumptions**; put anything unresolved in **Open Questions** — and Open Questions must be "none" before DoR passes. A genuine unknown that needs *investigation* (not a decision) is neither: set `spike_required: true` and resolve it first (e.g. a spike via `/marvin:track-new`). Do not launder unknowns into Assumptions to slip past the gate — the `spec` tool blocks on `spike_required: true` for exactly this reason.
  **Pipeline mode:** see *Unknowns* below.
- **Trace every criterion.** Each criterion names the `files` ids that implement it (`implemented_by`) and a typed `oracle`; each file names the criteria it serves (`satisfies`). Those are one graph written twice, and the gate transposes them: a file that declares a `satisfies` list must name every criterion whose `implemented_by` names it, or the DoR FAILs. A row with no `satisfies` at all (infra rows) declares no index and is exempt. A `kind: test` oracle's path must be an allowlisted `files` entry. This closed graph is what lets Phase 2 execute without inferring the mapping.
- **The user decides.** Present trade-offs and let the user choose. Never select a variant unilaterally.
  **Pipeline mode:** see *Variants* below.
- **Reject untestable criteria.** "It should be intuitive" → what specific behavior, proven by what test?
- **Keep it conversational.** This is a dialogue, not a form. Adapt to the user's communication style.
- **No generic filler.** Every section kept must contain specific, actionable content; an optional section that does not apply is deleted, not filled with "N/A".
- **One fact, one place.** A decision is written once, where its reader looks for it, and referred to by id everywhere else. A restatement is not emphasis: it is a second copy that drifts from the contract the first time either is edited.

## Pipeline mode

Active only when `MARVIN_PIPELINE=1` is set: this session is the planner child of the autopilot
pipeline, started headless by its engine, and the role prompt that launched it says so. Every step
above applies except where this section overrides it, and each `Pipeline mode:` line above names
the row here that replaces that step's question. An interactive session never sets the variable,
so none of this reaches one.

The "user" of the steps above is the orchestrator, and the only way to reach it is to end the turn
with status `needs_input`. The session is then resumed with a message starting `ANSWERS:`, or with
one starting `CHANGES REQUESTED:` once the orchestrator has read the sealed spec, and continues
exactly where the turn stopped. A place above that asks, confirms or presents and that no row below
names is decided the conservative way and recorded under Assumptions. Progress goes to the
orchestrator in the heartbeat reports the role prompt describes, not as narration of each step. The
session's last message is the planner object.

**What this session writes.** The spec, its evidence sidecar and the critic receipts, plus the
files the marvin tools write for this spec on their own: the progress journal and the metrics
record. No code, no test, no configuration and no commit. Before ending any turn, run
`git status --short` and delete every other path this session or one of its agents created, a
debugger's throwaway reproducer included. A stray file reaches either the executor's commit, where
the pipeline's gate stage reports it outside the contract `files`, or the gate stage's check for
uncommitted work, and either way it costs the executor a rejection it could not have avoided.

**Questions.** Step 1.4's budget of six and four, and its batches of three, do not apply here. One
cap replaces them:

- A question is one entry of a `needs_input` turn, at most four per turn and only when they are
  independent. Ask only what the task text, the code and the earlier answers leave open, in the
  priority order of step 1.4: scope and boundaries, then security and data, then interface and
  contract.
- The engine counts every question the planner asks against one cap for the whole run, whoever
  answers it. The orchestrator answers most questions itself, and those count too. The cap is
  `caps.planner_questions` in the pipeline rubric, eight by default. Keep part of it for the points
  a later step routes to a question: the variant pick, a split, a surviving critic blocker.
- A turn whose questions would cross the cap never reaches the orchestrator. The engine answers
  each of its questions with that question's own `recommendation`, marked
  `recommendation accepted: question cap reached`, and halts the run on the next `needs_input`.
  Write every `recommendation` so that it can stand as the answer on its own.
- **Once any answer arrives marked `recommendation accepted: question cap reached`, never end a
  turn with `needs_input` again**, also when the same answers arrive a second time because the
  orchestrator retried a halt. From then on every point a row below routes to a question, Variants,
  Size gate and Critic included, takes your own recommendation unless the row says otherwise, and
  each such decision is one line under Assumptions.

| Point | Pipeline behaviour |
|-------|--------------------|
| *Input* | The task is the TASK CONTEXT's task text, whether or not `$ARGUMENTS` repeats it. Never ask for it. With no task text at all, finish with status `failed`. |
| *Path A* | A found spec is never handed over: nothing here can run `/marvin:task-implement`. A `ready` spec that `action: "list"` reports sealed, and whose `action: "seal"` check then reads intact, is reused as it is: finish with `spec_ready` naming it, and record the reuse under Assumptions. A `ready` spec that is unsealed, or whose seal reads TAMPERED, cannot be executed: author anew on Path C under a distinct slug with `supersedes:` naming it, and record that under Assumptions. Do not run the seal check on an unsealed spec, because it passes with a warning and creates a metrics record this run never uses. Whether this run takes over an `in-progress` spec, which may be another session's live work, is a question while the question cap allows one. A `draft` resumes as the Path A table says. |
| *Path B* | Not taken: the run exists to produce a spec, and nothing here can route it to another command. Author it on Path C instead (a symptom with no confirmed cause takes the Bugfix Flow, whose Step 3B dispatches the debugger), and record the router's judgement under Assumptions so that the orchestrator sees it at approval. |
| *Path C and D* | The confirmation is not asked. On Path C, the scope sentence is the first line under Assumptions. On Path D, spec the first slice the one-PR test gives and list the rest under `## Deferred slices` with no board card, since the `task` tool is refused to every pipeline child; record the split under Assumptions so that the orchestrator can create the cards. |
| *Tracker* | A tracker reference is always a question while the question cap allows one, unless the task text already carries the issue's content: every pipeline child is refused `gh issue view`, and no other fetch is on its allowlist. Ask for the content, and record the reference as `tracker` either way. Past the cap, author from the task text alone and record that under Assumptions. |
| *Task type* | Decide from the task text: something broken is a bugfix, everything else a feature. Record the choice under Assumptions. |
| *Host conventions* | Never write `.marvin/config.json`, which a guard refuses, and never propose its missing keys: use what the repository shows, and record each detected value under Assumptions. Without `gates.test_one`, give every `kind: test` criterion its own `oracle.run`. The pipeline's gate stage resolves each criterion that is not `prose-review` to a command through the chain `verify` uses, and one it cannot resolve is a gate blocker that no executor can clear, because nobody may edit a sealed spec. A `ref` holding a shell metacharacter resolves to nothing even with `gates.test_one`. |
| *Unknowns* | An unknown that needs investigation is investigated in this session (read the code, run an existing test or a one-off command, dispatch the debugger again on the next step it named) or asked as a question while the question cap allows one. Never set `spike_required: true` and never turn it into a spike card: the DoR gate blocks on the flag and the `task` tool is refused, so either way the run ends without a spec. An unknown that neither settles ends the session with status `failed`, the unknown as its `failure`. |
| *Spec directory and slug* | Take the directory `action: "next"` resolves and do not ask. On a collision, never overwrite and never supersede: choose a distinct slug, re-run `action: "next"` with it, and record the choice under Assumptions. |
| *Test harness* | A test command the repository does not declare is a question while the question cap allows one; never guess one. Past the cap, finish with status `failed` and the missing command as the `failure`, because a guessed `test_command` poisons every gate after it. |
| *Context map* | Not presented: it lands in the spec's Context, which the orchestrator reads at approval. |
| *Variants* | The variant pick is a question while the question cap allows one: the variants as `options`, each with its effort, risk and stack marker, and your pick as the `recommendation`. Past the cap the pick is yours, recorded under Assumptions; the Step 4F journal entry records it either way. This row overrides the Guidelines' "never select a variant unilaterally". |
| *Size gate* | A question only when the one-PR test fails or the size threshold is crossed, with exactly the two options of Step 4.5F, and only while the question cap allows one; past the cap, take your recommendation. Slicing now defers the rest as Path D does, with no board card. A bugfix's Step 5B item 5 follows the same rule. |
| *Criteria* | Give every criterion an automatable oracle wherever one exists. On the standard and heavy tiers an independent author writes sealed acceptance tests from the criteria before any implementation exists and never sees it, so each `statement` and `failure` says what to observe through the contract's surface, never through internals the implementer is free to choose. |
| *Draft approval* | Not asked: the orchestrator approves the sealed spec after `spec_ready`, and asks for changes with `CHANGES REQUESTED:`. |
| *Follow-ups* | Keep every one and create no card: list each under the planner object's `assumptions` as a line starting `follow-up (not implemented):`, never as a spec section. |
| *Spec tool* | Required. Without the `spec` tool nothing can allocate, gate or seal the spec, so its absence ends the session with status `failed` instead of the manual self-check above. A `metrics` call that fails is skipped. |
| *Critic* | The spec-critic cap is the one in the TASK CONTEXT, and it is enforced: never dispatch past it, nor when the `critic-dispatch` record answers with a Budget line reading `exceeded`. `PASS WITH WARNINGS` is accepted, with its override recorded in Critic Verdict & Overrides. `NEEDS_CONTEXT` is handled as Step 8F says. On `UNABLE`, or on `BLOCK` from the last dispatch the cap allows, stop revising and ask a question while the question cap allows one: the surviving blockers or the `UNABLE` reason as its `text`, and as its `recommendation` either the override or one more revision without a critic. Past the cap, take that recommendation yourself, recording the override in Critic Verdict & Overrides and the decision under Assumptions. A missing Task tool is handled as Step 8F says. |
| *Root cause* | Dispatch `marvin-debugger` as Step 3B says, and tell it that this is a pipeline run: it reports its lesson in its report instead of calling `lessons` `action: "add"`, which the pipeline refuses, and it deletes any throwaway reproducer it wrote before it returns. The run's retro owns lessons. |
| *Reproduction* | Reproduce the bug from the task text and the code without leaving a file behind: read the execution path, run an existing test or a one-off command, and describe the failing test in the Regression Test Specification and the contract, where the test-author or the executor writes it. A scratch test written to confirm the bug is deleted before the turn ends. A reproduction that needs a human (credentials, a device, production data) is a question while the question cap allows one, and past it an unknown as the *Unknowns* row says. |
| *Finalize* | Steps 9F and 9B as written, except that a collision on the re-check renames without asking, and the path goes to the orchestrator in the `spec_ready` object instead of to a user. |
| *Changes requested* | No executor has read the contract yet, so edit the same spec in place: re-run Step 7F or 7B, the critic within what remains of its cap, and Step 9F or 9B, and stamp the new `contract_sha`. Write no superseding spec. |
| *Never* | Create a branch, a worktree or a board card; call the `task` or `tracker` tool; commit or push. The run's branch exists already, and guards refuse each of these. The `slices` field stays out of the planner object unless the TASK CONTEXT says slicing is enabled. |

**The planner object.** The output schema the pipeline passed decides its exact shape; these are
the fields this skill fills:

| Field | Content |
|-------|---------|
| `status` | `needs_input` with `questions`, or `spec_ready` with `spec` and no questions. `failed` only where a row above says so: the pipeline treats it as a crash, repeats the turn once, then halts the run. |
| `summary` | At most five lines of facts. |
| `questions` | At most four, each with an `id` unique across the session (`Q1`, `Q2`, … continuing over turns), the `text`, a `recommendation` that can stand as the answer, `why_blocking`, and `options` when the answer is a choice. |
| `spec` | `path` relative to the repository root, with no `./` and no absolute part; `slug`; `risk`; `files`, the contract's file count; `criteria`, its criterion count; `sealed: true`; and `critic` and `overrides` when there are any. |
| `assumptions` | Every decision made without the orchestrator in the whole session, one line each. Give the full list on the `spec_ready` turn: the engine reads assumptions from that turn alone and drops any that a `needs_input` turn carried. |
| `failure` | On `failed`, one line: what stopped the session. |
