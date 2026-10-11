---
id: a-sealed-test-is-committed-as-written
type: process
title: A sealed test is committed as written, so the pipeline test-author
  formats and lints it first
created: 2026-10-11
tags: pipeline, role:test-author, seal, prettier, eslint, format, lint, test,
  plugins, marvin, server, widgets
source: autopilot-task-19
---

In an autopilot run the seal stage commits the test-author's files byte for byte: children run with HUSKY=0, so lint-staged never formats them, and no later role may edit a sealed file. The gate stage then runs `npm run lint` and `npm run format:check` over them, so an unformatted or lint-failing sealed test fails the gate on every iteration until the test goes back to its author. Before finishing, run `npx --no -- prettier --write <file>` and `npx --no -- eslint --fix <file>` on every test file written, then run it once more with `node scripts/test-one.mjs <file>` to see it still fail for the missing implementation. Keep the `--`: under npm 11, `npx --no prettier --write <file>` hands `--write` to npm, and Prettier prints the file and writes nothing.
