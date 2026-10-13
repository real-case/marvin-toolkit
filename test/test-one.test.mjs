// scripts/test-one.mjs is this repository's `gates.test_one`: the command every `kind: test`
// oracle, every sealed test's red run and the pipeline verifier's probe resolve to. A wrong route
// is a wrong verdict, so the routes are pinned against the workspaces' own `test` scripts, and the
// exit contract (pass, fail, nothing ran, a signal) is driven through the CLI as the gates run it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_RUN, ROUTES, hermeticTestEnv, routeTestFile } from "../scripts/test-one.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repoRoot, "scripts", "test-one.mjs");
const readJson = (...parts) => JSON.parse(readFileSync(join(repoRoot, ...parts), "utf8"));

/** The dispatcher as a gate runs it: its own process, from the root it lives in. */
const cli = (script, root, args) =>
  spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });

test("each node workspace's file runs from that workspace, under node --test", () => {
  const cases = [
    ["test/hooks.test.mjs", ".", "test/hooks.test.mjs", false],
    [
      "plugins/marvin/mcp/server/test/spec.test.mjs",
      "plugins/marvin/mcp/server",
      "test/spec.test.mjs",
      true,
    ],
    [
      "packages/marvin-mcp-shared/test/contracts.test.mjs",
      "packages/marvin-mcp-shared",
      "test/contracts.test.mjs",
      true,
    ],
    ["packages/site/test/catalog.test.mjs", "packages/site", "test/catalog.test.mjs", false],
    ["./test/hooks.test.mjs", ".", "test/hooks.test.mjs", false],
  ];
  for (const [path, dir, rel, shared] of cases) {
    assert.deepEqual(
      routeTestFile(path),
      { path: path.replace(/^\.\//, ""), dir, rel, runner: "node", shared },
      path,
    );
  }
});

test("a widget test runs under vitest from the widgets workspace, at any depth under src/", () => {
  assert.deepEqual(routeTestFile("packages/marvin-widgets/src/lib/actions.test.ts"), {
    path: "packages/marvin-widgets/src/lib/actions.test.ts",
    dir: "packages/marvin-widgets",
    rel: "src/lib/actions.test.ts",
    runner: "vitest",
    shared: true,
  });
  assert.equal(
    routeTestFile("packages/marvin-widgets/src/widgets/dashboard/DashboardWidget.test.tsx").rel,
    "src/widgets/dashboard/DashboardWidget.test.tsx",
  );
});

test("a file no workspace's test script selects is refused, and says why", () => {
  const refused = {
    "packages/site/e2e/home.spec.ts": /Playwright.*oracle\.run/s,
    "test/fixtures/autopilot-sandbox/project/test/math.test.mjs": /not a file any workspace/,
    "plugins/marvin/mcp/server/test/_driver.mjs": /not a file any workspace/,
    "plugins/marvin/mcp/server/test/nested/a.test.mjs": /not a file any workspace/,
    "packages/marvin-widgets/stories/x.test.tsx": /not a file any workspace/,
    "src/a.ts": /not a file any workspace/,
    "../x.test.mjs": /leaves the repository/,
    "test/../../x.test.mjs": /leaves the repository/,
    "/abs/test/a.test.mjs": /not a repo-relative path/,
    "test\\a.test.mjs": /not a repo-relative path/,
    "": /no test file/,
  };
  for (const [path, why] of Object.entries(refused)) {
    assert.match(routeTestFile(path).refused ?? "", why, JSON.stringify(path));
  }
});

test("the routes select what each workspace's own test script selects", () => {
  // The four node workspaces glob their top-level test/*.test.mjs.
  assert.match(readJson("package.json").scripts.test, /node --test test\/\*\.test\.mjs$/);
  for (const ws of ["plugins/marvin/mcp/server", "packages/marvin-mcp-shared", "packages/site"]) {
    assert.match(
      readJson(ws, "package.json").scripts.test,
      /^node --test .*test\/\*\.test\.mjs$/,
      ws,
    );
  }
  // The widgets run vitest with the include glob vite.config.ts declares.
  assert.equal(readJson("packages", "marvin-widgets", "package.json").scripts.test, "vitest run");
  const vite = readFileSync(join(repoRoot, "packages", "marvin-widgets", "vite.config.ts"), "utf8");
  assert.match(vite, /include:\s*\["src\/\*\*\/\*\.test\.\{ts,tsx\}"\]/);
  // Every route's directory is a workspace, and the shared rebuild goes with its importers.
  const dirs = ROUTES.map((r) => r.dir).sort();
  assert.deepEqual(dirs, [
    ".",
    "packages/marvin-mcp-shared",
    "packages/marvin-widgets",
    "packages/site",
    "plugins/marvin/mcp/server",
  ]);
  assert.deepEqual(
    ROUTES.filter((r) => r.shared)
      .map((r) => r.dir)
      .sort(),
    ["packages/marvin-mcp-shared", "packages/marvin-widgets", "plugins/marvin/mcp/server"],
  );
});

test("a route whose tests import the shared library at run time rebuilds it first", () => {
  // The library's package exports point only at its git-ignored dist/. A route that skips the
  // rebuild runs its importers against whatever build is on disk, and in a re-seal's base tree
  // against none: the import fails, the runner reports one failed file, and the seal stage takes
  // that for the test's red. The server's tests reach the library through the modules they load
  // rather than an import of their own, so this direction is the one a file scan can hold.
  const manifest = readJson("packages", "marvin-mcp-shared", "package.json");
  assert.ok(
    Object.values(manifest.exports).every((target) => target.default.startsWith("./dist/")),
    "the shared library is consumed from its build output",
  );
  const valueImport = /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+["']@marvin-toolkit\/mcp-shared\b/m;
  // No inherited GIT_* variable, so an ambient GIT_DIR cannot choose the repository listed.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", env })
    .stdout.split("\0")
    .filter(Boolean);
  const importers = tracked.filter(
    (f) => !routeTestFile(f).refused && valueImport.test(readFileSync(join(repoRoot, f), "utf8")),
  );
  assert.ok(importers.length > 0, "some routed test imports the shared library");
  for (const file of importers) {
    assert.equal(routeTestFile(file).shared, true, `${file} imports the shared library`);
  }
});

test("the environment a test sees is the clean shell's", () => {
  const env = hermeticTestEnv({
    PATH: "/bin",
    MARVIN_TASKS_CONFIG: "/x/config.json",
    MARVIN_PIPELINE: "1",
    MARVIN_TEST_TIMEOUT_MS: "90000",
    CLAUDE_PROJECT_DIR: "/x",
    NODE_TEST_CONTEXT: "child-v8",
  });
  assert.deepEqual(env, { PATH: "/bin", MARVIN_TEST_TIMEOUT_MS: "90000" });
});

test("the CLI passes a pass and a failure through, re-raises a signal, and exits 127 when nothing ran", () => {
  const root = mkdtempSync(join(tmpdir(), "marvin-test-one-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "test"));
    const script = join(root, "scripts", "test-one.mjs");
    copyFileSync(SCRIPT, script);
    const write = (name, body) =>
      writeFileSync(join(root, "test", name), `import { test } from "node:test";\n${body}\n`);
    write("ok.test.mjs", 'test("ok", () => {});');
    write("bad.test.mjs", 'test("bad", () => { throw new Error("red"); });');
    write(
      "env.test.mjs",
      'import assert from "node:assert/strict";\ntest("env", () => assert.equal(process.env.MARVIN_TASKS_CONFIG, undefined));',
    );
    // SIGKILL on the runner itself: the one way to end `node --test` by a signal it cannot handle.
    write("kill.test.mjs", 'test("kill", () => { process.kill(process.ppid, "SIGKILL"); });');

    assert.equal(cli(script, root, ["test/ok.test.mjs"]).status, 0);
    assert.equal(cli(script, root, ["test/bad.test.mjs"]).status, 1);
    // Launched through a symlinked directory, the script must still run rather than exit 0
    // having done nothing, which an oracle would read as a pass.
    const link = `${root}-link`;
    symlinkSync(root, link);
    try {
      assert.equal(
        cli(join(link, "scripts", "test-one.mjs"), link, ["test/bad.test.mjs"]).status,
        1,
      );
    } finally {
      rmSync(link, { force: true });
    }
    const leaky = spawnSync(process.execPath, [script, "test/env.test.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, MARVIN_TASKS_CONFIG: "/elsewhere/config.json" },
    });
    assert.equal(leaky.status, 0, leaky.stdout + leaky.stderr);
    const killed = cli(script, root, ["test/kill.test.mjs"]);
    assert.equal(killed.signal, "SIGKILL");

    for (const args of [
      ["test/missing.test.mjs"],
      ["packages/site/e2e/a.spec.ts"],
      [],
      ["a", "b"],
    ]) {
      const r = cli(script, root, args);
      assert.equal(r.status, NOT_RUN, JSON.stringify(args));
      assert.match(r.stderr, /^test-one: /m);
    }
    // A shared-library test needs the TypeScript compiler, which this bare root lacks.
    mkdirSync(join(root, "packages", "marvin-mcp-shared", "test"), { recursive: true });
    writeFileSync(join(root, "packages", "marvin-mcp-shared", "package.json"), "{}\n");
    writeFileSync(join(root, "packages", "marvin-mcp-shared", "test", "a.test.mjs"), "");
    const noDeps = cli(script, root, ["packages/marvin-mcp-shared/test/a.test.mjs"]);
    assert.equal(noDeps.status, NOT_RUN);
    assert.match(noDeps.stderr, /npm ci/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("in this repository, a shared-library test rebuilds the library first, and vitest counts one file", () => {
  const shared = cli(SCRIPT, repoRoot, ["packages/marvin-mcp-shared/test/contracts.test.mjs"]);
  assert.equal(shared.status, 0, shared.stdout + shared.stderr);
  const widget = cli(SCRIPT, repoRoot, ["packages/marvin-widgets/src/lib/actions.test.ts"]);
  assert.equal(widget.status, 0, widget.stdout + widget.stderr);
  // The seal stage reads this count as its primary evidence that one file ran, after stripping
  // the escape sequences vitest colours it with where the environment asks for colour, as CI
  // does (FORCE_COLOR); the same pattern as `ANSI` in src/pipeline/seal.ts.
  const plain = widget.stdout.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b(?:\[[0-?]*[ -/]*[@-~]|[\]PX^_][^\u0007\u001b\n]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g,
    "",
  );
  assert.match(plain, /^\s*Test Files\s+1 passed \(1\)\s*$/m);
});
