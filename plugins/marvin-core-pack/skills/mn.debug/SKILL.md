---
description: Systematic debugging skill — guides Claude through structured root-cause analysis instead of guessing. Use this skill whenever the user reports a bug, error, unexpected behavior, test failure, crash, performance issue, or says something "doesn't work", "broke", or "stopped working". Also triggers for stack traces, error messages, log analysis, or when the user asks "why is this happening?" about code behavior. Applies to any language, framework, or runtime.
---

# Debug

A structured root-cause analysis framework. The goal is to find the *actual* cause before touching any code — most debugging time is wasted on premature fixes.

## Core principle

**Read, don't guess.** The #1 debugging anti-pattern is jumping to a fix based on a hunch. Instead: gather evidence → form hypotheses → verify the most likely one → only then fix. Every phase below serves this principle.

## Phase 1 — Reproduce and scope

Before analyzing anything, establish the facts.

1. **Clarify the symptom.** Ask: what's the expected behavior vs. what's actually happening? Get specifics — "it crashes" is not enough; "it throws TypeError on line 42 when input is empty string" is.
2. **Reproduce it.** Find the shortest, most reliable path to trigger the bug. If there's a failing test, that's the reproducer. If not, build one: a curl command, a unit test, a REPL snippet, a set of UI steps — whatever the stack allows.
3. **Scope the blast radius.** Is it one endpoint, one component, one platform, or everywhere? Narrowing scope early saves hours.
4. **Anchor in time.** When did it last work?
    - `git log --oneline -20` — scan recent commits
    - If the timeframe is known, `git bisect` is the fastest path to the culprit commit (suggest it when applicable)

If the user can't reproduce the issue, focus on gathering logs and traces before proceeding — intermittent bugs need data, not guesses.

## Phase 2 — Gather evidence

Read code and artifacts systematically. Do not skim — read the actual execution path.

**Source code:**
- Read the function/component where the error occurs, including its callers and callees
- Trace the data flow: where does the input come from? What transforms it? Where does the output go?
- Check type definitions, interfaces, schemas — mismatches between expected and actual types are a top cause

**History and diff:**
- `git log --oneline -10 -- <file>` — recent changes to the affected file
- `git diff HEAD~5 -- <file>` — what changed recently?
- `git blame -L <start>,<end> <file>` — who changed the specific lines and when?

**Logs and runtime signals:**
- Read the full stack trace, not just the top frame — the root cause is often deeper
- Check application logs around the timestamp of the failure
- For frontend: browser console errors, network tab (status codes, response bodies, timing)
- For backend: request logs, database query logs, external service responses
- For infra: container logs, health checks, resource utilization

**Environment and config:**
- Environment variables, feature flags, config files — compare working vs. broken environment
- Dependency versions — `package.json`, `Cargo.toml`, `requirements.txt`, `go.mod`, etc.; check lockfile diffs
- Runtime version (Node, Python, JDK, etc.) — especially after CI/CD or container image changes

**Tests:**
- Run existing tests for the affected module — are they green? If yes, the bug may be in an untested path
- Read the test assertions — they document intended behavior and may reveal wrong assumptions

## Phase 3 — Form hypotheses

Based on evidence (not intuition), rank 2–3 hypotheses. Use this structure:

```
Hypothesis 1 (most likely): [concise description]
  Evidence for: [what supports this]
  Evidence against: [what contradicts this, if anything]
  Verify by: [specific action — a log check, a test, a code read, a breakpoint]

Hypothesis 2: [concise description]
  Evidence for: ...
  Evidence against: ...
  Verify by: ...
```

If there is only one plausible hypothesis with strong evidence, it's fine to have just one — don't invent alternatives for the sake of the format.

**Common root-cause categories** to consider when forming hypotheses:
- **Null / undefined / nil** — missing data where it's expected
- **Type mismatch** — string vs number, wrong enum value, schema drift
- **Race condition / timing** — async operations completing in unexpected order
- **State mutation** — shared mutable state modified by an unexpected caller
- **Environment delta** — works locally, fails in CI/staging/prod due to env vars, secrets, versions
- **Stale cache / stale build** — old artifacts served despite code changes
- **Off-by-one / boundary** — edge cases at limits (empty arrays, max values, first/last items)
- **Dependency change** — transitive dependency updated, API changed, breaking change in minor version
- **Permissions / auth** — token expired, role missing, CORS, CSP
- **Resource exhaustion** — memory, disk, connections, rate limits

## Phase 4 — Verify

Test one hypothesis at a time. Resist the urge to "fix and see" — that's cargo-culting, not debugging.

**Verification methods** (from least to most invasive):
1. **Re-read code** — sometimes a closer read is all you need
2. **Add targeted logging** — log the specific value you suspect is wrong, at the specific point in the flow
3. **Write a minimal test** — a unit test that exercises the suspected faulty path
4. **Isolate the component** — run just the failing piece in isolation (mock its dependencies)
5. **Use a debugger / breakpoint** — step through the execution (suggest IDE-appropriate tools if the user's IDE is known)
6. **Binary search the change** — `git bisect` with the reproducer as the test script

After verifying:
- **Confirmed** → proceed to Phase 5
- **Rejected** → document why, move to the next hypothesis
- **Inconclusive** → gather more evidence, refine the hypothesis

## Phase 5 — Fix

Only after the root cause is confirmed.

1. **Minimal fix.** Change only what's necessary to fix the bug. Do not refactor, rename, or "improve" adjacent code in the same change — that obscures the fix and risks new bugs.
2. **Write a regression test.** The test should fail without the fix and pass with it. This is non-negotiable — untested fixes recur.
3. **Verify the fix against the original reproducer.** Run the exact steps from Phase 1 and confirm the symptom is gone.
4. **Check for siblings.** Search the codebase for the same pattern — if the bug was `arr.length - 1` where it should be `arr.length`, grep for similar usages. `git grep`, `rg`, or IDE search.

## Phase 6 — Reflect (optional but valuable)

For non-trivial bugs, briefly note:
- **Root cause category** — which of the common categories was it?
- **Why it wasn't caught** — missing test? Wrong assumption? Insufficient logging?
- **Preventive action** — a linter rule, a type constraint, a pre-commit check, a monitoring alert, better error handling?

This isn't bureaucracy — it's pattern recognition. Teams that track root-cause categories spot systemic issues.

## Guidelines

- **Never jump to Phase 5.** The urge to "just try this fix" is the most common and most expensive debugging mistake. Understand first, fix second.
- **Prefer reading code over running code.** Most bugs are visible in source if you trace the execution path carefully. Running code is for verification, not discovery.
- **One hypothesis at a time.** Changing two things simultaneously makes it impossible to know which one mattered.
- **Occam's razor applies.** The simplest explanation consistent with the evidence is usually correct. A typo is more likely than a compiler bug.
- **Respect the stack trace.** Read it bottom-to-top. The root frame is where the story begins.
- **Ask "what changed?"** Most bugs are regressions — something that used to work stopped. Finding the delta is often the fastest path.
- **Don't normalize the bug.** If you find yourself thinking "that's weird but probably fine" — it's not fine. Investigate.
- **Know when to step back.** If you've been stuck for 15+ minutes on one hypothesis, take a step back and re-examine your assumptions. The bug might be in a different layer than you think.