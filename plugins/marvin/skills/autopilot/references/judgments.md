# Autopilot judgments

The engine blocks on a judgment until you answer it. `await` prints
`JUDGMENT <id> <kind> <request-path>`; the request file holds `{id, kind, payload}`. Read the
payload, decide by the policy below, write the answer JSON to a temporary file outside the
repository, and run:

```bash
node <cli> judge --run <runDir> --id <id> --answer-file <file> [--answered-by orchestrator|user]
```

Every answer object is closed: a key the kind does not list is refused, so a typo cannot pass
silently. Every text you put in an answer is English.

## Contents

1. Answer policy: alone or ask
2. `planner_questions`
3. `executor_questions`
4. `spec_approval`
5. `halt`
6. `unverified`
7. `no_ci`
8. When `judge` refuses

## 1. Answer policy: alone or ask

Answer a question **yourself** when one of these settles it:

- the task text, in the user's original words;
- the code, read through a read-only `Explore` subagent (never your own edits, never a
  reproduction run);
- the rubric, the project's `.marvin/config.json` or its conventions;
- an earlier answer in this run, including what the user said at intake.

Otherwise **ask the user**, because the decision is theirs: product behaviour, scope, naming
that users will see, a trade-off between two reasonable designs, anything irreversible. Ask one
contested point per `AskUserQuestion`, in `lang`, with the child's `recommendation` as the first
option and its options (if any) after it. Send a `PushNotification` first, when available,
since the user may be away. Batching unrelated points into one question makes each answer
weaker; one at a time is the house rule.

Keep a list of every answer you gave alone and every assumption you made. The spec approval
shows it to the user, so their consent is recorded rather than presumed.

## 2. `planner_questions`

Payload: `{questions: [{id, text, options?, recommendation, why_blocking}]}`, at most four.

Answer every question, by the policy above, in one payload:

```json
{ "kind": "answers", "text": "Q1: <answer>\nQ2: <answer>", "count": 2 }
```

- `text` is one line per question, `<id>: <answer>`, in English. Say briefly why when the reason
  is not obvious, because the planner records it in the spec.
- `count` is the number of questions answered: at least 1, at most the number asked.
- Pass `--answered-by user` if the user decided any of them, `--answered-by orchestrator` if you
  settled all of them.
- `{ "kind": "cancel", "reason": "<why>" }` ends the run (it goes to the retro). Use it only when
  the user asks to stop.

## 3. `executor_questions`

Payload: `{questions: [...], dispute: {path, reason, evidence} | null}`.

Questions are answered as for the planner, with `answers` and `--answered-by`. When there is no
question but a dispute, `count` is 0.

A **dispute** says a sealed acceptance test is wrong. The sealed tests were written before the
implementation, by a different session, precisely so that the executor cannot bend them, so
judge the evidence rather than the executor's confidence:

- Read the test at `path` and the spec criterion it covers (read-only; an `Explore` subagent is
  fine). Compare it with the spec, not with the implementation.
- If the test contradicts the spec, or asserts something the spec leaves open, answer
  `{ "kind": "revise_tests", "text": "<what is wrong and what the test must assert instead>" }`.
  The test-author revises the tests and the engine re-seals them.
- Otherwise the test stands: answer `answers` with `count` = the number of questions (0 when
  there are none), and a `text` that explains why the test is right and what the implementation
  must do to pass it.
- When the spec itself is ambiguous on the point, ask the user before deciding.

## 4. `spec_approval`

Payload: `{spec: {path, slug, risk, files, criteria, sealed, critic?, overrides?}, summary, tier,
reasons, assumptions, assignments}`. `spec.path` is relative to the run worktree, which
`node <cli> status --run <runDir>` gives as `worktree`.

Spec approval by the user is mandatory. Never approve on your own, whatever the tier.

Read the spec file yourself, then present, in `lang`:

1. The spec as a link to `<worktree>/<spec.path>`.
2. A summary of at most three lines: what will change and why.
3. The number of acceptance criteria and the files in the contract, the risk, and the critic
   verdict when present.
4. The tier and the reasons it was computed (`reasons`), and the stage-A guess if it differed.
5. A table of the roles and what each runs as, from `assignments`: planner, test-author
   (`skip` on the light tier), executor, verifier, retro, each `model/effort`.
