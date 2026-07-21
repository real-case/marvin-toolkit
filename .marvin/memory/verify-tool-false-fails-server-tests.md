---
id: verify-tool-false-fails-server-tests
type: process
title: verify tool false-fails server tests — MARVIN_TASKS_DIR and _CONFIG both
  leak from the server process
created: 2026-07-19
tags: verify, task-verify, mcp, env-leak, monorepo, testing, ci, gotcha
source: website-pipeline-page
---

**RESOLVED 2026-07-21 — the workaround below is no longer needed.** `test/_driver.mjs` now sanitises the child environment (`hermeticEnv`), so the ambient values cannot reach the spawned server at all. `verify` returns PASS, and the reproduce command that used to fail 42 tests passes 211/211. Kept because the FAILURE CLASS is what matters, and it will recur elsewhere.

**The class.** The `verify` tool runs inside the marvin MCP-server process, and `.mcp.json` gives that process `MARVIN_TASKS_DIR` and `MARVIN_TASKS_CONFIG` pointed at the real repo `.marvin/`. Anything it spawns inherits them. `src/lib/env.ts` resolves every storage path as `env.MARVIN_<X> ?? join(projectDir, …)`, so an inherited value does not merely influence the server — it **outranks the fixture a test just built**, and the test silently asserts against the real repository instead of its tmpdir.

**Why it stayed unexplained for two months.** The suite passed 209/209 from a plain shell (nothing set) and failed ~42 under `verify`. That split makes it read as a flake, as load, or as whatever branch is checked out — and it was misattributed to all three in turn. Confirm a suspected env leak by running the suite with the variables explicitly exported, not by rerunning it and hoping.

**How the fix generalises.** Sanitise by PREFIX (`MARVIN_*`) plus a small name list (`CLAUDE_PROJECT_DIR`), not by listing the two variables that happened to bite — the next storage variable is then hermetic the day it is added. Apply the test's explicit `env` after the sweep so an override always wins; being explicit is the point, since the value then comes from the test rather than from whoever launched it. Guard it at TWO levels: a unit test of the sanitiser, and an integration test that pollutes `process.env` and drives the real server. Measured — with the leaky spawn restored, the unit test still passed and only the integration test caught it, so the cheap test alone would have been false comfort.

Historical workaround, if you are on a commit before the fix: `env -u MARVIN_TASKS_DIR -u MARVIN_TASKS_CONFIG npm run test --workspaces --if-present`, with `execution: sequential`. Both variables had to be cleared; unsetting only `MARVIN_TASKS_CONFIG` (an even earlier note) was not enough.
