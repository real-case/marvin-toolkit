# Proposal: Workflow Hardening

| Field      | Value |
| ---------- | ----- |
| Status     | Proposed |
| Date       | 2026-08-07 |
| Applies to | `task-*` pipeline, critic agents, `sec-*` family, `evals/trigger`, the `spec` / `verify` / `report` / `help` tools, and a new hooks layer |
| Source     | Comparison of marvin's workflows against an 11-system external corpus (superpowers, anthropics/skills, wshobson/agents, spec-kit, BMAD, OpenSpec, SuperClaude, agent-os, spec-workflow-mcp, cc-sdd, team-kit), 2026-08-07 |
| Principle  | Apply the doctrine ADR-0027 already states — determinism by name — to every remaining place where a guarantee is enforced only by model goodwill |

## Background

The comparison confirmed that marvin's two strongest mechanisms have no counterpart in the
corpus: one prose body reachable through three entry points without a rebuild (ADR-0018), and
the sealed contract hash that proves a spec was not edited after approval. It also confirmed
four classes of defect, each verified against the tree rather than taken from the analysis:

1. **Already broken today.** The `evals/trigger` self-test is red (39 skills against 37
   datasets, with `report-export` and `widget-preview` missing). The `HUMAN_RUN` set has
   drifted in both of its hand-written mirrors, so `migration-plan` appears without a
   human-run label in `/marvin:help` and in the public site catalog. `scripts/dispatch.sh`
   is referenced three times in `task-implement/SKILL.md` but was deleted. `verification.md`
   is one global path, so `task-summary` for an old spec can present a foreign run as its own.
2. **Validated but never enforced.** The Definition-of-Ready gate proves every acceptance
   criterion has a typed oracle, and then no tool ever executes an `oracle.ref`. Red-green
   for bugfixes is two prose sentences plus a warning that still allows delivery. `sec-gate`
   has no caller, and no hook exists anywhere in the plugin.
3. **Not resumable.** `task-start` writes nothing to disk until step 9, and `task-implement`
   keeps its progress in `TodoWrite`, which context compaction destroys.
4. **Untyped agent returns.** The critics have a single success channel and no way to say
   "unable to judge". A skipped critic leaves no trace that any tool can read. Review
   feedback is applied without re-grounding each finding in the code first.

The full comparison, including the mechanisms borrowed from each corpus system and the
proposals that were rejected, lives in the analysis document of 2026-08-07; this plan is
self-contained and does not require it.

## Ground rules

Every phase follows the repository's standing conventions:

- Branch off `dev` and open every PR into `dev` (ADR-0019). No release is cut until the
  owner orders one.
- Rebuild `dist/server.js` in the main checkout only; a bundle built inside a worktree is
  byte-different and not committable.
- Bump the version with `npm run sync-version` and add an entry to
  `plugins/marvin/CHANGELOG.md` for every bump.
- Work packages sized M or L go through `/marvin:task-start` and get a sealed spec before
  implementation. S-sized packages go straight to a PR.

Four checklists recur across phases and are referenced as C1–C4 below.

**C1 — registering a new command.** Create `skills/<name>/SKILL.md` and
`commands/<name>.md`, add the entry to `prompts/index.ts`, add the three entries in
`help-content.ts` (`COMMAND_BLURBS`, `COMMAND_DETAILS`, and `COMMAND_PROMPTS` with at least
three trigger phrases), extend `REQUIRED_PROMPTS` in `scripts/smoke-commands.mjs`, update the
pinned counts in `packages/site/test/catalog.test.mjs`, regenerate the site catalog, add rows
to `README.md` and `docs/commands.md`, add the trigger dataset required by WP0.1, rebuild
`dist/`, and bump a minor version.

**C2 — changing a contract that widgets consume.** Edit the schema under
`packages/marvin-mcp-shared/contracts/` together with its deliberate runtime mirror in
`lib/reports.ts`, rebuild `mcp-shared` → `widgets` → `server` in that order, run
`scripts/verify-widgets.mjs`, and refresh the darwin visual baselines with
`npm run test-storybook:update -w @marvin-toolkit/widgets` whenever rendering changes.

**C3 — adding or amending an ADR.** Link the new file from both `README.md` and
`docs/README.md`, because `npm run lint:docs` fails the build otherwise. Accepted ADRs are
never edited in place: supersede them or add a successor. ADR-0031 sets the precedent that
stale names in accepted records stay as history.

