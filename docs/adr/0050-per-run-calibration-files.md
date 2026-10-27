# ADR 0050 — One calibration file per finished run, not one appended log

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-10-18 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` convention the new directory follows), [ADR-0043](0043-task-workflow-metrics.md) (the metrics series, whose one-record-per-spec layout this copies for the same reason), [ADR-0044](0044-deterministic-metrics-anchors.md) (the finalize commit that carries a tool-written record beside its own writes) |

## Context

The autopilot engine ends every run with a finalize step (`finalizeRun` in
`pipeline/learning.ts`). With a pull request open, finalize applies the retro, marks the spec
shipped, and records what the run cost and what it learned, then commits those files on the run
branch and pushes. Since plan Task 19 the cost record was one JSON line appended to
`.marvin/pipeline/calibration.jsonl`, a single file every run on the host shares. Its readers are
`efficacy` (through `calibrationRecords` in `pipeline/runtime.ts`, which judges whether a lesson
reduced the findings it targets), and the orchestrator's cost estimate at spec approval
(`skills/autopilot/references/judgments.md` §4), which takes the median cost of earlier runs on
the same tier and declines to estimate below three records.

A shared, append-only file is a merge conflict waiting for two writers. On 2026-10-17 two runs on
one host each started from a base that had no `calibration.jsonl`, each created it in its finalize
commit, and the second pull request could not merge (an add/add conflict, judgment 006 of run
`r20261017-1930-d2eb`). Nothing in either run was wrong. Release 0.30.0 answered with
`mergeBaseForFinalize`: finalize first joins the base tip to the gated commit when that merge is
clean, so a record the base gained while the run went on is appended to rather than written over.

That removes the case where the first run's pull request has merged before the second run
finalizes, which was the 2026-10-17 case. It does not remove the class. Two runs that both
finalize before either pull request merges still each append a line at the end of the same file,
and git's three-way merge reports two insertions at the same point as a conflict, whether the file
existed on the base or not. The `merge=union` attribute in `.gitattributes` would resolve it in a
local merge, but the pull request merge GitHub performs applies no merge attributes, so the
conflict surfaces exactly where a human has to resolve it. The 2026-10-18 workflow audit (F11,
§5.4) named the remaining class and recommended one file per run.

`checks.yaml` has the same shape on paper, a single file the retro appends rules to, but not the
same exposure: a run adds a rule rarely, the rules are merged by `id` so a duplicate is skipped
rather than written twice, and a conflict there is a disagreement about project rules that a human
should see. It stays one file.

## Decision

1. **One file per finished run.** Finalize writes a run's calibration record to
   `.marvin/pipeline/calibration/<run-id>.json`, pretty-printed JSON with a trailing newline,
   through the same `writeWhole` every other finalize write goes through, and never writes
   `.marvin/pipeline/calibration.jsonl` again. The run id is already required to be a plain
   token (`[A-Za-z0-9][A-Za-z0-9._-]*`) before finalize does anything, so it is a safe file name
   without a second rule. The directory is a target of every check finalize already applies to its
   paths: a symbolic link anywhere on the way is refused, a hard link is refused, and uncommitted
   or ignored content under `.marvin/pipeline` refuses the whole finalize before the first write.
2. **A second finalize of the same run overwrites its own file.** The JSONL layout replaced the
   line carrying the run's id so that a finalize replayed after a failed push did not count the run
   twice. The per-run file has that property by construction: the file name is the identity, and a
   replay that computes the same record changes nothing, so the replay commits nothing and pushes
   the commit it already made, as before.
3. **Readers read both layouts.** `readCalibrationRecords(root)` in `pipeline/learning.ts` is the
   one reader: every regular `*.json` file under `calibration/`, then every line of a legacy
   `calibration.jsonl` if one exists, fail-open per file and per line, with a record whose
   `runId` appears in both layouts taken from the per-run file. `calibrationRecords` in
   `runtime.ts`, and through it `efficacy`, go through it. `efficacy` orders records by their `ts`
   field, never by file order, so a directory listing changes nothing for it. The orchestrator's
   cost estimate reads the directory and the legacy file the same way, with the median still taken
   over the records of one tier and still absent below three records.
4. **The legacy file is frozen, not migrated.** A host's existing `calibration.jsonl` keeps its
   records and is never rewritten, appended to or deleted by the engine. Deleting it would
   conflict with any run branch still open that an earlier engine finalized against it, and the
   readers see its records where they are, so there is nothing a migration would gain. A host may
   remove it by hand once no such branch is open. The `merge=union` attribute stays for the same
   reason, and is irrelevant to the new directory.
5. **The verification of the finalize commit follows the layout.** `verifyContents` compares the
   per-run file, parsed, with the record finalize computed: a formatter may change its layout and
   may not change the record, as with the rules in `checks.yaml`. The check runs twice as before,
   on the bytes read after the format command and on the blobs of the finalize commit.

## Consequences

- Two runs that start from one base and finalize in any order, before or after either pull
  request merges, add two different files under `calibration/` and merge cleanly. The base merge
  of 0.30.0 stays: it still serves `checks.yaml`, the lesson index and the spec, and it still puts
  the base's new records in the run's worktree, which the retro reads.
- The record's content is unchanged (`CalibrationRecord`: `ts`, `runId`, `tier`, `stageA`,
  `signalsReasons`, `aggregate`, `findingCategories`, `exposedLessons`), so nothing that computes
  from a record changes. Only where it lives does.
- A host's `.marvin/pipeline/` grows one file per run. Each is a few kilobytes and the git history
  of a run's PR already carries a comparable commit, so the cost is a directory listing. A
  deliberate side effect: a record is now readable by its run id without parsing the rest of the
  series, which the orchestrator's `status` and a human reading a PR both benefit from.
- A run finalized by an engine before this record, on a branch still open, appends to the legacy
  file and merges as before. A run finalized by this engine against a base that gained a legacy
  line meanwhile conflicts nowhere, since it does not touch that file.
- A `format_command` that is a project Prettier formats `.json` by default, so a host that excluded
  `calibration.jsonl` from Prettier through `--ignore-unknown` needs nothing new; the record is
  written in Prettier's own layout, and a layout change is tolerated anyway.
- The documentation that names the file changes with it: `docs/configuration.md`, the
  `.marvin/pipeline/` row of `CLAUDE.md`, the autopilot skill's `judgments.md` and
  `report-formats.md`, §3.6 of the implementation plan and the comments in `.gitignore` and
  `.gitattributes`.
- Not done here: a tool-backed reader for the orchestrator (it still reads the files itself,
  as the skill prose instructs), and any change to `checks.yaml`, whose exposure is argued above
  to be small enough to leave.

## Alternatives considered

- **Keep the single file and rely on the 0.30.0 base merge.** Removes the common case only. Two
  runs whose pull requests are both open at finalize time still conflict, and that is the normal
  state of a host running two tasks at once, which is what parallel runs are for.
- **Keep the single file and rely on `merge=union`.** Resolves a local merge only. GitHub's merge
  applies no `.gitattributes` merge driver, including the built-in `union`, so the conflict is
  reported in the pull request. The attribute was already in place on 2026-10-17 and did not help.
- **Let finalize retry on a conflict: fetch, rebase its append, push again.** Trades one race for
  a narrower one between the fetch and the push, runs rebases on a branch the gate approved, and
  still leaves two open pull requests conflicting with each other until one merges.
- **Write the record outside the repository (the run directory only).** The run directory under
  `MARVIN_PIPELINE_HOME` already keeps a copy for a run without a PR. But the record is the host's
  calibration data, shared by everyone who runs the pipeline against that host, and the cost
  estimate at spec approval must see runs made from other machines. Only the repository carries
  it there.
- **One file per spec, like `.marvin/metrics/`.** A spec can be run more than once (a cancelled run,
  a halt and a second attempt), and two attempts on one spec would be two writers of one file
  again. The run id is the identity of what is being recorded.
