# ADR 0054 — The hunt state is an append-only ledger, a flow map and per-file coverage under `.marvin/hunt/`

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-11-19 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` directory), [ADR-0024](0024-mcp-apps-widget-architecture.md) (shared zod contracts), [ADR-0038](0038-finding-identity-and-triage.md) (fingerprints), [ADR-0053](0053-hunt-command-family.md) (the commands that write it) |

## Context

The bug hunter (ADR-0053) needs to remember, across runs, machines and people: which defects it
has found, what was ruled on each, which a person closed, which code it has already read, and
how a user moves through the product. That memory is what keeps a weekly hunt from reporting the
same twenty findings every week, and what lets a person's "won't fix" stick.

## Decision

1. **One directory, `.marvin/hunt/`**, configurable with `MARVIN_HUNT_DIR`:

   | Path | Committed | Contents |
   | --- | --- | --- |
   | `findings.jsonl` | yes | the ledger |
   | `flows.json` | yes | the flow map |
   | `coverage.json` | yes | per-file audit history |
   | `reports/<run-id>.md`, `reports/latest.md` | yes | rendered reports |
   | `runs/<run-id>/run.json` (+ a `flows.json` snapshot) | no | one run's scope, hotspots, steps, recorded ids |
   | `evidence/<finding-id>/` | no | test output, traces, screenshots |

   The tool writes `.marvin/hunt/.gitignore` with `runs/` and `evidence/`; it never edits a
   `.gitignore` it did not create. A host that ignores `.marvin/` must negate this directory to
   share the ledger, and `hunt-init` says so when git ignores it.
2. **The ledger is append-only.** Each line is a `LedgerLine` with `v: 1` and one of five
   types: `finding` (written once, with the id, fingerprint and everything the tool owns),
   `verdict`, `status`, `link` and `seen` (a sighting in a later run). The current state of a
   finding is the fold of its lines in order. No line is ever rewritten, and the history of
   every ruling is the file itself. Two branches that both hunted append to the same last line,
   which git's default text merge calls a conflict, so the tool writes
   `.marvin/hunt/.gitattributes` with `findings.jsonl merge=union` (never overwriting one that
   exists): a union merge keeps both sides' lines, which is the correct resolution for
   independent events. A ledger merged without it is read anyway; its conflict-marker lines are
   reported by line number, and the lines between them still fold.
3. **Identity is ADR-0038's fingerprint.** `sha256` over `hunt:<check>:<class>`, the primary
   location (first file, else route, else component), the taxonomy category and the title slug,
   first 16 hex characters. Line numbers are excluded for ADR-0038's reason. A claim whose
   fingerprint is already in the ledger is a `seen` event for an open finding, is suppressed for
   one a PERSON rejected (a `human` `reject`) or closed as won't-fix, and reopens a fixed one as
   `regressed`. A rejection by the referee or by a green test is an agent's call and does not
   suppress: the sighting is recorded and reported, and a person can reopen it. Ids are
   `BH-` plus the first eight hex digits of the fingerprint, derived rather than allocated, so
   two branches cannot mint one id for two findings. Should two fingerprints share eight digits,
   the later id grows two digits at a time. In a merged ledger a second `finding` line with the
   same id and fingerprint folds as a sighting; one with the same id and a different fingerprint
   never overwrites the first and is reported as an id conflict by `status` and `triage`.
4. **Every artefact has a zod contract and a version.** `contracts/hunt.ts` in the shared
   library holds `FindingClaim`, `HuntFinding`, `LedgerLine`, `FlowMap`, `Coverage`,
   `HuntConfig` and `HuntRun`. Every read validates; every write validates before it touches the
   disk; JSON files are written atomically. A file whose version is newer than
   `HUNT_STATE_VERSION` is refused with a message that says to upgrade, never misread or
   overwritten. The JSON Schemas an agent is pointed at
   (`skills/hunt-code/references/schemas/*.schema.json`) are generated from the contracts by
   `scripts/gen-hunt-schemas.mjs` and byte-checked by `test/hunt-schemas.test.mjs`.
5. **The flow map is shared and survives regeneration.** Nodes (screens), transitions (user
   actions) and journeys (goals, with a priority) each carry provenance, confidence, sources and
   a `pinned` flag. A regenerated map is merged over the previous one so a pinned entry survives,
   the answer lists what appeared and disappeared, and a map that references a node or
   transition it does not define is refused before anything is written.
6. **Configuration is the `hunt` key of `.marvin/config.json`**, validated on its own rather
   than through the shared `Config` schema, so a typo in it cannot reset the board's statuses or
   the verify gates for every other tool, and an invalid `hunt` block is an error for the hunt
   tool alone. Foreign keys survive the read-modify-write.
7. **Coverage records what was read.** At `finalize`, every file of a hotspot batch the run
   checkpointed is written to `coverage.json` with its blob hash, the run and a count of
   findings, which the next hotspot ranking reads.

## Consequences

- A person's verdict is durable: it is in a committed file, and a later run cannot quietly
  re-raise what they closed.
- The ledger grows without bound. At one line per event it stays small for years of weekly
  runs; a compaction tool can be added later because the fold is the only reader.
- A malformed line is skipped and reported by `triage` and `status` rather than failing the
  read, so one bad merge does not lock the ledger.
- The run record lives in the repository's `.marvin/hunt/runs/`, git-ignored, rather than under
  a state root outside the tree as the autopilot's does: a hunt is driven by the session that
  started it and has no detached engine to outlive it.

## Alternatives considered

- **One JSON file per finding.** Rejected: every ruling would rewrite a file, two branches
  would conflict on the same finding, and the history of rulings would live only in git.
- **Store the ledger in `.marvin/report/` beside the triage baseline.** Rejected: that directory
  is the `report` tool's own local, git-ignored state; the ledger is a shared record.
- **Hand-written JSON Schemas as the source of truth.** Rejected: two definitions of one shape
  drift; the generated files are a view of the contract, not a second contract.
