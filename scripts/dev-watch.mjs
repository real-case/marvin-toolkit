/**
 * Rebuild the plugin's artefacts whenever their sources change — the standing
 * local development loop.
 *
 *   npm run dev:watch              # watch and rebuild until interrupted
 *   npm run dev:watch -- --dry-run # print the plan, build nothing, exit 0
 *
 * A local install serves BUILD ARTEFACTS, not sources: `mcp/server/dist/server.js`
 * and `widgets/*.html`. Only `SKILL.md` bodies are live. This script removes the
 * manual `npm run dev:plugin` step; it cannot remove the session restart a new
 * `dist/server.js` needs, so it says so exactly when that happens. A rebuilt widget
 * document needs nothing further — the server reads the `ui://` resource from disk
 * per request (ADR-0008).
 *
 * Run it in the MAIN checkout. A build made inside a git worktree is not
 * committable: the worktree has no `node_modules`, resolution walks up past the
 * checkout, and esbuild bakes the longer relative depth into every module-path
 * comment in the bundle — functionally identical, byte-different.
 *
 * Every decision lives in an exported pure function so the behaviour is testable
 * without a file system, a clock, or a build; the watch starts only under the
 * main-module guard at the bottom.
 */

import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Source trees watched recursively. Anything outside them is ignored by default. */
const SOURCE_ROOTS = {
  "packages/marvin-mcp-shared/src": ["mcp-shared", "widgets", "server"],
  "packages/marvin-widgets/src": ["widgets"],
  "plugins/marvin/mcp/server/src": ["server"],
};

/**
 * Build configuration that changes the output without living under `src`: each
 * workspace's compiler or bundler config, the `tsconfig.base.json` both TypeScript
 * projects extend (where `target`, `module` and `strict` actually live), and each
 * workspace's `package.json`, every one of which its build reads.
 *
 * Two fan-outs are deliberate and two are deliberately absent. The shared package's
 * config and manifest reach BOTH consumers, because the server inlines the package
 * (`noExternal: [/^@marvin-toolkit\//]`) and the widgets resolve it through the same
 * emitted `dist`. The server's own `package.json` maps to the server alone — only
 * the version crosses into its build, injected as `__MARVIN_VERSION__`. And the
 * widgets' `tsconfig.json` is here rather than folded into `vite.config.ts`: it
 * supplies `jsxImportSource: "preact"` and the react→preact/compat `paths`, which
 * esbuild reads through vite, so a change to it changes all nine documents.
 */
const BUILD_CONFIG = {
  "tsconfig.base.json": ["mcp-shared", "widgets", "server"],
  "packages/marvin-mcp-shared/tsconfig.json": ["mcp-shared", "widgets", "server"],
  "packages/marvin-mcp-shared/package.json": ["mcp-shared", "widgets", "server"],
  "packages/marvin-widgets/vite.config.ts": ["widgets"],
  "packages/marvin-widgets/tsconfig.json": ["widgets"],
  "packages/marvin-widgets/package.json": ["widgets"],
  "plugins/marvin/mcp/server/tsconfig.json": ["server"],
  "plugins/marvin/mcp/server/tsup.config.ts": ["server"],
  "plugins/marvin/mcp/server/package.json": ["server"],
};

/** Tests and stories are inlined into no committed document, so they build nothing. */
const NON_BUILDING = /\.(test|stories)\.[^./]+$/;

const WIDGET_DIR = /^packages\/marvin-widgets\/src\/widgets\/([^/]+)\//;

/**
 * Whole-workspace recipes. A `widget:<name>` target is resolved separately: the
 * workspace `build` script sets `WIDGET` itself in a loop over every widget
 * directory, so it cannot build one — `vite` has to be spawned directly.
 */
export const TARGETS = {
  "mcp-shared": {
    cwd: repoRoot,
    command: "npm",
    args: ["run", "build", "-w", "@marvin-toolkit/mcp-shared"],
  },
  widgets: {
    cwd: repoRoot,
    command: "npm",
    args: ["run", "build", "-w", "@marvin-toolkit/widgets"],
  },
  server: {
    cwd: repoRoot,
    command: "npm",
    args: ["run", "build", "-w", "@marvin-toolkit/server"],
  },
};

/** Repo-relative, forward-slash form — what the rules below are written against. */
function normalise(relPath) {
  return String(relPath).split(sep).join("/");
}

