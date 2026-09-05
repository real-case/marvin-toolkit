# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

## [0.23.1] — 2026-09-05

### Fixed

- **A `stack` hint no longer forces gates the project cannot run.** `verify` accepts a `stack` id to
  skip re-detection in a chained call, and `/marvin:task-implement` passes one straight from the
  spec's frontmatter. The hint bypassed the named detector's own precondition, so a workspace repo
  that keeps its `tsconfig.json` files per package — with no root one — was handed the TypeScript
  table and ran `npx tsc --noEmit` from the root. tsc printed its usage text and exited 1, failing
  the whole verification on a clean tree for a reason unrelated to the change under test, and
  blocking `/marvin:task-deliver`. A hint is now honoured only when its detector actually matches
  the project; a mismatched hint is ignored and normal detection runs, exactly as an unrecognised
  one already was. A project whose detector does match is unaffected.

## [0.23.0] — 2026-09-04

A metrics record stopped depending on a session issuing a prose-instructed call. The two gates the
pipeline must call now write it, so the coverage number the series reports says something about the
pipeline rather than about whether a skill's instruction was followed. Recorded as ADR-0044.

### Changed

- **The seal gate creates the task's metrics record.** `spec action: "seal"` — the mandatory
  pre-execution gate of `/marvin:task-implement` — creates `.marvin/metrics/<NNN>-<slug>.md` with
  its header and nothing else, so a run that reaches execution has a record before it has anything
  to put in it and a run abandoned afterwards is visible in the series rather than absent from it.
  Four conditions, each a defect it would otherwise have: the spec was READ FROM DISK (both input
  keys may legally arrive together, and the inline fragment then wins while `specPath` stays truthy);
  a slug resolves, frontmatter first, else the filename; that slug is kebab-case, which also makes
  the step-1.5 skeleton unreachable rather than merely forbidden, since an unfilled template still
  carries `{kebab-case-slug}`; and the verdict is not FAIL, so a `shipped` or `superseded` spec mints
  nothing. The write is fail-open and cannot reach the verdict.
- **The delivery gate writes the terminal block, on ALLOW only.** `verify action: "gate"` derives the
  ` ```json task-metrics ` block and appends it beside its answer, under the same `if (slug)` that
  already writes the verification-run journal. A BLOCK writes nothing: `rolled_up` is what coverage
  reads as tasks shipped, so a block for a refused attempt would overstate what was delivered, and
  refusals stay visible in the verification-run journal. The answer's markdown gains one
  deterministic line naming the record — a path and a boolean, no count and no timestamp — which is
  what keeps the `.gitignore` warning reachable for host projects. It never travels through `reason`,
  which `gateResult` serialises into the `deliver-gate` block that `critique-protocol.test.mjs` pins.
- **`/marvin:task-deliver` step 1.5 is now a relay.** It reads the record back with the `metrics`
  tool's `series` action and reports the digest instead of writing one; a second append would put two
  terminal blocks in the record for one delivery. Step 1 also stops passing `specSlug` "when a spec
  slug is known" and passes it whenever a spec exists, since the slug now decides whether the task is
  measured at all.
- **`marvin-tm-executor` §5.0 keeps its own roll-up, and says why.** That agent never calls the
  delivery gate — it runs `verify` in `mode: feature` and opens its own pull request — so it is the
  only writer of a headless run's terminal block. The asymmetry is deliberate and asserted, so an
  edit that tidies the two into agreement goes red instead of silently leaving headless tasks
  unmeasured.
- **The one-writer invariant moved from the tool to the storage module.** `recordPathFor` left
  `tools/metrics.ts` for a new `lib/metrics-record.ts`, which owns the rule that decides a record's
  filename and is now reached by all three callers; two copies of that rule would give one task two
  record files that no reader joins. The module deliberately does not own fail-open behaviour — each
  caller keeps its own `try/catch`, as `journalVerifyEntry` does, so one anchor's failure cannot
  decide another's.

### Added

- **`empty` in `MetricsSeriesCoverage` and `MetricsSummary`** — records holding neither a terminal
  block nor an event. The seal anchor makes that state expressible, and without the bucket such a
  record counted in `records` and vanished from the breakdown. On the dashboard it sits beside the
  record total, because a bare count would otherwise read as "tasks measured" while counting files
  nothing has written to. The difference between `records` and `rolled_up` is now the count of runs
  that started and did not deliver — a number the series could not previously express.

## [0.22.0] — 2026-09-03

Phase 3 of the task-metrics plan, WP5: the series becomes readable. The prompt count moves from
55 to 56. With this landing every package of `docs/proposals/task-metrics.md` is implemented.

### Added

- **`metrics action: "series"`** reads every record under `.marvin/metrics/`, takes each record's
  last terminal block, and aggregates the three groups — count, median, mean and maximum per
  metric — computed only over the records where the field is present, so an absent source is never
  counted as zero and `n` says how many tasks contributed. It reports coverage — how many shipped
  specs have a record — which is the number that says whether the series can be trusted yet.
  `type` (`feature` or `bugfix`) and `since` (a date) narrow it; `slug` renders one record in full.
  The answer carries a ` ```json metrics-series ` block (`MetricsSeries` in `contracts/metrics.ts`).
- **Q11 and Q12 are computed there, at query time, and never stored** (plan D7). Q11 resolves the
  pull-request URL from the spec's `## Delivery` section and counts the PR's commits dated after it
  opened through `gh api`; it is null without `gh`, without a URL, or on any error, and never
  blocks the rest of the report. Q12 joins the shipped corpus: each shipped bugfix credits the
  earlier shipped specs whose contract `files[].path` intersect its own with one escaped defect.
- **`/marvin:task-metrics`**, an inline-body prompt in the shape of `task-summary`, with a
  `commands/task-metrics.md` wrapper and its four help-content records.
- **The dashboard's `metrics` section**, after `lessons`: record and roll-up counts, the newest
  record, the median active time and spec gaps per task, or a zero-state line naming the command
  that writes the first record. `DashboardState` gains `metrics` as an optional, additive field;
  the widget and the site's embeds are untouched until a later pass renders it.

## [0.21.0] — 2026-09-03

Phase 2 of the task-metrics plan: WP2 and WP3 together, as the proposal requires. The pipeline
gains a place to record what compaction otherwise destroys, the prose sites that lose it now write
it, and delivery derives the terminal block from the artifacts already on disk. The tool count
moves from 13 to 14.

### Added

- **The `metrics` tool**, the fourteenth, and the one writer of `.marvin/metrics/` (ADR-0043). Its
  input is `.strict()`, like `spec` and `report`, so a mistyped key is an error rather than an event
  recorded without a field. `action: "record"` appends one live ` ```json metric-event ` block — six
  kinds: `fix-round` (loop + round), `spec-gap` (detail), `open-item` (classification + detail),
  `critic-dispatch` (critic + pass), `critic-verdict` (critic + pass + verdict + blockers +
  warnings) and `gate-call` (gate + call + verdict) — each validated fail-closed on its own required
  fields, so a half-written event is refused rather than counted. `action: "rollup"` derives the
  terminal ` ```json task-metrics ` block from the spec, the progress, oracle and verification-run
  journals, the `verify-result` block, the critique receipts and git, and appends it; every metric
  is nullable, null means the source was absent and never zero, and a `sources` map names which of
  the eight inputs was on disk. A second delivery appends a second block and readers take the last.
  The answer also says whether git ignores the record, so a host project with a blanket `.marvin/`
  exclusion learns at the first roll-up that its series is not being committed.
- **The record is named after the spec's own file** — `.marvin/metrics/<NNN>-<slug>.md`, or
  `<slug>.md` for a spec that lives unnumbered in a host directory or for an event `task-start`
  records against a draft. Nothing is allocated, two parallel branches cannot mint the same number,
  and both directions of the join are a filename lookup.
- **The `TaskMetrics` and `MetricEvent` contracts** in `packages/marvin-mcp-shared/src/contracts/metrics.ts`,
  with the plain field names of the plan's derivation table (`intake_ms`, `scope_drift`, `reseals`,
  …). The server keeps a runtime mirror of the event vocabulary in `storage/metrics.ts`, and a test
  compiles both and asserts they agree.
- **`MARVIN_METRICS_DIR`** repoints the directory, chiefly for test isolation. No self-written
  `.gitignore`: this is a shared record, and ignoring it is a project's choice.

### Changed

- **The pipeline prose records the live events.** `task-start` records every DoR gate call (7F/7B,
  and each re-run the sweep prescribes) and every spec-critic dispatch and terminal verdict (8F/8B)
  with its pass number; `task-implement` records the diff-critic dispatch and verdict (6F/9B), every
  fix-cycle round with its loop, every item deferred or blocked at a limit, and every SPEC GAP,
  including Step 6B's regression test that passes on unfixed code; `marvin-tm-executor` records the
  same events under its own `source`. Each site says why: compaction destroys the in-session count,
  and the call costs one tool round-trip.
