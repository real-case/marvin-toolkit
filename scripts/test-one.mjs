#!/usr/bin/env node
// test-one.mjs — run ONE test file the way the workspace that owns it runs its tests.
//
// This is marvin-toolkit's `gates.test_one` (`node scripts/test-one.mjs {file}` in
// .marvin/config.json). Three readers use that template, each with one repo-relative path
// that lib/shell-quote.ts has single-quoted (ADR-0048): `verify`'s `action: "oracles"` for a
// `kind: test` criterion, the autopilot seal stage for the red run of each sealed test, and the
// pipeline verifier's single-test probe.
//
// WHY A DISPATCHER RATHER THAN `node --test {file}`. The repository runs three test runners,
// and every workspace runs its own from its own directory:
//   - `node --test test/*.test.mjs` in the root, the server, the shared library and the site;
//   - vitest (`vitest run`, happy-dom) for the widgets' `src/**/*.test.{ts,tsx}`;
//   - Playwright for the site's `e2e/*.spec.ts`, against a built and served site.
// `node --test {file}` from the root cannot run a widget test at all, and runs a server test
// from the wrong directory: the stdio driver spawns the server with the test's working
// directory, the server takes that directory as its project, and from the root it would read
// this repository's own committed .marvin/config.json instead of an empty project. ADR-0036
// leaves a path-keyed `test_one` as future work for the engine; this script is that, for this
// repository, because one template has to name one command.
//
// WHAT IT GUARANTEES
//   - A file runs under the runner, and from the directory, that its workspace's `test` script
//     uses. Only the files those scripts select are routed: a top-level `test/*.test.mjs` of one
//     of the four node workspaces, or a widget `src/**/*.test.{ts,tsx}`.
//   - Anything else exits 127, the shell's "nothing ran", with the reason on stderr. The seal
//     stage reads 127 as a test that did not run, never as a red one. A site e2e spec is refused
//     this way on purpose: it needs a fresh site build and port 4321, which a running dev server
//     silently takes over, so a criterion it proves names its own `oracle.run` or is a
//     `kind: command` oracle.
//   - Server, shared-library and widget tests import the shared library's build output, which
//     git ignores: the package exports point only at `dist/`, and the widgets' vite.config.ts
//     has no alias to `src/`. It is rebuilt first (about two seconds), so the test judges the
//     current source: nothing else rebuilds it before an oracle, and a re-seal's base tree has
//     none at all. There a widget test that imports a contract fails to resolve it, vitest counts
//     one failed file, and the seal stage would take that failure as the test's red. A library
//     that does not build exits 127 instead, since the test itself never started.
//   - The environment is hermetic in the sense test/_driver.mjs gives the word: every `MARVIN_*`
//     variable except `MARVIN_TEST_TIMEOUT_MS` (a knob the tests themselves read), and
//     `CLAUDE_PROJECT_DIR`, are dropped, so a run started from an MCP server or a pipeline child
//     behaves as one started from a clean shell. `NODE_TEST_CONTEXT` is dropped too: it marks a
//     process as a child of a running `node --test`, and this run is a top-level one.
//   - The runner's exit status is passed through, and a signal that ended it is re-raised.

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The shell's "command not found": nothing ran, so the outcome says nothing about the code. */
export const NOT_RUN = 127;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SHARED_DIR = "packages/marvin-mcp-shared";
const WIDGETS_DIR = "packages/marvin-widgets";

/**
 * Each workspace's own test selection, as its `test` script globs it, and where it runs. The
 * node patterns admit top-level files only (`test/*.test.mjs` does not descend), so a fixture
 * under `test/fixtures/` is never routed; the widget pattern mirrors the `include` glob in the
 * widgets' vite.config.ts: a `.test.ts` or `.test.tsx` file at any depth under `src/`.
 */
export const ROUTES = [
  { pattern: /^test\/[^/]+\.test\.mjs$/, dir: ".", runner: "node", shared: false },
  {
    pattern: /^plugins\/marvin\/mcp\/server\/test\/[^/]+\.test\.mjs$/,
    dir: "plugins/marvin/mcp/server",
    runner: "node",
    shared: true,
  },
  {
    pattern: /^packages\/marvin-mcp-shared\/test\/[^/]+\.test\.mjs$/,
    dir: SHARED_DIR,
    runner: "node",
    shared: true,
  },
  {
    pattern: /^packages\/site\/test\/[^/]+\.test\.mjs$/,
    dir: "packages/site",
    runner: "node",
    shared: false,
  },
  {
    pattern: /^packages\/marvin-widgets\/src\/(?:[^/]+\/)*[^/]+\.test\.tsx?$/,
    dir: WIDGETS_DIR,
    runner: "vitest",
    shared: true,
  },
];

const E2E = /^packages\/site\/e2e\//;

/**
 * Where `path` runs, or why it cannot. `path` is repo-relative with forward slashes, as git and
 * every spec contract name it; a leading `./` is tolerated, anything that leaves the repository
 * is not.
 */
