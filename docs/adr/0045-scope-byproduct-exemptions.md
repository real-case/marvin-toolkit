# ADR 0045 — By-product files are exempted from a task's scope by project configuration

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-09-27 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0003](0003-tool-backed-dor.md) (the `spec` tool whose scope gate this widens), [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` convention behind the one exemption that already existed), [ADR-0043](0043-task-workflow-metrics.md) (Q1 `scope_drift`, which gains an `exempt` field, and the null-means-absent rule it follows), [ADR-0026](0026-configurable-status-model.md) (the precedent for a project-owned list in `.marvin/config.json` that replaces rather than extends) |

## Context

A spec's `files` list is the allowlist for a task's changes. Two places enforce it, and both read
the changed set from `changedFilesForScope` in `lib/git.ts`: the scope gate (`spec action:
"scope"`), which FAILs on any changed file outside the list unless the caller passes it in `allow`
as a recorded SPEC GAP, and the metrics roll-up, which lists the same files as Q1
`scope_drift.undeclared`. Both hard-coded one exemption: anything under `.marvin/`, and the spec
file itself.

The records of one host project, vantage-erp-1, show what that single exemption misses. Its 38
metrics records carry 43 `spec-gap` events. Fourteen of them are not spec defects at all:

| Kind of file | SPEC GAPs | Why no author can plan it |
|---|---|---|
| `.claude/agent-memory/**` | 6 | Reviewer subagents write notes into their own memory directory, and the host's memory contract has the calling session commit them. |
| `*.d.mts` sidecars | 4 | The host requires a hand-written declaration file beside any `.mjs` a strict-TS test imports. |
| `bun.lock` | 1 | Adding the one permitted devDependency rewrites the lock file. |
| files under `.marvin/` | 3 | Already exempt; the session recorded a gap the gate never raised. |

The same by-products inflate Q1 in every record: re-judging the sixteen records that carry a
`scope_drift` block moves 69 of their 691 undeclared paths (61 agent-memory notes, 5 sidecars,
3 lock files) out of `undeclared`. Each of those SPEC GAPs was written by hand, re-read by the
critic, and reproduced in a PR body, and each undeclared path is noise in the one metric meant to
show scope creep.

## Decision

### 1. A project-level list, `scope.exempt`, in `.marvin/config.json`

`scope: { exempt: string[] }` is an optional key holding path patterns. A changed file that the
allowlist does not name and that matches a pattern is not a violation. It is reported separately,
never silently: the gate's detail names every exempted path with the pattern that took it, and the
metrics record lists it under `scope_drift.exempt`.

Precedence is fixed: marvin's own `.marvin/` files and the spec file are removed first, as before;
then the allowlist; then the exemptions. A file the contract declares is therefore always counted
as declared, and an exemption can only ever turn a would-be violation into a reported by-product.

### 2. marvin ships no defaults

An absent key means no exemptions, and the scope gate's answer is byte-identical to the answer it
gave before this record. `.claude/agent-memory/**` was the strongest candidate for a default, being
a Claude Code convention rather than a host's own, and it was still rejected, for three reasons:

- **A gate should widen only by the project's decision.** A default would change the verdict of
  every installed project on upgrade, including one that does not want reviewer notes committed in
  a feature PR and relies on the gate to catch them.
- **Every candidate is a convention of some host.** Whether agent memory is committed at all,
  whether a lock file exists and what it is called, whether sidecars are hand-written: none of these
  holds across hosts, and a wrong default is worse than none because it hides the change it exempts.
- **The upgrade stays inert.** Q1 of an existing series does not shift because marvin was upgraded;
  it shifts on the day the project adopts a list, and `exempt` stops being null on that day, so a
  reader of the series can see where the definition changed.

A present list replaces the empty default rather than extending anything, as `statuses` does.

### 3. One matcher, one partition, shared by both callers

`lib/scope.ts` holds `partitionScope`, which splits a changed set into `judged`, `outside` (the
gate's violations, Q1's `undeclared`), `exempt` and `rejected`. The gate and the roll-up both call
it, so they cannot disagree about which paths are marvin's own, which are by-products and which are
violations, the same reason `changedFilesForScope` lives in `lib/git.ts`. The `.marvin/` and spec
exclusion, previously written out twice, moved into it.

The matcher is hand-written, about thirty lines, rather than a dependency. The server bundles every
dependency into `dist/server.js`; `picomatch` and `minimatch` exist in the tree only as development
dependencies of other tools; and `path.matchesGlob` is experimental on Node 20, which CI still runs.
The grammar is deliberately small: `**` as a whole segment for any depth, `*` within one segment,
`?` for one character, a trailing `/` for everything under a directory, and every other character
literal. Wildcards match a leading dot, because by-products live in dot-directories often enough
that the shell's dotfile rule would only produce patterns that look right and never match. Every
pattern is anchored at the project root, so one rule covers every pattern, unlike `.gitignore`,
where a slash anywhere changes where a pattern applies.

A pattern the matcher cannot honour (empty, absolute, containing a backslash or a `.`/`..` segment,
starting with `!`, or made only of wildcards, which would exempt every file) is ignored by
`compileExemptions`, the one place validity is decided. `/marvin:track-config` refuses to write
such a pattern. One edited in by hand is reported by the gate as a warning, by the roll-up as a
note, and by the configuration view and the dashboard, but the loader does not rewrite the list: if
it did, the gate would have nothing to name.

### 4. Q1 gains `exempt`, nullable

`scope_drift` gains `exempt: string[] | null`. It is null when the project configures no list,
because the source is absent and a count of zero would claim a check that never ran; it is an empty
list when a list is configured and nothing matched. `changed` keeps counting every judged file,
exempt ones included, so it does not move when a project adopts a list; only `undeclared` does. The
contract marks the field optional as well, because records rolled up before it existed lack it, and
a reader treats that exactly as null. The series gains a `scope_drift_exempt` row, present only for
records rolled up under a list.

## Consequences

- A by-product the project has exempted needs no SPEC GAP, and `task-implement`, the executor and
  the diff critic now say so. A by-product it has not exempted is still a FAIL, and the prose asks
  the session to suggest the pattern when it recurs.
- The scope gate now reads `.marvin/config.json`, with the one-argument `loadConfig` every other
  `spec` action uses, so an absent file costs no git call. A config file that cannot be applied,
  which the gate previously never noticed, now adds a `scope-config` warning: without it the gate
  would silently be stricter than the project asked for.
- An exemption list can hide real scope creep if a pattern is written too broadly. The guards are
  the visibility of every exemption in the gate's answer and in the record, and the refusal of a
  pattern that is only wildcards; a narrow pattern remains the project's responsibility.
- The changed set itself is untouched. Diffing against the merge-base rather than the base
  branch's tip is a separate change to `changedFilesForScope`, and most of the undeclared paths
  that remain in the host's records are that drift, not by-products.

## Alternatives considered

- **Ship `.claude/agent-memory/**` as a default.** Rejected for the reasons in §2.
- **Defaults that a project list extends, rather than replaces.** This leaves a project no way to
  opt out of a default short of a negation grammar, which is exactly the part of `.gitignore`
  semantics that surprises people.
- **Exempt through `allow` on every call.** This is today's behaviour, and it is the cost this
  record removes: the same paths re-entered by hand on every task, each recorded as a gap.
- **Take a glob library.** Rejected in §3: bundle weight and a new runtime dependency for a grammar
  that needs three operators.
- **Drop an invalid pattern at load, as `tracker_url_template` is dropped.** The gate could then no
  longer say why a file the user believed exempt still fails, which is the one place that answer is
  needed.