- **`task-deliver` rolls the metrics up in a new step 1.5**, after the delivery gate allows and
  before the commit, so the record ships in the same commit and pull request as the work; step 2
  stages it, and step 6 lists it among the artifacts to preserve. The executor does the same in a
  new §5.0. The roll-up is a record, never a gate — an unavailable tool is reported and skipped.
- **`changedFilesForScope` moved from `tools/spec.ts` into `lib/git.ts`** so the scope gate and the
  metrics roll-up's scope-drift metric judge the same file set; the gate's behaviour is unchanged.

## [0.20.0] — 2026-09-03

Phase 1 of the task-metrics plan (`docs/proposals/task-metrics-implementation-plan.md`). The
design of the whole series is stated in ADR-0043 before any metrics record exists, and the one
record the pipeline destroyed by design — the verification run — is journalled, so the two metrics
that need it are present from the first record in the series rather than absent for its head.

### Added

- **The verification-run journal** `.marvin/task/runs/<slug>.verify.md`, the third `runs/` sibling
  beside the oracle and progress journals. Every verification run overwrites `runs/<slug>.md`, so
  how many attempts preceded the surviving one was unrecoverable, and the delivery gate persisted
  nothing at all. The journal is append-only, one ` ```json verify-run ` block per entry, with two
  entry kinds under one tag: `run` — appended after every per-spec run `verify` writes, carrying the
  verdict, mode, execution, the `only` subset or null (so a targeted retry is distinguishable from a
  full pass), every gate's status and duration, the wall-clock and summed-gate durations and the
  `head_sha` proved — and `gate`, appended on every delivery-gate decision for a resolved slug
  (decision, verdict, staleness, `allowStale`, `red_green`, the artifact judged), a BLOCK for a
  missing artifact included. Both writes are fail-open: a throw is swallowed and never changes a
  verdict or a decision, and `runs/<slug>.md` stays the latest run so the delivery gate is unchanged.
- **ADR-0043** (`proposed`): `.marvin/metrics/` is a committed per-task series named after the spec
  file, holding live `metric-event` blocks and a terminal `task-metrics` block derived at delivery;
  the verification-run journal above; the boundary with the progress journal; metrics are not a
  report group; and the warning below. Amends ADR-0007 through its Related row, as ADR-0039 did.

### Changed

- **A pipeline `verify` run that names no spec warns.** A run in `feature` or `bug` mode with no
  `specSlug` records a warning saying that no per-spec run was written, that the delivery gate will
  judge the global artifact, and that the metrics series will not see this run. Warnings already
  degrade PASS to PASS WITH WARNINGS, and `/marvin:task-deliver` already surfaces that verdict for
  confirmation, so the coverage gap reaches the user when it happens and no other surface changes.
  A `standalone` run — the default when no `mode` is passed — keeps no warning, because it
  legitimately has no spec. This answers the proposal's first open question.

## [0.19.0] — 2026-09-03

An instrumented end-to-end run of the pipeline (one feature task, 74.8 minutes) put **67% of the
wall clock inside the two critic agents**, and 97% of *that* into generating their reports rather
than investigating: 211 tool calls, 79.6 seconds of execution, 3,026 seconds of wall clock. This
release attacks the cost without changing what is checked. Recorded as ADR-0042.

### Changed

- **Both critics carry a countable output budget.** Blockers and per-criterion coverage are never
  truncated; warnings cap at 5, out-of-scope lines at 10, confirmations at 3, one line each, with
  overflow stated as a count. One line per finding, `file:line` instead of pasted code, nothing
  outside the template, a 400-word target, and tighter caps on a stated re-dispatch. The spec
  critic's "Questions for the author" section is gone — a question that would change the verdict is
  a blocker, one that would not is a warning.
- **`/marvin:task-start`'s critic loop is bounded to two dispatches** — it had no limit at all,
  while `/marvin:task-implement` has had a three-round fix-cycle budget for months. The measured run
  spent four dispatches and 34.8 minutes there, and half the blockers of the third and fourth were
  introduced by the previous round's own fix. A second `BLOCK` now stops
  dispatching and hands the survivors to the user as a revision or a recorded override. A
  deterministic sweep — re-run the gate, cross-check the spec's declared gates against the project's
  real CI jobs, re-read each shell snippet for its exit code, re-check the repaired defect class
  elsewhere in the contract — runs before every dispatch.
- **Verification runs before review, not beside it** (`task-implement` Step 6F / Step 9B,
  `marvin-tm-executor` §3). The critic is dispatched once, against a green tree. This reverses P2 of
  `docs/proposals/task-workflow-latency-optimization.md`: the overlap saved 76 seconds and cost the
  393-second re-review that the stale-review guard mandates when a verify fix moves the tree under
  the critic. The guard becomes a stale-*verify* guard — any change after the green run, including
  one made for a critic blocker, needs the affected gate re-run and a final full pass.
- **The diff critic is no longer dispatched blind to new files.** It now receives
  `git status --porcelain --untracked-files=all` beside `git diff`, and its own workflow enumerates
  and reads untracked paths. A feature spec is mostly `action: new` rows: in the measured run the
  prescribed diff carried 4 of the 17 contract files.
- **`/marvin:task-implement` reads the host project's own skills.** Step 3 now globs
  `.claude/skills/*/SKILL.md` and reads the (at most three) closest matches for the contract's file
  paths. The measured run lost a 393-second review round to two `aria-label` attributes the
  project's own skill forbids; reading it would have cost two seconds.
- **The feature pipeline records its acceptance oracles.** `verify action: "oracles"` was reachable
  only from the bugfix red/green steps, so a feature shipped with no per-criterion proof beyond a
  green suite. Nine oracles ran in 16 seconds against 343 for the gates.
- **A fix-cycle round re-runs the narrowest thing that proves the fix** — `gates.test_one` or a
  single criterion's oracle — and never a full `verify`, which is the pre-delivery confirmation
  rather than the loop's feedback channel.

### Added

- **The DoR gate transposes the traceability graph.** A new `graph-symmetry` check in `spec`
  `action: "dor"` compares `criteria[].implemented_by` against `files[].satisfies` in both
  directions and FAILs on disagreement — one relation stored twice, previously validated one side
  at a time, so a criterion could name a file that denied it and both checks passed. A row that
  declares no `satisfies` is exempt: an absent index is not a contradicting one. The shipped
  feature template was itself asymmetric and is corrected, with a fence that runs the shipped
  checker over both templates.

### Fixed

- **A failing gate's excerpt names the file that failed.** `verify` showed the last twelve lines of
  output; for any linter that prints warnings after errors those are the wrong twelve — the measured
  run's lint failure rendered a pre-existing warning in an untouched file while all five real errors
  scrolled past. The excerpt now leads with the matched error lines and their count. Lines carrying a
  success marker are removed before matching, and the last three lines are kept whatever matched: a
  runner states its verdict in its final lines, and those carry no error token at all
  (`AssertionError [ERR_ASSERTION]` matches none of the patterns), so leading with matches alone
  reproduced the same defect in the test gate.

## [0.18.1] — 2026-08-18

### Changed

- **A host that renders widgets no longer also prints the panel as markdown.** Nine of marvin's
  tools bind a `ui://` widget. On a client that advertises the MCP Apps UI extension the host drew
  the widget *and* the model rebuilt the same panel in text, so the user saw one dashboard twice.
  A widget-bound tool's result is now gated on the calling client's advertised capabilities: such a
  client receives a one-line digest naming the widget, plus a `_rendered` key in the payload telling
  the model the content is already on screen. A client that advertises nothing — every terminal,
  `widget-preview`, the test driver, `mcp-call.mjs` — receives byte-identical output, exactly as
  before.
- The decision is taken once, in the shared `registerTool`, rather than in each of the nine tools,
  so a tenth widget-bound tool inherits it. It is declined whole when the tool binds no widget, the
  result carries no payload, the result is an error, or the payload already owns a `_rendered` key,
  and it never alters `isError`. Recorded as ADR-0041 (`proposed`), which narrows ADR-0024's
  progressive-enhancement decision rather than superseding it.

## [0.18.0] — 2026-08-16

WP4.1, and the last work package of the workflow-hardening plan
(`docs/proposals/workflow-hardening.md`). Marvin gains the one mechanism a model cannot reason
its way around: a guard the host runs **before** the call, rather than prose a model reads or a
tool a model chooses. ADR-0040 binds it and was ratified before any of it was written.

### Added

- **Two blocking `PreToolUse` guards on `Bash`**, in `plugins/marvin/hooks/`. Hook A refuses
  `--no-verify` and `-n` as standalone arguments of `git commit` / `git merge`, and refuses a
  force-push or branch deletion aimed at a protected ref. Hook B scans the added lines of the
  commit a call is about to create against a high-confidence secret list, resolving what
  "pending" means rather than reading the index alone — at `PreToolUse` time the index is
  frequently empty, so `git commit -a` widens to unstaged tracked changes and a pathspec to
  those paths. A hook reading only `git diff --cached` would pass every `git commit -am` while
  appearing to work.
- **The protected set is a three-input union** — `base_branch` from the config, the `origin/HEAD`
  default, and a shipped list of conventional names. In this repository the first two both
  resolve to `main`, so `dev` — the branch ADR-0019 designates and every PR in this plan targets
  — is protected only because of the third. ADR-0040 recorded that gap as an open question; this
  is the answer.
- **A kill switch a separate process can actually read**: `hooks.enabled` in
  `.marvin/config.json`, via an independent raw-JSON reader, plus `MARVIN_HOOKS_DISABLED=1` for
  one session. Absent, unreadable, malformed, no `hooks` block, or an unrecognised key under
  `hooks` all leave the guards **enabled** — only an explicit `false` disables. The reader
  ignores `MARVIN_TASKS_CONFIG`: that variable scopes to the server, and honouring it would let
  a test-isolation affordance decide what a blocking guard reads.
- **Disclosure on four install-facing surfaces** — both READMEs, `docs/configuration.md`, and
  both manifest descriptions — each stating that marvin can refuse a shell command, which ones,
  and both ways to turn it off. A skills-directory plugin is enabled by default with no install
  step, which ADR-0040 established by probe, so the disclosure is the only consent surface there
  is.

### Fixed

Every defect found in review was a **false denial** — the direction that breaks a release rather
than skipping a check — and each was found by spawning the shipped guard, not by reading it:

- **A mention became a denial.** The subcommand was located anywhere in a segment, so
  `echo git push --force origin main` and a comment line reached exit 2. The git token must now
  be the segment's first, after leading environment assignments only.
- **A heredoc body was cut into segments.** A delimiter word closes its own quotes before the
  newline, so `cat > doc.md <<'EOF'` split every body line into a command — and a document whose
  text contained `git push --force` was refused.
- **An attached option value was read as flag letters.** `git commit -uno` is
  `--untracked-files=no`, which git accepts and the guard refused. A bundle's letters are now
  read left to right and the read stops at the first letter that is not a known no-argument short
  flag for that subcommand.
- **`-C <dir>` was parsed and discarded**, so the protected set resolved in the wrong repository
  — and, because the unresolved case fell back to the current branch, produced a wrong deny.
- **`--all` / `--mirror` denied where nothing was protected**, naming four branches that did not
  exist in that repository.
- **`refs/heads/<name>` was not recognised as a refspec**, an asymmetry inside one module: the
  guard both missed the protected target and refused an unprotected one.
- **Three secret patterns matched kebab-case identifiers.** `sk-` admitted `-` in the body, so
  `sk-workflow-latency-optimization` matched inside `task-workflow-latency-optimization` — a
  string in this repository's own ADRs. AWS's documented example key is exempted by name rather
  than by editing the fixture that carries it, because a guard that refuses a well-known example
  string will keep surprising people.
- **A dry run was scanned and could deny.** `git commit --dry-run` creates no commit; the sibling
  guard already exempted dry runs on the same reasoning.

### Changed

- `scripts/lint-manifests.mjs` gains a rule that every hook command resolves and is executable.
  It lives inside that script rather than as a new CI step, because `test/ci-workflow.test.mjs`
  pins step adjacency — and its negatives assert the specific failure message, since
  `lint-manifests` also exits 1 on an unrelated missing file.
- The instrument taxonomy gains a seventh kind. A hook is the only one the host runs on its own
  initiative; every other instrument waits to be chosen.

## [0.17.1] — 2026-08-15

### Fixed

- **The ADR readiness gate read a record's own content as unfilled template residue.** Its
  code-stripper matched a fenced-block marker that appeared *inside* an inline code span — the
  shipped example is a record describing the ` ```json oracle-run ` block it writes — and consumed
  everything up to the next fence in the document. The resulting odd backtick run re-paired every
  span after it, exposing their contents to a lint that is supposed to ignore code. ADR-0036 was
  refused acceptance because `{file}` and `{name}`, written inside backticks as the substitution
  tokens they are, were reported as placeholders.

  The fence pattern is now anchored to line starts and the inline pattern no longer crosses a
  newline, so a single unbalanced backtick cannot cascade. Measured across the corpus: one record
  false-positived before, none after, and no other record changes classification. Both narrowings
  cost something — an indented fence, and an inline span wrapping a soft line break, neither of
  which occurs here — and both fail towards reporting rather than towards silence.

### Changed

- **Every ADR is now `accepted`.** The eight that stood at `proposed` — 0033 and 0034, whose
  features shipped some time ago, and 0035 through 0040 from the workflow-hardening plan — were
  ratified by the owner. Both index tables were corrected with them: `check-docs-drift` verifies
  that an ADR is *linked* from each, never that the status it prints is the status the record
  carries, so they had gone on saying `Proposed` after each acceptance.

## [0.17.0] — 2026-08-15

Phase 7 of the workflow-hardening plan (`docs/proposals/workflow-hardening.md`), and the last of
the seven: a finding stops being anonymous within one run and gets an identity that survives the
next scan, the four disagreeing severity bullets become one rubric with anchored examples, and a
critic's verdict becomes a typed artefact instead of prose in a conversation. ADR-0038 and
ADR-0039 accompany it, both `proposed`.

### Added

- **Every finding carries a `fingerprint`.** A sha256 over the report kind, the file path, the
  category and the title slug, first 16 hex characters, computed server-side at assembly. Line
  numbers are deliberately excluded, so an unrelated insertion above a finding does not mint a new
  identity — the whole point being that "what is new since last week" survives a renumbering.
- **`/marvin:reports` answers what is new.** A `triage` action reconciles the live findings against
  a stored baseline into `new`, `persisting` and `regressed`, plus a `resolved` roll-up for
  fingerprints that have left every current report. Both actions reconcile — the terminal and the
  widget see the same data — and only `snapshot: true` writes the baseline, to
  `.marvin/report/triage.json`, a local self-ignoring directory created lazily on that path alone.
  The write is a flag rather than an action because the tool is widget-bound at tool level: an
  action-keyed write would let a host consume the baseline by merely opening the panel.
- **`sec-gate` and `sec-fix` emit typed `audit-report` blocks**, strictly inside their existing
  "if the user asks to keep a record" branches. The gate runs on the commit path and still stays
  quiet by default.
- **One severity rubric with anchored examples**, at `skills/sec-scan/references/severity-rubric.md`:
  a spine of blast radius × likelihood × cost to reverse, five rows, two stated adjustments, and two
  concrete anchors per row — one security, one code-health. `sec-scan`, `sec-gate`, `sec-fix`,
  `refactor-audit` and `refactor-smells` reference it by path; `marvin-auditor` and
  `marvin-refactor-auditor` carry an inlined condensed copy, because an agent body is loaded
  standalone and a `skills/…` path there resolves against the working directory and silently fails
  to open.

### Changed

- **`AuditKind` accepts two new members, `gate` and `fix`** — ten in total. A project that pinned or
  switched over the eight-member enum downstream needs to widen with it. Reading is compatible in
  one direction only: an eight-member block still parses here, but a `gate`- or `fix`-kind report
  written under this version parses as invalid against an older server and is dropped by every
  reader with only a skip-note.
- **The dashboard's Security area never shows a `gate` or `fix` report.** Those two kinds are
  excluded from candidacy, so a pre-commit gate record — usually the newest file in
  `.marvin/security/`, since it is written on the commit path — cannot silently replace the last
  full scan as the project's stated security posture. Both kinds remain fully visible in
  `/marvin:reports` and `/marvin:sec-report`, where a report is one row among many.
- **The `report` tool rejects undeclared arguments** instead of stripping them — the second tool
  after `spec` to do so. A caller who intends `snapshot: true` and mistypes the key now gets an
  error naming the key, rather than a successful-looking call that wrote nothing and left every
  later triage reporting the whole finding set as new.
- **A `fix`-kind report carries no `fixCommand`.** Its findings describe what was already closed, so
  the continuation chip would have asked the fix skill to fix its own record.
- **A `fix`-kind report is never reconciled as live state.** Its findings record what was repaired,
  not what is currently wrong, so counting them would let a fix report displace the very findings it
  closed. ADR-0038's premise that `.marvin/security/` is current state because scanners overwrite
  fixed filenames is corrected in the record: `fix-<slug>.md` accumulates, exactly like a refactor
  register.

### Added — critic receipts

- **A critic's verdict becomes a typed artefact.** Both critics now end with a `critic-verdict`
  block carrying two axes — spec compliance and quality — and the calling session writes the
  receipt to a new `.marvin/critique/` group, the fifth `ReportGroup`, browsable in
  `/marvin:reports` and linked from `/marvin:task-summary`. Until now a verdict existed only as
  prose in a conversation, and a skipped critic left no trace any tool could read.
- **`.marvin/critique/` rather than `.marvin/task/`**, because three independent readers classify
  any file in the task directory other than the verification artifact as a spec. The directory is
  registered in ADR-0039, honours `MARVIN_CRITIQUE_DIR`, and never goes stale — a verdict describes
  the moment it was made, so ageing it would be meaningless.
- **A guard that the group set stays enumerated in one place.** `report-groups.test.mjs` asserts
  the enum equals every code enumeration in the tool, the library and the widget, and that each
  pinned prose surface names every group — the enumeration debt this phase inherited was roughly
  twenty unguarded sites.

### Changed — critic receipts

- **Both critic agent protocols are rewritten, not extended.** The single `**Verdict:**` line
  becomes the roll-up of the two axes and is preserved, as is the spec critic's explicit no-veto
  statement and the five-verdict vocabulary Phase 1 introduced.
- **A receipt cannot change a delivery decision.** ADR-0017 puts enforcement in the draft PR, and
  making the audited party the author of its own audit record would invert that. The delivery gate
  returns byte-identical output with and without a `BLOCK` receipt present — asserted on a fixture
  that would otherwise ALLOW, so the test reaches the code that could violate it.

## [0.16.0] — 2026-08-15

Phase 6 of the workflow-hardening plan (`docs/proposals/workflow-hardening.md`): the last large
area where the model did mechanical work by hand becomes tool-backed, and an interrupted intake
stops losing its answers. ADR-0037 accompanies it, `proposed`.

### Added

- **The spec corpus is read by a tool, not by prose.** `resolveSpecDir`, `readSpecCorpus` and
  `nextSpecNumber` mirror the ADR family's equivalents, and the `spec` tool gains
  `action: "next"` and `action: "list"` — corpus reads that answer with a `spec-corpus` block
  instead of a verdict, and never error on an empty or absent directory. A `spec.dir` config tier
  now decides where specs live; four skills stop performing the numbering arithmetic themselves.
- **`/marvin:task-audit`** — a read-only lint over the whole corpus: duplicate numbers, numbering
  holes, slug collisions, dangling `depends_on`, missing seals, statuses outside the vocabulary,
  and files that do not identify themselves as specs, each with remediation guidance.
- **An intake can be resumed.** `task-start` allocates and opens a draft at step 1.5 and appends
  each resolved answer as it goes, instead of writing nothing until step 9; `task-implement` gains
  a resume fork. The journal lives beside the verification runs under `.marvin/task/runs/`, which
  makes the `spec` tool a **writer** for the first time — recorded in ADR-0037 alongside the
  allocation change, since both narrow the same sentence of ADR-0022.
- **An absent journal is never read as "nothing was done".** The resume fork degrades loudly and
  says so in those words: with no journal, verify every criterion from scratch. The silent
  alternative is the inference Phase 5 spent a package removing.

### Fixed

- **The slugless `/marvin:task-summary` picked the alphabetically last file.** It now takes the
  highest-numbered spec that is neither a draft nor unsealed — without which step 1.5's drafts
  would have become the default target of every summary the moment they started being written.
- **A draft would have counted as work in flight.** The dashboard's current-work zone caps at
  three rows ordered by number descending, so newly abandoned skeletons would have crowded out
  real work first.
- **One mistyped number could produce a million-byte finding.** The numbering-hole check copied a
  mirror bounded by a five-digit filename pattern into a place where the prefix pattern is
  deliberately unbounded for legacy tolerance. Measured on a two-file corpus, the message reached
  1,000,033 bytes; it is now capped at ten listed ids plus a count, and measures 169.
- **A file with no identity was reported as malformed.** The guard that skips such a file ran
  *after* the channel it was meant to protect.
- **`verify action: "oracles"` could not see a configured spec directory**, while every other
  reader could — so a project setting `spec.dir` outside the conventional candidates worked
  everywhere except the oracle runner. `/marvin:help` and `/marvin:dashboard` likewise printed
  different spec counts on such a project.

### Changed

- `mode` on the `spec` tool becomes a deprecated synonym for `action`, bounded to its original
  three values. The two are resolved in exactly one place and a disagreeing pair is refused naming
  both keys — `mode` carried a default, so an unset one would otherwise have been
  indistinguishable from an explicit `action`.

## [0.15.0] — 2026-08-13

Phase 5 of the workflow-hardening plan (`docs/proposals/workflow-hardening.md`): proofs get bound
to the code state they prove, and the oracle graph the Definition-of-Ready gate validates is
finally executed. ADR-0035 and ADR-0036 accompany it, both `proposed`.

### Added

- **Provenance on every verification run** (`head_sha`, `branch`, `dirty`, `worktree_digest`,
  `generated_at`), carried in the `verify-result` block and read by the delivery gate. The
  decisive field is `worktree_digest`: in marvin's own process both verification and delivery run
  on a dirty tree *before* the commit, so `head_sha` and `dirty` are identical either side of an
  edit and would almost never catch a stale proof. It hashes a structural path list — changed
  paths plus untracked paths plus one `git hash-object` pass — rather than patch text, so the
  cost is O(paths) and the computation cannot be defeated by a large diff. `decision` stays
  two-valued; a sibling `staleness: fresh | stale | unknown` carries the freshness verdict, and a
  missing provenance block is always `unknown` and always allows.
- **Per-spec runs** under `.marvin/task/runs/<slug>.md`, with the global `verification.md` kept as
  fallback. `task-summary` now joins the run belonging to its own spec — the fix for a summary
  presenting a foreign run as its own. ADR-0035 names the directory contract once, because three
  packages write there.
- **A `not-run` gate state.** A gate whose binary is absent is recorded as `not-run` with the
  reason, instead of exiting 127 and being read as a failure. Gates sharing a runner are probed
  once between them.
- **Oracle execution.** A new `verify action: "oracles"` runs the typed oracles the DoR gate has
  always validated and never executed, resolving each command in ADR-0009 order — the call
  argument, then `gates.test_one` from `.marvin/config.json`, then a narrow default table — and
  recording `not-run` with a reason rather than guessing. Results are journalled under `runs/`,
  keyed by slug, `contract_sha` and criterion id, with the test-file hash and `head_sha`.
- **Red-green proof for bugfixes.** A criterion marked `regression: true` can now carry a recorded
  red-then-green pair at the current `contract_sha`. The delivery gate reports a missing pair as a
  warning for now; promotion to a veto waits on measuring the command-resolution rate in real use.

### Fixed

- **`task-summary` was over-claiming, not being conservative.** It reported `pass` for every
  test-backed or command-backed criterion whenever the *run* verdict was green — asserting
  per-criterion proofs it never had. A criterion whose oracle did not run now reports `unknown`,
  even on a PASS verdict. `AcOutcome` keeps its three values.
- **The delivery gate could be bypassed by an unrunnable test gate.** Making a missing binary
  `not-run` would, on its own, have turned `"test": "nonexistent-runner"` from a hard block into a
  delivery. The gate now refuses when every recorded `test` gate is `not-run`, or when every gate
  is, with no input waiving it — while a missing *optional* scanner still delivers with a warning,
  which is the whole reason `not-run` exists.
- **`task-deliver` could skip the gate entirely.** Two clauses licensed reusing a verdict from
  conversation context and hand-reading the artifact when the tool was unavailable. A verdict
  reused from context carries no freshness check, so in the pipeline's most common path the new
  staleness block would never have fired.
- The `verify-result` block had one writer and three readers, each with its own regex and subtly
  different tolerance. All four now share one codec with a discriminated result, so a corrupt
  sibling field no longer changes a delivery decision, and a malformed block can no longer crash
  the summary.

### Changed

- `verify` gate probing moved out of the measured wall-clock window. Adding the availability probe
  inside `runGate` serialised gates that ADR-0002 made concurrent on purpose, and the repository's
  own latency test caught it — parallel 1094ms against sequential 973ms. Probes now run once per
  token before the clock starts; the margin is back to roughly 215ms against 640ms.
## [0.14.1] — 2026-08-13

### Fixed

- **The `spec` tool no longer answers over arguments it ignored.** Its input schema was
  non-strict, so zod dropped an unrecognised key instead of rejecting it. A `mode: "scope"` call
  passing `changedFiles` — the argument callers reach for by analogy, though the changed set is
  always derived from git — was accepted, the argument was silently discarded, and the caller got
  a confident PASS/FAIL over a file set the tool never saw. Two runs with deliberately different
  `changedFiles` lists returned byte-identical violations. The input is now `.strict()`, and the
  error names both the rejected argument and the fields that are accepted. No shipped skill or
  prompt ever passed the argument, so nothing that worked before stops working.
- **`registerTool` now passes the input schema itself rather than its raw `.shape`** — without
  which the fix above could not work at all. Handed a raw shape, the MCP SDK rebuilds it with a
  plain, non-strict `z.object()` and strips unknown keys *before* the handler and before the
  shared `safeParse` ever see them, so a `.strict()` schema could never reject anything. Strict
  schemas now fail loudly; non-strict schemas keep stripping exactly as before. The advertised
  JSON Schema is unchanged for 12 of the 13 tools — and 12 already published
  `additionalProperties: false`, so this aligns enforcement with a contract that was already
  public. The exception is the zero-argument `tracker` tool, whose empty shape fell through an SDK
  heuristic: it now advertises `additionalProperties: false` like every other tool, with no change
  in behaviour.

## [0.14.0] — 2026-08-13

Phase 3 of the workflow-hardening plan (`docs/proposals/workflow-hardening.md`): the invariants
CLAUDE.md asserts become machine-checked, and the first session gets a front door.

### Added

- **`/marvin:onboard`** — a guided first session in the user's own project. It reads the
  repository, proposes starter tasks found in that codebase rather than invented ones, and runs
  at most two side-effecting commands, each behind an explicit yes. Declining any step continues
  the walkthrough rather than aborting it, and it never creates a branch, checks one out, or
  pushes. It discloses the local `.marvin/usage/events.jsonl` log **before anything is written**
  and offers the opt-out, showing the exact lines first — a disclosure step that writes a file the
  user has not seen defeats its own purpose. The opt-out is a read-modify-write that preserves
  every other key, because no shipped tool action can set `usage.enabled`: the `config` action's
  schema has no such field.
- **`scripts/lint-skills.mjs`**, wired as a blocking CI step, with six checks over the three
  authored surfaces: closed frontmatter allowlists (skills, agents, commands), a description
  present and within budget, `name` agreeing with the directory or filename, every `skills/…`
  path in a body resolving on disk, an agent without a `tools:` allowlist being on an explicit
  whitelist, and the set of prompts without a command wrapper matching the pin. It extends
  `scripts/lib/skill-datasets.mjs` rather than opening a parallel module, and deliberately does
  **not** re-implement the parity and canonical-form checks `lint-manifests` already reports.
  Five of the six pass on the current tree with no content edits — they are regression fences,
  not repairs, and the module says so.
- **`plugins/marvin/commands/{lessons,dashboard,reports}.md`** (decision **D3**). Beyond
  uniformity, this is what lets the wrapper check pin a *rule* rather than a list: the
  wrapper-less set was ten prompts — those three plus the seven `track-*` — and is now exactly
  the `track-*` group, which is what CLAUDE.md already asserted.
- **`scripts/usage-surface.mjs`** — compares the declared registry against the names actually
  invoked in `.marvin/usage/`, reporting the prompt and tool axes separately and reporting the
  observation window prominently, so an empty log cannot read as "nothing is used". A
  never-invoked name has no age, so the script reports the window plus per-name last-seen rather
  than pretending otherwise.

### Fixed

- **The usage log was measuring its own test harness.** `scripts/smoke-commands.mjs` spawned the
  server with no environment scrubbing and the project as its working directory, writing one
  event per registry prompt into the very log any usage analysis would read. Every prompt
  therefore appeared "invoked", and the never-invoked surface was empty and structurally always
  would be. The smoke test now runs against a temporary usage directory. The uncontaminated
  half is the tool axis, where only 4 of 13 tools have ever been recorded.
- **The new linter disagreed with an existing one about quoted YAML.** `name: "commit"` is legal
  and `evals/trigger/lib/catalog.mjs` — already enforcing the same fields in a blocking step —
  strips the quotes. The frontmatter reader now borrows exactly that rule, so the three readers
  agree. The canonical-form check for `disable-model-invocation` keeps its own verbatim read, so
  quote-stripping cannot silently make `'true'` acceptable.

### Changed

- **CLAUDE.md now matches the linter it gained.** Creating `commands/<command>.md` was documented
  as optional while the new wrapper pin makes it mandatory for every non-`track-*` prompt — and
  the `track-*` exemption is stated where the rule is, not in a later aside, because a model
  following the unqualified sentence would create the one file the build now rejects.
- `docs/getting-started.md` is rewritten around the single entry point, keeping the
  install-recovery path for a reader whose install did not appear.
- `docs/configuration.md` records the one carve-out to "you do not edit `.marvin/config.json` by
  hand": `usage.enabled`, which no tool action writes.

## [0.13.0] — 2026-08-13

Phase 2 of the workflow-hardening plan (`docs/proposals/workflow-hardening.md`): the task
pipeline gets a routed entrance and a bounded intake.

### Added

- **`/marvin:task-start` now routes before it asks.** A new Step 0 reads only cheap evidence —
  the request text, `git status --short`, `git log --oneline -3`, and the spec-directory
  listing step 1.3 already performs — and picks one of four paths: hand over to
  `/marvin:task-implement` when a spec already exists, route out to `/marvin:commit`,
  `/marvin:track-new`, `/marvin:debug` or a `refactor-*` command when no spec is warranted,
  author one coherent spec, or slice multi-deliverable work. The router **may not refuse
  work**: paths C and D need explicit confirmation with a one-line rationale, and thin
  evidence defaults to authoring a spec rather than declining. Path B is worded one-way so it
  cannot ping-pong with `/marvin:refactor-plan`, which routes spec-sized work back the other
  way.
- **`skills/task-start/references/routing.md`** — the operational one-PR test, the
  anti-heuristics (never count verbs, conjunctions, noun phrases, or files), and three worked
  examples from this repository's own merged history, deliberately chosen to reach three
  different verdicts: split by deliverable (#128), split by layer (#162), and kept together
  despite nineteen files (#176). The last is what makes "never count files" operative rather
  than merely asserted.
- **A place for deferred slices.** Step 4.5F was a silent note under "Future Considerations";
  it is now a stop with a two-way choice, and slices become board cards through the `task`
  tool with the mechanics written out exactly — `action: "create"` with explicit `type` and
  `title` so the form is skipped, then **no** to the branch question, which would otherwise
  check out the card's branch and flip it to wip in the middle of authoring. Both templates
  gain a `## Deferred slices` section; the bugfix template previously had nowhere for slices
  to land at all, and the bugfix flow (step 5B) had no size check.
- **A question budget.** Intake is capped at six questions for a feature and four for a
  bugfix, in priority order — scope and boundaries, security and data, interface and
  contract, the rest — with up to three numbered independent questions per turn. Three sweep
  rows are relabelled as answered by *reading* rather than asking: reverse dependencies by
  grep, the test environment from CI configuration, merge obligations from CLAUDE.md. A
  do-not-ask list names the default each item assumes, and every accepted default must be
  recorded in `## Assumptions` as "assumed X because Y; correct now if wrong".
- **Two advisory DoR content checks.** `assumptions` and `critic verdict overrides` were
  already at the recommended tier, so the gate noticed their absence and nothing about their
  content. `checkAssumptions` surfaces an absent, empty, or "none" section; `checkCriticVerdict`
  accepts the four terminal verdicts plus `none`, and gives `NEEDS_CONTEXT` its own message,
  because Phase 1 made it transient and never recordable. Both are **warn** tier, so no
  already-sealed spec becomes undispatchable — promotion to the rejecting tier is decision
  **D5**, at the next declared breaking release, since the semver table in CLAUDE.md
  classifies a validation break as major.

### Fixed

- **A spec whose `## Assumptions` reads "none" is no longer undispatchable.** Steps 7F/7B
  accept `PASS WITH WARNINGS`, but the write-and-seal steps in the same file demanded the
  re-run "must still PASS". With an advisory warning now reachable on a legitimate value, a
  literal-minded executor would have looped on a warning it could never clear.
- **Six template sections carried no placeholder the gate could see.** The DoR gate's
  placeholder check matches single-line stubs of at most 71 characters, while the templates'
  guidance blocks run 73–396 characters and several are multi-line or nested — so the check
  that exists to stop unfilled residue reaching a PASS was blind to most of the template it
  guards. Each such section now carries one short sentinel stub the shipped scanner reports,
  with the long guidance kept beside it. Eight stubs remain out of reach by construction; the
  pattern itself is untouched, because it is a FAIL-tier check and widening it is a breaking
  change (recorded against D5, together with the measurement that a filled, sealed spec in
  this repository would flip PASS → FAIL, and the note that the fix is to lift the existing
  `findPlaceholders` out of `storage/adr.ts` rather than write a second scanner).
- **`commands/task-start.md` and `docs/commands.md` described a flow that no longer runs
  first.** Both stated unconditionally that the command parses input and writes a spec; paths
  A and B end the command without writing one.

### Documented

- `docs/proposals/task-workflow-latency-optimization.md` (R3) and
  `docs/requirements/parallel-step-execution.md` (NR-1) both record that the one-question-at-a-time
  cadence stays. Both now carry a supersession note pointing at this change, so a reader
  grepping the phrase does not land on two contradicting records.

## [0.12.5] — 2026-08-12

Phase 1 of the workflow-hardening plan (`docs/proposals/workflow-hardening.md`): the
advisory protocols gain the vocabulary and the carriers they were missing. Prompt and
agent bodies only — no server source changed.

### Added

- **The critics can now say "I could not judge".** Both `marvin-tm-spec-critic` and
  `marvin-tm-diff-critic` extend from three verdicts to five, adding `NEEDS_CONTEXT` (the
  critic can name the exact input that would let it judge) and `UNABLE` (it cannot, or a
  `NEEDS_CONTEXT` it already raised recurred). A `NEEDS_CONTEXT` earns exactly one
  re-dispatch, which the caller marks as such — a subagent enters with a fresh context and
  cannot observe that a prior turn happened — and a second occurrence becomes `UNABLE`.
  `UNABLE` is never treated as success.
- **A skipped or unable critic now reaches the pull request.** `task-start` has always
  promised that it would, and nothing carried it: `task-deliver` contained no mention of a
  critic at all. Its PR body now renders a `**Spec critic:**` and a `**Diff critic:**` line
  from separate sources, under a total rendering rule — one of the four terminal verdicts,
  or `⚠️ critic skipped` in every other case, including a spec with no such section and a
  delivery with no spec at all. `marvin-tm-executor`, which opens its own PR, carries both
  lines too, so the headless path cannot drop a verdict the interactive path records. This
  makes ADR-0017's Consequences clause true in the tree rather than aspirational.
- **One named fix-cycle protocol** in `task-implement`, replacing seven scattered mentions
  of a two-retry budget. Rounds 1–2 retry the same path with the feedback verbatim; round 3
  changes the conditions. The three loops it governs — verify-gate, critic, red-green —
  keep separate budgets, because collapsing them into one silently shortens the verify loop.
  Round 3 escalates to `marvin-debugger` only for the two loops with a reproducible symptom:
  that agent's contract requires a trigger to reproduce and a regression test to write, and
  a critic blocker such as "AC2 has no implementing change" has neither. At the limit every
  open item is recorded as deferred with rationale or blocked with cause; dropping one
  silently is banned.
- **A re-grounding step before review feedback is classified**, in `pr-resolve` and
  `marvin-tm-review-fixer`: open the cited location and read enough around it to judge the
  finding first. With it comes a fifth class, `unfounded` — leave the code unchanged, reply
  with a file-and-line refutation, leave the thread open — and an all-or-nothing rule, since
  review comments are frequently interdependent: when one comment cannot be grounded, none
  are applied.
- **`sec-scan` phase 3 fans out to three `marvin-auditor` lenses** dispatched in one
  response (A01/A05/A08, A02/A04/A07/A09, A03/A06/A10), with the inline walk kept as the
  fallback when the Task tool is unavailable, and a new consolidation phase that merges on
  matching location and substance, takes the higher severity on disagreement, and renders a
  lens-coverage matrix that exposes a lens which found nothing. `marvin-auditor` gains the
  executor-mode constraints `marvin-refactor-auditor` already had — a write ban, an
  enumerated read-only command list, the untrusted-input caveat — and an output contract,
  without which three concurrent dispatches can each return a different shape.

### Fixed

- **A surviving critic `BLOCK` now actually gates delivery.** `task-implement` stated that
  it does, "because the PR opens as draft", but on the interactive path the PR is opened by
  `pr-create`, which composed a bare `gh pr create`. The draft path now runs end to end.
- **The outdated-thread rule can execute the case it names.** Both review-handling bodies
  keyed re-grounding on `isOutdated: true`, but GitHub returns `line: null` for such a
  thread and neither GraphQL query requested `originalLine` or `diffHunk`. For the
  autonomous agent this was the worse half of the defect: one outdated comment would hold
  the entire pass, producing no fixes at all.
- **The fourth review class had two names** — `spec-conflict` in `pr-resolve`,
  `spec-gap-discussion` in `marvin-tm-review-fixer` — while the latter's own steps routed a
  `Spec-conflict` its table never defined. Reconciled on one name.
- **`task-verify` cited ADR-0011 for config-first gate resolution.** Every other reference
  in the tree says ADR-0009.

### Documented

- **Real scanners are legitimate verify gates.** `docs/configuration.md` names
  `npm audit --audit-level=high`, `gitleaks detect` and `semgrep --config auto` as gate
  content, documents the chaining form the closed four-key set forces, and records that a
  key outside that set is silently stripped and that a declared command replaces the
  detected one. It also states plainly what happens today when a gate's binary is missing:
  the gate fails and delivery is blocked. A `not-run` state is planned; documenting it as
  though it existed would have told users to add `gitleaks detect` and thereby block
  delivery for every teammate without the binary.

## [0.12.4] — 2026-08-10

### Fixed

- **`task-implement` no longer sends hands-off work to a script that does not exist.**
  Three places in the skill named `scripts/dispatch.sh` as the headless counterpart to
  interactive execution, and one of them was an instruction rather than a description:
  "For multi-task or hands-off execution, use `scripts/dispatch.sh`." The script was
  deleted long ago, so a model following that guideline reached for a missing file. All
  three now describe what actually performs headless execution — the `marvin-tm-executor`
  agent, dispatched via Task-tool — keeping the interactive-versus-headless contrast the
  prose was drawing.

## [0.12.3] — 2026-08-08

### Fixed

- **`migration-plan` is no longer advertised as model-invocable.** Its skill has carried
  `disable-model-invocation: true` all along, but the 👤 marker came from hand-typed lists
  that were never updated, so `/marvin:help`, the public command catalog, the Storybook
  preview and both shipped command tables all told the model it was free to auto-trigger a
  human-run command.

### Changed

- **Skill frontmatter is now the only source of the human-run flag.** `humanRunSkills()`
  reads `disable-model-invocation` from each `skills/*/SKILL.md` at call time through the
  ADR-0005 frontmatter codec, and the website generator reads the same frontmatter, so
  neither carries a name list to keep in sync. A flag change in a `SKILL.md` now needs no
  second edit and no rebuild, consistent with ADR-0008.

## [0.12.2] — 2026-08-02

### Fixed

- **A broken `tracker_url_template` no longer produces links to nowhere.** `{tracker_id}`
  is the only placeholder substitution fills, but nothing checked that a template
  actually contained it. A config edited by hand to
  `"https://example.com/issues/{id}"` — a path `/marvin:track-config` documents — flowed
  through untouched, and every tracked card carried a live URL ending in a literal
  `{id}`: a markdown link in the `tracker` tool, an anchor in the tracker-list widget,
  with no warning anywhere. `trackerUrl` is now the guarantee rather than a passthrough:
  a template that cannot substitute derives `null`, which every surface already renders
  as the tracker id in plain text. Repeated `{tracker_id}` occurrences are all replaced;
  before, only the first was.
- **A setting that cannot work is dropped alone, with its reason.** The loader neutralises
  an unusable `tracker_url_template` and reports why through `/marvin:track-config` and
  `/marvin:dashboard`. It does not fall back to whole-file defaults, so one mistyped URL
  no longer risks the board's `statuses`, `gates` and `base_branch` alongside it.
- **The config surface refuses such a template instead of noting it.** Writing one was
  previously allowed with an advisory note; it is now a fail-closed error that writes
  nothing. The interactive `edit=true` form is held to the same rule — it used to bypass
  the check entirely and reach disk.

## [0.12.1] — 2026-08-02

### Fixed

- **A character split across two pipe reads no longer corrupts what a subprocess
  sends back.** Every stdio client in the repo accumulated output as
  `buf += chunk.toString()`, which decodes each read in isolation: a character whose
  UTF-8 bytes straddle a chunk boundary becomes U+FFFD on both sides of it, turning
  one character into three. Whether it happened depended on where the kernel chose to
  slice the stream, so it struck under load and vanished on retry. All of them now
  decode through the stream's own `StringDecoder`.
  - `bin/widget-preview.mjs` — the widget documents are ~300 KB with ~4% of their byte
    offsets on a continuation byte, so a preview could silently embed a document that
    was not the committed one. This is what kept CI red: the suite's byte-identity
    assertion caught it on roughly a third of runs, reported against whichever widget
    happened to be affected.
  - `verify` — a gate's captured output feeds the `details` block of
    `verification.md`, and test reporters emit ✔/✖/→ by the line, so a long enough
    gate could write mojibake into the artifact the user reads back.
  - `scripts/mcp-call.mjs`, `scripts/smoke-commands.mjs` and the trigger-eval harness,
    which had the same defect in developer tooling.

## [0.12.0] — 2026-07-31

### Added

- **`/marvin:widget-preview`** — open a marvin widget as a real rendered panel, with
  this project's own data, on a host that cannot render widgets. It writes one
  self-contained file to `.marvin/preview/<widget>.html` and opens it. This is what
  makes the widget family reachable from the terminal at all: the Claude Code CLI
  implements no part of MCP Apps, so every widget-bound tool has only ever shown its
  markdown fallback there ([ADR-0034](../../docs/adr/0034-widget-preview-door.md)).
- **`mcp/server/bin/widget-preview.mjs`** — the command behind it. A dependency-free
  script with no build target of its own: it drives the committed `dist/server.js`
  over stdio, resolves the widget from the `_meta.ui.resourceUri` binding the server
  already publishes (so no widget is named in it anywhere), fetches the document over
  `resources/read`, and composes it with the tool's payload and a small host that
  answers the five protocol messages a framed view needs.

### Notes

- Covers all nine bound widgets, but not all of them render on defaults: `help`,
  `dashboard` and `reports` do, while the task and board widgets need their tool's
  arguments, e.g. `widget-preview task-list '{"action":"list"}'`. A tool that returns
  no payload prints its own message and exits without writing a file.
- `.marvin/preview/` writes its own `.gitignore` of `*`, the `.marvin/usage/`
  convention — a preview is a derived artifact and never reaches a commit.
- The panel follows the operating system's light/dark scheme: the preview host
  advertises no theme, so the widgets' own fallback governs.

## [0.11.0] — 2026-07-31

### Added

- **The widgets follow the host's theme.** All nine `ui://` documents now read the
  light/dark theme the MCP host advertises over the protocol and render on it,
  instead of always following the operating system's `prefers-color-scheme`. A
  dark host no longer shows a light widget on a light desktop, and a theme the
  host changes mid-session is picked up without re-running the tool.
