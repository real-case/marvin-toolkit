# Metrics — scanner-gates-via-gates-extra

Append-only. One `metric-event` block per live event; one `task-metrics` block per delivery, the last authoritative (ADR-0043).

```json metric-event
{"slug":"scanner-gates-via-gates-extra","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-10-14T18:35:37.311Z","verdict":"PASS","gate":"dor","call":2}
```

```json metric-event
{"slug":"scanner-gates-via-gates-extra","source":"task-start","step":"8F","kind":"critic-dispatch","contract_sha":null,"at":"2026-10-14T18:35:39.392Z","critic":"marvin-tm-spec-critic","pass":1}
```

```json metric-event
{"slug":"scanner-gates-via-gates-extra","source":"task-start","step":"8F","kind":"critic-verdict","contract_sha":null,"at":"2026-10-14T18:36:52.759Z","critic":"marvin-tm-spec-critic","pass":1,"verdict":"BLOCK","blockers":1,"warnings":5}
```

```json metric-event
{"slug":"scanner-gates-via-gates-extra","source":"task-start","step":"7F","kind":"gate-call","contract_sha":null,"at":"2026-10-14T18:38:41.647Z","verdict":"PASS","gate":"dor","call":3}
```

