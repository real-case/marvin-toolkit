# ADR 0048 — A `test_one` placeholder is shell-quoted by marvin, not by the template author

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-10-10 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0036](0036-oracle-execution-and-red-green.md) (the literal-substitution rule this **amends**), [ADR-0009](0009-config-first-gate-resolution.md) (the resolution chain whose `gates.test_one` rung this changes), [ADR-0015](0015-verify-shell-trust-boundary.md) (the shell trust boundary, unchanged) |

> Amends [ADR-0036](0036-oracle-execution-and-red-green.md) rather than superseding it. Its oracle
> journal, its resolution chain, its `unsafe-ref` refusal and its trust boundary are unchanged. One
> sentence of its **Trust boundary** section no longer holds: "Substitution is literal and the
> template author owns the quoting." This record replaces that rule.

## Context

ADR-0036 substituted `{file}`, `{name}` and `{ref}` into `gates.test_one` literally and left the
quoting to the template author, on the reasoning that a placeholder usually sits inside a flag the
author already quoted and quoting it again produces an unreadable failure.

The autopilot pipeline then became a second reader of the same template. Its seal stage runs one
whole sealed test file through `gates.test_one`, and it single-quoted the path it substituted and
refused a quoted `{file}`, because a single-quoted path inside another quote is a literal
character. The two readers now demanded opposite templates: the seal stage refused
`npx vitest run '{file}'`, and the oracle resolver behind `verify` `action: "oracles"` and the
pipeline's gate stage broke on `npx vitest run {file}` with a shell syntax error whenever the path
held a `(`.

Project O, the first host configured for the pipeline (Task 19 of the autopilot plan), has 189
`kind: test` criteria that resolve through `test_one`, and 147 of them name a file under a Next.js
route group such as `src/app/(dashboard)/` or `src/app/(admin)/`. No single template served both
readers there. The workaround in use, a `${VAR:-{file}}` indirection, satisfied the seal stage at
the cost of per-test oracles.

## Decision

1. **One encoder for both readers.** `lib/shell-quote.ts` (`fillShellTemplate`) is the only place a
   value is substituted into `gates.test_one`. `formatTestOne` in `pipeline/seal.ts` and the
   `test_one` rung of `resolveOracleCommand` in `storage/oracles.ts` both call it.
2. **The encoding follows the template's own quoting, read as a POSIX shell reads it.** An unquoted
   placeholder is single-quoted. Inside `'…'`, each `'` in the value becomes `'\''`. Inside `"…"`,
   `\`, `"`, `$` and a backtick are backslash-escaped. Behind a backslash the value is inserted as
   is. A template written for literal substitution (`pytest -k '{name}'`) therefore produces the
   same arguments as its unquoted form, and `npx vitest run {file}` is safe on a path containing
   `(`, `)`, a space, `[id]`, `$` or `'`.
3. **The oracle path treats `{name}` and `{ref}` the same way as `{file}`**, after the existing
   `unsafe-ref` screen. The screen is unchanged and still runs first: a ref that would reach the
   shell as a chain, pipe, substitution, redirection or newline is `not-run` before any encoding.
4. **The seal stage keeps its narrower contract.** It accepts `{file}` only, unquoted, and refuses
   `{name}`, `{ref}` and a quoted `{file}`, because it runs every test in one file and has no
   criterion to name.
5. **Built-in commands are not re-quoted.** The three-row default table of ADR-0036 keeps its own
   fixed command shapes and does not pass through the encoder; a `kind: command` ref is still the
   command itself and is never substituted into anything.

## Consequences

- A template author writes placeholders unquoted. `docs/configuration.md` now says so, and
  `npx vitest run {file}` serves `verify`, the gate stage and the seal stage alike.
- Existing quoted templates keep working in `verify` and the gate stage. The seal stage refuses a
  quoted `{file}`, as it did before this record.
- The asymmetry on `{name}` remains. A host whose seal stage needs a plain `{file}` template cannot
  also put `-t {name}` in it, so its oracle runs execute the whole test file rather than the one
  named test. The evidence stays valid, because a red and a green are still recorded for one file
  at one `contract_sha`, but a run takes longer and a red can come from another test in the file.
- The trust boundary is unchanged: encoding is applied to values that already passed the
  `unsafe-ref` screen, and the contract is sealed before any of this runs.

## Alternatives considered

- **Keep literal substitution and document the conflict.** It leaves no template that serves both
  readers on a host with route-group paths, which is most of project O's criteria.
- **Require quoted templates everywhere.** The seal stage would have to strip or re-read the
  author's quotes, and an unquoted template, the form most authors write first, would stay broken
  in the oracle path.
- **A separate template per caller** (for example a `test_file` key beside `test_one`). It solves
  the conflict with configuration surface and two templates that drift. The shared encoder makes
  one template correct for both, and the seal stage's narrower contract is a validation of that
  template rather than a second one.