/** Segment-boundary containment. A raw `startsWith` would accept `src-generated` as `src`. */
function isUnder(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The targets a changed repo-relative path requires, in dependency order.
 * Returns `[]` when the path builds nothing.
 *
 * Rule precedence is load-bearing: the non-building test/story rule is evaluated
 * BEFORE any directory rule, or `src/lib/format.test.ts` matches the shared-widget
 * -code rule and triggers a nine-widget pass that cannot change a byte.
 */
export function planFor(relPath) {
  const path = normalise(relPath);

  if (BUILD_CONFIG[path]) return orderTargets(BUILD_CONFIG[path]);
  if (NON_BUILDING.test(path)) return [];

  const widget = WIDGET_DIR.exec(path);
  if (widget) return [`widget:${widget[1]}`];

  for (const [root, targets] of Object.entries(SOURCE_ROOTS)) {
    if (isUnder(path, root)) return orderTargets(targets);
  }
  return [];
}

/** mcp-shared is built first because both consumers read its emitted `dist`. */
function rank(target) {
  if (target === "mcp-shared") return 0;
  if (target === "server") return 2;
  return 1; // `widgets` and every `widget:<name>`
}

/** Deduplicate, then order by dependency. Array#sort is stable, so ties keep arrival order. */
export function orderTargets(targets) {
  return [...new Set(targets)].sort((a, b) => rank(a) - rank(b));
}

/**
 * The session-restart notice, or null when none is due. A rebuilt widget document
 * is picked up on the host's next `resources/read`; only a new `dist/server.js`
 * needs the session to restart, because the server process is spawned once per
 * connection.
 */
export function restartNotice(rebuilt) {
  if (!rebuilt.includes("server")) return null;
  return "dist/server.js rebuilt — restart the Claude Code session to load it.";
}

/**
 * Run a target set once, in dependency order, and report the order actually used
 * plus which targets failed. A rejecting or failing build does not abort the pass:
 * the remaining targets still run, and `ok` reports the aggregate.
 *
 * `failed` is what keeps the restart notice honest — a target that did not build is
 * not a target that was rebuilt, and announcing it would tell the developer to
 * restart into a bundle that was never produced.
 *
 * A failure ABORTS the pass rather than continuing to the dependents, matching what
 * this reuses: `dev:plugin` chains its three builds with `&&`. Continuing would
 * build the server against the shared `dist` the failed step did not update, and
 * then truthfully advise a restart into it.
 */
export async function runOnce({ run, targets }) {
  const order = orderTargets(targets);
  const built = [];
  const failed = [];
  for (const target of order) {
    let result;
    try {
      result = await run(target);
    } catch (err) {
      result = { ok: false, error: err };
    }
    if (!result?.ok) {
      failed.push(target);
      break;
    }
    built.push(target);
  }
  // `built` is reported, never derived as `order` minus `failed`: once the pass can
  // abort, the tail of `order` was never attempted, and calling it rebuilt would
  // reintroduce the very claim this function exists to keep honest.
  return { ok: failed.length === 0, order, built, failed };
}

/**
 * Coalescing rebuild scheduler.
 *
 * `schedule(paths)` maps the paths to targets, merges them into the pending set and
 * resolves when the pass carrying them has finished. A burst inside the debounce
 * window becomes one pass; changes arriving while a pass runs become exactly ONE
 * follow-up carrying the union of everything that changed during it.
 *
 * Every pass goes through `runOnce`, never through an ordering of its own — the
 * dependency order exists in one place, so the path the watcher takes is the path
 * the tests cover.
 */
export function createRebuilder({ run, notify, delay = 300 }) {
  let pending = new Set();
  let waiters = [];
  let timer = null;
  let active = false;

  function drain() {
    // Local guards rather than a caller-discipline invariant: a `notify` that
    // schedules synchronously would otherwise leave a timer armed over an active
    // pass and start a second one concurrently.
    if (active) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;

    const batch = [...pending];
    const settle = waiters;
    pending = new Set();
    waiters = [];
    active = true;

    void runOnce({ run, targets: batch }).then((result) => {
      active = false;
      // Only what actually built is announced — see runOnce.
      try {
        notify(result.built, result);
      } catch (err) {
        // Fail-open, as runPackServer's onInvoke does: a throwing observer must not
        // strand the waiters below, wedge the queue, or kill the watch.
        // String(err), not err.message: `throw null` would make this catch throw.
        console.error(`dev:watch: notify threw — ignoring: ${String(err)}`);
      }
      for (const resolveWaiter of settle) resolveWaiter(result);
      drain(); // one follow-up, carrying whatever accumulated during the pass
    });
  }

  function schedule(paths) {
    let planned = 0;
    for (const path of paths) {
      for (const target of planFor(path)) {
        pending.add(target);
        planned += 1;
      }
    }
    // A change that builds nothing must not extend a pending rebuild's window:
    // a formatter sweeping the test files would otherwise defer it indefinitely.
    if (planned === 0) return Promise.resolve(null);

    const done = new Promise((resolveWaiter) => waiters.push(resolveWaiter));
    if (!active) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        drain();
      }, delay);
    }
    return done;
  }

  return { schedule };
}