**C4 — adding a script tree.** Confirm the ESLint and Prettier globs cover the new files,
because `lint` and `format:check` are blocking CI steps.

## Phase 0 — Repair

Fix what is broken today. Nothing in this phase changes intended behavior. Ships as a patch
(≈ 0.12.3).

**WP0.1 — evals/trigger (S).** *Landed, spec `repair-and-enforce-trigger-evals`.* Make the
self-test derive the skill count from the catalog
instead of a hard-coded literal, and compare the set of dataset names against the contents of
`plugins/marvin/skills/`. Add `eval:self-test` and `eval:trigger` scripts to the root
`package.json`, and add a CI step after "Lint manifests" on both matrix legs; the self-test
needs no network. Extend `scripts/lint-manifests.mjs` with one rule: a skill without
`disable-model-invocation: true` must have `evals/trigger/datasets/<name>.json`. Write the
two missing datasets — `report-export.json` (near-miss competitors: `reports`,
`sec-report`) and `widget-preview.json` (competitors: `dashboard`, `help`).

> Four things stated here turned out to be wrong or too narrow, and are corrected for the
> record. The coverage rule applies to **every** skill, not only those without
> `disable-model-invocation`: all four human-run skills already carry datasets, legitimately
> all-negative, so the weaker wording would have exempted files that already exist. The
> `disable_model_invocation` parity check listed under WP3.1 landed **here** instead, together
> with a canonical-form rule, because the case-sensitivity gap was live and WP3.1 is three
> phases away behind an open decision; both live in `scripts/lib/skill-datasets.mjs`, so
> WP3.1 extends that module rather than writing the checks a second time. The four named
> competitors are **prompts without a `SKILL.md`**, so they are absent from the catalog a
> decider is shown and cannot be competition winners at all; they are named in negative notes,
> and a new rule rejects any winner that is unreachable — which covers human-run skills too,
> since `catalogText` filters those out as well. And three further invariants, each measured
> universal across the shipped corpus, are enforced alongside: a `note` on every negative and
> competition query (399 of 399 and 137 of 137 carry one), an explicit `mock_rate` on every query
> (882 of 882), and no orphan datasets.
>
> One finding is worth carrying into WP3.1 directly. The three readers of the human-run flag
> do not accept the same values: `catalog.mjs` strips both quote styles and the ADR-0005 codec
> accepts either, but `gen-catalog.mjs` matches `"?true"?` with neither an `i` flag nor a
> single-quote alternative. So `disable-model-invocation: 'true'` would be human-run in Claude
> Code and in `/marvin:help` while the public site advertised the command as model-invocable —
> the drift WP0.2 removed, one quote character away. Canonical form is therefore defined as the
> **intersection** of the three readers and the linter rejects `'true'`; widening the site
> regex to `["']?` is the alternative and belongs with WP3.1's frontmatter allowlist.

**WP0.2 — HUMAN_RUN single-sourcing (S).** *Landed in 0.12.3, spec
`single-source-human-run-flag`.* The skill frontmatter becomes the only source. On the
server side, `help-data.ts` replaces its constant with `humanRunSkills(packRoot)`, reading
`skills/*/SKILL.md` at request time through the ADR-0005 frontmatter codec; `buildHelpTool`
takes `packRoot` from `server.ts`. On the site side, `gen-catalog.mjs` drops its own mirror
and scans the same frontmatter. Guards land in `help-structured.test.mjs`,
`catalog.test.mjs` and a new `help-human-run.test.mjs`, the last driving a synthetic pack
root so a hard-coded set cannot pass. Requires a dist rebuild.

> Two premises stated here before implementation turned out to be wrong, and are corrected
> for the record. The reader stays in `help-data.ts` rather than moving into the tool:
> `gen-catalog.mjs` transpiles only `prompts/index.ts` and `help-content.ts`, never
> `help-data.ts`, and that file already imported `node:fs`, so no import-free constraint
> applied. And the flag had **six** hand-typed sources, not two — the widget fixture,
> `README.md`, `docs/commands.md` and a doc comment in `packages/site/src/data/catalog.ts`
> carried it as well.

