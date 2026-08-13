# Routing reference — the one-PR test

Read this on Step 0's **Path D**, on **Step 4.5F**, and on **Step 5B item 5** — the three places that
decide whether work in hand is one pull request or several. Nothing on Paths A, B or C needs it.

## The one-PR test

A body of work is **one** pull request when all four conditions hold. Check them in order and stop at
the first failure — one failure is enough to split.

1. **One reviewable decision.** A reviewer can accept or reject it as a single judgement. Two
   independent judgements ("the schema is right" and "the UI reads well") are two PRs.
2. **Revertible alone.** Reverting it leaves the tree consistent and every gate green, without
   dragging another slice out with it.
3. **Its own red-to-green oracle.** It carries proof that fails before the change and passes after.
   A slice whose only proof lives in a later slice is not independently provable.
4. **Mergeable without waiting.** It can land on its own, before the next slice exists, without
   leaving the tree in a state nobody would ship.

All four hold → keep it together. Any one fails → split, and re-apply the test to each slice.

## Anti-heuristics

These are the shortcuts that look like the test and are not it:

- **Never count verbs, conjunctions or noun phrases.** "Add X and Y" may be one decision; "add X"
  alone may be three. Grammar is not scope.
- **Never count files.** A twenty-file change with one decision behind it is one PR; a two-file
  change that asks the reviewer two unrelated questions is two.

The only counting that matters is the four conditions above.

## Worked examples — this repository's own merged history

**PR #128 — split by deliverable.** The approved website design covered four pages. Each page was
its own reviewable decision, revertible alone, proved by its own Playwright e2e, and shippable
before the next page existed. Conditions 1–4 failed across the set and held within each page, so
Phase 3 shipped as four PRs and #128 was the first slice — the Home page. The remaining three were
carded, not noted.

**PR #162 — split by layer.** The dashboard rework changed a contract, a tool and a widget. #162
shipped the contract alone: four new **optional** `DashboardState` fields, so the existing narrow
producer still conformed, reverting it touched nothing downstream, and its own contract test proved
it. The tool (#163) and the widget (#164) followed as separate PRs. The seam here is the layer, not
the feature: data first, per ADR-0024.

**PR #176 — kept together despite nineteen files.** The human-run flag was hand-typed in six places
and four were stale. The fix touched a README, a command table, the site catalog, a widget fixture
and six committed image baselines — and it is still **one** PR, because there is exactly one
decision (read the flag from skill frontmatter) and no slice of it is revertible alone: leaving any
mirror behind leaves the tree self-contradictory, and the parity tests only go green once every
reader agrees. This is the example to recall when file count starts to feel like an argument.

## Recording a deferred slice

Every slice that is not being specced now becomes a board card **before** the spec is written, so it
survives the session. For each one:

1. Call the `task` tool with `action: "create"` and both `type` (`bug` | `feature` | `chore` |
   `spike`) and `title` passed explicitly. Passing both skips the create form entirely.
2. On a git host the tool then asks whether to create and check out the card's branch. Answer
   **no**. Answering yes checks the branch out and flips the card to the wip status mid-authoring,
   which breaks the spec write still ahead at Step 9F/9B.
3. Read the new id from the reply text — `Created task **NNN**`. The call returns no structured
   data, so the id exists only in that line.
4. Put the id in the spec's `## Deferred slices` section, one row per slice: the id, a one-line
   scope, and why it is a separate PR (which of the four conditions failed).

Do nothing else to the card. No `start`, no `link-pr`, no status change — the deferred slice is
picked up by its own `/marvin:task-start` run later.
