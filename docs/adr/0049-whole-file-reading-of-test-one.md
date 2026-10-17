# ADR 0049 — The seal stage reads `test_one` for a whole file instead of refusing its per-test parts

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-10-17 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0048](0048-shell-quoted-test-one-placeholders.md) (the seal stage's narrower contract this **amends**), [ADR-0036](0036-oracle-execution-and-red-green.md) (the oracle resolver, unchanged) |

> Amends [ADR-0048](0048-shell-quoted-test-one-placeholders.md) rather than superseding it. Its
> shared encoder, its per-context encoding and the oracle path are unchanged. Decision 4 ("the
> seal stage accepts `{file}` only, unquoted, and refuses `{name}`, `{ref}` and a quoted
> `{file}`") and the consequence that follows from it ("the asymmetry on `{name}` remains") no
> longer hold in the form written there. This record replaces them.

## Context

ADR-0048 made one encoder serve both readers of `gates.test_one`, and kept the seal stage on a
narrower contract: `{file}` only, unquoted. It recorded the cost. A host whose seal stage needs
that contract cannot put `-t {name}` in the template, so its oracle runs execute a whole test file
rather than the one named test.

Project O took the other side of that trade. Its committed `.marvin/config.json` holds
`npx vitest run "{file}" -t "{name}"`, which `verify` `action: "oracles"` uses to run one named
test, and which the oracle resolver accepts in both its quoted and its filtered parts. Autopilot
run `r20261017-1749-b2f2` against that host spent $3.21 on a planner and a test-author and then
stopped at the seal stage: `formatTestOne` threw on `{name}` before any test ran, and would have
thrown on the quoted `{file}` next.

The engine reads a run's config from the run's base commit (`runConfig`), so the run cannot be
repaired by editing the host's file, and editing it would cost the oracles their per-test
selection. The template is a valid instruction for the oracle path. What the seal stage lacked
was a way to read it for a whole file.

## Decision

1. **One whole-file reading of the template.** `wholeFileTemplate` in `pipeline/seal.ts` turns
   `gates.test_one` into the command shape that runs one whole test file, and every whole-file
   reader goes through it: the seal stage's probe and red runs (`formatTestOne`), the bench's
   hidden tests, and the verifier's probe prefix in `pipeline/runtime.ts`.
2. **A per-test filter is dropped together with its option, in one exact form only.** The template
   is split into words as a POSIX shell splits it at unquoted blanks. A filter is an option word
   (one or two dashes, a letter, then letters, digits, `_`, `.` or `-`) whose value is exactly one
   of `{name}`, `{ref}` or `{path}`, bare or as the whole of one quoted span. The value is the next
   word (`-t {name}`, `--grep '{ref}'`), follows a `=` (`--testNamePattern="{name}"`), or is
   attached to a one-letter option (`-t{name}`). The option and its value are cut together with
   the blanks before them, and the rest of the template is kept byte for byte.
3. **A `{file}` quoted as a whole span is the engine's to quote.** `"{file}"` or `'{file}'` in
   unquoted context is read as the placeholder including its quotes and becomes the engine's
   single-quoted path. The template author's quotes only made one word of the path, and the
   engine's quotes do that themselves. A `{file}` that shares its quoted span with anything else
   (`"./{file}"`, `sh -c 'vitest {file}'`, `'{file}'` inside `"…"`) is still refused: there the
   path is part of a longer string or is read again by another shell.
4. **Every other refusal stands.** A backtick, `$(`, `<<`, `#` or a newline anywhere in the
   template is refused, checked on the template as committed before anything is cut. A foreign
   placeholder in any other position (positional, `-t "^{name}$"`, inside `"-t {name}"`) is
   refused, and the message names the form that is accepted. So are a template without `{file}`
   and a `{file}` still quoted or escaped after the reading. The checks that follow the command's
   construction, the three static readings and the runner's own count of the files it ran, are
   unchanged and still decide whether exactly one file is selected.
5. **No new configuration key.** The fallback must accept the template exactly as a base commit
   holds it, so a seal-specific key would not have helped the run that prompted this record.

## Consequences

- `npx vitest run "{file}" -t "{name}"` now serves the oracle path, which runs one named test,
  and the seal stage, which runs `npx vitest run '<path>'`. The asymmetry ADR-0048 left on
  `{name}` is closed for a filter written as an option.
- The stopped run can resume from its seal stage on the host's config as committed.
- The verifier's probe prefix is cut from the whole-file reading, so a quoted `{file}` no longer
  leaves `npx vitest run "` in the read-only allowlist. A template the seal stage refuses gives
  the verifier no probe, and the engine notes why.
- Dropping the option assumes its only role is to narrow a run to tests inside the file, which is
  what the name filters of vitest (`-t`), jest (`--testNamePattern`), `node --test`
  (`--test-name-pattern`), pytest (`-k`) and Playwright (`--grep`) do. An option that took
  `{name}` for another purpose would be dropped too. The selection checks in Decision 4 still
  refuse a resulting command that selects a second file.
- `docs/configuration.md` now describes the whole-file reading instead of the narrower form.

## Alternatives considered

- **A seal-specific key (`gates.test_file`, or a key under `pipeline`) as a preferred override.**
  ADR-0048 already rejected a second template because the two drift apart, and a key added now is
  absent from every base commit written before it. It can still be added later as an override.
  The reading in this record would stay its fallback.
- **Fill `{name}` with a value that matches everything.** What matches everything differs per
  runner and per option (a substring, a regular expression, a pytest `-k` expression), and an
  empty value is an error for some of them.
- **Accept `"{file}"` with ADR-0048's double-quote encoding.** That encoding is also safe, but the
  seal stage would then build its command with two encodings depending on the template, while
  every check after it reasons about one single-quoted word.
- **Change the host's template.** It cannot reach a run whose base commit is fixed, and it would
  cost `verify` its per-test oracle runs.
