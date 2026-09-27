---
id: validate-the-same-canonical-form-the
type: bug-pattern
title: Validate the same canonical form the matcher compiles
created: 2026-09-27
tags: validation, normalisation, scope, glob
source: "PR #214"
---

A guard that checks a raw input while the consumer uses a normalised form of it can be bypassed through the normalisation step. In scope.exempt, the only-wildcards guard tested the raw pattern, so `./**` passed (the `.` counted as a literal) and canonicalPattern then stripped `./` to `**`, which exempted every file. When a function both validates and normalises, run every validity check on the normalised value, and include one case in the tests that only becomes invalid after normalisation.
