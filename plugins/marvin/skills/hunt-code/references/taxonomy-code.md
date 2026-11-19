# Code defect taxonomy (CODE-D01…D25)

The categories a `marvin-hunt-hunter` hunts for, by id. A claim names exactly one in
`category`. Each entry says what to look for, the trap that makes it a false positive, and the
class and severity a confirmed instance usually takes. "Usually" is not a rule: severity is set
by the impact on the user, per [severity.md](severity.md).

A category is a place to look, not a verdict. Every claim still has to say how an input or
state reaches the line (`reproduction.path_feasibility`) and what guards were checked
(`not_false_positive`).

| Id | Category | Look for | False-positive trap | Class · usual severity |
| --- | --- | --- | --- | --- |
| CODE-D01 | Null and undefined access | A value that can be absent (optional field, `find`, map lookup, failed parse, empty response) used without a check | A schema, a type guard or an earlier return already rules the absence out | bug · high |
| CODE-D02 | Boundaries and off-by-one | `<` vs `<=`, inclusive ranges, first and last page, empty and single-element collections, slice ends | The off-by-one is compensated elsewhere, or the boundary cannot be reached | bug · medium |
| CODE-D03 | Inverted or incomplete condition | A negation in the wrong place, `&&` for `\|\|`, a missing branch in a switch over a union, an `else` that swallows a new case | A lint rule or exhaustiveness check already fails the build | bug · high |
| CODE-D04 | Missing input validation | User or network input reaching logic, storage or another service unchecked: length, range, format, whitespace, type | Validation happens at a boundary the hunter did not read (middleware, schema, ORM) | bug · high |
| CODE-D05 | Swallowed error | `catch {}` or a catch that logs and continues as if it succeeded; a promise whose rejection nobody handles; an ignored return code | The error is deliberately non-fatal and the fallback is correct | bug · medium |
| CODE-D06 | Async ordering | A missing `await`, a fire-and-forget write that is read back immediately, `forEach` with an async callback, results used before they settle | The call is deliberately detached and nothing reads its result | bug · high |
| CODE-D07 | Race and check-then-act | Read, decide, write without a lock or a conditional write; double submit; two tabs; concurrent jobs on one record | A unique constraint or a transaction already serialises it | bug · high |
| CODE-D08 | Resource leak | A listener, timer, subscription, file handle, connection or object URL created and never released on the error path or on unmount | The runtime releases it on scope exit | bug · medium |
| CODE-D09 | Shared mutable state | A module-level cache or array mutated per request; props or arguments mutated in place; a default parameter object reused | The state is genuinely per-process configuration | bug · medium |
| CODE-D10 | Equality and coercion | `==` across types, comparing objects by reference, string vs number ids, `NaN`, truthiness of `0` and `""` | Both sides are guaranteed the same type | bug · medium |
| CODE-D11 | Numeric correctness | Money in floating point, integer overflow, division by zero, rounding direction, percentages that do not sum | The precision loss is below what the domain displays | bug · high |
| CODE-D12 | Dates, times and zones | Local vs UTC, DST transitions, end-of-month arithmetic, parsing without a zone, comparing date strings | The value never leaves one zone and is never displayed | bug · medium |
| CODE-D13 | Text and locale | Byte vs character length, case folding, Unicode normalisation, sorting with the default collation, string building of user-visible sentences | The text is internal and ASCII by construction | bug · low |
| CODE-D14 | Missing authorisation | A handler that acts on an id from the request without checking the caller owns it; a role check on the client only | The data layer scopes every query by tenant or owner | bug · critical |
| CODE-D15 | Session and authentication | Token accepted when expired or empty, logout that leaves a session usable, a redirect target taken from input | The framework's own auth middleware covers it | bug · critical |
| CODE-D16 | Injection | Input concatenated into SQL, a shell command, a file path, a regex, HTML or a template | The value is parameterised or escaped before it gets there | bug · critical |
| CODE-D17 | Partial writes and lost data | Several writes that must succeed together without a transaction; a form that discards input on error; an update that overwrites fields it did not read | The writes are idempotent and retried as a unit | bug · high |
| CODE-D18 | Retries and idempotency | A retry around a non-idempotent call; a webhook or job handled twice; a payment or email sent twice | An idempotency key is checked | bug · high |
| CODE-D19 | Caching and staleness | A cache never invalidated on write; an optimistic update never reconciled; a memo with missing dependencies | The staleness window is accepted and documented | bug · medium |
| CODE-D20 | Limits and pagination | An unbounded query or list; a page loop that stops early or never stops; a client that shows only the first page | The data set is bounded by the domain | bug · medium |
| CODE-D21 | Configuration defaults | A default that is wrong in production (debug on, a test key, a localhost URL); a missing variable that falls back silently | The fallback is only reachable in development | bug · high |
| CODE-D22 | Contract mismatch | Client and server disagree on a field name, type, unit, enum value or status code; a schema change that one side did not follow | A generated client keeps both sides in step | spec-drift · high |
| CODE-D23 | Unreachable code that should run | An early return or a wrong condition that leaves a cleanup, an audit log or a notification dead | The dead path is a leftover with no behaviour anyone relies on | bug · medium |
| CODE-D24 | Performance on a hot path | N+1 queries, quadratic loops over user data, a synchronous heavy call on a request or render path, a re-render storm | The input is small by construction; measure before claiming | perf · medium |
| CODE-D25 | Systemic pattern | The same defect in several places, usually copied code or a misused helper | Each occurrence has its own guard | the class of the pattern · the worst occurrence |

## Claiming a systemic pattern (CODE-D25)

Record one claim whose `location.files` holds the clearest occurrence and whose `occurrences`
lists every other one. Do not record one claim per copy: triage would have to merge them, and
the ledger would count one root cause as many bugs.

## Out of scope for this check

Style, naming, structure and dead code with no behaviour are `/marvin:refactor-smells`.
Vulnerability scanning against advisories and secrets is `/marvin:sec-scan` and
`/marvin:sec-secrets`. A hunter that finds one of these mentions it in its notes and does not
record it.
