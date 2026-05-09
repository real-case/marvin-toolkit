# ADR 0001 — Source format: keep `plugins/` Claude-native

| Field         | Value                                                |
| ------------- | ---------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off — see below)  |
| Date          | 2026-05-08                                           |
| Phase         | Phase 4 of the multi-target scaffolder plan          |
| Supersedes    | —                                                    |
| Superseded by | —                                                    |

## Context

The marvin-toolkit repo grew a CLI installer (`marvin`) with a
target-adapter abstraction that lets non-Claude editors render its
plugin packs. PR-3 shipped a Codex adapter as a deliberately narrow
proof of concept. With a real second target on disk, we now have
data to answer the question that's been deferred since Phase 0:

> Should `plugins/<pack>/` stay in its current Claude-native shape, or
> should we refactor it into a target-neutral source format (a "neutral
> DSL") with Claude becoming one renderer among many?

This ADR records the decision and the evidence that drives it. It also
records what would have to change to revisit it later.

## Options on the table

### Option A — Status quo (Claude-native source)

Keep `plugins/<pack>/` exactly as today: SKILL.md frontmatter,
commands as `.md` slash-prompts, `.mcp.json` server bundles, etc.
Claude Code installs the pack directly via `/plugin install`. Other
targets render via adapters — every new target writes a translator.

**Cost:** every new target is a new adapter implementation.
**Benefit:** zero migration; the marketplace install path stays
trivially correct.

### Option B — Neutral DSL

Introduce a neutral source format, e.g. `packs/<pack>/skills/<name>/skill.md`
with target-agnostic frontmatter (purpose, parameters, examples, tool
requirements). Add a Claude renderer alongside Codex/Cursor renderers;
the marketplace ships rendered Claude artifacts generated at build time.

**Cost:** one-time migration of all 3 packs (35+ skills, 27+ commands,
8 agents); new build pipeline; risk of designing the DSL wrong before
we have enough renderers to validate it.
**Benefit:** every target becomes a 1st-class citizen; no "Claude-favoured"
asymmetry; new targets need only a renderer, not a translator.

## Decision

**Adopt Option A.** Keep `plugins/<pack>/` Claude-native. Add new
adapters when needed; defer Option B until the evidence base is
materially larger.

## Evidence

Numbers from the head of `feat/multi-target-scaffolder` after PR-3 lands:

| Measurement                                            | Value                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Codex adapter size                                     | **149 lines** ([codex.mjs](../../cli/src/adapters/codex.mjs))                          |
| Codex line budget set in plan                          | 200 lines                                                                              |
| Claude-specific special-cases in Codex adapter         | **6** (3 `unsupported` branches + 3 null-`pathFor` returns + 1 frontmatter strip + 1 `unsupportedPack` + 1 MCP→TOML helper, double-counting allowed) |
| Adapter contract surface                               | 7 methods (5 required, 2 optional) — fits in [67 lines of JSDoc](../../cli/src/adapters/types.mjs) |
| Public packs in scope today                            | 3 (core, security, taskmaster)                                                         |
| Targets shipping                                       | 2 (claude, codex)                                                                      |
| Externally requested 3rd targets                       | 0 (no tickets, no DMs, no issues at time of writing)                                    |

The 200-line budget mattered because the plan said this:

> If [the Codex adapter] exceeds [200 lines], the abstraction is
> leaking and Phase 4 should consider a neutral source format.

149 lines is **74% of budget** — comfortable margin, not "barely fit."
The 6 special-cases are concentrated in two methods (`unsupported` and
`pathFor`); they're the kind of branching every adapter will need
because Codex, by design, doesn't model Marvin's full primitive set.
That's not a leak — that's the reduction that adapters exist to perform.

## Consequences

### Direct

- `plugins/<pack>/` stays in its current shape. No migration work.
- Adding a new target is "write an adapter" — not "extend the DSL plus
  write a renderer plus migrate fixtures."
- The marketplace install path (`/plugin install`) keeps working with
  no special treatment; it's reading the same files Claude users
  reference in their prompts.

### Costs we accept

- Other targets always render Marvin from a Claude-shaped source.
  Lossy mappings (e.g. agents → unsupported on Codex) are visible in
  the `skipped` array and documented per-target.
- New skills are written with Claude's affordances in mind. Future
  adapters may have to leave more on the floor.

### Reversibility

This decision is reversible. If we hit any of the trigger conditions
in the next section, we re-open Phase 4 and consider Option B.
`plugins/<pack>/` is small enough today (~50 markdown files + a few
helpers) that a one-shot migration is feasible if the evidence shifts.

## When to revisit

Re-open this decision if **any** of the following becomes true:

1. **Adapter complexity creeps past the budget.** A second adapter
   measurably above 200 lines, or a third adapter that copy-pastes
   significant logic from another. (This would suggest the abstraction
   is leaking and a neutral source would let us share more.)
2. **An ecosystem ask.** Two or more concrete external requests for
   the same non-Claude target, or one request from a high-visibility
   collaborator we want to support.
3. **A skill-in-Claude that can't be expressed Claude-natively.** If
   we ever want to express a workflow that *requires* targeting Codex
   primitives (or Cursor, or Cline) the source needs to grow that
   vocabulary, and a neutral DSL is the natural place.
4. **Non-trivial fidelity loss reports.** Multiple users telling us
   "the Codex eject lost behaviour X that I needed."

Any one of (2) or (3) would itself trigger re-opening; (1) and (4)
need to accumulate before they do.

## Sign-off

Solo-maintainer sign-off per the cross-cutting policy in the
multi-target scaffolder plan:

- **Author:** Yurii Anichkin
- **Date:** 2026-05-08
- **Comment:** the Codex PoC came in well under the budget the plan
  set as a tripwire. Until that changes, the cost of a neutral DSL
  isn't paying for itself.

External review would be welcome but is not a blocker; this ADR is
committed to repo and any future maintainer can supersede it.

---

## Playbook — adding a new adapter (companion to Option A)

A one-page recipe distilled from the Codex experience.

### 0. Decide whether this target should exist

Before writing code, answer two questions:

1. **What primitives does the target model?** Codex models prompts
   (slash-commands), MCP servers, and a TOML config file. It does
   *not* model subagents. List what's there and what isn't.
2. **What % of Marvin's vocabulary survives?** For Codex,
   marvin-core-pack survives mostly intact (skills as prompts);
   marvin-taskmaster-pack does not (subagents are central). Before
   committing to the adapter, decide which packs you'll claim
   support for.

If <50% of any pack survives, ask whether it's worth shipping.

### 1. Write the adapter

Create `cli/src/adapters/<name>.mjs`. Implement the 5 required +
2 optional methods documented in [adapter-contract.md](../adapter-contract.md):

- `name`, `unsupported`, `pathFor`, `render`, `manifestPath`,
  `manifestSchema`, optional `postWrite` and `unsupportedPack`.

Reach for `injectHeader` from `eject-core.mjs` if your target wants
the same idempotent origin marker (it almost always does — re-running
must produce byte-identical output).

Stay under **200 lines**, including helpers. If you exceed, that's
your signal to re-read this ADR and consider Option B.

### 2. Register it

```js
// cli/src/adapters/index.mjs
import myAdapter from "./my-adapter.mjs";
REGISTRY.set("<name>", myAdapter);
```

### 3. Build a fixture

```shell
# Add a generator script alongside cli/scripts/gen-codex-fixture.mjs
node cli/scripts/gen-<name>-fixture.mjs   # one-shot
```

Pin `today` to a fixed date in the generator so the fixture diff
test is reproducible.

### 4. Write the test

Two layers:

- **Unit:** every method on the adapter, each branch in `unsupported`,
  each `pathFor` shape. ~10 tests.
- **Integration:** ejected-tree-vs-fixture diff. One test, but high
  signal — it catches every behaviour change.

### 5. Document the target

Add `docs/<name>-target.md` covering:

- Pack matrix (which packs are supported, which are rejected).
- Mapping table (skill → ?, command → ?, agent → ?, MCP → ?, manifest → ?).
- Exit codes (especially if you use `unsupportedPack` → exit 3).
- A manual smoke transcript section (placeholder OK initially).
- A regenerate-fixture instruction.

### 6. Wire CI

Add three lines to [validate-plugins.yml](../../.github/workflows/validate-plugins.yml):

```yaml
- name: Test <name> adapter
  run: node --test cli/src/adapters/<name>.test.mjs

- name: Smoke-test marvin init --target=<name>
  run: |
    REPO="$GITHUB_WORKSPACE"
    scratch=$(mktemp -d)
    (cd "$scratch" && node "$REPO/cli/bin/marvin.mjs" init <pack> --target=<name> --source "$REPO" --offline >/dev/null)
    # Plus exit-code-3 check for any unsupportedPack rejection if applicable.
```

### 7. Bump versions

- `cli/package.json` minor bump (new public target).
- No pack bumps; packs didn't change.
- Update [cli/README.md](../../cli/README.md) target table.

### 8. Open the PR

Reference this ADR in the PR description. If the adapter exceeded
200 lines or required new orchestrator features, flag it explicitly
— that's the first datapoint for re-opening Phase 4.
