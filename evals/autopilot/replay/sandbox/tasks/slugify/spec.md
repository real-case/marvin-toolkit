---
slug: slugify
type: feature
status: shipped
risk: low
---
# slugify

The reference spec for the bench task `slugify`: the contract a careful planner would write. Read by `marvin-pipe assess` to check the suite's `tier_expected`; never shown to a pipeline child.

```yaml spec-contract
files:
  - { id: F1, path: src/strings.mjs, action: edit, satisfies: [AC1] }
  - { id: F2, path: test/slugify.test.mjs, action: new, satisfies: [AC1] }
criteria:
  - id: AC1
    statement: slugify(text) lower-cases text, joins runs of non-alphanumerics with one hyphen and trims hyphens
    implemented_by: [F1, F2]
    oracle: { kind: test, ref: test/slugify.test.mjs }
```