- **`src/lib/host-theme.ts`** — the shared resolver behind it. One effect seeds
  from `app.getHostContext()` and subscribes to `hostcontextchanged`; both the
  production and the seam wiring of every widget call it, which is what lets the
  seam-driven tests prove the code that actually ships.

### Notes

- When a host advertises no theme, the widgets deliberately stay on the OS
  scheme: `data-theme` is left unset rather than defaulted. Embedders that set
  the attribute on the framed `.mvroot` themselves — the marvin website does —
  keep working unchanged.
- The host's style variables, fonts and locale are still ignored. Marvin's own
  tokens and typography continue to define the widgets' appearance.

## [0.10.0] — 2026-07-29

The dashboard rework, delivered in three slices (contract → tool → widget). This
entry covers all three, since the earlier two deliberately deferred the version
bump so a single one could carry the whole change.

### Added

- **`DashboardState` v2 sections** — `servers` (the configured MCP servers),
  `current_tasks` (active board cards plus pipeline specs in flight), `handoffs`
  (recent session-continuation docs with their age), and `audits` (findings by
  severity for the newest security and refactor report). Every field is optional,
  so the narrower `help` payload keeps conforming.
- **The `dashboard` tool emits all four**, backed by four digest readers in
  `lib/state.ts` (`boardDigest` / `specDigest` / `handoffDigest` / `auditDigest`),
  plus three new terminal sections: **Current work**, **Handoffs** and **Audits**.