**WP0.3 — dead references (S).** Rewrite the three `dispatch.sh` references in
`skills/task-implement/SKILL.md` (and the note in
`evals/trigger/datasets/task-implement.json`) to describe headless dispatch through the
`marvin-tm-executor` agent, pending decision D1. Register `.marvin/research-results/` in the
CLAUDE.md working-directory table and in `docs/`; leave ADR-0007 untouched per C3 (its stale
`.marvin/kanban/` row is history under the ADR-0031 precedent), and defer `report`-tool
ingestion of the directory to Phase 7, where `ReportGroup` changes anyway.

Phase 0 is done when the self-test is green in CI, `migration-plan` carries the human-run
label in both `/marvin:help` and the site catalog, and no shipped file references a path
that does not exist.

## Phase 1 — Protocol prose

Upgrade the advisory protocols without touching the server. Ships as a patch: every change
is a prompt-body or agent-body edit.

**WP1.1 — critic verdict vocabulary (S).** Extend both critics
(`marvin-tm-diff-critic.md` §4, `marvin-tm-spec-critic.md` §4) from three verdicts to
`PASS | PASS WITH WARNINGS | BLOCK | NEEDS_CONTEXT | UNABLE`, with narrow definitions for
the two new values and an explicit escalation license taken from the Blocker Protocol in
`marvin-tm-executor.md`. Route both new values at all four call sites (`task-start` 8F and
8B, `task-implement` 6F, `marvin-tm-executor` §4): `NEEDS_CONTEXT` gets exactly one
re-dispatch with the answer, and a second occurrence counts as `UNABLE`; `UNABLE` is never
treated as success. Add a verdict line to the PR body template in
`skills/task-deliver/SKILL.md`, filled from the spec's "Critic Verdict & Overrides" section,
so the promise `task-start` makes — that a skipped critic surfaces in the PR — finally has a
carrier. The `spec`-tool tightening of that section moves to Phase 2 so the DoR changes land
once.

**WP1.2 — receiving-review protocol (S).** In `skills/pr-resolve/SKILL.md`, insert a
re-grounding step between fetching threads and classifying: open the cited location with
enough surrounding context to judge the finding. Add a fifth class, "unfounded", whose route
is to leave the code unchanged, reply with a file-and-line refutation, and leave the thread
open. Add the rule that when one comment is not understood, none are applied, because review
comments are frequently interdependent. Mirror both changes in `task-implement` 6F and in
`agents/marvin-tm-review-fixer.md`, which declares itself the same contract.

**WP1.3 — one named fix-cycle protocol (S).** Add a "Fix-cycle protocol" section to
`skills/task-implement/SKILL.md` and replace the six scattered "up to 2 retries" mentions
with references to it by section name. Rounds 1–2 retry the same path with the feedback
verbatim. Round 3 changes the conditions: a stalled fix or a surviving blocker goes to
`marvin-debugger` with a fresh context that receives only the failure output, the spec path,
and the diff range, with an explicit ban on passing the history of failed attempts. At the
limit, every open item is recorded as either "deferred, with rationale" or "blocked, with
cause" in the PR self-review section; silent dropping is banned. `marvin-tm-executor.md`
keeps its own condensed copy, because the agent runs standalone and `skills/...` paths do
not resolve from an agent body.

**WP1.4 — sec-scan fan-out (S).** Replace the inline OWASP walk in `skills/sec-scan/SKILL.md`
phase 3 with three `marvin-auditor` dispatches sent in one response, modeled on the dispatch
pattern in `refactor-audit/SKILL.md`: pass the detected stack, file scope, and focus areas,
require output shaped as `Finding` fields from `contracts/audit.ts`, and require spot
re-verification of cited locations before accepting a finding. Keep the inline walk as the
fallback when the Task tool is unavailable. Add a consolidation phase modeled on
`refactor-audit` phase 4 (merge on matching location and substance, take the higher severity
on disagreement, and render the lens-by-severity matrix that exposes a lens that found
nothing). In `agents/marvin-auditor.md`, add the executor-mode constraints that
`marvin-refactor-auditor` already has and this agent lacks: enumerated read-only commands, a
write ban, and the untrusted-input caveat.

