# ADR 0056 — An oracle run is classified, and only "ran and failed" counts as a red

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-11-26 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0036](0036-oracle-execution-and-red-green.md) (the journal and the red→green proof), [ADR-0055](0055-autopilot-delivery-requires-a-proof.md) (the proof the autopilot requires) |

## Context

An `oracle-run` record held `status`, `code` and `durationMs`. A red was "a non-zero exit". A
test file that failed to import, a collection error, a run that found no tests and a missing
binary (exit 127) all exit non-zero, so each was read as a proven red although no test body ever
ran. ADR-0055 made the proof blocking in the autopilot, which made this the weak point of the
proof. The fleet plan "Fleet oracles that can fail" item F6b asks marvin to classify a run the
way platform-agent-factory does (`docs/oracles-that-can-fail.md`, step 2), so both tools judge
one red alike.

## Decision

1. **Each run is classified**, with the factory's names (platform-agent-factory `7bdf2dee826b`,
   `lib/oracle-run.ts`): `failed` (ran and failed), `did_not_run` (collection, import or syntax
   error, setup error, skipped-only, a suite that failed with no results, no tests found, a crash,
   a kill, no resolved command), `passed`, plus marvin's `unknown`. The record gains optional
   `outcome`, `marks`, `runner` and `outcome_detail`.
2. **Marks** are the factory's regexes verbatim: `missing_name` and `missing_file` are
   informational, `snapshot` is refused as proof.
3. **Detection reads the runner's summary text** (`lib/oracle-classify.ts`), because marvin runs
   the project's own command and keeps no per-case report. Covered: pytest and vitest. A non-zero
   exit from anything else (jest, `node --test`, go, cargo, a plain command) is `unknown`, never
   `failed`: the factory refuses to fall back to the exit code and so does marvin.
4. **Only `failed` is a red** in `redGreenProof`, for every session, not only the autopilot. The
   gate's reason names why a recorded red was rejected.
5. **A record without `outcome` is unclassified**, parses as before, and is not a red.

## Consequences

- A host whose oracle commands run a runner marvin cannot read (including this repository's own
  `node --test`) gets no proven red until the runner is added, or the criterion declares
  `no_oracle`. Under the autopilot that BLOCKs; interactively it is the ADR-0036 warning.
- Journals recorded before this change need the red phase re-run.
- Adding a runner is one function in `lib/oracle-classify.ts` plus its fixtures.
