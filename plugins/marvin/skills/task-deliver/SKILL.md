---
name: task-deliver
description: Final delivery phase of the taskmaster pipeline — commits changes and opens a pull request by delegating to the commit and pr-create skills, and refuses to proceed if the preceding task-verify step did not pass. Use when the user says "deliver", "ship it", "finalize the task", "commit and PR", "close out the task", or when a taskmaster worktree has finished implementation and verification.
---

# Deliver

Commit changes and create a pull request. This is the final phase — it gates on successful verification and delegates the actual commit/PR creation to the commit and pr-create skills.

## Core principle

**Don't ship unverified code.** Delivery is the last gate. It checks that verification passed, then delegates to the battle-tested commit and PR workflows.

## Workflow

### 1. Check verification (tool-backed gate)

Call the **`verify` MCP tool** with `action: "gate"`. It reads `.marvin/task/verification.md`, parses the machine-readable `verify-result` verdict, and returns a `deliver-gate` decision — do **not** eyeball the prose verdict yourself.

- **BLOCK** — no `verification.md`, no parseable verdict, or verdict **FAIL**. **Stop.** Relay the gate's reason and tell the user to run or fix `/marvin:task-verify` before delivering. Do not deliver.
- **ALLOW** — verdict **PASS** or **PASS WITH WARNINGS**. Proceed. On PASS WITH WARNINGS, surface the warnings and confirm the user wants to proceed.

In a **chained** run (invoked straight after `/marvin:task-verify` in the same session) you may reuse the verdict already in context. If the `verify` tool is unavailable, fall back to reading `.marvin/task/verification.md` yourself and refusing on a FAIL or a missing/unparseable verdict — never deliver unverified.

### 2. Commit

Follow the `/marvin:commit` workflow.

When composing the commit:
- Use the spec title as the commit scope/subject
- Reference the spec for the "why" in the commit body — what problem this solves or what feature this delivers
- Spec context: in a **chained** session (invoked straight after `/marvin:task-implement`), reuse the spec already read in the conversation — do not re-read it. Only when invoked **standalone** read from disk: search the spec directories (`.marvin/task/`, `specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`) by slug from conversation, fall back to `.marvin/task/spec.md`

### 3. Create pull request

Follow the `/marvin:pr-create` workflow.

When composing the PR:
- Include the spec summary in the PR body
- Include the verification results summary
- Reference the original issue/ticket if one was identified during intake
- If spec is v2.0 format (from `.marvin/task/` or a host spec dir), use the v2.0 PR body structure:

```markdown
## Summary
{from spec goal/problem statement}

## Spec Reference
`.marvin/task/{slug}.md`

## Changes
{key changes grouped by area}

## Self-Review Notes
{any concerns or trade-offs noted}

## Tests
- [ ] New tests written for acceptance criteria
- [ ] Regression test (bugfix only)
- [ ] All existing tests pass
```

### 4. Record delivery on the spec

If the spec lives under one of the spec directories (`.marvin/task/`, `specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`)
and the PR was created, update its lifecycle metadata — the only mutable part of an
otherwise-immutable spec:
- Set frontmatter `status: shipped`.
- Append a `## Delivery` section with the PR URL and today's date.

Skip silently when no spec file is found (e.g. when only a verification artifact exists, no named spec).

### 5. Capture a lesson (retrospective)

Close the feedback loop (ADR-0021). If this task surfaced something a future task should inherit — a recurring **SPEC GAP**, a non-obvious convention you had to discover, a gotcha that cost time, or a process friction — capture **one** lesson via the `lessons` tool:

- `action: "add"`, a one-line `title`, a `body` of 2–4 sentences (what to know · why · how to apply), relevant `tags`, and `source: "<spec-slug>"`.
- Choose `type`: `gotcha` / `convention` / `pitfall` for code knowledge, `process` for workflow friction. (Bug root-cause patterns are captured upstream by `marvin-debugger` — don't duplicate them here.)

Skip it for routine tasks that taught nothing new — an empty lesson is noise, and the store earns its value by staying scannable. Capture at most one or two. If the `lessons` tool is unavailable, append the index line to `.marvin/memory/MEMORY.md` yourself.

### 6. Preserve artifacts

Do NOT delete `.marvin/task/` artifacts. They serve as documentation:
- `spec.md` — what was intended
- `plan.md` — how it was implemented
- `verification.md` — that it was verified

## Guidelines

- **Never bypass the verification gate.** If verification wasn't run or failed, refuse to deliver. This is the whole point of the pipeline.
- **Delegate, don't duplicate.** The commit and PR workflows already exist (`/marvin:commit`, `/marvin:pr-create`) — use them via command invocation. Don't re-implement commit message generation or PR body formatting.
- **Enrich, don't replace.** Add spec/plan/verification context to the commit and PR, but let those workflows handle their standard checks (sensitive files, pre-flight, etc.).
- **Artifacts are documentation.** After delivery, the `.marvin/task/` directory is a record of the decision process. Users can archive or clean up at their discretion.