**WP1.5 — real scanners as verify gates (XS).** Document in `docs/configuration.md`,
`skills/sec-gate/SKILL.md`, and `skills/task-verify/SKILL.md` that `.marvin/config.json`'s
existing `gates` block (ADR-0009) accepts `npm audit --audit-level=high`,
`gitleaks detect`, or `semgrep --config auto` as ordinary gates. A missing binary must
produce `not-run` with a reason, never a failure. This is the cheapest deterministic win in
the plan and lands before the hooks phase, not instead of it: hooks close the bypass,
gates close the content.

## Phase 2 — Entry boundary and Definition-of-Ready

Give the pipeline a routed entrance and a bounded intake. Ships as one minor (≈ 0.13.0),
because both work packages touch the DoR surface and existing specs should be re-validated
against the new checks once, not twice.

**WP2.1 — entry router and deferred slices (M).** Insert "Step 0 — Routing" into
`skills/task-start/SKILL.md` before intake, using only cheap evidence: the request text,
`git status --short`, `git log --oneline -3`, and the spec-directory listings. Four paths: A
(a spec already exists — hand over to `task-implement`), B (no spec needed — route to
`/marvin:commit`, `/marvin:track-new`, `/marvin:debug`, or `refactor-*` and stop), C (one
coherent spec), D (multi-deliverable work — apply the one-PR test and slice). Paths C and D
require explicit user confirmation with a one-line rationale, and with thin evidence the
default is C: the router may not refuse work. Add
`skills/task-start/references/routing.md` with the operational test, the anti-heuristics
(never count verbs, conjunctions, or noun phrases), and three or four worked examples from
this repository's own history. Rewrite step 4.5F from a silent "Future Considerations" note
into a stop with a choice between slicing and keeping scope. Deferred slices become board
cards through the `task` tool (`action: "create"` with explicit `type` and `title`,
answering no to the branch-switch question); their ids land in a new "Deferred slices"
template section that is deliberately not added to the `spec` tool's section lists. Add a
size check to the end of the bugfix flow (step 5B), which today has none.

**WP2.2 — bounded intake and mandatory assumptions (M).** In `task-start` step 1.4, cap the
dialogue at six questions for a feature and four for a bugfix, with a priority order (scope
and boundaries, security and data, interface and contract, the rest). Name the sweep rows
that are not questions at all and are answered by reading the repository: reverse
dependencies by grep, merge obligations from CLAUDE.md, the test environment from CI
configuration. Publish the do-not-ask list with the default each item assumes, in the form
"assumes the pattern in `<file>`". Require every accepted default to be recorded in
`## Assumptions` as "assumed X because Y; correct now if wrong". Allow up to three numbered
independent questions per turn with a short-form answer protocol, editing both
"one question at a time" lines, not one. In `tools/spec.ts`, add content-form validation for
the `assumptions` and `critic verdict overrides` sections (a verdict token or the literal
`none`; assumptions present, with a warning when the content reduces to "none"). Keep both
sections at the warning tier for now and schedule promotion to the rejecting `required` tier
for the next declared breaking release (decision D5), because the CLAUDE.md semver table
classifies a validation break as major. Replace the multi-line stub in the feature template
with a single-line one, since the placeholder regex does not cross line breaks.

## Phase 3 — Toolkit governance

Make the invariants CLAUDE.md asserts machine-checked, and lower the cost of the first
session. Ships as a minor (≈ 0.14.0) because of the new prompt.

**WP3.1 — `scripts/lint-skills.mjs` (M).** A new linter beside `lint-manifests`, wired as a
blocking CI step, with these checks: closed allowlists of frontmatter keys (skills
`{name, description, disable-model-invocation}`, agents `{name, description, model, color,
tools}`, commands `{description}`) where any extra key is a hard failure; `name` equals the
directory name; `description` is non-empty and at most 1024 characters; every
`skills/<x>/...` path named in a command body exists on disk; `skills/...` references in
skill and agent bodies resolve; an agent without a `tools:` allowlist must be on an explicit
whitelist; dataset `disable_model_invocation` fields stay in parity with skill frontmatter
(the third mirror, currently correct and unguarded); and the set of prompts without
`commands/*.md` wrappers is pinned, with the `lessons` / `dashboard` / `reports` asymmetry
resolved by decision D3 and recorded against ADR-0018. Prompt resolution itself is not
re-checked here, because `scripts/smoke-commands.mjs` already proves it against a live
server. Apply C4.