export function routeTestFile(path) {
  if (typeof path !== "string" || path.trim() === "") return { refused: "no test file was named" };
  if (path.includes("\\") || path.startsWith("/")) {
    return { refused: `${JSON.stringify(path)} is not a repo-relative path with forward slashes` };
  }
  const normal = posix.normalize(path);
  if (normal === "." || normal.split("/").includes("..")) {
    return { refused: `${JSON.stringify(path)} leaves the repository` };
  }
  if (E2E.test(normal)) {
    return {
      refused:
        `${normal} is a Playwright end-to-end spec: it needs a fresh site build and port 4321, ` +
        "which a running dev server silently takes over. Give its criterion an `oracle.run` that " +
        "builds the site and runs Playwright from packages/site with CI=1, or make it a " +
        "`kind: command` oracle.",
    };
  }
  const route = ROUTES.find((r) => r.pattern.test(normal));
  if (!route) {
    return {
      refused:
        `${normal} is not a file any workspace's test script runs: a top-level test/*.test.mjs ` +
        "of the root, plugins/marvin/mcp/server, packages/marvin-mcp-shared or packages/site, " +
        "or a packages/marvin-widgets/src/**/*.test.{ts,tsx}",
    };
  }
  const rel = route.dir === "." ? normal : normal.slice(route.dir.length + 1);
  return { path: normal, dir: route.dir, rel, runner: route.runner, shared: route.shared };
}

/** The ambient environment with the variables that would make a test non-hermetic removed. */
export function hermeticTestEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === "CLAUDE_PROJECT_DIR" || key === "NODE_TEST_CONTEXT") continue;
    if (key.startsWith("MARVIN_") && key !== "MARVIN_TEST_TIMEOUT_MS") continue;
    env[key] = value;
  }
  return env;
}

/** The absolute path of an installed package's bin script, resolved from a workspace. */
function binOf(root, workspace, pkg, bin) {
  const require = createRequire(join(root, workspace, "package.json"));
  const manifestPath = require.resolve(`${pkg}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rel = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[bin];
  if (!rel) throw new Error(`${pkg} declares no "${bin}" bin`);
  return join(dirname(manifestPath), rel);
}

const say = (stderr, text) => stderr.write(`test-one: ${text}\n`);

/**
 * Run the file `argv` names and return how the runner ended: `{ status }`, or `{ signal }` for a
 * runner a signal ended. Everything that keeps the file from running returns `NOT_RUN`.
 */
export function runTestFile(
  argv,
  { root = repoRoot, env = process.env, stderr = process.stderr } = {},
) {
  if (argv.length !== 1) {
    say(stderr, `expected exactly one repo-relative test file, got ${argv.length} arguments`);
    return { status: NOT_RUN };
  }
  const route = routeTestFile(argv[0]);
  if (route.refused) {
    say(stderr, route.refused);
    return { status: NOT_RUN };
  }
  let isFile;
  try {
    isFile = statSync(join(root, route.path)).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    say(stderr, `${route.path} does not exist`);
    return { status: NOT_RUN };
  }

  const runEnv = hermeticTestEnv(env);
  let runner;
  try {
    runner =
      route.runner === "vitest"
        ? [binOf(root, WIDGETS_DIR, "vitest", "vitest"), "run", route.rel]
        : ["--test", route.rel];
    if (route.shared) {
      const tsc = binOf(root, SHARED_DIR, "typescript", "tsc");
      const built = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
        cwd: join(root, SHARED_DIR),
        env: runEnv,
        stdio: ["ignore", "inherit", "inherit"],
      });
      // The test never started, so this is not a red: the seal stage must not accept it as one.
      if (built.error || built.status !== 0) {
        say(
          stderr,
          `the shared library (${SHARED_DIR}) does not build, so its importers cannot run`,
        );
        return { status: NOT_RUN };
      }
    }
  } catch (error) {
    say(
      stderr,
      `${error instanceof Error ? error.message : String(error)} — install dependencies first (npm ci)`,
    );
    return { status: NOT_RUN };
  }

  const ran = spawnSync(process.execPath, runner, {
    cwd: join(root, route.dir),
    env: runEnv,
    stdio: "inherit",
  });
  if (ran.error) {
    say(stderr, `the runner could not start: ${ran.error.message}`);
    return { status: NOT_RUN };
  }
  return ran.signal ? { signal: ran.signal } : { status: ran.status ?? 1 };
}

/**
 * Whether this file is the script node was asked to run, compared as real paths: the ESM loader
 * resolves symlinks in `import.meta.url`, while `process.argv[1]` keeps the spelling of the
 * command. Compared as strings, a run from a symlinked directory (macOS's `/tmp` and `/var` are
 * `/private/...`) would skip the body and exit 0, which an oracle reads as a pass.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
}

if (invokedDirectly()) {
  const outcome = runTestFile(process.argv.slice(2));
  if (outcome.signal) process.kill(process.pid, outcome.signal);
  else process.exitCode = outcome.status;
}
