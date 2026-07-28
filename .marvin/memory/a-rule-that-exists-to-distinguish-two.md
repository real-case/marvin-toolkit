---
id: a-rule-that-exists-to-distinguish-two
type: process
title: A rule that exists to distinguish two behaviours needs a fixture where
  the wrong one fails
created: 2026-07-28
tags: testing, oracles, spec, diff-critic, task-implement, fixtures
source: dashboard-tool-v2
---

When a spec pins a rule precisely because two plausible implementations differ ("take the newest register REGARDLESS of finding count, not the newest register WITH findings"; "bucket by severity rank, not document order"), a test that merely asserts the right output is not a proof — it has to be built so the wrong implementation produces a different value. Both gaps shipped green on spec 018: the refactor fixture put its findings table in the newest register, so a stricter "newest with findings" rule would have passed identically, and every audit fixture happened to list findings in severity order, so document-order bucketing rendered the same line. Neither the DoR gate, the scope gate, the type-checker nor 218 passing tests can see this — only an adversarial reader who asks "would this test fail under the other reading?" The fix is cheap and mechanical: put the discriminating value in the position the wrong rule would pick (findings in the OLDER register, one out-of-rank severity first). Apply it at spec-writing time — when the second critic pass forces a disambiguating clause into a contract docstring, that clause is a signal that the oracle needs a discriminating fixture, not just an asserting one. Related: [[a-generated-manifest-row-breaks-tests]], which is the same failure class one level up (a caller grep that returns nothing is not proof of no callers).