**WP3.2 — `/marvin:onboard` (M).** A first-session walkthrough skill: inspect state, run
`/marvin:help`, disclose the local `.marvin/usage/events.jsonl` log and offer
`usage: {enabled: false}`, find three or four genuine starter tasks with file and line,
let the user pick one, drive it through `/marvin:track-new` and `/marvin:commit`, show the
board and the `.marvin/` tree, and end with exactly one next command. The body must not use
relative `Read docs/...` paths, which do not resolve through the MCP door. Apply C1 in
full, including the `onboard.json` trigger dataset that the WP0.1 lint rule now demands.
Rewrite the head of `docs/getting-started.md` around it.

**WP3.3 — usage-surface measurement (S).** A read-only `scripts/usage-surface.mjs` that
compares the declared prompt registry against the distinct names actually invoked in
`.marvin/usage/events.jsonl` and prints the never-invoked surface with ages. The decommission
decisions the data enables are deliberately out of scope here and parked as backlog; the
script only makes the dead surface visible. Folding the digest into the `dashboard` tool is
a later option once the script proves useful.

## Phase 4 — Runtime enforcement

Introduce the one mechanism a model cannot reason its way around. Ships as a minor
(≈ 0.15.0) after its ADR is accepted.

**WP4.0 — ADR first (S).** Hooks are a consent change: nothing marvin ships today affects a
session before a call, while a plugin hook fires in every project of every user from the
moment of installation, including this repository's own live symlink install. The ADR must
fix four things: that consent model; the hard fail-open contract (any internal error in a
hook script must exit 0 — a broken hook that returns non-zero breaks every Bash call in
every user project); the kill switch `hooks.enabled` in `.marvin/config.json` following the
ADR-0030 pattern, with an environment variable as a one-shot override; and an explicit
accept-or-reject decision on the `SessionStart` / `UserPromptSubmit` policy-loader idea
(decision D4), which belongs to the same consent surface. Apply C3.

**WP4.1 — two blocking hooks (M).** `plugins/marvin/hooks/hooks.json` plus two scripts
addressed via `${CLAUDE_PLUGIN_ROOT}`. Hook A (`PreToolUse`, matcher `Bash`) blocks
`--no-verify` and `-n` only as standalone arguments of `git commit` / `git merge` after
stripping quoted strings, and blocks force-pushes to the base branch read from
`.marvin/config.json`. Hook B scans the added lines of a pending commit against a
high-confidence secret-pattern list, handling `git commit -a` and explicit pathspecs, since
otherwise the index is empty at `PreToolUse` time and the scan sees nothing. Both scripts
open with a cheap prefix check and return 0 on the vast majority of calls. Regression
fixtures with exact expected exit codes live in the root `test/` tree, never inside the
plugin, because a fixture with a fake key would otherwise be installed into every user's
plugin directory. `lint-manifests` gains a check that the hook commands are executable. The
pattern list is canonical in the script and referenced from `skills/sec-gate/SKILL.md`, with
a consistency test between the two. Update the file-kind taxonomy in `docs/architecture.md`
and the instrument-types section of CLAUDE.md. Apply C4.

## Phase 5 — Evidence provenance and oracle execution

Bind proofs to the code state they prove, and execute the oracle graph the DoR gate already
validates. This is the largest server work in the plan; both work packages share one change
to the `verify-result` block so its schema is versioned once. Ships as a minor (≈ 0.16.0)
after its ADR.

**WP5.1 — parser unification (S, first).** Extract the `verify-result` block parsing into
one module and delete the three regex copies in `verify.ts`, `summary.ts`, and
`lib/reports.ts`. A pure refactor with tests, done before the schema changes underneath.

**WP5.2 — provenance (L).** A `Provenance` contract (`head_sha`, `branch`, `dirty`,
`worktree_digest`, `generated_at`) collected through the existing `lib/git.ts` helpers and
failing open: any git error yields nulls, never an exception. The decisive field is
`worktree_digest` — a truncated `sha256` over `git diff HEAD` plus a hash of untracked
files — because in marvin's own process both verification and the delivery gate run on a
dirty tree before the commit, so `head_sha` and `dirty` are identical before and after an
edit and would almost never catch staleness. Runs are written to
`.marvin/task/runs/<slug>.md` with the global `verification.md` kept as the fallback;
`action: "gate"` accepts a `specSlug` and prefers the per-spec run. The gate's `decision`
stays two-valued (`ALLOW | BLOCK`), because `task-deliver` branches exactly two ways; a
sibling typed field `staleness: fresh | stale | unknown` carries the freshness verdict, a
missing provenance block (old artifact, not a git repository) is always `unknown` and always
`ALLOW`, and an `allowStale` input records its use in the reason text. Apply C2 if the
shared contracts move.

