---
slug: duration
type: feature
status: shipped
risk: low
---
# durations

The reference spec for the bench task `duration`: the contract a careful planner would write. Read by `marvin-pipe assess` to check the suite's `tier_expected`; never shown to a pipeline child.

```yaml spec-contract
files:
  - { id: F1, path: src/duration.mjs, action: new, satisfies: [AC1, AC2] }
  - { id: F2, path: src/index.mjs, action: edit, satisfies: [AC1] }
  - { id: F3, path: bin/duration.mjs, action: new, satisfies: [AC3] }
  - { id: F4, path: README.md, action: edit, satisfies: [AC4] }
  - { id: F5, path: test/duration.test.mjs, action: new, satisfies: [AC1, AC2] }
  - { id: F6, path: test/duration-cli.test.mjs, action: new, satisfies: [AC3] }
criteria:
  - id: AC1
    statement: parseDuration reads h, m, s and ms groups in order and throws a TypeError on anything else
    implemented_by: [F1, F2, F5]
    oracle: { kind: test, ref: test/duration.test.mjs }
  - id: AC2
    statement: formatDuration is the inverse of parseDuration and omits zero units
    implemented_by: [F1, F5]
    oracle: { kind: test, ref: test/duration.test.mjs }
  - id: AC3
    statement: node bin/duration.mjs prints the milliseconds of its argument and exits 2 on a bad one
    implemented_by: [F3, F6]
    oracle: { kind: test, ref: test/duration-cli.test.mjs }
  - id: AC4
    statement: README.md documents both functions and the CLI
    implemented_by: [F4]
    oracle: { kind: manual, ref: README.md }
```
