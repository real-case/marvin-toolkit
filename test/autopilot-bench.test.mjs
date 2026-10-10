// Task 21 of the autopilot plan: `marvin-pipe bench` end to end over the committed bundle, with no
// model, no network and no GitHub. The suite is the shipped synthetic one
// (evals/autopilot/suites/sandbox.yaml), narrowed to its `clamp` task, whose replay repository the
// bench generates in a temp dir. The children are the deterministic sandbox's fakes
// (test/fixtures/autopilot-sandbox: a standard-tier clamp run, one verifier rejection), the judge
// is `auto`, and `claude` and `gh` on PATH are stubs that fail.
//
// Two bench invocations: a baseline, then a variant on a copied roles directory compared against
// it, so the roles seam, the result files and the L3 comparison are all exercised.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "test", "fixtures", "autopilot-sandbox");
const suite = join(root, "evals", "autopilot", "suites", "sandbox.yaml");
const cli = join(root, "plugins", "marvin", "mcp", "server", "dist", "marvin-pipe.js");
const ROLES = { planner: "PLANNER", "test-author": "TEST_AUTHOR", executor: "EXECUTOR" };

function hermeticEnv(home, stubBin) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "NODE_TEST_CONTEXT" || k.startsWith("MARVIN_") || k.startsWith("GIT_")) continue;
    env[k] = v;
  }
  return {
    ...env,
    PATH: `${stubBin}:${process.env.PATH}`,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "xdg"),
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    MARVIN_PIPELINE_FAKE_PLANNER: join(fixture, "roles", "planner.json"),
    MARVIN_PIPELINE_FAKE_TEST_AUTHOR: join(fixture, "roles", "test-author.json"),
    MARVIN_PIPELINE_FAKE_EXECUTOR: join(fixture, "roles", "executor.json"),
    MARVIN_PIPELINE_FAKE_VERIFIER: join(fixture, "roles", "verifier.json"),
    MARVIN_PIPELINE_FAKE_RETRO: join(fixture, "roles", "retro.json"),
    ...Object.fromEntries(
      Object.entries(ROLES).map(([role, v]) => [
        `MARVIN_PIPELINE_FAKE_${v}_SCRIPT`,
        join(fixture, "scripts", `${role}.mjs`),
      ]),
    ),
  };
}

test("bench replays a suite task, judges it by its hidden tests and compares two variants", async (t) => {
  assert.ok(existsSync(cli), `no bundle at ${cli}: run npm run build`);
  const home = mkdtempSync(join(tmpdir(), "autopilot-bench-"));
  const stubBin = join(home, "bin");
  mkdirSync(stubBin);
  for (const name of ["claude", "gh"]) {
    writeFileSync(join(stubBin, name), `#!/bin/sh\necho '${name}: bench stub' >&2\nexit 97\n`, {
      mode: 0o755,
    });
  }
  const env = hermeticEnv(home, stubBin);
  // The children's commits use this identity; a git that lost GIT_CONFIG_GLOBAL refuses to guess.
  writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\temail = bench@example.com\n\tname = Bench\n");
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  const out = join(home, "results");

  const bench = async (...args) => {
    const started = Date.now();
    try {
      const r = await promisify(execFile)(
        process.execPath,
        [cli, "bench", "--suite", suite, "--tasks", "clamp", "--judge", "auto", "--repeat", "1"]
          .concat(["--out", out])
          .concat(args),
        { env, encoding: "utf8", timeout: 180_000 },
      );
      t.diagnostic(`bench ${args.join(" ")} ran ${Date.now() - started} ms`);
      return JSON.parse(r.stdout);
    } catch (error) {
      assert.fail(`bench failed: ${error.stderr ?? error.message}`);
    }
  };

  // ---------------------------------------------------------------------------- the baseline
  const work1 = join(home, "work1");
  const first = await bench("--variant", "baseline", "--work-dir", work1);
  assert.equal(first.verdict, null);
  assert.deepEqual(
    [first.summary.runs, first.summary.readyRuns, first.summary.hiddenPassed],
    [1, 1, 1],
  );
  const result = JSON.parse(readFileSync(first.json, "utf8"));
  assert.equal(result.suite, "sandbox");
  assert.equal(result.costIsNotional, true);
  assert.equal(result.settings.judge, "auto");
  const [run] = result.tasks[0].runs;
  assert.equal(run.outcome, "ready");
  // The fake planner writes a risk-medium spec, so the run is standard where the suite expects
  // light: the mismatch is recorded, not hidden.
  assert.equal(run.tierAssigned, "standard");
  assert.equal(run.tierExpected, "light");
  assert.equal(run.tierMatch, false);
  assert.deepEqual(
    run.hidden.files.map((f) => [f.path, f.passed]),
    [["test/clamp.test.mjs", true]],
  );
  assert.equal(run.iterations, 2);
  assert.deepEqual(run.rejections, { total: 1, gate: 0, verifier: 1, ci: 0 });
  assert.equal(run.gatesGreen, true);
  assert.equal(run.perRole.executor.children, 2);
  assert.match(
    readFileSync(first.md, "utf8"),
    /\| clamp \| 1 \| ready \| standard \/ light ✗ \| 1\/1 \|/,
  );
  assert.match(readFileSync(first.md, "utf8"), /\*\*notional\*\* API-price figure/);

  // The run's origin got the base history and the delivered branch, and never the reference.
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const replay = join(work1, "replay");
  const reference = git(replay, "rev-parse", "bench/clamp/reference");
  const origin = join(work1, "runs", "clamp-1", "origin.git");
  assert.throws(() => git(origin, "cat-file", "-e", reference));
  assert.equal(git(origin, "tag"), "");
  assert.match(git(origin, "branch", "--list"), /feature\/BENCH--clamp/);

  // ---------------------------------------------------------- a roles variant, against it
  const roles = join(home, "roles");
  cpSync(join(root, "plugins", "marvin", "pipeline", "roles"), roles, { recursive: true });
  writeFileSync(
    join(roles, "planner.md"),
    `${readFileSync(join(roles, "planner.md"), "utf8")}\nBENCH-VARIANT-MARKER\n`,
  );
  const work2 = join(home, "work2");
  const second = await bench(
    "--variant",
    "roles-variant",
    "--roles-dir",
    roles,
    "--baseline",
    first.json,
    "--work-dir",
    work2,
  );
  const planner = execFileSync("find", [join(work2, "state"), "-name", "planner.system.md"], {
    encoding: "utf8",
  }).trim();
  assert.match(readFileSync(planner, "utf8"), /BENCH-VARIANT-MARKER/);
  // One repeat on each side: the gate refuses to decide rather than accept on thin evidence.
  assert.equal(second.verdict.decision, "inconclusive");
  assert.match(second.verdict.reasons.join("; "), /needs 2/);
  const md = readFileSync(second.md, "utf8");
  assert.match(md, /## L3 comparison: roles-variant against baseline/);
  assert.match(md, /\*\*Decision: inconclusive\.\*\*/);

  // bench-compare reaches the same verdict from the two files.
  const compared = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "bench-compare", "--baseline", first.json, "--candidate", second.json],
      { env, encoding: "utf8" },
    ),
  );
  assert.equal(compared.verdict.decision, "inconclusive");
  assert.match(compared.markdown, /Hidden pass rate \| 100\.0% \| 100\.0%/);
});
