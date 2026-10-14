---
slug: clamp
type: feature
status: shipped
risk: low
---
# clamp

The reference spec for the bench task `clamp`: the contract a careful planner would write. Read by `marvin-pipe assess` to check the suite's `tier_expected`; never shown to a pipeline child.

```yaml spec-contract
files:
  - { id: F1, path: src/math.mjs, action: edit, satisfies: [AC1, AC2] }
  - { id: F2, path: test/clamp.test.mjs, action: new, satisfies: [AC1, AC2] }
criteria:
  - id: AC1
    statement: clamp(x, lo, hi) returns x bounded to the closed range [lo, hi]
    implemented_by: [F1, F2]
    oracle: { kind: test, ref: test/clamp.test.mjs }
  - id: AC2
    statement: clamp throws a RangeError when lo > hi
    implemented_by: [F1, F2]
    oracle: { kind: test, ref: test/clamp.test.mjs }
```