6. Every answer you gave alone and every assumption, from your list and from `assumptions`.
7. A cost estimate: the median total cost of earlier runs on this tier, from
   `<repo>/.marvin/pipeline/calibration.jsonl` (one JSON record per line; a record's `tier`,
   and its cost is the sum of `aggregate.perRole[].costUsd`). With fewer than three records on
   the tier, say there is no estimate yet rather than guessing.

Send a `PushNotification`, when available, then ask with `AskUserQuestion`:

| Choice | Answer |
|--------|--------|
| Approve | `{ "kind": "approve" }` |
| Request changes | ask what to change, then `{ "kind": "changes", "text": "<the changes, in English>" }`; the planner revises and a new approval follows |
| Change tier | ask which tier and why, then `{ "kind": "approve", "tier": "light"\|"standard"\|"heavy", "reason": "<why>" }`; this approves at the new tier, so confirm that first. Show that tier's assignments from the rubric (`rubricDefault`, deep-merged with `<repo>/.marvin/pipeline/rubric.yaml`) before asking for the confirmation |
| Cancel | `{ "kind": "cancel", "reason": "<why>" }` |

Pass no `--answered-by` on an approval: it is always the user's.

## 5. `halt`

Payload: `{reason, detail?, findings?, failing?}`. Raised for a rejection cap, a crash or failure
after its retry, a usage limit, a stalled child, a child that mutated the tree or wrote outside
its worktree, a planner or executor past its question cap, the sealed tests revised too often, a
closed PR, or CI red after finalize.

Explain in `lang`, with a `PushNotification`: what stopped the run, the findings or failing
jobs that led there, and what a retry would do. Then ask the user to retry or cancel:

- `{ "kind": "retry" }` repeats the halted role's last step. After a rejection the executor
  starts a fresh iteration on the same findings. After a CI halt the engine polls CI again.
- `{ "kind": "cancel", "reason": "<why>" }` closes the run through the retro. A halted run never
  marks its PR ready and never ships its spec.

Three halts deserve a look before you ask:

- **`<role> wrote outside its worktree`.** `detail` lists new entries in the main checkout's
  `git status`. The main checkout is shared with other sessions, so an entry may be someone
  else's edit. Inspect each path read-only: its modification time, and whether its content
  relates to the task. Tell the user what you found. Recommend `retry` only when no path is the
  child's; a write by the child is a real boundary breach, and the user should see it.
- **`<role> mutated the tree`.** The read-only verifier changed the worktree. Recommend
  `cancel` unless the user wants to inspect it; a verifier that writes cannot be trusted.
- **A usage limit** (`<role> limited`). A retry will hit the same limit until it resets; say
  when, if the detail names it, and suggest retrying then.

## 6. `unverified`

Payload: `{criteria: [{id, result, evidence}], missing: [<criterion ids>]}`. The verifier
returned PASS but verified nothing, or skipped criteria the sealed tests cover.

Ask the user, with a `PushNotification`:

- `{ "kind": "retry" }`: a fresh verifier tries again. The default recommendation.
- `{ "kind": "proceed", "reason": "<why it is acceptable>" }`: continue to CI without the
  verification evidence. The reason is required and lands in the run's assumptions; use it only
  on the user's explicit word.
- `{ "kind": "cancel", "reason": "<why>" }`.

## 7. `no_ci`

Payload: `{}` when no workflow run appeared for the PR head, or `{reason}` when CI is still
pending past the wait cap. Ask the user:

- `{ "kind": "wait" }`: poll CI again for another full wait.
- `{ "kind": "proceed" }` (optional `reason`): treat CI as settled. Before finalize this moves
  to the retro. After finalize it closes the run with the PR left as a draft, because nothing
  proved the finalize commit green.
- `{ "kind": "cancel", "reason": "<why>" }`.

If the repository has no CI at all, say so: `proceed` is then the expected answer.

## 8. When `judge` refuses

`judge` exits 1 with the reason on stderr, and nothing is written:

- `invalid answer to <id> (<kind>): <field>: <message>`: the payload does not fit the kind.
  Fix the JSON and run `judge` again.
- `answer to <id> counts <n> questions; the judgment asked <m>`: correct `count`.
- `answer to <id> refused: <reason>`: the run's state cannot take this answer (a retry with
  nothing to retry, say). Pick another answer; tell the user if it was theirs.
- `judgment <id> already answered`: a repeat of a judgment you already answered. Do nothing.
- `judgment <other> is pending, not <id>`: an older judgment is open; handle that one.

An answer the engine still refuses after `judge` accepted it is reported by `await` as
`EVENT note answer to <id> refused: <reason>`, and the judgment is open again. Decide afresh.
