---
name: task-verify
description: Run project quality gates — tests, lint, type-check, and build — concurrently with automatic stack detection (Node, Python, Go, Rust, Java) and produce a verification.md artifact that gates delivery. Use when the user says "verify", "run the gates", "run tests and lint", "check the project", "is this green?", "/marvin:task-verify", after finishing implementation, or as a standalone health check on a repo before handing off work.
---

# Verify

Run project quality gates with stack auto-detection. Verification gates delivery — `/marvin:task-deliver` refuses to proceed if verification fails.

## Core principle

**Trust the tests, not the vibes.** Code that "looks right" isn't verified. Code that passes its test suite, linter, type checker, and build is verified. This phase runs all available quality gates and records the results.

## Input

- None required (operates on current project state)
- Pipeline context determines verification mode. If not set explicitly in conversation, **infer from spec**:
  1. Look for spec in `specs/` directory (match by slug from conversation context or most recent spec)
  2. Fall back to `.taskmaster/current-task/spec.md`
  3. Detect type: prefer the spec's frontmatter `type` (`feature`/`bugfix`); else infer from structure — a "Root Cause Analysis" section → bugfix, a "Chosen Approach" section → feature
  4. If no spec found → standalone mode
- Verification modes:
  - **Feature**: new tests must exist and pass
  - **Bug**: regression test must exist; all pre-existing tests pass
  - **Standalone** (no pipeline context): run all checks, report results

## Workflow

### 1. Run the gates via the `verify` tool

Call the **`verify` MCP tool** (`mcp__plugin_marvin_marvin__verify`). It owns stack detection and
gate execution — there is a single source of truth in TypeScript, not a table duplicated in prose.

- It auto-detects the stack from config files (`go.mod` → Go, `pyproject.toml` → Python,
  `tsconfig.json` → TypeScript, `Cargo.toml` → Rust, `pom.xml` → Java) and builds the gate set
  (test / lint / type-check / build, whichever apply).
- It runs the **independent gates concurrently** (`execution: "parallel"`, the default), collects
  every result at a single merge point, then computes one verdict. A failing gate never discards
  the others — every gate's result is recorded.

**Pass-through arguments:**

- `mode`: `"feature"` | `"bug"` | `"standalone"` — set from the pipeline context (see Input). In a
  **chained** run (called straight after `/marvin:task-implement`), pass the `mode` and, if known,
  the `stack` forward so the tool skips re-detection. Standalone invocation lets it auto-detect.
- `execution`: default `"parallel"`. Offer **`"sequential"`** (all gates, one at a time — same
  verdict, lower peak CPU/RAM) or **`"fail-fast"`** (stop at first failure, fast feedback) when the
  user asks or the machine is resource-constrained. The default is parallel because the common
  PASS path is the largest single latency win.
- `only`: e.g. `["test"]` — used by `/marvin:task-implement` for targeted retries; not normally set here.

If `verify` is unavailable, fall back to running the gates yourself: detect the stack from the
config files above (plus `package.json` scripts, `Makefile` targets, or CI config), run each gate,
and record all results. For monorepos with multiple stacks, the tool runs each detected stack's
gates; in the manual fallback, do the same.

### 2. Apply pipeline-specific checks

#### Feature pipeline
- **New tests must exist**: check `git diff --name-only` for new or modified test files. If no test changes, flag as WARNING.
- **All tests must pass**: any test failure is a FAIL verdict.

#### Bug pipeline
- **Regression test must exist**: check for a new test that specifically covers the fixed bug. If missing, flag as WARNING.
- **All pre-existing tests must pass**: any previously-passing test now failing is a FAIL verdict.

#### Standalone (no pipeline context)
- Run all checks, report results. No pipeline-specific assertions.

The feature/bug warnings above are also emitted by the tool's `mode` argument (it inspects
`git diff` for new/modified test files). Setting `mode` correctly is what turns those WARNINGs on.

### 3. Relay the verdict

The `verify` tool **writes the artifact itself** to
`<projectRoot>/.taskmaster/current-task/verification.md` — the exact path `/marvin:task-deliver`
reads, so the delivery gate finds it unchanged. The tool returns a `verify-result` JSON block
(verdict, per-gate status/duration, `wallClockMs` vs `sumOfGatesMs`, `artifactPath`).

Relay to the user: the **verdict** (PASS / FAIL / PASS WITH WARNINGS), which gates ran
concurrently and each result as it came back (preserve the "show each major step" principle),
and the latency (`wallClockMs` vs `sumOfGatesMs`). Do **not** hand-write the artifact — only
reproduce its structure in the manual fallback when the tool is unavailable:

```markdown
# Verification Report
**Pipeline:** {feature | bug | standalone}
**Verdict:** PASS | FAIL | PASS WITH WARNINGS
## Test Results / Lint Results / Type-check Results / Build Results
- **Command / Status / Details** per gate
## Warnings
{non-blocking issues, e.g. missing new tests}
```

## Guidelines

- **Run what exists.** If the project has no linter configured, skip linting — don't install one. Report "Lint: N/A — no linter configured."
- **Don't fix issues in this phase.** Verify only records results. Fixing happens back in the execution phase.
- **Failed verification blocks delivery.** This is by design. If tests fail, the code isn't ready to ship.
- **Capture enough detail to debug.** Test names and error messages, not just pass/fail counts.
- **Baseline mode is non-destructive.** It only records the current state — it doesn't modify anything.
