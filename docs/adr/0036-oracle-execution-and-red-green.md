# ADR 0036 — Acceptance oracles are executed and journalled, not narrated

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-08-15 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0015](0015-verify-shell-trust-boundary.md) (the shell trust boundary this **extends**), [ADR-0003](0003-tool-backed-dor.md) and [ADR-0004](0004-spec-contract-schema.md) (the oracle graph the DoR gate validates), [ADR-0009](0009-config-first-gate-resolution.md) (the precedence chain generalised here), [ADR-0002](0002-tool-backed-verification.md) (the gate runner whose spawn primitive is reused), [ADR-0035](0035-evidence-provenance.md) (the `runs/` directory the journal lives in), [ADR-0024](0024-mcp-apps-widget-architecture.md) (the `AcOutcome` contract this does **not** change) |

> Extends [ADR-0015](0015-verify-shell-trust-boundary.md) rather than superseding it. 0015 stays
> accepted and unedited; its three load-bearing clauses are re-examined in **Trust boundary** below,
> and two of them survive verbatim.

## Context

Every acceptance criterion in a sealed spec carries an `oracle` — `{kind, ref}` — and the
Definition-of-Ready gate validates it: the kind is typed, a `kind: test` ref must name a file the
contract's own `files` list declares, and every criterion must trace to files and tests. That
graph is checked at seal time and then **never executed**. Two things follow, and both are silent.

**The red-green proof is prose.** `/marvin:task-implement`'s bugfix pipeline says, in step 6B, "run
only the new regression test; detect the test runner from project config", and in 8B "run the
regression test again". Whether either ever happened is not recorded anywhere, so
`/marvin:task-deliver` lets a bugfix ship on a red-green pair nobody observed. The delivery gate
already refuses a run with no test evidence at all; it has nothing to say about a *specific*
criterion.

**The task summary reports an outcome it cannot support.** `toAcOutcome` in `tools/summary.ts` read

```ts
const passed = verify?.verdict === "PASS" || verify?.verdict === "PASS WITH WARNINGS";
const real = cr.oracle.kind === "test" || cr.oracle.kind === "command";
return { ...base, outcome: passed && real ? "pass" : "unknown" };
```

