# ADR 0037 — Spec corpus mechanics are tool-backed

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-08-15 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0022](0022-numbered-spec-files.md) (numeric-prefixed spec filenames — **amended**, not retired), [ADR-0005](0005-portable-spec-contract.md) (host-adaptive spec location), [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` service-file convention), [ADR-0027](0027-tool-backed-adr-lifecycle.md) (the ADR corpus mechanics this mirrors), [ADR-0003](0003-tool-backed-dor.md) (the `spec` tool this widens), [ADR-0009](0009-config-first-gate-resolution.md) (the config-tier precedent), [ADR-0035](0035-evidence-provenance.md) and [ADR-0036](0036-oracle-execution-and-red-green.md) (the `runs/` artifacts that stay pinned) |

## Context

The ADR family has had three primitives since [ADR-0027](0027-tool-backed-adr-lifecycle.md):
`resolveAdrDir` resolves the corpus directory config → detected → default, `readAdrCorpus` reads it
into typed records with a malformed channel, and `nextAdrNumber` allocates the next number. The spec
family — the older domain — described all three in English, in four different skills.

**The rule was implemented nowhere.** ADR-0022 §1 specifies that a spec's ordering number is the
highest leading-integer prefix in the chosen directory plus one, "zero-padded to at least 3 digits,
matching a wider width if the dir already uses one". No code in the server allocates a spec number,
and no expression implements that width rule. `parseSeq` in `storage/slug.ts` matches exactly three
digits and parses **board task** filenames, never a spec. The ADR parser tolerates three to five
digits and pads to a fixed four, and is ADR-only. The single expression that parses a *spec* prefix
lived in `specDigest`, and it reads a number without ever allocating one. The number was produced by
a model reading a directory listing — which is why the rule was stated in three skills and enforced
in none.

**Six enumerators disagreed about where specs live.** `SPEC_DIRS` is the ordered candidate list and
`resolveSpecBySlug` resolves one slug inside one directory. Above them: the DoR gate iterated
`[spec_location, ...SPEC_DIRS]` for `depends_on`; the task summary iterated `SPEC_DIRS` for a slug
and again for "the latest"; `verify` iterated it for an oracle run's slug; `specDigest` ignored the
list and hard-coded `.marvin/task`; and `artifactCounts` hard-coded the same path a second time.
Two rendered dashboard strings named that literal in prose. A project keeping specs under
`docs/rfcs/` was therefore invisible to the dashboard, and there was no tier anywhere in which such
a project could declare where its specs live — `spec_location` in `host-bindings` is per-spec and is
read only to resolve that spec's `depends_on`.

**One reader was quietly wrong.** `findLatestSpec` carried the comment "the newest spec (highest
numeric prefix)" over a body that sorted lexicographically and took the last entry. The two agree
only while every prefix has the same width — that is, only until the width rule above is honoured.
Implementing allocation without fixing the reader would have made a slugless `/marvin:task-summary`
silently summarise the wrong spec.

## Decision

**Give the spec corpus the same mechanics the ADR corpus has, then route every existing reader
through the result.**

### 1. Four primitives in `storage/spec.ts`

- `resolveSpecDir(projectDir, specConfig?)` → `{abs, rel, source: "config"|"detected"|"default"}`.
- `readSpecCorpus(dir)` → `{records, malformed}`; a record carries `{number, id, slug, title,
  status, contract_sha, filename, path}`, sorted by number descending with `null` last.
- `nextSpecNumber(corpus)` — the maximum over records **and** malformed files plus one, so a file
  the parser cannot read still holds its number.
- `specIdWidth(corpus)` / `formatSpecId(n, width)` — `max(3, longest observed prefix)`, the width
  rule ADR-0022 stated and nothing had executed.

`specSearchDirs(projectDir, specConfig?, hostSpecLocation?)` is the fifth, and it is about reach
rather than allocation: the resolver answers "where do NEW specs go", while a slug lookup must keep
finding a spec that already lives elsewhere. Resolution order changes; reach does not.

### 2. Detection order is code order

`SPEC_DIRS` keeps `.marvin/task` first, and the task-start prose is corrected to match rather than
the reverse. `resolveAdrDir` already leads detection with its own house default; every current
reader agrees with this order; and the alternative silently relocates the resolved directory for any
repository holding both a `.marvin/task/` and a host convention. A resolver whose answer changes
because an unrelated directory was added is worse than a mildly arbitrary order. The host-convention
preference ADR-0005 states survives where it is load-bearing — as the config tier for an explicit
answer, and as the per-spec `spec_location` binding for resolving a spec that already exists.

### 3. A config tier: `spec.dir`

`.marvin/config.json` gains an optional `spec: { dir }`. Detection cannot see a directory the host
has not created yet, and task-start asks the user to *choose* one; until now that choice was
recorded nowhere, so the next session re-derived it and could answer differently. Additive and
read-compatible: every existing config parses unchanged, and an absent block means detection.

### 4. `action` widens the `spec` tool; `mode` is a deprecated synonym

The tool accepts `action: dor | seal | scope | next | list`. `mode` keeps its three values and moves
from `.default("dor")` to `.optional()` — removing the default without that would make the field
required and reject every shipped caller, all of which pass no mode at all. The effective action is
resolved once, as `action ?? mode ?? "dor"`. Because inputs are strict, both keys can legally
arrive together; when they **disagree** the call is refused naming both, rather than answering
confidently for the winner.

`next` and `list` render through their own renderer and emit a ```json spec-corpus``` block — a
distinct tag, so a reader keyed on `spec-result` can never mistake a corpus answer for a gate
verdict. Neither ever sets `isError` for a corpus condition: an absent directory and an empty corpus
are answers (`next` = 1 → `001`), not failures. A malformed *input* — a slug that is not kebab-case,
rejected rather than sanitised — still is one.

### 5. The status-transition check goes on `seal`

`shipped` and `superseded` FAIL, naming the status and pointing at a new spec with `supersedes:`.
This belongs on seal rather than on dor: dor is only ever called by task-start on a spec it is
itself writing with `status: ready`, while seal is the gate a spec passes on the way *into*
execution. An absent status is a WARNING that says the check did not run — seal is legitimately
called on inline content whose frontmatter may be a fragment, and a silent pass there would report a
check that never happened. A status outside the vocabulary warns and echoes the value: a repository
using its own lifecycle words should not be unable to execute its specs. `draft` deliberately does
**not** block here; `task-implement` refuses one in prose, and what `draft` means on disk is a
decision the resumability work holds.

### 6. Three subordinate rules the code cannot state for itself

- **An unnumbered file counts as a spec only when its frontmatter identifies it as one.**
  `readSpecCorpus` cannot require a numeric prefix, because ADR-0022's Consequences guarantee that a
  legacy unnumbered `<slug>.md` keeps working. Dropping that requirement is harmless alone and
  unsafe composed with detection: a host repository with no `.marvin/task/` but a `specs/` directory
  — a very common name for API or test specs — would have its README, templates and unrelated
  markdown enumerated as pipeline specs in flight. A numeric prefix **or** a frontmatter
  `slug`/`type` is the cheapest predicate that keeps the guarantee and refuses the phantom corpus.
- **The dashboard's spec COUNT follows the same resolved directory as its digest.** Routing only the
  digest would leave one render naming two directories — the current-work zone listing specs read
  from `docs/rfcs/` while the Artifacts zone printed `Specs: 0 · .marvin/task/`.
- **The slugless summary target skips `draft` and unsealed records, with an unfiltered fallback.**
  `/marvin:task-summary` reports what a task delivered, and a spec that never passed the gate has no
  sealed criteria to report against. Once a `draft` skeleton is written to disk before authoring
  finishes, the newest record is routinely one. The fallback is what keeps a repository of legacy
  unsealed specs from being told it has none, and an explicit `slug` is never filtered: the rule
  governs the guess, never the instruction.

### 7. The artifact-location invariant

**A spec is a project document and stays host-adaptive (ADR-0005). Every artifact marvin GENERATES
about a run — `verification.md`, `runs/<slug>.md`, `runs/<slug>.oracles.md` — is a service file and
stays pinned under `.marvin/` (ADR-0007).** `spec.dir` therefore moves specs and moves no artifact.
This requires no reader to move, and it makes the `report` tool's `.marvin/`-scoped contract correct
by construction rather than by exception. If a project ever wants specs and their proofs
co-located, the honest mechanism is a second config key for the artifact root — not a rule that ties
the artifact to the spec directory.

## Consequences

- The number, the width, the collision check and the directory listing are computed by the tool.
  The judgements stay with the model: proposing a directory to the user, and deciding whether a slug
  collision is a supersede or a distinct task.
- **ADR-0022 stays `accepted` and is amended, not retired.** Its item 1 — allocation is prose-driven
  by the model — is mechanised here, and its Consequences bullet stating that the convention is "not
  mechanically enforced by the `spec` gate" is retired with it. Items 2 and 3 — identity is the
  slug; slug→file resolution is prefix-tolerant — still govern, and are what `resolveSpecBySlug`
  implements. Running `adr supersede` on that record would have retired all three, and a record
  cannot be both superseded and cited as authority. The mechanism this establishes for the corpus: an
  ADR that **narrows** an earlier one without retiring it adds a forward `Related` link, and the
  successor states which items it amends.
- **The `spec` tool is no longer only a validator**, which amends the clause ADR-0022's item 1
  shares a sentence with: "the model writes the spec file and the `spec` tool only validates it".
  The first half still holds — the model writes the spec file, and no tool in this toolkit authors
  one. What is retired is "only validates": alongside allocation, the tool now writes the per-spec
  **progress journal** under `runs/<slug>.progress.md`, appended through `action: "progress"` and
  read back through `action: "resume"` so an intake interrupted mid-dialogue, or an implementation
  run whose context was compacted, can report where it got to. The journal is the tool's only write,
  it is append-only, and it never touches the spec file — so the immutability the seal enforces is
  unaffected. Recorded here rather than in a second record because it narrows the same sentence of
  the same ADR that allocation does.
- A project with a configured spec directory now sees its specs in the dashboard's current-work zone
  and in its Artifacts count, and **not** in `/marvin:reports`, which scans `.marvin/` only. That is
  the contract `report` was given — it is the `.marvin/` viewer, not the spec viewer — and it is
  recorded here so the next reader finds a decision rather than a bug.
- A slugless `/marvin:task-summary` now picks the highest-numbered eligible spec rather than the
  lexicographically last file. On a corpus of uniform-width prefixes the two agreed; on a mixed-width
  corpus — which the width rule now makes reachable — they do not. This is a behaviour change users
  can observe.
- Removing the `spec` block from the schema returns the resolver to detection → default. A config
  file still carrying `spec.dir` is then silently stripped by zod, exactly as any other unknown key
  is (the trade-off [ADR-0009](0009-config-first-gate-resolution.md) records), so a downgraded
  server does not fail — it stops honouring the tier.
- No environment variable is introduced. `MARVIN_SPEC_DIR` deliberately does not exist: the tier is
  project data, which is what `.marvin/config.json` is for.
- No existing spec filename is migrated. The width rule applies to numbers allocated from now on;
  specs already carrying three-digit prefixes keep them and keep resolving.
