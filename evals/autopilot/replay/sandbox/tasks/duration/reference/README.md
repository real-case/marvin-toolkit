# bench-sandbox

A small utility library: arithmetic helpers, string helpers, CSV parsing and a report built on it.
Every module is an ES module under `src/`; tests run with `node --test`.

| Module           | Exports                                 |
| ---------------- | --------------------------------------- |
| `src/math.mjs`   | `add(a, b)`, `mean(values)`             |
| `src/strings.mjs`| `capitalize(text)`                      |
| `src/csv.mjs`    | `parseCsv(text)`                        |
| `src/report.mjs` | `totals(csvText, column)`               |
| `src/index.mjs`  | everything above                        |

## Durations

`parseDuration(text)` turns `1h30m`, `45s` or `2m500ms` into milliseconds (units `h`, `m`, `s`,
`ms`, in that order, each at most once) and throws a `TypeError` on anything else.
`formatDuration(ms)` is its inverse. `node bin/duration.mjs 1m5s` prints `65000`.
