// Tests for the dev-watch rebuild loop.
//
// Every fixture below is chosen so a plausible WRONG implementation yields a
// different value, not merely so the right one passes. The ignore cases are
// sibling-prefix paths a `startsWith` allowlist really does accept; the mid-pass
// case schedules `server`, `mcp-shared`, `server` so one assertion discriminates
// four separate bugs. Nothing here spawns a build: `run` is always injected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createRebuilder,
  orderTargets,
  planFor,
  recipeFor,
  restartNotice,
  runOnce,
} from "../scripts/dev-watch.mjs";

/** Resolve once the predicate holds, so "a pass is running" is a state, not a guess. */
async function waitFor(predicate, label) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/** A `run` fake that records targets and resolves immediately. */
function recordingRun(outcome = { ok: true }) {
  const calls = [];
  return {
    calls,
    run: async (target) => {
      calls.push(target);
      return typeof outcome === "function" ? outcome(target) : outcome;
    },
  };
}

/**
 * A `run` fake whose FIRST call hangs until released. Without it, "a change
 * scheduled while a pass is already running" is a timing race and the mid-pass
 * test is flaky rather than false.
 */
function gatedRun() {
  const calls = [];
  let release;
  const gate = new Promise((r) => {
    release = () => r({ ok: true });
  });
  return {
    calls,
    release: () => release(),
    run: async (target) => {
      calls.push(target);
      return calls.length === 1 ? gate : { ok: true };
    },
  };
}

test("planFor maps each source tree to its dependency-ordered targets", () => {
  assert.deepEqual(planFor("packages/marvin-mcp-shared/src/contracts/index.ts"), [
    "mcp-shared",
    "widgets",
    "server",
  ]);
  assert.deepEqual(planFor("packages/marvin-widgets/src/widgets/help/HelpWidget.tsx"), [
    "widget:help",
  ]);
  assert.deepEqual(planFor("packages/marvin-widgets/src/lib/links.ts"), ["widgets"]);
  assert.deepEqual(planFor("plugins/marvin/mcp/server/src/tools/help.ts"), ["server"]);

  // Build configuration: changes the output without living under `src`.
  assert.deepEqual(planFor("packages/marvin-mcp-shared/tsconfig.json"), [
    "mcp-shared",
    "widgets",
    "server",
  ]);
  assert.deepEqual(planFor("packages/marvin-widgets/vite.config.ts"), ["widgets"]);
  assert.deepEqual(planFor("plugins/marvin/mcp/server/tsup.config.ts"), ["server"]);
  // Only the version crosses into the server build, so this must NOT fan out.
  assert.deepEqual(planFor("plugins/marvin/mcp/server/package.json"), ["server"]);

  // The base config both TypeScript projects extend — where target/module/strict
  // actually live, so it reaches every consumer.
  assert.deepEqual(planFor("tsconfig.base.json"), ["mcp-shared", "widgets", "server"]);
  assert.deepEqual(planFor("plugins/marvin/mcp/server/tsconfig.json"), ["server"]);
  // The widgets `build` script is the loop that emits all nine documents.
  assert.deepEqual(planFor("packages/marvin-widgets/package.json"), ["widgets"]);
  // Supplies jsxImportSource + the react→preact/compat paths, read by esbuild
  // through vite, so it changes all nine documents.
  assert.deepEqual(planFor("packages/marvin-widgets/tsconfig.json"), ["widgets"]);
  // The shared manifest's exports map is what both consumers resolve through.
  assert.deepEqual(planFor("packages/marvin-mcp-shared/package.json"), [
    "mcp-shared",
    "widgets",
    "server",
  ]);
});

test("paths outside the watched sources and test files plan no rebuild", () => {
  // Sibling prefixes: exactly what a raw `startsWith` gets wrong.
  assert.deepEqual(planFor("packages/marvin-widgets/src-generated/x.ts"), []);
  assert.deepEqual(planFor("packages/marvin-mcp-shared/srcfoo.ts"), []);

  // Tests and stories are inlined into no committed document.
  assert.deepEqual(planFor("packages/marvin-widgets/src/widgets/help/HelpWidget.test.tsx"), []);
  assert.deepEqual(planFor("packages/marvin-widgets/src/primitives/Markdown.stories.tsx"), []);

  // The precedence case: the test-file rule must win over the src/lib directory rule.
  assert.deepEqual(planFor("packages/marvin-widgets/src/lib/format.test.ts"), []);

  // Build outputs and unrelated trees.
  assert.deepEqual(planFor("plugins/marvin/mcp/server/dist/server.js"), []);
  assert.deepEqual(planFor("plugins/marvin/widgets/help.html"), []);
  assert.deepEqual(planFor("README.md"), []);
});

