---
name: taskmaster-verify
description: Run project quality gates — tests, lint, type-check, and build — with automatic stack detection (Node, Python, Go, Rust, Ruby, Java) and produce a verification.md artifact that gates delivery. Use when the user says "verify", "run the gates", "run tests and lint", "check the project", "is this green?", "/mn.verify", after finishing implementation, or as a standalone health check on a repo before handing off work.
---

# Verify

Run project quality gates with stack auto-detection. Verification gates delivery — `mn.deliver` refuses to proceed if verification fails.

## Core principle

**Trust the tests, not the vibes.** Code that "looks right" isn't verified. Code that passes its test suite, linter, type checker, and build is verified. This phase runs all available quality gates and records the results.

## Input

- None required (operates on current project state)
- Pipeline context determines verification mode. If not set explicitly in conversation, **infer from spec**:
  1. Look for spec in `specs/` directory (match by slug from conversation context or most recent spec)
  2. Fall back to `.taskmaster/current-task/spec.md`
  3. Detect type from spec structure: presence of "Root Cause Analysis" section → bugfix; presence of "Chosen Approach" section → feature
  4. If no spec found → standalone mode
- Verification modes:
  - **Feature**: new tests must exist and pass
  - **Bug**: regression test must exist; all pre-existing tests pass
  - **Standalone** (no pipeline context): run all checks, report results

## Workflow

### 1. Detect stack

Identify the project's tech stack from config files:

| Indicator | Stack | Test | Lint | Type-check | Build |
|-----------|-------|------|------|------------|-------|
| `go.mod` | Go | `go test ./...` | `golangci-lint run` | — | `go build ./...` |
| `pyproject.toml` | Python | `pytest` | `ruff check .` | `mypy .` | — |
| `tsconfig.json` | TypeScript | `npm test` | `eslint .` | `tsc --noEmit` | `npm run build` |
| `Cargo.toml` | Rust | `cargo test` | `cargo clippy` | — | `cargo build` |
| `pom.xml` | Java | `mvn test` | — | — | `mvn package` |

**Fallback detection** (if none of the above match):
- Check `package.json` for `scripts.test`, `scripts.lint`, `scripts.build`
- Check `Makefile` for `test`, `lint`, `check`, `build` targets
- Check CI config (`.github/workflows/`, `.gitlab-ci.yml`) for commands

For monorepos with multiple stacks, run verification for each detected stack.

### 2. Run quality gates

Run in order (stop early on critical failures):

#### 2.1 Tests
Run the detected test command. Capture:
- Total tests, passed, failed, skipped
- Names of failing tests
- Test output/error messages for failures

#### 2.2 Lint
Run the detected lint command. Capture:
- Number of warnings and errors
- File paths and descriptions of errors (not warnings, unless relevant)

#### 2.3 Type-check
Run the detected type-check command (if applicable). Capture:
- Number of type errors
- File paths and descriptions

#### 2.4 Build
Run the detected build command (if applicable). Capture:
- Success or failure
- Error messages on failure

### 3. Apply pipeline-specific checks

#### Feature pipeline
- **New tests must exist**: check `git diff --name-only` for new or modified test files. If no test changes, flag as WARNING.
- **All tests must pass**: any test failure is a FAIL verdict.

#### Bug pipeline
- **Regression test must exist**: check for a new test that specifically covers the fixed bug. If missing, flag as WARNING.
- **All pre-existing tests must pass**: any previously-passing test now failing is a FAIL verdict.

#### Standalone (no pipeline context)
- Run all checks, report results. No pipeline-specific assertions.

### 4. Write verification artifact

Write results to `.taskmaster/current-task/verification.md`:

```markdown
# Verification Report

**Date:** {ISO date}
**Pipeline:** {feature | bug | refactor | spike | standalone}
**Verdict:** PASS | FAIL | PASS WITH WARNINGS

## Test Results
- **Command:** {test command}
- **Total:** {N} | **Passed:** {N} | **Failed:** {N} | **Skipped:** {N}
- **Failing tests:** {list or "none"}

## Lint Results
- **Command:** {lint command}
- **Errors:** {N} | **Warnings:** {N}
- **Details:** {error descriptions or "clean"}

## Type-check Results
- **Command:** {type-check command}
- **Errors:** {N}
- **Details:** {error descriptions or "clean"}

## Build Results
- **Command:** {build command}
- **Status:** success | failure
- **Details:** {error messages or "clean"}

## Pipeline Checks
{pipeline-specific assertions and their results}

## Warnings
{any non-blocking issues}
```

## Guidelines

- **Run what exists.** If the project has no linter configured, skip linting — don't install one. Report "Lint: N/A — no linter configured."
- **Don't fix issues in this phase.** Verify only records results. Fixing happens back in the execution phase.
- **Failed verification blocks delivery.** This is by design. If tests fail, the code isn't ready to ship.
- **Capture enough detail to debug.** Test names and error messages, not just pass/fail counts.
- **Baseline mode is non-destructive.** It only records the current state — it doesn't modify anything.
