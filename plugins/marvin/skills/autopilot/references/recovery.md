# Autopilot recovery

The engine is built to be restarted: `run.json` is its resting state, `engine.journal.json`
covers the step in flight, and a restarted engine repeats at most that one step. So the first
answer to almost every failure is `node <cli> start --run <runDir>`. This file covers what to do
when that is not enough. In every case you still act only through `marvin-pipe`; you never edit
run files to unstick a run.

## The engine is down

`await` prints `ENGINE down`, usually with `EVENT note engine stopped: <reason>`.

1. Run `start --run <runDir>`. If it fails with `an engine already holds <runDir>`, another
   engine took the run between the two looks: do nothing, and re-arm `await`.
2. Re-arm `await`. A healthy restart produces an `EVENT` line soon after.
3. After three `ENGINE down` lines with no `EVENT` between them, stop. The engine fails the same
   way on every start, and restarting again only repeats it. Tell the user, in `lang`:
   - the last `engine stopped:` reason, or the last lines of `<runDir>/engine.log`;
   - the run directory, so they can inspect it;
   - that the run is intact and resumes with `/marvin:autopilot resume <run-id>` once the cause
     is fixed.

Common causes, readable in `engine.log`:

| Symptom | Likely cause | What the user can do |
|---------|--------------|----------------------|
| `no run at <dir>` | a mistyped run path | `list --repo` and use the printed `runDir` |
| `engine already running (pid …)` | a second `start` | nothing; one engine is enough |
| `the engine journal … is unreadable` | the journal was damaged | report it; the run needs a human |
| a failed bootstrap command | `pipeline.bootstrap` in `.marvin/config.json` failed in the run worktree | fix the bootstrap command or the dependency install, then resume |
| `no rule for stage … and observation …` | an engine fault | report it with the run directory; do not retry blindly |

## The session ended

Runs outlive sessions: the engine is a detached process, and judgments wait on disk. In a new
session, `/marvin:autopilot resume [run-id]` lists the runs, attaches this session as the
orchestrator, restarts the engine when it is down, and re-arms `await`. A pending judgment
reappears within 60 s.

`attach` writes the new name to `<runDir>/orchestrator.txt`; it never touches `run.json`, so it
is safe while an engine runs.

## `await` itself fails

`await` exits 1 only on a bad argument or an unreadable run (`no run at …`). Check the run
directory with `list`, and re-arm with the path `list` prints. It never dies on a bad line in
`events.jsonl`; such a line is skipped.

## No messages from a child

Children report every five minutes, nudged by a heartbeat hook. A silent child is not a stuck
run: the engine watches every child's output and raises a `halt` judgment (`<role> stalled`)
when one stops producing any. Do not poke the child and do not message it; wait for the
judgment.

## A judgment you cannot answer

If the user is away and the judgment needs them, leave it pending. The engine waits as long as
it takes and holds no resources but its own process; `await` reminds you every 60 s and at each
deadline. Do not answer in the user's place to keep the run moving.

## Cancelling a run

To stop a run on the user's request, answer the pending judgment with `cancel` and a reason. With
no judgment pending, there is no command that interrupts a running child: tell the user that the
run stops at its next judgment, and answer that one with `cancel`. A cancelled run still runs its
retro, then closes as `done`; it never marks its PR ready.
