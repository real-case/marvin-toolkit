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
