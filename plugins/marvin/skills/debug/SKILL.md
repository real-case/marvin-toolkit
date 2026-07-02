---
name: debug
description: Systematic root-cause debugging — hypothesis-driven analysis, evidence gathering, and minimal reproductions instead of guessing. Use whenever the user reports a bug, error, unexpected behavior, test failure, crash, or performance issue, or says something "doesn't work", "broke", "stopped working", "regression", "flaky". Also triggers on pasted stack traces, error messages, log snippets, or when the user asks "why is this happening?", "what's wrong?", "marvin debug this", or "help me debug". Applies to any language, framework, or runtime.
---

# Debug

Find the *actual* root cause before touching any code — most debugging time is wasted on premature fixes.

## Core principle

**Read, don't guess.** Gather evidence → form hypotheses → verify the most likely one → only then fix. Jumping to a fix on a hunch is the #1 debugging anti-pattern.

## This skill is the door to `marvin-debugger`

The hypothesis-driven methodology lives in one place — the **`marvin-debugger`** agent — so the debug skill and `/marvin:task-start` Step 3B share a single source instead of duplicating it. This skill is the **interactive** path: you stay in the conversation and apply the fix; the agent does the isolated, evidence-first analysis.

### 1. Dispatch the agent

If Task-tool is available, invoke **`marvin-debugger`** with everything you know about the bug — the symptom, any stack trace or error text, repro steps, and the suspected area. It runs read-mostly (it may write a throwaway reproducer) and returns a structured report: **Symptom · Reproduction · Evidence · Hypotheses · Root Cause · Fix Approach · Regression Test · Siblings · Lesson**.

### 2. Act on the report

- **Root cause confirmed** → apply the agent's **minimal** fix approach with the user. Write the **regression test first** (it must fail on the current code), then apply the fix and confirm the test goes green and the original reproducer is gone. Then grep for the **siblings** the agent listed and decide with the user whether they're in scope.
- **Unconfirmed** → the agent returns its best-supported hypothesis and the exact next step. Gather that evidence (or re-dispatch with it) before changing code. Never apply an unconfirmed fix.

### 3. Confirm the lesson was captured

For a non-trivial bug the agent captures a `bug-pattern` lesson via the `lessons` tool. If it reported the lesson **inline** instead (Task-tool/MCP unavailable in its run), persist it yourself: call `lessons` with `action: "add"`, `type: "bug-pattern"`, `source: "debug"`. This is what lets the next task recall the pattern at intake.

### Relationship to the task pipeline

- **Standalone** (this skill): ends at a verified fix on the current branch.
- **Spec-bound bug** (you intend to spec and ship it): the agent's report *is* the spec's Root Cause Analysis / Fix Approach / Regression Test — run `/marvin:task-start` (Bugfix Flow), which dispatches the same agent at Step 3B, then implement and deliver through the pipeline.

## Fallback — no Task-tool

If you cannot dispatch the agent, run its phases inline (the agent body is the full reference):

1. **Reproduce & scope** — shortest reliable trigger; blast radius; `git log` / `git bisect` to anchor in time.
2. **Gather evidence** — read the execution path (callers/callees), `git log`/`diff`/`blame`, the *full* stack trace, logs, env/config/dependency deltas, existing tests.
3. **Form hypotheses** — rank 2–3 with evidence for/against and a way to verify each. Categories: null/undefined · type/schema drift · race/timing · state mutation · env delta · stale cache · off-by-one · dependency change · perms/auth · resource exhaustion.
4. **Verify** one at a time, least-to-most invasive.
5. **Fix** minimally + a regression test that's red before and green after; re-run the original reproducer; grep for siblings.
6. **Reflect** — category · why-not-caught · prevention — and capture it via the `lessons` tool.

## Guidelines

- **Never jump to the fix.** Understand first.
- **Prefer reading code to running it.** Running code is for verification, not discovery.
- **One hypothesis at a time.** Occam's razor — a typo is likelier than a compiler bug.
- **Ask "what changed?"** Most bugs are regressions; find the delta.
