# ADR 0035 — A verification is bound to the tree it verified

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-08-15 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0002](0002-tool-backed-verification.md) (the `verify` gate runner), [ADR-0012](0012-tool-backed-delivery-gate.md) (the delivery gate), [ADR-0009](0009-config-first-gate-resolution.md) (config-first gate resolution), [ADR-0015](0015-verify-shell-trust-boundary.md) (the shell trust boundary the probe sits inside), [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` layout), [ADR-0024](0024-mcp-apps-widget-architecture.md) (the widget data contracts) |

## Context

`verify` proves something about *a* code state and records the proof in
`.marvin/task/verification.md`. Nothing in the artifact says **which** state, and nothing says
which spec. Three consequences follow, and all three are silent.

**One global path, many tasks.** `verification.md` means "the most recent verification run in this
project, whatever spec it was for". `/marvin:task-summary` joins a spec's acceptance criteria
against it unconditionally, so a run belonging to another task is presented as this task's own —
with the same confident green as a real one.

**No binding to a tree.** `/marvin:task-deliver` calls the gate before it commits, so verification
and delivery both run on the same dirty working tree. A proof produced before a further round of
edits is indistinguishable from one produced after them, and the gate ALLOWs either.

**A missing binary is reported as a failure.** Every command runs through a shell, and a shell that
cannot find `golangci-lint` exits 127 — a failed gate, a `FAIL` verdict, a refused delivery. The
verdict then describes the contributor's machine rather than the code. The built-in stack defaults
are the common case here: `golangci-lint run`, `ruff check .`, `mypy .`, `cargo clippy` are each a
single simple command, and a teammate who has not installed one of them cannot deliver.

## Decision

Three decisions, recorded together because the third is only safe in the presence of the second.

### 1. `.marvin/task/runs/` is a directory of per-spec runs

A `verify` run that resolves a valid spec slug writes **both** `.marvin/task/runs/<slug>.md` and
`.marvin/task/verification.md`, with byte-identical text.

- `verification.md` keeps its meaning: the most recent verification in this project.
- `runs/<slug>.md` means: the most recent run for that spec.
- The slug is validated against the kebab-case rule the DoR gate applies to a spec's frontmatter
  `slug` (`/^[a-z0-9]+(-[a-z0-9]+)*$/`). Anything else is **rejected, not sanitised**: the run
  writes only the global artifact and warns. Path traversal is closed by construction.
- Writer and reader resolve the slug by one rule — the spec's frontmatter `slug`, else its filename
  slug — so `task-verify` and `task-summary` cannot disagree about which file this is.

**The subdirectory shape is load-bearing, not aesthetic.** `runs` carries no `.md` extension, and
all three top-level enumerators of the spec corpus are a non-recursive `readdirSync` plus an
`.endsWith(".md")` filter — `readMdFiles` (`lib/reports.ts`), `countMarkdown`/`specDigest`
(`lib/state.ts`), and `findLatestSpec` (`tools/summary.ts`). A directory is invisible to every one
of them **by construction**, rather than by an exclusion list that rots the next time an enumerator
is added. A flat `runs-<slug>.md` beside the specs would need three new exclusions and would
inflate the dashboard's spec count by one per verification the moment anyone forgot one.

Two further work packages write into this directory — oracle records and progress journals — which
is why the contract is recorded here rather than inside the change that first needed it. The
contract is the **shape**: one file per spec, named `<slug>.md` (or `<slug>.<kind>.md`), never
`.md` files directly under `.marvin/task/`.

The dual write is what makes the whole thing additive. Of the five readers that treat
`verification.md` as *the* artifact, exactly two change:

| Reader | Change | Why |
| --- | --- | --- |
| `verify` writer | writes both files | the invariant above |
| `verify action:"gate"` | prefers `runs/<slug>.md` when a slug is given; names the file it read | the gate must judge *this* task's proof |
| `summary` | prefers `runs/<resolved-slug>.md`, falls back to the global artifact | the concrete fix for a foreign run presented as its own |
| `report` (`scanTaskReports`) | **unchanged** | one "Verification" card = the latest run, as today. `ReportEnvelope.id` is the path, so N runs would multiply the cards, and per-run cards need a `kind`/`generatedBy` decision |
| `dashboard` (`verificationFreshness`) | **unchanged** | correct *because of* the dual write: the global file is always at least as fresh as the newest run, so `{exists, age_days}` keeps its meaning and no observable value changes |
| `state` (`artifactCounts.specs`, `specDigest`) | **unchanged** | `runs/` is invisible; the spec count must not grow by one per verification |

The two "unchanged" rows are the part of this change most likely to be read later as an oversight.
They are deliberate, and the reasoning is the table.

### 2. Provenance is recorded, and staleness is a sibling of a two-valued decision

Every run records a `provenance` object in its `verify-result` block: `head_sha`, `branch`,
`dirty`, `worktree_digest`, `generated_at`. The delivery gate compares the recorded provenance
against the tree in front of it and emits `fresh | stale | unknown` **beside** its ALLOW/BLOCK
decision, never as a third decision value — `/marvin:task-deliver` branches exactly two ways.

| verdict | gates | staleness | `allowStale` | decision |
| --- | --- | --- | --- | --- |
| PASS / PASS WITH WARNINGS | test evidence present | fresh | — | ALLOW |
| PASS / PASS WITH WARNINGS | test evidence present | unknown | — | ALLOW, reason notes freshness was not checked |
| PASS / PASS WITH WARNINGS | test evidence present | stale | false | **BLOCK** — re-run `/marvin:task-verify` |
| PASS / PASS WITH WARNINGS | test evidence present | stale | true | ALLOW, reason names the override |
| PASS / PASS WITH WARNINGS | every `test` gate `not-run`, or every gate `not-run` | any | any | **BLOCK** — §3 |
| FAIL | any | any | any | BLOCK |
| missing / unreadable / unrecognised | — | unknown | any | BLOCK, as today |

`allowStale` waives the freshness check **only**. It cannot turn a `FAIL` into an `ALLOW`, and it
does not reach the no-evidence refusal.

**Collected last.** Provenance is collected after every gate has settled and immediately before the
artifact is written — never at the start of the run. A gate can change the tree it is verifying:
this repository's own build gate is `npm run build`, which at the root rewrites the tracked
`dist/server.js` and `widgets/*.html`. Collected first, the recorded digest would describe a tree
the run itself then changed, and every developer who had not pre-built would be told their fresh
verification was stale. A guard that cries wolf is disabled by its users.

**The digest hashes a structural path list, and that is a decision, not an implementation detail.**
`worktree_digest` is 16 hex of a sha256 over one sorted line per changed or untracked path,
carrying the path, its status, and git's content id for the working-tree bytes:

1. `git diff HEAD --name-status --no-renames -z -- ':(exclude).marvin'`
2. `git ls-files --others --exclude-standard -z -- ':(exclude).marvin'`
3. one `git hash-object --stdin-paths` over the paths from (1) and (2) that exist on disk

Two alternatives were rejected on measurement, and the measurements belong here because without
them the next reader will "simplify" this back to hashing the patch.

- **Hashing the patch text of `git diff HEAD`** is O(patch bytes) and dies on Node's 1 MiB
  `spawnSync` default: a child writing 2 MiB yields an ENOBUFS error and a null status. A
  **5,543,366-byte** diff exists in this repository's own history, and the nine committed widget
  documents cross the bound on their own. The failure mode is a null digest → `unknown` → ALLOW, so
  the guard would go blind on exactly the large refactors where stale evidence costs most.
- **Hashing `git diff HEAD --numstat` plus the `--raw` blob ids** is correctly O(files changed) but
  carries no content identity: `--raw` reports the destination blob of a worktree modification as
  **all-zeros**. Editing one committed line to `ZZZZ` and then to `YYYY` yields byte-identical
  `--numstat` and `--raw` output both times. A digest over those reads cannot see a same-line-count
  edit, which is the commonest edit there is — and it would report `fresh` for a changed tree,
  the only one of the three failure modes that is confidently wrong.

`hash-object` returns 41 bytes per path whatever the file weighs, so the input scales with the
number of dirty paths rather than the size of the change, and no file's bytes enter the server
process at all. An explicit 64 MiB `maxBuffer` is kept as a second line of defence rather than as
the design. Two bounds degrade to `null`: a union of more than 5,000 paths, and any path containing
a newline (which `--stdin-paths` cannot express).

**Fail-open is the invariant.** Every git read degrades to `null`, every null degrades to
`unknown`, and `unknown` always ALLOWs. The null rule in the classifier is stated over both
decisive fields on both sides, so a matching digest beside a null `head_sha` reads as `unknown`
rather than `stale`. A broken or absent git must never make a project undeliverable; the property
being sought is evidence integrity, not access control, and the conservative direction for evidence
integrity is to say "unknown" rather than to guess "fresh". `.marvin/` is excluded by an explicit
git pathspec rather than by trusting `.gitignore`, because a project that commits `.marvin/task/`
would otherwise fold the run file into its own digest and be stale on every read.

`branch` and `dirty` participate in no decision. They are quoted back in the gate's reason on a
stale BLOCK ("verified at `1a2b3c4` on `feat/x`"), which is what makes a refusal actionable instead
of merely correct.

### 3. `not-run` is a gate state, and the gate refuses a run with no test evidence

A gate whose command is a **single simple command** not on PATH is recorded `not-run` — `code:
null`, `durationMs: 0`, a summary naming the missing token — and is never spawned. The decision is
made by a pre-flight `command -v` probe, **not** by exit code 127: `npm`, `make` and most test
runners propagate a child's 127 as their own, so classifying after the fact would silently downgrade
real failures to warnings.

The probe is **deliberately partial**. If the command contains any shell metacharacter it abstains
and the gate runs exactly as today, so the documented chained scanner form
(`"lint": "npm run lint && gitleaks detect"`) is unchanged: a chain whose missing binary sits in a
later segment still FAILs. Parsing the chain was rejected — shell grammar is a large surface and a
mis-parse produces a *false* `not-run`, which is strictly worse than a missed one because it
converts a real failure into a warning. Under uncertainty the design fails towards the status quo.
The metacharacter screen doubles as the injection screen: a command that reaches the probe provably
contains no metacharacter, so neither can the token interpolated into `sh -c`. The probe adds no
execution surface to the trust boundary [ADR-0015](0015-verify-shell-trust-boundary.md) records —
the gate command itself already runs through a shell — and strictly reduces it, by not spawning
commands whose binary is absent.

`computeVerdict` excludes `not-run` from its failure predicate and each such gate contributes a
warning, so an otherwise-green plan yields `PASS WITH WARNINGS` and never a silent `PASS`.

**That degradation is a visibility measure, not an anti-bypass measure.** PASS WITH WARNINGS
delivers — it ALLOWs at the gate and will keep ALLOWing. What closes the bypass is a separate rule:
**the delivery gate refuses a run with no test evidence.** Two cases, both read off the block's
`gates` array:

1. the run recorded at least one gate named `test` and **every** such gate is `not-run`;
2. the run recorded at least one gate and **every** gate is `not-run`.

Either is BLOCK, with a reason naming the missing runner, and **no input waives it**. The verdict
itself stays `PASS WITH WARNINGS`: `verify` reports what ran, the delivery gate decides whether that
is enough to ship — the division of labour [ADR-0012](0012-tool-backed-delivery-gate.md) already
established. `/marvin:task-verify` therefore stays usable as a local convenience on a machine where
a runner is missing; only *delivering* on it is refused.

**The asymmetry is the point.** A missing optional scanner degrades to a warning; a missing test
runner refuses. A scanner's absence leaves the pipeline's central claim intact. The pipeline's
central claim is that delivered code was tested, so "no tests ran" is not a degraded proof, it is
the absence of one. In the limit, without this rule, a machine with none of the four binaries
installed would deliver green with zero gates executed.

Two limits, stated rather than hidden. A project that configures **no test gate at all** still
yields PASS and ALLOW — today's behaviour, unchanged here, and a minimum-evidence policy question
rather than a missing-binary one. And a *chained* test gate whose runner is missing still exits
non-zero and FAILs, which is stricter, not looser.

## Consequences

- **A stale proof stops being deliverable**, and the refusal explains itself: the block and the
  rendered reason carry the staleness verdict, the artifact the gate read, and the commit and branch
  the evidence was produced on. The escape hatch is one input, recorded in the block and carried
  into the PR body as an explicit override line.
- **`task-deliver` loses its two escape clauses.** Its prose licensed reusing a verdict already in
  context during a chained run, and hand-reading `verification.md` when the tool was unavailable.
  Neither path is freshness-checked, and the chained path is the pipeline's most common one, so both
  are removed: a freshness verdict is never reusable from context, and an unavailable tool means
  refuse rather than approve.
- **A contributor missing an optional scanner can deliver again**, which was the original point, and
  a contributor missing the test runner cannot — which is the part that had to be added before the
  first was safe.
- **Coverage of the `not-run` state is partial and stays partial.** It covers the built-in stack
  defaults (every one a single simple command except the C/C++ build) and any scanner a project pins
  bare as a whole gate command. It does not cover the chained form the configuration guide
  recommends. If chained gates turn out to be common, the honest next step is not a shell parser but
  widening the gate-key vocabulary so a scanner can be its own gate.
- **The provenance schema is mirrored twice on purpose.** `lib/reports.ts` keeps its
  no-sibling-imports, type-only-contract-imports rule, so the zod schema it validates is a local
  runtime mirror of `contracts/provenance.ts` — the same deliberate duplication the other block
  codecs carry. It is a double edit whenever the contract changes.
- **Freshness is invisible in a rich host.** `summary` is widget-bound and the desktop application
  renders `structuredContent`, so "the text fallback names the file it read" cannot be seen exactly
  where the defect is displayed. Carrying the source path into `TaskSummary` would cost a contract
  edit, a widget change and nine committed baselines for a label; instead the *gate* names the
  artifact it read at the decision point, and writer and reader share one slug rule so the widget
  cannot join against a foreign run in the first place. A freshness badge is the obvious follow-on
  once there is a design worth spending that cycle on.
- **Two extra git reads per delivery.** The digest is four short spawns and runs at most twice —
  once at verification, once at the gate. It re-reads the bytes of every dirty file through git,
  which is the honest cost of content identity and is bounded by the 5,000-path cap. Outside a git
  worktree the whole computation is skipped and the gate stays a pure file read.
- **Rollback is deleting a directory.** Every reader falls back to `.marvin/task/verification.md`,
  which this change never stops writing, and `provenance` is optional on read, so artifacts written
  by an older `verify` stay readable in both directions.