test("runOnce runs a joined target set in dependency order", async () => {
  const { run, calls } = recordingRun();

  const result = await runOnce({
    run,
    targets: ["server", "widget:help", "mcp-shared"],
  });

  // Both assertions matter: sorting a copy while iterating the original passes
  // the first and fails the second.
  assert.deepEqual(result.order, ["mcp-shared", "widget:help", "server"]);
  assert.deepEqual(calls, ["mcp-shared", "widget:help", "server"]);
  assert.equal(result.ok, true);
});

test("the restart notice is returned only when the server bundle was rebuilt", () => {
  assert.equal(restartNotice(["widget:help"]), null);
  assert.equal(restartNotice(["mcp-shared", "widgets"]), null);
  assert.match(restartNotice(["mcp-shared", "server"]), /restart/i);
  assert.match(restartNotice(["server"]), /restart/i);
});

test("a burst of changes coalesces into a single pass", async () => {
  const { run, calls } = recordingRun();
  const rebuilder = createRebuilder({ run, notify: () => {}, delay: 5 });

  const path = "plugins/marvin/mcp/server/src/tools/help.ts";
  rebuilder.schedule([path]);
  rebuilder.schedule([path]);
  rebuilder.schedule([path]);
  await rebuilder.schedule([path]);

  // Undebounced, this is 4.
  assert.deepEqual(calls, ["server"]);
});

test("a failed build is reported and the rebuilder keeps working", async () => {
  const reported = [];
  const { run, calls } = recordingRun((target) =>
    target === "server" ? { ok: false } : { ok: true },
  );
  const rebuilder = createRebuilder({
    run,
    notify: (rebuilt, result) => reported.push({ rebuilt, ok: result.ok, failed: result.failed }),
    delay: 5,
  });

  await rebuilder.schedule(["plugins/marvin/mcp/server/src/tools/help.ts"]);
  assert.deepEqual(calls, ["server"]);

  // The watcher survives the failure: a later change is still built.
  await rebuilder.schedule(["packages/marvin-widgets/src/lib/links.ts"]);
  assert.deepEqual(calls, ["server", "widgets"]);

  // The failure is OBSERVED, not merely survived. A `notify` handed the pass order
  // regardless of outcome would report `rebuilt: ["server"], ok: true` here, which is
  // what makes the watcher announce a bundle it never produced.
  assert.deepEqual(reported, [
    { rebuilt: [], ok: false, failed: ["server"] },
    { rebuilt: ["widgets"], ok: true, failed: [] },
  ]);

  // And the notice is withheld for the build that did not happen.
  assert.equal(restartNotice(reported[0].rebuilt), null);
});

test("a failed target is never announced as rebuilt, so no restart is advised", async () => {
  const { run } = recordingRun((target) => (target === "server" ? { ok: false } : { ok: true }));

  const result = await runOnce({ run, targets: ["mcp-shared", "server"] });

  assert.deepEqual(result.failed, ["server"]);
  assert.deepEqual(result.built, ["mcp-shared"]);
  assert.equal(result.ok, false);
  assert.equal(restartNotice(result.built), null);
});

test("an aborted pass announces nothing, never its untried tail", async () => {
  const reported = [];
  const { run, calls } = recordingRun((target) => ({ ok: target !== "mcp-shared" }));
  const rebuilder = createRebuilder({
    run,
    notify: (rebuilt, result) => reported.push({ rebuilt, failed: result.failed }),
    delay: 5,
  });

  // One shared-package change plans all three targets; the first one fails.
  await rebuilder.schedule(["packages/marvin-mcp-shared/src/contracts/index.ts"]);

  assert.deepEqual(calls, ["mcp-shared"]);
  assert.deepEqual(reported, [{ rebuilt: [], failed: ["mcp-shared"] }]);

  // Deriving the announcement as `order` minus `failed` would name
  // ["widgets", "server"] — targets that never ran — and advise a restart into a
  // bundle that was never produced. That is the original defect, re-entered
  // through the abort.
  assert.equal(restartNotice(reported[0].rebuilt), null);
});

test("a failed dependency aborts the pass instead of building on a stale artefact", async () => {
  const { run, calls } = recordingRun((target) => ({ ok: target !== "mcp-shared" }));

  const result = await runOnce({ run, targets: ["mcp-shared", "server"] });

  // `server` must NOT run: it would bundle the shared dist that the failed step
  // did not update, and then be truthfully announced as rebuilt.
  assert.deepEqual(calls, ["mcp-shared"]);
  assert.deepEqual(result.failed, ["mcp-shared"]);
  assert.deepEqual(result.built, []);
  assert.equal(restartNotice(result.built), null);

  // `order` still reports the full plan — only `built` narrows.
  assert.deepEqual(result.order, ["mcp-shared", "server"]);
});

