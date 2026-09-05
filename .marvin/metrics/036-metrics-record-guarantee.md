# Metrics — metrics-record-guarantee

Append-only. One `metric-event` block per live event; one `task-metrics` block per delivery, the last authoritative (ADR-0043).

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-09-04T18:31:44.591Z","verdict":"PASS WITH WARNINGS","gate":"dor","call":1}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-09-04T18:32:27.518Z","verdict":"PASS WITH WARNINGS","gate":"dor","call":2}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"8F","kind":"critic-dispatch","contract_sha":null,"at":"2026-09-04T18:32:27.685Z","critic":"marvin-tm-spec-critic","pass":1}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"8F","kind":"critic-verdict","contract_sha":null,"at":"2026-09-04T18:41:59.323Z","critic":"marvin-tm-spec-critic","pass":1,"verdict":"BLOCK","blockers":3,"warnings":5}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-09-04T18:41:59.511Z","verdict":"PASS WITH WARNINGS","gate":"dor","call":3}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"8F","kind":"critic-dispatch","contract_sha":null,"at":"2026-09-04T18:41:59.690Z","critic":"marvin-tm-spec-critic","pass":2}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-09-04T18:51:27.833Z","verdict":"FAIL","gate":"dor","call":4}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-09-04T18:51:27.993Z","verdict":"PASS WITH WARNINGS","gate":"dor","call":5}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-start","step":"8F","kind":"critic-verdict","contract_sha":null,"at":"2026-09-04T18:51:28.156Z","critic":"marvin-tm-spec-critic","pass":2,"verdict":"BLOCK","blockers":2,"warnings":5}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"6F","kind":"spec-gap","contract_sha":"df50aac639313c74","at":"2026-09-04T19:05:07.345Z","detail":"scope gate flagged docs/proposals/unbounded-intake-dialogue.md — a pre-existing untracked file from 2026-08-31, unrelated to this task; allowed past the gate and deliberately NOT staged"}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"fix-cycle","kind":"fix-round","contract_sha":"df50aac639313c74","at":"2026-09-04T19:09:28.632Z","loop":"verify-gate","round":1}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"6F","kind":"critic-dispatch","contract_sha":"df50aac639313c74","at":"2026-09-04T19:20:54.024Z","critic":"marvin-tm-diff-critic","pass":1}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"fix-cycle","kind":"fix-round","contract_sha":"df50aac639313c74","at":"2026-09-04T19:27:26.257Z","loop":"critic","round":1}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"6F","kind":"spec-gap","contract_sha":"df50aac639313c74","at":"2026-09-04T19:29:51.160Z","detail":"the task own metrics record .marvin/metrics/036-metrics-record-guarantee.md is committable and task-deliver step 2 stages it, but it is not one of the contract 29 files rows — it is minted by the pipeline, not by the implementation"}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"fix-cycle","kind":"fix-round","contract_sha":"df50aac639313c74","at":"2026-09-04T19:35:20.894Z","loop":"verify-gate","round":2}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"6F","kind":"critic-verdict","contract_sha":"df50aac639313c74","at":"2026-09-04T19:39:33.743Z","critic":"marvin-tm-diff-critic","pass":1,"verdict":"BLOCK","blockers":2,"warnings":5}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"6F","kind":"critic-dispatch","contract_sha":"df50aac639313c74","at":"2026-09-04T19:39:33.906Z","critic":"marvin-tm-diff-critic","pass":2}
```

```json task-metrics
{"slug":"metrics-record-guarantee","contract_sha":"df50aac639313c74","type":"feature","risk":"medium","breaking":false,"spike_required":false,"created":"2026-09-04","rolled_up_at":"2026-09-05T08:43:27.809Z","head_sha":"610e725983649bdde4a788cb201710dd66bfb6cb","base_branch":"dev","sources":{"spec":"present","progress":"present","oracles":"present","verify_journal":"present","verify_result":"present","critique":"present","events":"present","git":"present"},"time":{"intake_ms":2571382,"implement_ms":468408,"first_green_ms":1072859,"active_ms":4112649,"gate_efficiency":1,"oracle_ms":[{"criterion":"AC1","ms":265},{"criterion":"AC2","ms":230},{"criterion":"AC3","ms":758},{"criterion":"AC4","ms":259},{"criterion":"AC5","ms":374},{"criterion":"AC6","ms":456},{"criterion":"AC7","ms":161},{"criterion":"AC8","ms":91},{"criterion":"AC9","ms":306}],"gate_ms":[{"gate":"test","ms":191992},{"gate":"lint","ms":2570},{"gate":"build","ms":11796}],"critic_ms":{"total":2259823,"dispatches":[{"critic":"marvin-tm-spec-critic","pass":1,"ms":571638},{"critic":"marvin-tm-spec-critic","pass":2,"ms":568466},{"critic":"marvin-tm-diff-critic","pass":1,"ms":1119719}]}},"quality":{"scope_drift":{"declared":29,"changed":31,"undeclared":["docs/proposals/unbounded-intake-dialogue.md","scripts/mcp-call.mjs"]},"oracle_strength":{"criteria":9,"executable":9,"share":1},"red_green":null,"not_run":{"gates":3,"not_run":0,"share":0},"freshness_waivers":0,"critics":{"spec":{"compliance":{"verdict":"BLOCK","blockers":1,"warnings":3},"quality":{"verdict":"BLOCK","blockers":1,"warnings":2}},"diff":null},"spec_gaps":2,"open_items":{"deferred":0,"blocked":0},"dor_first_call":true,"oracle_resolution":{"by_source":{"config.test_one":9},"unresolved":0}},"rework":{"seals":1,"reseals":0,"critic_passes":{"spec":2,"diff":1},"fix_rounds":{"verify_gate":2,"critic":1,"red_green":0},"runs_before_green":0},"notes":["T8: 1 critic dispatch(es) without a recorded verdict — excluded"]}
```

```json metric-event
{"slug":"metrics-record-guarantee","source":"task-implement","step":"6F","kind":"critic-verdict","contract_sha":"df50aac639313c74","at":"2026-09-05T08:55:37.567Z","critic":"marvin-tm-diff-critic","pass":2,"verdict":"PASS WITH WARNINGS","blockers":0,"warnings":6}
```

```json task-metrics
{"slug":"metrics-record-guarantee","contract_sha":"df50aac639313c74","type":"feature","risk":"medium","breaking":false,"spike_required":false,"created":"2026-09-04","rolled_up_at":"2026-09-05T08:55:42.485Z","head_sha":"687d556dd8cdcc6d2584408a932b00c49633ce96","base_branch":"dev","sources":{"spec":"present","progress":"present","oracles":"present","verify_journal":"present","verify_result":"present","critique":"present","events":"present","git":"present"},"time":{"intake_ms":2571382,"implement_ms":468408,"first_green_ms":1072859,"active_ms":4112649,"gate_efficiency":1,"oracle_ms":[{"criterion":"AC1","ms":265},{"criterion":"AC2","ms":230},{"criterion":"AC3","ms":758},{"criterion":"AC4","ms":259},{"criterion":"AC5","ms":374},{"criterion":"AC6","ms":456},{"criterion":"AC7","ms":161},{"criterion":"AC8","ms":91},{"criterion":"AC9","ms":306}],"gate_ms":[{"gate":"test","ms":191992},{"gate":"lint","ms":2570},{"gate":"build","ms":11796}],"critic_ms":{"total":50023484,"dispatches":[{"critic":"marvin-tm-spec-critic","pass":1,"ms":571638},{"critic":"marvin-tm-spec-critic","pass":2,"ms":568466},{"critic":"marvin-tm-diff-critic","pass":1,"ms":1119719},{"critic":"marvin-tm-diff-critic","pass":2,"ms":47763661}]}},"quality":{"scope_drift":{"declared":29,"changed":31,"undeclared":["docs/proposals/unbounded-intake-dialogue.md","scripts/mcp-call.mjs"]},"oracle_strength":{"criteria":9,"executable":9,"share":1},"red_green":null,"not_run":{"gates":3,"not_run":0,"share":0},"freshness_waivers":0,"critics":{"spec":{"compliance":{"verdict":"BLOCK","blockers":1,"warnings":3},"quality":{"verdict":"BLOCK","blockers":1,"warnings":2}},"diff":{"compliance":{"verdict":"PASS WITH WARNINGS","blockers":0,"warnings":2},"quality":{"verdict":"PASS WITH WARNINGS","blockers":0,"warnings":4}}},"spec_gaps":2,"open_items":{"deferred":0,"blocked":0},"dor_first_call":true,"oracle_resolution":{"by_source":{"config.test_one":9},"unresolved":0}},"rework":{"seals":1,"reseals":0,"critic_passes":{"spec":2,"diff":2},"fix_rounds":{"verify_gate":2,"critic":1,"red_green":0},"runs_before_green":0},"notes":[]}
```