- **A reworked dashboard widget** on that payload: a nav sidebar, an identity
  strip, and three zones — Project (repo, board distribution bar, artifacts, MCP
  servers), Work in progress (current tasks, handoffs, audit findings with
  per-severity spark-bars), and Toolbox state (paths, config, ADR corpus, lessons,
  usage, commands). Controls send their marvin command to the conversation, and
  degrade to the clipboard, then to a revealed command, when the host declines.
- **`src/lib/actions.ts`** — the shared chat-action ladder behind those controls.
  A host refusal arrives as a RESOLVED `{ isError: true }` rather than a
  rejection, which the two pre-existing `sendMessage` call sites do not check.

### Changed

- **An audit area with no report now renders differently from one scanned clean.**
  A never-scanned project previously read as a clean bill of health.
- `specDigest` treats `superseded` specs as delivered, matching the predicate the
  task pipeline already applies. A superseded spec no longer reports as in flight.
- The `dashboard` blurb in the command reference now describes the v2 sections.

### Removed

- **`SecurityInventory` and `RefactorInventory`** from the contract, the tool
  payload, and the widget cards that rendered them. `DashboardAudits` supersedes
  both with findings and freshness per area, and `artifacts.audits` still carries
  the security document count. The refactor register counts by kind have no v2
  equivalent and were dropped deliberately, not relocated. The Artifacts text
  section no longer reports a security document count beside the Audits finding
  count: the two measured different things and read as a contradiction.

