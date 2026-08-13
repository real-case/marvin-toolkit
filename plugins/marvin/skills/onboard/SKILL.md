---
name: onboard
description: Guided first session with marvin in this project — reads the repository, discloses the local usage log and its opt-out before anything is written, proposes real starter tasks found in this codebase, and runs at most two side-effecting commands, each behind an explicit yes. Use when the user says "I just installed marvin", "set marvin up in this project", "walk me through marvin", "where do I start with marvin", "first time using this plugin", "give me the guided tour", or "/marvin:onboard". This is about setting the toolkit up here, not about introducing a person to a codebase.
---

# Onboard

A first session with marvin, in this project. Read the repository, disclose what marvin writes
locally, propose real starter tasks, and run at most two commands that change anything — each
behind an explicit yes.

Work through the seven steps in order, one at a time, and do not summarise the whole walkthrough
up front. Steps 2, 4, 5 and 6 end with a question, and the answer decides what the next step
does: do not batch them and do not run ahead of an answer. Steps 1, 3 and 7 report their result
and move on without asking anything. Step 2 takes two turns when its offer is accepted — the
offer, then the exact lines before they are written — because showing a write before making it is
a consent requirement, not a formality.

## Hard rules

- **Nothing is written without an explicit yes in the same turn.** A hedged, ambiguous or absent
  answer is a no.
- **Declining a step continues the walkthrough at the next step.** A no is never a reason to
  abort, to apologise, or to ask again.
- **No branches, no pushes.** No step runs `git checkout -b`, `git switch -c`, `git push`, or
  `/marvin:track-start` — which creates a branch, and is deliberately absent from this flow.
- **Delegate the two writing commands.** The board card is `/marvin:track-new`; the commit is
  `/marvin:commit`. Never substitute a direct `git add` or `git commit` — the commit skill's
  sensitive-file screening is why the delegation exists.
- **Read only what a step needs.** Steps 1 and 4 read repository metadata and source locations.
  Never open `.env` files, key material, or credential stores, and never echo file contents the
  user did not ask for.
- **End on one suggestion, not a menu.**

## Step 1 — Read the room, write nothing

This step only reads. Say so, then run:

```bash
git status --short
git log --oneline -5
ls -d .marvin 2>/dev/null || echo "no .marvin/ yet"
ls package.json pyproject.toml go.mod Cargo.toml Gemfile pom.xml build.gradle 2>/dev/null
```

Report three lines back: the stack the manifests reveal, whether the working tree is clean, and
whether `.marvin/` already exists. If it does, this project has used marvin before — say so and
keep going; every step below behaves the same either way.

## Step 2 — Disclose the usage log, then offer the switch

Disclosure comes first, before anything in this walkthrough is written, because logging is the
one thing that can already have happened by the time the user reads it. State these facts plainly:

- Marvin appends one line to `.marvin/usage/events.jsonl` per prompt and per tool call. The line
  is `{ts, kind, name}` and nothing else — no arguments, no file contents, no repository data.
- The directory writes its own `.gitignore`, so nothing there reaches git.
- It is read by `/marvin:dashboard` and by nothing else.
- It never leaves this machine.
- It starts on the first `/marvin:` prompt or marvin tool call of a session, which may already
  have happened before this walkthrough. The line is written by the MCP server, so a skill reached
  through plain chat or through the terse `/onboard` wrapper logs nothing on its own.
- The directory is created by the first logged event, so until one occurs there is nothing to
  read. An absent `.marvin/usage/` is the expected state, not a fault; say so if the user looks.

Then offer the opt-out and ask. If the user declines, or answers with anything short of a yes,
write nothing and go to step 3.

On an explicit yes, in this order — **show, then confirm, then write**:

1. Read `.marvin/config.json` if it exists, and parse it.
2. Compose the result: the same object with `usage.enabled` set to `false` and **every other key
   and value untouched**. If the file does not exist, the result is exactly:

   ```json
   {
     "usage": { "enabled": false }
   }
   ```

3. Show the user the exact lines the file will contain.
4. Only on an explicit yes to what was shown, write it.

Never replace the file with a fresh object. A project's `base_branch` and its `statuses`
vocabulary live there, and a telemetry opt-out that destroys them is worse than the telemetry.
`/marvin:track-config` cannot make this edit — its form covers the board settings and has no
`usage` field — which is why this one write is made directly instead of delegated.

The absent state means enabled, so deleting the key is the undo. For the rest of the file, see
`docs/configuration.md`.

## Step 3 — Show the surface

Run `/marvin:help`. It reads and writes nothing.

Then say once, and only once, that every workflow answers to three doors: plain chat
("commit my changes"), the terse `/commit`, and the namespaced `/marvin:commit`. All three run
the same skill body, so the choice is a matter of habit and not of capability.

## Step 4 — Find real starter tasks

Look for three or four genuine candidates **in this repository**, each with `file:line` evidence.
Good hunting grounds:

- a module with no test file beside it
- a claim in `README.md` that the tree contradicts
- a `TODO` or `FIXME` carrying a name or a date
- a dependency that is unpinned, unmaintained, or a major version behind

Search source, manifests and documentation, and stay inside the read rule above.

Present the candidates as a numbered list, one line each, evidence included. Then ask the user to
pick one or to decline.

Never invent a candidate, and never dress a generic suggestion — "add tests", "improve error
handling" — as a finding. If nothing genuine turns up, say so in one sentence and go to step 7.

## Step 5 — Card it, on a yes

Offer to put the picked task on the board, and say what that costs: one markdown file under
`.marvin/track/`, nothing else.

On an explicit yes, run `/marvin:track-new` with the task's title and its evidence as the
description. On anything else, go to step 6.

## Step 6 — Commit it, on a yes

Re-run `git status --short` rather than trusting step 1's snapshot — an accepted opt-out in step 2
or a card in step 5 changes the answer. With nothing uncommitted, skip the step and say in one
line why.

Otherwise offer to commit what is in the tree, on the branch that is already checked out. On an
explicit yes, run `/marvin:commit` and let it handle the staging, the sensitive-file screening
and its own confirmation. No `git add`, no `git commit`, no `--no-verify`, no new branch.

## Step 7 — Show what was written, and stop at one command

List the files that now exist under `.marvin/`, by path, separating what this session created
from what was already there. If nothing was created, say that too — it is the expected result of
declining every gate, not a failure. `.marvin/usage/` appears in the listing only once something
has been logged, so its absence is the state step 2 described and not a missing file.

Then end with exactly one suggestion:

- the user picked a task and it is big enough to deserve a spec → `/marvin:task-start`
- otherwise → `/marvin:help <group>`, naming the group closest to their work

One command. Not a menu, not a tour of the rest of the toolkit, not an offer to continue.
