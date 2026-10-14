# Metrics — seal-syntax-check

Append-only. One `metric-event` block per live event; one `task-metrics` block per delivery, the last authoritative (ADR-0043).

```json metric-event
{"slug":"seal-syntax-check","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-10-13T18:11:41.147Z","verdict":"FAIL","gate":"dor","call":1}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-10-13T18:11:43.550Z","verdict":"PASS WITH WARNINGS","gate":"dor","call":2}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-start","step":"8F","kind":"critic-dispatch","contract_sha":null,"at":"2026-10-13T18:11:45.710Z","critic":"marvin-tm-spec-critic","pass":1}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-start","step":"8F","kind":"critic-verdict","contract_sha":null,"at":"2026-10-13T18:14:15.328Z","critic":"marvin-tm-spec-critic","pass":1,"verdict":"BLOCK","blockers":1,"warnings":5}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-10-13T18:15:03.985Z","verdict":"PASS","gate":"dor","call":3}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-start","step":"8F","kind":"critic-dispatch","contract_sha":null,"at":"2026-10-13T18:15:05.753Z","critic":"marvin-tm-spec-critic","pass":2}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-start","step":"8F","kind":"critic-verdict","contract_sha":null,"at":"2026-10-13T18:16:54.103Z","critic":"marvin-tm-spec-critic","pass":2,"verdict":"PASS WITH WARNINGS","blockers":0,"warnings":4}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-implement","step":"fix-cycle","kind":"fix-round","contract_sha":null,"at":"2026-10-13T19:12:47.062Z","loop":"verify-gate","round":1}
```

```json metric-event
{"slug":"seal-syntax-check","source":"task-implement","step":"6F","kind":"open-item","contract_sha":null,"at":"2026-10-13T20:18:42.613Z","detail":"verify-tool test gate red: pipeline-guards.test.mjs:732 inherits the MCP server's CLAUDE_PROJECT_DIR (test file outside contract); clean shell green","classification":"blocked"}
```