Registry unchanged: 52 prompts, 13 tools, 9 widgets.

## [0.9.0] — 2026-07-17

### Added

- **Report export, template-only** (ADR-0033): the new `/marvin:report-export`
  skill exports any generated `.marvin/` report — security scans, refactor
  registers and plans, task specs, verification, handoffs — as a **Markdown
  digest** or **print-ready HTML** (the PDF path: open in a browser → print →
  save as PDF). Claude fills the shipped print-quality template in-session;
  **no export code ships in the MCP server** — the plugin carries only the
  template (styled on the `.mvroot` widget theme tokens, locked to the token
  sheet by a new guard test) and the instructions. Exports land in
  `.marvin/export/`, which self-ignores from git. Registry: 52 prompts, tools
  unchanged (13).

## [0.8.1] — 2026-07-16

### Added

- **Reports zone-A `Sync` action** (design §A): a ghost header button that asks the
  conversation to re-run `/marvin:reports` through the host's `sendMessage` chat
  action — the handoffs continue-button precedent, and the first partial answer to
  the design doc's prompt-bridge open question.

### Fixed

- Register-table parsing no longer shifts columns when a cell carries an escaped
  pipe (`\|`) — cells split on unescaped pipes only and unescape afterwards.
- The `.marvin` report scan skips symlinked entries, so a planted symlink can no
  longer pull out-of-tree file content into `structuredContent`.