That is a gate-level verdict promoted to a per-criterion claim. Every test- or command-backed
criterion reported `pass` whenever the suite was green — including a criterion whose test was never
written, and one whose test was written and never run. The file header claimed the opposite ("the
summary never fabricates a per-AC pass/fail it cannot prove"), which is how the wrong invariant
survived review: the comment described the intended design and the code did something else.

This is not conservatism to be refined. It is an over-claim, and the correction is the more
valuable half of this decision.

## Decision

### 1. `verify` gains `action: "oracles"`, and it runs only sealed contracts

A third action beside `run` and `gate`. Given a `specSlug` — 0035's input, validated against
`/^[a-z0-9]+(-[a-z0-9]+)*$/` — it resolves the spec, extracts its `spec-contract` block, recomputes
the seal, and **refuses before any child process** when the digest does not match the stamped
`contract_sha`, or when the frontmatter carries none at all. Then, for each selected non-prose-review
criterion, it resolves a command and either runs it or records `not-run`.

The criterion selector is `criteria`. The existing `only` input keeps its meaning — `z.array(z.enum(GATE_NAMES))`,
"run only these gates" — because widening it to accept criterion ids would delete the gate-name enum
validation that the executor's self-test and `/marvin:task-verify` depend on, and turn a typo into a
silent early return.

### 2. Resolution is a precedence chain whose failure mode is silence

[ADR-0009](0009-config-first-gate-resolution.md)'s order, generalised from gates to criteria:

1. the per-call `command` argument;
2. the criterion's own `oracle.run` (new, optional);
3. for `kind: "command"`, `oracle.ref` verbatim — that is already what a command ref means;
4. for `kind: "test"`, `gates.test_one` from `.marvin/config.json` with `{file}`, `{name}` and
   `{ref}` substituted;
5. a three-row default table — pytest, `go test`, `cargo test`;
6. otherwise `{command: null, source: null, reason}` — **`not-run`, never a guess**.

Every run records which rung produced its command, so the resolution success rate is a query over
the journal rather than a study.

The table has three rows because exactly three runners meet one criterion: the documented
single-invocation form consumes a file path and a test name, and the stack detector matches exactly
one such runner. There is deliberately **no JavaScript or TypeScript row**. This repository is the
measured counter-example — its own `npm test` fans out to three workspaces running `node --test`,
vitest and Playwright — so a synthesized `node --test --test-name-pattern …` would run the wrong
workspace's suite or none, and report green from a suite that never contained the test. That is
strictly worse than `not-run`. A row is added on a measurement, never by analogy.

### 3. `test_one` is a sibling key of `GateCommands`, never a fifth gate name

It is declared in the config schema — zod strips undeclared keys silently, which ADR-0009 already
records as an accepted trade-off, so an undeclared `test_one` would vanish inside `loadConfig` with
no error anywhere to observe. It is **not** added to `GATE_NAMES`, for two independent reasons.
`GATE_NAMES` is mirrored by the shared `GateName` contract that the task-summary widget consumes and
nine committed visual baselines render, so widening it is a contract change for a value that is not
a gate. And it would become *schedulable*: a single-test command running on every verify, its exit
code entering the verdict that gates delivery. The guarantee that it cannot is mechanical rather
than conventional — all three gate paths iterate the `GATE_NAMES` tuple rather than the object's
keys, so a key outside that tuple is structurally unreachable as a gate.

### 4. The journal is `runs/<slug>.oracles.md`, append-only, keyed by the seal

One fenced ` ```json oracle-run ` block per run, appended, never rewritten whole — the property
`verification.md` lacks, and the reason a red recorded an hour ago survives the green that follows
it. Each entry carries the slug, the `contract_sha`, the criterion id, the referenced test file and
the hash of its bytes, the `head_sha`, the resolved command with its `source`, the exit code and
signal, and the timestamp.

**Reading filters by `contract_sha` before anything else, in code.** Keyed by criterion id alone, a
spec amended and re-sealed would report a proof for a contract that no longer exists — a silent
failure that reads as a pass, which is the one defect class this whole decision exists to remove.

The location is a subdirectory and that is load-bearing, because the obvious filename is the broken
one. Four call sites across three modules classify any top-level `.md` in the spec directory as a
spec: `scanTaskReports` in `lib/reports.ts`, `findLatestSpec` in `tools/summary.ts` — which takes the
alphabetically **last** name, where `oracles.md` outranks every `NNN-` prefix — and both `specDigest`
and `artifactCounts` in `lib/state.ts`. None descends into a subdirectory, so `runs/` is invisible to
all four by construction rather than by an exclusion list that rots.

### 5. The red-green check ships as a WARNING

`deliverGate` reports `red_green: "proven" | "missing" | "unknown"` and, in the `missing` case,
contributes a sentence to `reason`. It does **not** touch `decision`, which stays two-valued. With no
slug supplied the field is `unknown` and no sentence is added, so the change is strictly additive
against every existing caller.

Blocking is deferred deliberately. Command resolution has never been measured on a real project,
this repository has zero bugfix specs to calibrate against, and 74% of its own oracles are
`kind: test` refs that need a `test_one` no project has yet declared — so a blocking veto today
would refuse delivery for the resolver's *silence* rather than for a missing proof, and the first
response would be to disable it. The measurement that would promote it is the resolution success
rate: across real runs, the share of `regression: true` criteria whose oracle resolved to a runnable
command rather than recording `not-run`. The `source` and `reason` fields exist to make that a
query. The data cannot come from this repository, which is measured rather than assumed: 28 spec
files, all `type: feature`, zero `regression: true` criteria. It comes from a downstream project
that declares a `test_one`, or from this repository's first bugfix spec, whichever arrives first.

### 6. The task summary reports recorded outcomes, and the gate-level inference is deleted

`toAcOutcome` now reads the journal, filters to the spec's current `contract_sha`, and lets the
newest entry for the criterion decide: a recorded green is `pass`, a recorded `expect: pass` run
that exited non-zero is `fail`. A red-only entry, a `not-run` entry, an unsealed spec, a stale seal
and an absent journal are all `unknown`. **The verify verdict no longer participates at all.**

Keeping it as a fallback "for compatibility" was rejected. It would preserve the over-claim behind a
new feature, and would make the shipped summary byte-identical to today's for every project that has
not declared a `test_one` — which is every project — while this record announced recorded outcomes.

`AcOutcome` keeps its three values. A fourth member such as `not-run` was rejected: it is a shared
contract change consumed by the widget and nine committed baselines, for information the journal
already holds precisely, and the widget would render an unknown enum member with no styling at all.

### 7. One seal algorithm, one home

`contractHash` moves from private in `tools/spec.ts` to exported from `storage/spec.ts`, beside the
already-exported `extractContractBlock`, and both callers import it. `storage/` is the layer both
tools may import, and a tool importing another tool is a shape this repository does not have. The
alternative — re-deriving `createHash("sha256")…slice(0, 16)` inside `verify.ts` — is a second copy
of the seal that drifts the first time either is touched, leaving a spec that reads sealed to
`spec mode: "seal"` and tampered to the oracles action, with no way to tell which is right.

**Adding `oracle.run` requires no seal migration, and none may be written.** The hash digests the
block's raw **text**, never a parsed or re-serialised structure, so widening what the parser accepts
cannot move the digest of a block already on disk. Every `contract_sha` stamped into an existing
spec stays valid. This is recorded because it is not obvious: a reviewer who assumes the hash covers
the parsed shape will look for a migration that must not exist, and an implementer who "helpfully"
normalises the hash input invalidates every sealed spec at once.

## Trust boundary — the three ADR-0015 clauses this strains

**"Marvin does not inject commands of its own."** The `spec-contract` block becomes a **fourth**
command-declaration surface, beside `.marvin/config.json` `gates`, `package.json` scripts and
`Makefile` targets. The clause survives in substance: the command is still one a human wrote into
this repository, not one Marvin synthesized. What is new is that the declaring file is a spec rather
than a build manifest, and the control for that is the seal — the block is hashed, the oracles
action refuses to run a contract whose `contract_sha` does not match, and refuses an unsealed one
outright. A command changed after the Definition-of-Ready gate ran is therefore *detectable* rather
than merely discouraged.

**"`verify` is the only place the server uses `shell:true`."** Still true, and now true by
construction rather than by inspection. The child-process primitive is extracted out of `runGate`
into one `spawnCommand(command, cwd)`, and the gate runner and the oracle runner both call it; the
exit trichotomy (`code === 0` pass, a clean non-zero fail, a null code or a non-null signal an
execution error, an `error` event a launch failure) is stated once in `classifyExit` beside it. A
reader counting two actions would otherwise assume two sites. The extraction is also what keeps the
red phase honest: a copy that lumped "non-zero or null" together would read a missing runner's 127
and a timeout's SIGKILL alike as "the test failed before the fix" — exactly the evidence a red phase
must never fabricate.

**The default table interpolates spec-authored data.** The existing stack detectors already
synthesize bare commands — `go test ./...`, `cargo test`, `pytest` — so a synthesized command is not
itself new. What is new is interpolating spec-authored values (`{file}`, `{name}`) into one. The
control is refusal, not sanitisation: a `ref` or a substituted value containing `;`, `|`, `&`, a
backtick, `$(`, `>`, `<` or a newline yields `not-run` with the reason `unsafe-ref`, and no child
process is started. Substitution is literal and the template author owns the quoting — the
placeholder commonly sits inside a flag they already quoted, and wrapping it again produces a
command that fails for a reason nobody can read. The threat model here is a spec author's typo or a
copied ref that silently gains a pipeline, not an attacker reaching a running system: the contract
is sealed before any of this runs.

**Path handling.** The journal path is `projectRoot` plus the validated `specSlug` token — the same
kebab-case rule the DoR gate applies. Rejection, not sanitisation: a slug that does not match
resolves no spec and writes no file. This is why the action reuses `specSlug` rather than
introducing a `specPath`; a raw path would have to be sanitised, and a sanitiser can be wrong, where
an allowlisted kebab-case token cannot express a traversal at all.

## Consequences

### Positive

- A `regression: true` criterion's red→green pair becomes evidence rather than narration, and the
  delivery gate can name which criterion lacks one.
- The task summary's per-criterion outcomes become earned. Every remaining `pass` names a run.
- `spawnCommand` and `classifyExit` are free of gate vocabulary, so the next caller — a timeout, a
  per-gate environment, a `not-run` gate state — does not have to launder its subject into a gate.

### Negative / accepted trade-offs

- **A user-visible behaviour change on upgrade.** `/marvin:task-summary` reports `unknown` where it
  reported `pass`, for every project, until runs are recorded. That is the correction, not a
  regression, and it is called out in the changelog as a **Changed** entry so nobody has to guess.
  There is no compatibility flag: the flag's default would decide whether the fix shipped at all,
  and the behaviour it restores is one the tool cannot support.
- **A fourth command-declaration surface**, bounded by the seal as above.
- **One `test_one` per project** cannot serve a polyglot repository — this one being the example,
  with three runners across three workspaces. Such a project declares `run:` per criterion instead.
  A `test_one` keyed by path glob is future work; the single string is the smaller step that makes
  the map's value measurable first.
- **This repository resolves its own oracles to `not-run`** until it declares a `test_one`, and the
  configuration doc says so plainly. That is the honest zero the promotion measurement starts from.
