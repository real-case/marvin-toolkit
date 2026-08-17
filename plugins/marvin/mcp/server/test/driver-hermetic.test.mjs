// driver-hermetic.test.mjs — the stdio driver must not leak ambient storage paths to the server.
//
// THE BUG THIS PINS. `src/lib/env.ts` resolves every storage path as
// `env.MARVIN_<X> ?? join(projectDir, ".marvin", "<x>")`, with `projectDir` itself
// `env.CLAUDE_PROJECT_DIR ?? process.cwd()`. The driver used to spawn the server with
// `{ ...process.env, ...env }`, so an ambient value OUTRANKED the fixture a test had just built —
// and the test then asserted against the real repository's `.marvin/` instead of its own tmpdir.
//
// `plugins/marvin/.mcp.json` sets MARVIN_TASKS_DIR and MARVIN_TASKS_CONFIG for the marvin MCP
// server, so everything it spawns inherits them — including `npm run test` when the `verify` tool
// runs it. Measured on dev at 0898d10: 209/209 from a plain shell, 42 failures under `verify`,
// entirely in the adr and config suites. The split is what made it read as a flake for so long,
// and it blocked the task pipeline's delivery gate.
//
// Two tests, deliberately at different levels. The first is a fast unit check of the sanitiser.
// The second is the one that would actually have caught the bug: it pollutes `process.env` and
// drives the REAL server over stdio, so it exercises the spawn path rather than a helper's
// arithmetic. Without the second, a future refactor could bypass `hermeticEnv` at the call site
// and leave the first still green.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hermeticEnv, withSession, HERMETIC_PREFIX, HERMETIC_NAMES } from "./_driver.mjs";

/** Every name src/lib/env.ts consults. Restated here so a rename there fails loudly. */
const STORAGE_VARS = [
  "MARVIN_TASKS_DIR",
  "MARVIN_TASKS_CONFIG",
  "MARVIN_MEMORY_DIR",
  "MARVIN_HANDOFF_DIR",
  "MARVIN_SECURITY_DIR",
  "MARVIN_USAGE_DIR",
  "CLAUDE_PROJECT_DIR",
];

test("hermeticEnv strips every storage variable and keeps everything else", () => {
  const base = {
    PATH: "/usr/bin",
    HOME: "/home/someone",
    MARVIN_TASKS_DIR: "/ambient/track",
    MARVIN_TASKS_CONFIG: "/ambient/config.json",
    MARVIN_MEMORY_DIR: "/ambient/memory",
    MARVIN_HANDOFF_DIR: "/ambient/handoff",
    MARVIN_SECURITY_DIR: "/ambient/security",
    MARVIN_USAGE_DIR: "/ambient/usage",
    MARVIN_TEST_TIMEOUT_MS: "60000",
    CLAUDE_PROJECT_DIR: "/ambient/project",
  };

  const clean = hermeticEnv(base);

  for (const name of STORAGE_VARS) {
    assert.ok(!(name in clean), `${name} must not reach the server from the ambient environment`);
  }
  // The prefix rule sweeps the harness knob too. Harmless and deliberate: it is read by _driver.mjs
  // in the PARENT process, and the server never looks at it.
  assert.ok(!("MARVIN_TEST_TIMEOUT_MS" in clean));

  // Everything unrelated survives — PATH in particular, or the child could not exec node.
  assert.equal(clean.PATH, "/usr/bin");
  assert.equal(clean.HOME, "/home/someone");

  // An explicit override always wins: that is how a test declares the paths it actually wants.
  const overridden = hermeticEnv(base, { MARVIN_TASKS_DIR: "/fixture/track" });
  assert.equal(overridden.MARVIN_TASKS_DIR, "/fixture/track");
  assert.equal(overridden.MARVIN_TASKS_CONFIG, undefined);

  // Sanity on the rule itself, so a future edit that empties these is not silently vacuous.
  assert.equal(HERMETIC_PREFIX, "MARVIN_");
  assert.ok(HERMETIC_NAMES.includes("CLAUDE_PROJECT_DIR"));
});

test("a polluted ambient environment cannot reach the spawned server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-hermetic-"));
  const decoy = mkdtempSync(join(tmpdir(), "marvin-decoy-"));

  // The fixture the test declares: a project whose config carries a base_branch nothing else uses.
  mkdirSync(join(dir, ".marvin"), { recursive: true });
  writeFileSync(
    join(dir, ".marvin", "config.json"),
    JSON.stringify({ base_branch: "fixture-branch" }, null, 2),
  );

  // The pollution: exactly what .mcp.json exports into everything the MCP server spawns, pointed
  // at a decoy so a leak is unmistakable rather than accidentally correct.
  mkdirSync(join(decoy, ".marvin"), { recursive: true });
  writeFileSync(
    join(decoy, ".marvin", "config.json"),
    JSON.stringify({ base_branch: "LEAKED-ambient-branch" }, null, 2),
  );

  const saved = {};
  for (const name of STORAGE_VARS) saved[name] = process.env[name];
  process.env.MARVIN_TASKS_CONFIG = join(decoy, ".marvin", "config.json");
  process.env.MARVIN_TASKS_DIR = join(decoy, ".marvin", "track");
  process.env.CLAUDE_PROJECT_DIR = decoy;

  try {
    const result = await withSession({ env: { CLAUDE_PROJECT_DIR: dir } }, (s) =>
      s.request("tools/call", {
        name: "task",
        arguments: { action: "config", projectRoot: dir },
      }),
    );
    const text = result.content.map((c) => c.text).join("\n");

    // The assertion that matters: the server read the FIXTURE's config, not the ambient one.
    assert.match(
      text,
      /fixture-branch/,
      `server did not read the fixture config — ambient MARVIN_TASKS_CONFIG leaked through:\n${text}`,
    );
    assert.doesNotMatch(
      text,
      /LEAKED-ambient-branch/,
      `ambient MARVIN_TASKS_CONFIG reached the server:\n${text}`,
    );
  } finally {
    for (const name of STORAGE_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});
