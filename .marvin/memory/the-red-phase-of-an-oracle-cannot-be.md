---
id: the-red-phase-of-an-oracle-cannot-be
type: process
title: The red phase of an oracle cannot be reconstructed after the code is green
created: 2026-09-05
tags: oracles, red-green, task-implement, verify, metrics, proof
source: metrics-record-guarantee
---

`verify action: "oracles"` with `expect: "fail"` has to run BEFORE the implementation lands: the journal keys a proof on the pair (contract_sha, test hash), so once the code is green every later run is another green and the red half is unrecoverable without reverting the change. Measured on `metrics-record-guarantee`: nine criteria, eighteen oracle runs, all green, and the delivery gate reported `red_green: unknown` while the metrics record stored `red_green: null` — the task shipped with no executable proof that its tests can fail. The gate treats the field as advisory and never blocks on it, so nothing in the pipeline forces the ordering; only the author does. Run the red phase at the moment each oracle is first written, not as a retrospective step before delivery.
