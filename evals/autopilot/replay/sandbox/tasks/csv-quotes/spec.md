---
slug: csv-quotes
type: feature
status: shipped
risk: medium
---
# CSV quoted fields

The reference spec for the bench task `csv-quotes`: the contract a careful planner would write. Read by `marvin-pipe assess` to check the suite's `tier_expected`; never shown to a pipeline child.

```yaml spec-contract
files:
  - { id: F1, path: src/csv.mjs, action: edit, satisfies: [AC1, AC2, AC3] }
  - { id: F2, path: test/csv.test.mjs, action: new, satisfies: [AC1, AC2] }
  - { id: F3, path: test/report-quoted.test.mjs, action: new, satisfies: [AC3] }
criteria:
  - id: AC1
    statement: a quoted field may hold commas, newlines and doubled quotes, and unquoted input parses as before
    implemented_by: [F1, F2]
    oracle: { kind: test, ref: test/csv.test.mjs }
  - id: AC2
    statement: an unterminated quoted field throws a SyntaxError
    implemented_by: [F1, F2]
    oracle: { kind: test, ref: test/csv.test.mjs }
  - id: AC3
    statement: totals() sums a column of rows that hold quoted fields
    implemented_by: [F1, F3]
    oracle: { kind: test, ref: test/report-quoted.test.mjs }
```