- Storybook: all widget story files now map the `hostTheme` toolbar onto the view's
  `theme` prop (previously 6 of 11 ignored the toolbar and stayed light on a dark
  canvas); the preview contract comment is true again.
- Server test loader: `esbuild` is a declared devDependency (was a phantom hoisted
  transitive) and compiled test bundles reuse one hash-keyed cache directory via
  atomic renames instead of leaking a temp dir per run.

## [0.8.0] — 2026-07-16

### Added

- **`/marvin:reports` — a unified viewer over every report marvin generates**
  (docs/design/reports-widget.md). The new `report` MCP tool scans `.marvin/` in one
  pass — security scans (via the shared audit-report parser), refactor findings
  registers and plans, task specs and `verification.md`, handoffs — and emits a
  `ReportListPayload`: one typed envelope per document, newest first, with
  server-computed staleness (> 7 days for security/refactor reports) and continuation
  commands as data. Terminals get a grouped markdown summary; MCP Apps hosts render the
  new `ui://marvin/reports.html` widget — KPI strip, group segments, a local search
  filter, per-kind detail bodies (findings with severity triage, checks, documents),
  and copy-only re-run/fix chips. Registry: 51 prompts / 13 tools / 9 widgets.

### Changed

- **Premium family restyle — all widgets move to one theme module.** A new
  `packages/marvin-widgets/src/theme/` owns the design language: a token stylesheet on
  a `.mvroot` scope (light + dark via `prefers-color-scheme`, pinnable with
  `data-theme`), the `MvRoot` boundary component, and TS token constants
  (`TOKENS` / `SEVERITY_TOKENS` / `BAR_TOKENS`) that widgets reference inline. All 8
  existing widgets plus the `<ListDetail>` / `<Markdown>` primitives were restyled to
  it: lowercase dot-pill statuses on a shared role→tone mapping, mono code chips, ghost
  link buttons, microlabel headings, segmented filters, no shadows, weights 400/500.
  The old per-widget host-var palette (`--color-*`) is gone. Darwin visual baselines
  were regenerated wholesale (92 updated + 9 new for reports).

