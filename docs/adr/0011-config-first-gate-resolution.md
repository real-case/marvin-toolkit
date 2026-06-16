# ADR 0011 — Config-first gate resolution for `verify`

| Field         | Value                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                                                                                                |
| Date          | 2026-06-16                                                                                                                             |
| Supersedes    | —                                                                                                                                      |
| Superseded by | —                                                                                                                                      |
| Related       | [ADR-0004](0004-tool-backed-verification.md) (the `verify` tool), [ADR-0007](0007-portable-spec-contract.md) (open stack detection), [ADR-0009](0009-marvin-working-directory.md) (`.marvin/` working dir) |

## Context

`verify` (ADR-0004) detects a project's quality gates from a five-entry `STACK_TABLE`
(Go, Python, TypeScript, Rust, Java), each mapping an ecosystem to a _canonical_
toolchain — `pytest`/`ruff`/`mypy`, `npm test`/`npx eslint`/`npx tsc`, and so on. ADR-0007
(alpha.6) added a declared-command fallback (`package.json` scripts → `Makefile` targets)
for ecosystems **outside** the table.

The table is stack-agnostic by _ecosystem_ but not by _toolchain_, and the declared-command
fallback only runs when **no** tabled marker file is present. So for a tabled stack the
hardcoded commands always win:

- A Python project on `tox` / `uv` / `hatch`, a Rust project on `cargo nextest`, a TypeScript
  project on `vitest` / `bun`, or any project whose lint / type-check differs from the table
  default silently gets the _wrong_ command.
- The only escapes were the per-call `gates` argument and the spec's `test_command` — both
  opt-in and ephemeral, re-supplied on every invocation, never durable.

Determinism and stack-agnosticism are the same move here: execute the commands the project
_declares_, rather than commands _inferred_ from an ecosystem marker.

## Decision

Add an optional **`gates`** object to `.marvin/config.json` — a durable, per-project
declaration of gate commands — and make `verify` resolve the plan **config-first**:

1. explicit per-call `gates` — wholesale override (programmatic / tests);
2. **`.marvin/config.json` `gates`** — per gate; a declared gate replaces the detected
   command of that name, gates left unset fall back to detection;
3. auto-detection — `STACK_TABLE`, then the declared-command fallback.

```json
{ "gates": { "test": "vitest run", "lint": "biome check .", "typecheck": "tsc --noEmit" } }
```

- The merge is **per gate**, not all-or-nothing: a project can pin only its test command and
  keep the table's lint / build. Output stays in canonical gate order, and the report's
  `Stacks:` line appends `.marvin/config.json` so an override is visible, never silent.
- A malformed config is surfaced as a verification **warning** and falls back to detection —
  never a silent swap to defaults (the existing `loadConfig` already validates and warns).
- `gates` lives in the same `.marvin/config.json` the kanban tools already use (ADR-0009),
  read through the same loader, honouring `MARVIN_TASKS_CONFIG`.

## Consequences

### Positive

- **Any stack, any toolchain, verified deterministically** by declaring its commands once —
  no dependence on the table matching the project's actual tools.
- More deterministic: the plan is read from a file, not inferred from an ecosystem marker.
- Backwards-compatible: no `gates` key → byte-identical detection behaviour, guarded by a
  parity test.

### Negative / accepted trade-offs

- Two declaration surfaces now exist (the config file and the per-call `gates` argument);
  precedence is fixed and documented to keep it predictable.
- `gates` keys are not strict — a typo (`tests:`) is stripped by the schema and silently falls
  back to detection. Accepted to match the rest of `Config`; the `Stacks:` line and the
  dry-run plan make the effective set inspectable.
- `STACK_TABLE` remains as the zero-config default; it is now a convenience, not the source of
  truth.