test("recipeFor builds one widget through vite, never through the workspace script", () => {
  const recipe = recipeFor("widget:help");

  // The workspace `build` script sets WIDGET itself in a loop over every widget
  // directory, so it cannot build one — this must not be an `npm run build -w`.
  assert.notEqual(recipe.command, "npm");
  assert.match(recipe.command, /vite$/);
  assert.deepEqual(recipe.args, ["build"]);
  assert.equal(recipe.env.WIDGET, "help");
  assert.match(recipe.cwd, /packages\/marvin-widgets$/);

  // Whole-workspace targets keep the existing scripts.
  assert.deepEqual(recipeFor("server").args, ["run", "build", "-w", "@marvin-toolkit/server"]);

  // An unrecognised target must throw rather than slice a prefix off garbage and
  // spawn a build for a widget that does not exist.
  assert.throws(() => recipeFor("garbage"), /unrecognised target/);
});

test("a change that builds nothing does not join or defer a pending rebuild", async () => {
  const { run, calls } = recordingRun();
  const rebuilder = createRebuilder({ run, notify: () => {}, delay: 5 });

  const real = rebuilder.schedule(["plugins/marvin/mcp/server/src/tools/help.ts"]);
  // A formatter sweeping the test files while a real rebuild is pending.
  const ignored = rebuilder.schedule(["packages/marvin-widgets/src/lib/format.test.ts"]);

  // The discriminator is the RETURN VALUE, not the timing: a guard written as
  // `pending.size === 0` falls through whenever any real target is already
  // pending, so this call would register a waiter, resolve with the pass result
  // instead of null, and — the actual harm — reset the debounce timer. Timing
  // alone cannot tell the two apart when the events arrive in one tick.
  assert.equal(await ignored, null);

  await real;
  assert.deepEqual(calls, ["server"]);
});

test("changes arriving mid-pass collapse into one ordered follow-up", async () => {
  const { run, calls, release } = gatedRun();
  const passes = [];
  const rebuilder = createRebuilder({
    run,
    notify: (rebuilt) => passes.push(rebuilt),
    delay: 1,
  });

  // Start a pass and hold it open.
  rebuilder.schedule(["packages/marvin-widgets/src/lib/links.ts"]);
  await waitFor(() => calls.length === 1, "the first pass to start");

  // server, then mcp-shared, then server again — all while that pass is running.
  rebuilder.schedule(["plugins/marvin/mcp/server/src/tools/help.ts"]);
  rebuilder.schedule(["packages/marvin-mcp-shared/src/contracts/index.ts"]);
  const settled = rebuilder.schedule(["plugins/marvin/mcp/server/src/tools/spec.ts"]);

  release();
  await settled;

  // One follow-up (a per-event backlog gives three), carrying the union (an
  // assigned pending set drops the earlier ones), ordered by dependency (a
  // self-ordering createRebuilder puts server first), with the repeated `server`
  // built once (an array-push pending set builds it twice).
  //
  // `widgets` rides along because a shared-source change fans out to both
  // consumers by the rule above — no path plans to `mcp-shared` alone, which is
  // why the follow-up is three targets rather than the two named in AC7.
  assert.deepEqual(passes, [["widgets"], ["mcp-shared", "widgets", "server"]]);
  assert.deepEqual(calls, ["widgets", "mcp-shared", "widgets", "server"]);
});

test("the root test script runs the root suite exactly once and keeps the workspace suites", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const script = pkg.scripts.test;

  const rootSuite = "node --test test/*.test.mjs";
  const occurrences = script.split(rootSuite).length - 1;

  // 0 fails a forgotten edit, 2 fails a blind append.
  assert.equal(occurrences, 1, `expected exactly one "${rootSuite}" in: ${script}`);
  // A replaced rather than extended script would silently stop the workspace suites.
  assert.ok(
    script.includes("npm run test --workspaces --if-present"),
    `the workspace clause must survive, got: ${script}`,
  );
});

test("orderTargets deduplicates and is stable within a rank", () => {
  assert.deepEqual(orderTargets(["server", "mcp-shared", "server"]), ["mcp-shared", "server"]);
  assert.deepEqual(orderTargets(["widget:reports", "widget:help"]), [
    "widget:reports",
    "widget:help",
  ]);
});