// ── the watch itself: everything below runs only when this file is the entry ──

/**
 * The spawn recipe for a target. A `widget:<name>` build cannot go through
 * `npm run build -w @marvin-toolkit/widgets`: that script sets `WIDGET` itself in a
 * loop over every widget directory. Spawn the hoisted `vite` binary instead, with
 * `cwd` at the widgets package — the same resolution
 * `packages/marvin-widgets/scripts/watch.mjs` uses.
 */
export function recipeFor(target) {
  if (TARGETS[target]) return TARGETS[target];
  if (!target.startsWith("widget:")) {
    throw new Error(`dev:watch: unrecognised target "${target}"`);
  }

  const name = target.slice("widget:".length);
  // npm puts the workspace and root `node_modules/.bin` on PATH, but resolving the
  // hoisted binary keeps a direct `node scripts/dev-watch.mjs` working too.
  const hoisted = resolve(repoRoot, "node_modules", ".bin", "vite");
  return {
    cwd: resolve(repoRoot, "packages", "marvin-widgets"),
    command: existsSync(hoisted) ? hoisted : "vite",
    args: ["build"],
    env: { WIDGET: name },
  };
}

function spawnBuild(target) {
  const recipe = recipeFor(target);
  return new Promise((resolveResult) => {
    const child = spawn(recipe.command, recipe.args, {
      cwd: recipe.cwd,
      env: { ...process.env, ...recipe.env },
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`dev:watch: failed to start the ${target} build: ${err.message}`);
      resolveResult({ ok: false });
    });
    child.on("exit", (code, signal) => {
      const ok = !signal && code === 0;
      if (!ok) console.error(`dev:watch: ${target} build failed — watching anyway.`);
      resolveResult({ ok });
    });
  });
}

function main(argv) {
  if (argv.includes("--dry-run")) {
    const plan = orderTargets(Object.values(SOURCE_ROOTS).flat());
    console.error(`dev:watch plan: ${plan.join(" → ")}`);
    console.error(`watching ${Object.keys(SOURCE_ROOTS).length} source trees`);
    console.error(`watching ${Object.keys(BUILD_CONFIG).length} build-configuration files`);
    return 0;
  }

  const rebuilder = createRebuilder({
    run: spawnBuild,
    notify: (rebuilt, result) => {
      if (result.failed.length > 0) {
        console.error(`dev:watch: FAILED ${result.failed.join(", ")}`);
      }
      if (rebuilt.length > 0) {
        console.error(`dev:watch: rebuilt ${rebuilt.join(", ")}`);
      }
      // Only for a bundle that was actually produced.
      const notice = restartNotice(rebuilt);
      if (notice) console.error(`dev:watch: ${notice}`);
    },
  });

  for (const root of Object.keys(SOURCE_ROOTS)) {
    const absolute = resolve(repoRoot, root);
    try {
      watch(absolute, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        void rebuilder.schedule([`${root}/${normalise(filename)}`]);
      });
    } catch (err) {
      console.error(`dev:watch: cannot watch ${root}: ${err.message}`);
      return 1;
    }
  }

  for (const file of Object.keys(BUILD_CONFIG)) {
    const absolute = resolve(repoRoot, file);
    try {
      watch(absolute, () => void rebuilder.schedule([file]));
    } catch (err) {
      console.error(`dev:watch: cannot watch ${file}: ${err.message}`);
      return 1;
    }
  }

  console.error("dev:watch: watching plugin sources — Ctrl-C to stop.");
  process.on("SIGINT", () => process.exit(0));
  return null; // stay alive
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}
