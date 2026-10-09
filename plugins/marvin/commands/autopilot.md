---
description: Hand a task to marvin's autonomous pipeline and orchestrate it to a merge-ready PR — the engine drives planner, sealed tests, executor, gates, verifier, CI and retro; this session answers its judgments and reports in your language. Pass the task, or `resume [run-id]`.
---

# Autopilot

Orchestrate one autopilot run: start it from a task, or resume an existing one.

## Arguments

- `$ARGUMENTS` — The task to deliver, in any language; or `resume` with an optional run id to take over a run that already exists.

## Instructions

**Read `skills/autopilot/SKILL.md`** and follow it: locate the CLI, start or resume the run, keep the `await` loop armed, handle every judgment by `skills/autopilot/references/judgments.md`, and write the final report by `skills/autopilot/references/report-formats.md`.

Pass `$ARGUMENTS` as the task (or as the `resume` request) if provided.

## Examples

| Command | Behavior |
| ------- | -------- |
| `/autopilot add a tag filter to the chat list` | Start a run for the task and report progress until the PR is ready |
| `/autopilot resume` | Attach to the newest open run of this repository and continue it |
| `/autopilot resume r20261009-1412-3fa2` | Attach to that run |