**WP5.3 — oracle execution and red-green (L).** Add an optional `run: <command>` field to
the `Oracle` schema in `storage/spec.ts`. Do not infer single-test invocations from
`test_command` plus a `path::name` reference: test-runner filter syntax varies more finely
than any stack table, and this repository's own `npm test` fans out to three workspaces with
two different runners. Resolve the command in ADR-0009 order — the call argument, then
`gates.test_one` from `.marvin/config.json` with substitutions, then a narrow default table
for unambiguous stacks — and otherwise record `not-run` with a reason, never a guess. Add
`verify action: "oracles"` with `specPath`, `only`, and `expect: pass|fail`, appending to
`.marvin/task/oracles.md` (not to `verification.md`, which is rewritten whole), keyed by
spec, `contract_sha`, and criterion id, and carrying the test-file content hash plus
`head_sha` at the red phase. Red counts as proven only on a clean non-zero exit with the
test file existing; a launch failure or a signal kill is not a red phase. `deliverGate`
blocks a bugfix when a criterion marked `regression: true` lacks a red-then-green pair at
the current `contract_sha` with an unchanged test file. In `summary.ts`, replace the
`unknown` fallback with the recorded outcome, and do not extend the `AcOutcome` enum, which
the widget and its pinned baselines depend on. Ship the gate as a warning first and promote
it to blocking after measuring the command-resolution success rate. The ADR extends
ADR-0015: the spec becomes a fourth command-execution surface, mitigated by the fact that
the contract is sealed by hash, so tampering is detectable. Apply C3.

## Phase 6 — Spec corpus mechanics and resumability

Apply the doctrine to the last large area where the model does mechanical work by hand.
Ships as a minor (≈ 0.17.0); WP6.2 depends on WP6.1.

**WP6.1 — corpus mechanics (L).** In `storage/spec.ts`, add `resolveSpecDir` (modeled on
`resolveAdrDir`), `readSpecCorpus` (skipping symlinks), and `nextSpecNumber`. In
`tools/spec.ts`, widen the schema to `action: dor|seal|scope|next|list`, keeping `mode` as a
deprecated synonym so no shipped SKILL.md breaks. Put the status-transition check on `seal`,
not on `dor` — `dor` is only ever called by `task-start`, which always writes
`status: ready`, while `seal` is the true pre-execution check — and reject `shipped` and
`superseded` there. Make `specDigest` in `lib/state.ts` use the adaptive directory;
leave `report.ts` alone, since it is contractually scoped to `.marvin/`. Rewrite steps
9F/9B and `task-implement` step 1 to call the tool instead of describing the arithmetic.
Amend ADR-0022 via a successor note per C3, since its premise was already invalidated by
ADR-0027.

**WP6.2 — resumability (L).** Give `spec` a `progress` action appending to
`.marvin/task/runs/<slug>.progress.md`, a separate file from the verification report; the
`spec` tool owns criterion identity, and `verify` stays ignorant of specs per ADR-0002. In
`task-start`, move directory selection, slug-collision checking, and number allocation
forward to step 1.5, write a draft with `status: draft`, and append each resolved answer to
its section as intake proceeds; the step-9 collision check must then skip the file it
created itself. In `task-implement` step 1, add a resume fork that degrades loudly: with no
journal, say so and verify everything from scratch; with one, show the recorded state and
offer resume or archive. The absence of a journal is never read as "nothing was done". A
side benefit is that `task-implement` already refuses drafts, so a half-written spec cannot
be executed.

**WP6.3 — `/marvin:task-audit` (M).** A `spec action: "audit"` returning typed findings
modeled on `adr audit` — duplicate numbers, numbering holes, slug collisions, dangling
`depends_on`, missing seals, and `in-progress` specs whose branch has merged — plus the
command surface. Apply C1 in full.

## Phase 7 — Finding identity and critic receipts

Give findings a durable identity and the critics a typed artifact. Ships as a minor
(≈ 0.18.0); WP7.2 builds on the Phase 1 vocabulary.

