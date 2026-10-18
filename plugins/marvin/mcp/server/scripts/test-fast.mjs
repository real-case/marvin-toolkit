#!/usr/bin/env node
// test-fast.mjs — the server suite without its subprocess-heavy files.
//
// `npm test` in this workspace runs every `test/*.test.mjs` under `node --test`, and CI runs it
// that way. Ten of the files spawn git, `node -e` supervisors, whole `node --test` red runs or the
// server itself once per test, and measured alone on 2026-10-18 (darwin, Node 24, with other
// work on the machine) they take 17–152 s each and 713 of the suite's 802 sequential seconds:
//
//   spec 151.5 s · pipeline-learning 121.0 · pipeline-runtime 115.7 · pipeline-seal 100.6 ·
//   pipeline-gate-adversary 85.1 · pipeline-metrics-carry 39.1 · pipeline-gate 35.3 ·
//   verify 25.3 · pipeline-worktree 21.7 · summary-structured 17.4
//
// The next file (spec-next-base) takes 9 s and every other one under 5 s. The autopilot's `test`
// gate reruns the suite after every executor iteration, and the executor runs it once more
// through the `verify` tool, so on marvin-toolkit itself the gate took 33 minutes
// (docs/proposals/autopilot-workflow-audit.md §5.1, F8). Concurrency alone cannot fix that: the
// longest file is the critical path whatever `--test-concurrency` says.
//
// So `npm run test:fast` runs every file but the ten, and the repository's `.marvin/config.json`
// `gates.test` points at it. `npm test` is unchanged and CI still runs the whole suite on every
// push, so nothing a pull request merges is judged by less than before. A file named here that
// no longer exists fails the run: the list cannot rot into excluding nothing.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Measured above 15 s alone; see the header for the numbers. */
export const SLOW = Object.freeze([
  "pipeline-gate-adversary.test.mjs",
  "pipeline-gate.test.mjs",
  "pipeline-learning.test.mjs",
  "pipeline-metrics-carry.test.mjs",
  "pipeline-runtime.test.mjs",
  "pipeline-seal.test.mjs",
  "pipeline-worktree.test.mjs",
  "spec.test.mjs",
  "summary-structured.test.mjs",
  "verify.test.mjs",
]);

/** Every `test/*.test.mjs` basename, as the `test` script's glob selects them. */
export function allTestFiles(root = serverRoot) {
  return readdirSync(join(root, "test"))
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
}

/**
 * The fast selection: every test file that is not in `SLOW`. Throws when a `SLOW` entry names
 * no file, so a renamed or deleted slow test is noticed rather than silently rejoining the set.
 */
export function fastTestFiles(root = serverRoot) {
  const all = allTestFiles(root);
  const missing = SLOW.filter((f) => !all.includes(f));
  if (missing.length > 0) {
    throw new Error(`test-fast: SLOW names files that do not exist: ${missing.join(", ")}`);
  }
  return all.filter((f) => !SLOW.includes(f));
}

function invokedDirectly() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (invokedDirectly()) {
  const files = fastTestFiles().map((f) => join("test", f));
  const ran = spawnSync(process.execPath, ["--test", "--test-concurrency=4", ...files], {
    cwd: serverRoot,
    stdio: "inherit",
  });
  if (ran.error) {
    process.stderr.write(`test-fast: the runner could not start: ${ran.error.message}\n`);
    process.exitCode = 1;
  } else if (ran.signal) process.kill(process.pid, ran.signal);
  else process.exitCode = ran.status ?? 1;
}