## [0.7.1] — 2026-07-16

### Fixed

- **`/marvin:pr-resolve` never actually replied to or resolved review threads.** The
  reply step depended on a `$REPO` shell variable set in an earlier step — commands run
  in separate shells, so the variable was empty and the REST reply silently 404'd, after
  which the reply-then-resolve pair was abandoned. Every `gh` command in `pr-resolve`,
  `pr-review`, and the `marvin-tm-review-fixer` agent is now self-contained
  (`{owner}`/`{repo}` placeholders); thread replies moved to the GraphQL
  `addPullRequestReviewThreadReply` mutation keyed on the same thread node id as
  `resolveReviewThread` (the REST `/replies` + `databaseId` path is gone); a new
  "Verify closure" step re-queries the threads and forbids reporting success over a
  silent failure; and the change plan now includes per-thread draft replies discussed
  with the user before anything is applied — posted replies must answer the comment's
  substance, not just say "Fixed". Reply bodies pass through raw `-f` (`-F` magic-types
  values and substitutes `{owner}`/`{repo}` inside the text). The same `$REPO` bug is
  fixed in `pr-review`'s review POST; ADR-0023 carries a dated update note.

## [0.7.0] — 2026-07-16

### Changed

- **BREAKING — the `track-*` surface shrinks 14 → 7 commands** (ADR-0032). Removed:
  `/marvin:track-bug`, `-feature`, `-chore`, `-spike` (→ `/marvin:track-new` with the
  type as an argument/form field), `-review`, `-done` (→ `/marvin:track-move`, which
  also reaches any configured status), `-status`, `-tracker` (→ `/marvin:track-list`,
  which now routes between the full list, the work-in-progress view, and the tracked
  link-out view), and `-help` (→ `/marvin:help track`). The registry drops from 57 to
  50 prompts; the tools, their actions, and the widget bindings are unchanged, and
  natural-language phrasing keeps reaching the same tool actions.