**WP7.1 — fingerprints, triage, and one severity rubric (L).** Extend `ReportFinding` in
`contracts/report.ts` — not `Finding` in `audit.ts`, where a new required field would
invalidate every report already on disk — with `fingerprint`, `firstSeen`, and `state`,
computed by the server, never by the model. Fingerprint over kind, normalized path,
category, and title slug, deliberately excluding line numbers. Add merge logic in
`lib/reports.ts`, remembering its deliberate runtime mirror makes every contract edit a
double edit. Add `report action: "triage"` with a separate `snapshot` flag, because the
tool is widget-bound and an always-writing reconciliation would let merely opening the
widget consume the baseline. Store the baseline in `.marvin/report/triage.json` with a
self-ignoring `.gitignore` and an environment-variable path override. Add the
`audit-report` block to `sec-gate` and `sec-fix` only inside their existing
"if the user asks to persist" branch, preserving ADR-0007. Publish one severity rubric with
anchored examples as `skills/sec-scan/references/severity-rubric.md` and reference it from
both scanner families and both auditor agents, replacing the four anchor-free
"severity is contextual" lines. Apply C2.

**WP7.2 — typed critic receipts (L).** Add `contracts/critique.ts` with the two verdict
axes (spec compliance and quality), re-export it from `contracts/index.ts`, add the runtime
mirror and `parseCritiqueBlock` beside `parseAuditBlock`, and have both critics end with a
` ```json critic-verdict ` block. The calling session writes the receipt to a new
`.marvin/critique/<NNN>-<slug>.md` group — `.marvin/task/` is taken, since three
independent readers classify any file there other than `verification.md` as a spec — which
requires extending `ReportGroup`, `GROUP_ORDER`, the CLAUDE.md working-directory table, and
the docs (C2, C3). The receipt is displayed in the summary and the PR body; it does not
become a `deliverGate` veto, which would require an ADR overturning ADR-0017 and would make
the audited party the author of its own audit record. Enforcement stays where prose already
puts it: the PR opens as a draft.

## Ordering constraints

| Constraint | Reason |
| --- | --- |
| WP2.1 and WP2.2 ship in one minor | Both touch the DoR surface; existing specs re-validate once |
| WP5.2 and WP5.3 share the `verify-result` schema change | The block is versioned once, not twice |
| WP6.2 follows WP6.1 | The resume fork relies on corpus resolution and enumeration |
| WP7.2 follows WP1.1 | Vocabulary and PR carrier first, the typed record second |
| WP4.1 follows WP4.0 | Hooks are a consent change and need their ADR accepted first |
| WP3.2 follows WP0.1 | The new skill must ship with the dataset the lint rule demands |

## Open decisions

| Id | Question | Recommendation |
| --- | --- | --- |
| D1 | `marvin-tm-executor` lost its caller when `dispatch.sh` was deleted: restore a dispatch script, or re-scope the agent as Task-tool-only? | Re-point the prose now (WP0.3); decide restoration separately, outside this plan |
| D2 | `.marvin/research-results/`: register the directory or redirect `marvin-researcher` to an existing group? | Register in CLAUDE.md and docs now; `report`-tool ingestion in Phase 7 |
| D3 | `lessons`, `dashboard`, `reports` have no `commands/*.md` wrappers while equivalent thin wrappers do | Add the three wrappers for uniformity; cheap, and removes the pinned-set special case |
| D4 | A `SessionStart` / `UserPromptSubmit` policy loader as an addressed alternative to an always-loaded constitution file | Decide inside the Phase 4 ADR; same consent surface as the blocking hooks |
| D5 | When do the warned DoR sections (`assumptions`, `critic verdict overrides`) become rejecting? | At the next declared breaking release, recorded in the Phase 2 CHANGELOG entry |

## Backlog, deliberately unscheduled

- A decommission pass over the never-invoked surface once WP3.3 produces data; the plan adds
  two commands and should be balanced by evidence-based removal, not by guesses.
- A positive-mechanism review of the three corpus systems the comparison under-covered:
  spec-workflow-mcp (absent entirely), SuperClaude (only used as a negative lesson), and a
  structural slot for OpenSpec beyond the rejected delta model.
- Folding the WP3.3 digest into the `dashboard` tool if the standalone script proves useful.
