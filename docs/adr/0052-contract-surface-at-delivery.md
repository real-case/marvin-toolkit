# ADR 0052 — The delivery gate checks the contract's declared names against the code

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-11-08 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0004](0004-traceable-spec-contract.md) (the contract and its `signature`), [ADR-0012](0012-tool-backed-delivery-gate.md) (the delivery gate this extends), [ADR-0036](0036-oracle-execution-and-red-green.md) (the advisory `red_green` field this mirrors) |

## Context

A spec's `spec-contract` block carries `contract.kind` and `contract.signature`: the exact surface
the task promises, written before the code. The Definition-of-Ready gate checks the signature once,
and only for being non-empty (`checkContractField` in `tools/spec.ts`). Nothing after that reads it.
The scope gate compares the changed files with `files`, the oracles prove the criteria, and the
critics read the diff against the criteria. None of them compares the delivered code with the
signature. A task can therefore reach its pull request with a renamed, missing or relocated entry
point while every recorded check is green.

The signature is free text. The 110 sealed specs on this machine (marvin-toolkit and four host
projects) mix column-0 declarations, `// path` comments, prose, indented parameter lists, and lists
of names the task removes. Seventy-one are `kind: function`, eight `schema`, five `cli`, four
`route`, and twenty-two have no callable surface. A full signature comparison would need a parser
per language and a rule for each of those styles.

## Decision

1. **Read the decidable half of the signature.** A name counts as declared when it starts a line
   at column 0 in a declaration shape: `function name`, `const|let|var|class|interface|type|enum
   name`, `def|fn|func|struct|trait name`, the call shape `name(…)`, the alias shape `Name = …`,
   and `CONSTANT: …` for upper-case names. Indented lines, comment lines and block comments are
   not read. A name under a comment that says "removed", "deleted" or "dropped" is excluded,
   because the task takes it out of the code.
2. **Look for each name in the implementation files.** These are the contract's `files` rows that
   the task does not delete, minus documentation, test files by path, and every file a `kind: test`
   oracle names. A name found only in a test or a changelog has not been implemented. A name counts
   as present when it occurs as a whole word.
3. **Report it beside the decision.** The `deliver-gate` block gains `contract_surface`:
   `matched`, `missing` or `unknown`, computed on every decision as `red_green` is. On an ALLOW,
   `missing` adds one clause to the reason naming the absent names. `unknown` covers no slug, a
   missing, unsealed or tampered contract, `kind: none`, a signature with no readable declaration,
   and a contract whose implementation files cannot be read.
4. **Advisory, never a veto.** The field never changes `decision`. The reader is a heuristic over
   free text, and a refusal caused by the reader's blind spot would teach users to ignore the gate.
5. **Pure judgement, one reader.** `lib/contract-surface.ts` holds the extraction and the judgement
   and receives the file reader from the caller. The delivery gate reads only paths inside the
   project root.

## Measurement

The rule set above was run over the 110 specs against each project's current tree on 2026-11-08:
66 `matched`, 12 `missing`, 31 `unknown` (21 with no callable surface, 10 with no readable
declaration: routes, CLI usage lines and prose), and one contract that fails the schema. Every
marvin-toolkit spec read `matched`. All twelve `missing` answers come from one host project, and
every name they report is real drift against today's tree: all but one are absent from that host's
code entirely, and the remaining one, a type, now lives in files outside its contract. Those specs
shipped months ago, and the names were removed or moved afterwards.

A lower-case `name:` pattern, tried in an earlier draft, read route prose labels (`body:`,
`responses:`, `effect:`) as declared names and produced the only false warnings in the run. It is
restricted to upper-case constants for that reason.

## Consequences

- The delivery gate's block has one more key. `/marvin:task-deliver` still branches on `decision`
  alone; its skill relays a `missing` clause and asks which side is wrong, the code or the
  signature.
- A signature written as indented prose, or as a route or CLI usage line, stays `unknown`. The
  feature template asks for one column-0 declaration per public name, which is what makes the check
  read it.
- A correct name with wrong parameters still reads `matched`. Comparing parameter lists is not
  attempted.
- The verification-run journal does not record the field yet. A metric of signature drift would
  need it there first; that is left for when the field has been observed on real deliveries.

## Alternatives considered

- **An explicit `contract.exports` list.** Deterministic and free of false readings, but it adds a
  field to every spec, duplicates the signature, and covers none of the 110 specs already sealed.
  It remains available if the measured precision of the heuristic proves insufficient.
- **Block delivery on `missing`.** Rejected for the reason ADR-0036 gave for `red_green`: a gate
  that refuses on its own uncertainty is disabled at the first false refusal.
- **Check at the scope gate instead.** `spec action: "scope"` runs on the diff, before verification,
  and is not the call every delivery makes. The delivery gate is the one call `/marvin:task-deliver`
  always issues, so the answer reaches the user at the moment it matters.