## [0.6.0] — 2026-07-16

### Changed

- **BREAKING — the `kanban-*` command group is renamed `track-*`** (ADR-0031). All 14
  prompts rename mechanically (`/marvin:kanban-menu` → `/marvin:track-menu`, …
  `/marvin:kanban-help` → `/marvin:track-help`); the group key in the command registry,
  the `help` tool's `section` filter, and the widget fixtures now use `track`. The
  methodology-neutral vocabulary follows through the prose: the artifact is the "task
  board", the `commit`/`pr-create` skills are board-aware.
- **BREAKING — the board directory default moves to `.marvin/track/`** (archive:
  `.marvin/track/archive/`). Existing boards migrate with a single
  `mv .marvin/kanban .marvin/track`, or keep their location via `MARVIN_TASKS_DIR`.
- **BREAKING — `DashboardState` renames its board fields**: `kanban_counts` →
  `board_counts`, `kanban_role_counts` → `board_role_counts`; the `dashboard` tool's
  report section is now `board` (`## Board`).
- The curated help content for `track-tracker` and `track-status` now matches what the
  commands actually do (the read-only tracked-tasks list and the branch + WIP report);
  both previously described status/link *mutations*.

## [0.5.0] — 2026-07-12

### Changed

- **Help reference: two ways to call, one content source** (#101). The help widget's
  group-detail view shows each command with a Direct call chip plus ≥3 natural-language
  "marvin, …" phrases (new coverage-guarded `HelpCommand.phrases` contract field), and
  all curated reference data (`GROUP_BLURBS`, `COMMAND_BLURBS`, `COMMAND_DETAILS`,
  `COMMAND_EXAMPLES`, `COMMAND_PROMPTS`) moves into
  `@marvin-toolkit/mcp-shared/help-content` as the single source the server tool and the
  widget fixture both import. Help tool text output is byte-identical.

## [0.4.0] — 2026-07-10

### Fixed

- **Widgets rendered in the host serif font in production** (#99) — the CSS `font:`
  shorthand without a size is invalid and was silently dropped; fixed to `fontFamily`
  across all affected widgets.

### Added

- `<ListDetail>` keyboard a11y (single tab stop, `aria-activedescendant`), Markdown GFM
  strikethrough/task checkboxes with tiered inline precedence, an explicit link colour
  for dark hosts, and deterministic shared date formatting (#99).
- Storybook grows 19 → 93 stories (dark host theme, empty/minimal/stress states,
  interaction plays); every story is screenshot-gated via test-storybook +
  jest-image-snapshot with committed darwin baselines (#99).

## [0.3.0] — 2026-07-09

### Added

- **`help` widget "Read more" group drill-down** (`ui://marvin/help.html`, ADR-0024) — each
  command-group heading now carries a violet "Read more" link that opens a focused, in-widget
  detail view for that group: every command shown as `/marvin:<name>` with a richer
  description and an optional usage example, plus the 👤 human-run legend. The welcome panel
  is unchanged, and the drill-down is a pure client-side state swap over data the widget
  already holds — no extra tool round-trip. The terminal markdown door is unchanged.

### Changed

- The `help` tool's `HelpState` command entries gain a curated `description` (coverage-guarded
  like the existing blurb, with a `""` fallback so a missing entry fails CI) and an optional
  `example`, both curated in `help-data.ts` and surfaced only through the widget.

## [0.2.0] — 2026-07-09

### Added

- **`help` welcome widget** (`ui://marvin/help.html`, ADR-0024) — the `help` tool now
  binds a rich MCP Apps widget for desktop hosts: a CSS gradient wordmark, the
  per-project summary (project · git · kanban · artifacts), the configured MCP servers
  lit/dim by enabled state, the command-group table of contents, and the full
  per-command reference with authored blurbs. Terminal hosts keep the markdown fallback.

### Changed

- The `help` tool emits a purpose-built `HelpState` `structuredContent` (MCP servers with
  their enabled state, plus the full curated command index) in place of the narrower
  `DashboardState` base. The markdown fallback gains lit/dim server dots (`●` / `○`) and
  curated one-line command blurbs shared with the widget, so the two doors never drift.

## [0.1.0] — 2026-07-08

Initial release. Marvin delivers the full development lifecycle as **one MCP
server** under a single `/marvin:` slash prefix — 57 prompts and 12 deterministic
tools, reachable through three doors (chat auto-discovery, `/<command>` markdown
slash commands, and `/marvin:<command>` MCP prompts) that all resolve to the same
skill body.

### Added

- **Core developer tools** — `commit` (sensitive-file-aware Conventional Commits),
  `debug` (hypothesis-driven root-cause analysis), `adr` (tool-numbered decision
  records), `changelog`, `readme`, `migration-plan`, `explain`, `docs-search`,
  `handoff` / `handoff-list` (session continuation), `lessons` (the team
  lessons-learned store), `help`, and `dashboard` (whole-toolbox state report).
- **Pull-request lifecycle** — `pr-create`, `pr-review`, `pr-resolve`, `pr-merge`
  (ADR-0023).
- **Spec-driven task pipeline** — `task-start` (interactive spec co-creation behind a
  tool-backed Definition-of-Ready gate and an adversarial spec critic),
  `task-implement`, `task-verify` (concurrent quality gates with stack auto-detection),
  `task-deliver` (verification-gated commit + PR), and `task-summary`.
- **ADR lifecycle** — `adr-review`, `adr-accept`, `adr-audit`, `adr-coverage`,
  `adr-supersede`, `adr-sync`; deterministic mechanics live in the `adr` tool, with
  ratification, rollback, and project-memory sync reserved for humans (ADR-0027).
- **Security scanners** — `sec-scan` (OWASP Top 10:2025), `sec-secrets`, `sec-deps`,
  `sec-gate`, `sec-threat-model`, `sec-iac`, `sec-ci`, `sec-fix`, `sec-compliance`,
  `sec-pentest`, plus `sec-report` over the structured findings the scanners write.
- **Refactoring family** — `refactor-audit`, `refactor-smells`, `refactor-plan`,
  `refactor-apply`; a read → plan → apply progression under verify-gated rails
  (ADR-0029).
- **Kanban tracker** — a board-only per-project tracker (`kanban-*`, ADR-0025) with
  interactive elicitation forms, a configurable status model (ADR-0026), and PR-URL
  capture through the kanban-aware `commit` / `pr-create`.
- **Deterministic MCP tools** — `task`, `task-detail`, `tracker`, `help`, `dashboard`,
  `adr`, `verify`, `spec`, `lessons`, `handoff`, `summary`, and `audit`.
- **MCP Apps widgets** (ADR-0024) — seven bound `ui://` widgets (task-list, task-detail,
  tracker-list, handoffs, audit, task-summary, dashboard) over two React-on-Preact
  primitives (`<ListDetail>`, `<Markdown>`), each preserving a byte-unchanged terminal
  text fallback (progressive enhancement).
- **Agents** — `marvin-guide`, `marvin-researcher`, `marvin-debugger`, `marvin-auditor`,
  `marvin-refactor-auditor`, and the `marvin-tm-*` task-pipeline agents.
- **Working directory** — every generated service file lives under a single hidden
  `.marvin/` directory (ADR-0007); a local, self-ignoring usage log feeds the dashboard
  (ADR-0030).
- **Self-contained distribution** — a committed, bundled server (`dist/server.js`) and
  committed widget HTML, both guarded in CI for freshness (ADR-0013).
