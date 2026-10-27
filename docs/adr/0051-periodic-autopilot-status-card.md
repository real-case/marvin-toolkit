# ADR 0051 — The autopilot reports at least every five minutes, as one status card

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-10-25 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0024](0024-mcp-apps-widget-architecture.md) (the widget layer the card joins), [ADR-0034](0034-widget-preview-door.md) (why the Claude Code CLI shows the Markdown fallback), [ADR-0041](0041-capability-gated-tool-text-for-widget.md) (the one-line digest a widget-capable host gets instead of the text) |

## Context

The autopilot orchestrator (`/marvin:autopilot`) learns about a run through `marvin-pipe await`,
which blocks until the engine has something to say and then prints one line per event. Two
properties of that loop made the run hard to follow.

- **Silence had no bound.** `await` returned only on an event, a standing condition or its
  110-minute deadline. An executor that worked for forty minutes without a milestone produced
  forty minutes of nothing, and the user could not tell a working run from a stuck one without
  asking.
- **Progress had no shape.** Each event became one translated line, so a busy interval was a
  stream of lines and the state of the run (which stage, what it had cost, how many rejections)
  had to be pieced together from them.

The owner asked for a report at least every five minutes, in one fixed format: a card. Four
layouts were drawn on a design canvas on 2026-10-25, and variant A was chosen: a header with the
task and a status pill, a rail of the seven pipeline stages, four figures (elapsed time, cost,
iteration, rejections), a callout when the run needs an answer or has stopped, the events since
the previous report, and a footer that names the next report's deadline.

## Decision

1. **The timer lives in `await`, not in the engine or the orchestrator.** `marvin-pipe await
   --report-min <m>` keeps the time of the last report in its cursor (`await.cursor`,
   `reportedAt`). Events no longer return one by one: they stay behind the cursor until the
   interval ends and then go into one report. A standing condition that is new (a judgment, a dead
   engine, a terminal stage) returns at once with a report of its own, which starts the next
   interval. A repeat of a condition already reported returns its line alone, without a report,
   so a judgment that stands for an hour does not produce a card every minute. Because the timer
   does not depend on the engine, a run whose engine died still reports. Without the flag `await`
   behaves exactly as before, which the benchmark harness relies on.
2. **The engine owns every number on the card.** `buildReport` in `pipeline/status-report.ts` is
   pure: from `run.json`, the stage history in `events.jsonl`, the interval's events and the
   previous report it derives the state, the rail, the elapsed time, the cost (one charge per
   resumed session, an unknown cost never counted as zero), the cost since the previous report,
   the rejections, the children still running, and the callout. The report is written whole to
   `<runDir>/status-reports/<n>.json` and announced as `REPORT <n> <path>`. Its shape is the
   `AutopilotReport` contract in `@marvin-toolkit/mcp-shared/contracts`.
3. **The orchestrator adds only language.** The engine writes English. The orchestrator
   translates the event texts and the callout and passes them to a new tool, `autopilot-report`,
   one text per event in order; a list of the wrong length is refused rather than paired with the
   wrong times. Labels (stage names, figure names, the status pill) are not translated by the
   model at all: `autopilotLabels(lang)` in `@marvin-toolkit/mcp-shared/autopilot-labels` holds
   them, Russian for a `ru*` tag and English otherwise, and both the widget and the tool's text use
   that one table.
4. **A sixteenth tool and a tenth widget.** `autopilot-report` reads one report back, confined
   to the state root by the same check `pipeline status` uses (`checkedRunDir`, now shared) plus
   a check that the report file resolves inside its run directory. It binds
   `ui://marvin/autopilot-status.html`. It is a separate tool rather than an action of `pipeline`
   because a widget binds to a whole tool, and binding `pipeline` would put a card on `paths` and
   `status` too.
5. **The Markdown card is the same card.** The Claude Code CLI renders no widget (ADR-0034), so
   the tool's text is the card in Markdown: the same blocks in the same order, the rail as
   `✓ Plan → ✓ Tests → ● Execution → ○ …`, the figures as a one-row table. The orchestrator shows
   it verbatim, or nothing when the host has drawn the widget (ADR-0041).

## Consequences

- The user hears from a running autopilot at least every five minutes while the orchestrating
  session is idle, and an interval with no events still says that the run is alive and which
  child is working. A session busy in conversation receives the report when its turn ends, since
  a background command cannot interrupt a turn.
- Every report is an orchestrator turn, about twelve an hour. The context is cached, so a turn
  is cheap, but a long run now costs more orchestrator tokens than one that only woke on events.
- `EVENT` lines no longer reach the orchestrator in report mode. The two it acted on, an answer
  the engine refused and the reason the engine stopped, arrive as events inside the report, and
  the skill reads them there. The session-status title follows the report's `stage` instead of
  `EVENT stage` lines.
- Report files accumulate in the run directory, outside the repository, a few kilobytes each.
- The tool count in the docs, the site's catalogue and the server's registration test moves from
  fifteen to sixteen, and the widget count from nine to ten.
