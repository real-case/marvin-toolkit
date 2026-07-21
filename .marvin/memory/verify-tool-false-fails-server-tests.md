---
id: verify-tool-false-fails-server-tests
type: process
title: verify tool false-fails server tests — MARVIN_TASKS_DIR and _CONFIG both
  leak from the server process
created: 2026-07-19
tags: verify, task-verify, mcp, env-leak, monorepo, testing, ci, gotcha
source: website-pipeline-page
---

Running /marvin:task-verify (the `verify` MCP tool) on this monorepo FAILs the `@marvin-toolkit/server` test gate even when the code is green, because the tool runs inside the marvin MCP-server process, which `.mcp.json` gives BOTH `MARVIN_TASKS_DIR` and `MARVIN_TASKS_CONFIG` (pointed at the real repo `.marvin/` paths). Those two vars leak into the gate's node:test children and break the server board/config/adr fixture isolation — ~40 tests fail. Unsetting only `MARVIN_TASKS_CONFIG` (an earlier-recorded workaround) is NOT enough; BOTH must be cleared. How to apply: pass an explicit test gate to the verify tool — `env -u MARVIN_TASKS_DIR -u MARVIN_TASKS_CONFIG npm run test --workspaces --if-present` — with `execution: sequential` (also dodges the build/test dist-race). A plain shell `npm test` is already clean because those vars are unset there, so reproduce/confirm green in the shell; a site-only or other non-server change cannot affect these tests (they pass 209/209 hermetically). Real fix would be a hermetic server test driver that ignores the ambient MARVIN_TASKS_* env.
