// Task 20, scenario 1 of the autopilot plan: the deterministic sandbox. The committed
// `marvin-pipe` bundle drives one standard-tier run over the 3-file Node project in
// `test/fixtures/autopilot-sandbox/project/`, from `init` to `ready`, with no model, no network
// and no GitHub:
//
// - every child is a fake (`MARVIN_PIPELINE_FAKE_<ROLE>` names its result fixture), and the
//   planner, the test-author and the executor do their file work through
//   `MARVIN_PIPELINE_FAKE_<ROLE>_SCRIPT`, so the seal, the gate and finalize run for real;
// - CI is `MARVIN_PIPELINE_FAKE_CI=green`, which also leaves the PR alone at `mark_ready`;
// - the spec approval comes from `MARVIN_PIPELINE_JUDGE=fixtures`;
// - origin is a bare repository made in a temp dir, and `claude` and `gh` on PATH are stubs
//   that fail, so a fixture that went missing could never reach a real session or GitHub.
//
// The script: the verifier FAILs iteration 1 with one major finding, then PASSes iteration 2.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "test", "fixtures", "autopilot-sandbox");
const cli = join(root, "plugins", "marvin", "mcp", "server", "dist", "marvin-pipe.js");
const SEAL_SUBJECT = "test(clamp): sealed acceptance tests";
const ROLES = { planner: "PLANNER", "test-author": "TEST_AUTHOR", executor: "EXECUTOR" };

/** The environment every process of the run sees: hermetic, whatever the caller's shell holds. */
function sandboxEnv(home, stubBin) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // A test runner's context would turn the gates' own `node --test` into a sub-reporter, and
    // a marvin or pipeline variable from the caller's session must not steer this run.
    if (k === "NODE_TEST_CONTEXT" || k.startsWith("MARVIN_") || k.startsWith("GIT_")) continue;
    env[k] = v;
  }
  return {
    ...env,
    PATH: `${stubBin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    MARVIN_PIPELINE_HOME: join(home, "state"),
    MARVIN_PIPELINE_JUDGE: "fixtures",
    MARVIN_PIPELINE_FIXTURES: join(fixture, "judgments"),
    MARVIN_PIPELINE_FAKE_CI: "green",
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

/** The fixture project committed on `dev` of a bare origin, cloned as the main checkout. */
function sandboxRepo(home, env) {
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\temail = sandbox@example.com\n\tname = Sandbox\n");
  const origin = join(home, "origin.git");
  git(home, "init", "-q", "--bare", "-b", "dev", origin);
  const repo = join(home, "autopilot-sandbox");
  git(home, "clone", "-q", origin, repo);
  cpSync(join(fixture, "project"), repo, { recursive: true });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: sandbox project");
  git(repo, "push", "-q", "origin", "HEAD:dev");
  return { repo, origin, git };
}

const events = (runDir) =>
  readFileSync(join(runDir, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test("a standard sandbox run with one verifier rejection reaches ready", async (t) => {
  assert.ok(existsSync(cli), `no bundle at ${cli}: run npm run build`);
  const home = mkdtempSync(join(tmpdir(), "autopilot-sandbox-"));
  const stubBin = join(home, "bin");
  mkdirSync(stubBin);
  for (const name of ["claude", "gh"]) {
    writeFileSync(join(stubBin, name), `#!/bin/sh\necho '${name}: sandbox stub' >&2\nexit 97\n`, {
      mode: 0o755,
    });
  }
  const env = sandboxEnv(home, stubBin);
  const { repo, origin, git } = sandboxRepo(home, env);
  const base = git(repo, "rev-parse", "HEAD").trim();

  const task = join(home, "task.txt");
  writeFileSync(task, "Add clamp(x, lo, hi) to src/math.mjs.\n");
  const init = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "init", "--repo", repo, "--base", "dev", "--lang", "en", "--orch", "Sandbox"].concat([
        "--stage-a",
        "standard",
        "--task-file",
        task,
        "--task-en-file",
        task,
      ]),
      { env, encoding: "utf8" },
    ),
  );
  const { runDir } = init;

  // The engine in the foreground, as `start` would run it detached.
  const started = Date.now();
  let out;
  try {
    out = await promisify(execFile)(process.execPath, [cli, "engine", "--run", runDir], {
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
  } catch (error) {
    const log = existsSync(join(runDir, "events.jsonl"))
      ? events(runDir).map((e) => `${e.kind}: ${e.text}`)
      : [];
    assert.fail(`the engine failed: ${error.stderr ?? error.message}\n${log.join("\n")}`);
  }
  t.diagnostic(`engine ran ${Date.now() - started} ms`);
  const done = JSON.parse(out.stdout);
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const log = events(runDir);
  const trail = log.map((e) => `${e.kind}: ${e.text}`).join("\n");

  // It reaches ready.
  assert.equal(done.stage, "ready", trail);
  assert.equal(run.stage, "ready", trail);
  assert.equal(run.haltReason, null);
  assert.equal(run.tier, "standard");

  // Exactly two executors and two verifiers, each under a name of its own, and every child a fake.
  const named = (role) => run.children.filter((c) => c.role === role).map((c) => c.name);
  const executors = named("executor");
  const verifiers = named("verifier");
  assert.equal(executors.length, 2, trail);
  assert.equal(verifiers.length, 2, trail);
  const names = run.children.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `child names repeat: ${names.join(", ")}`);
  assert.deepEqual(
    run.children.map((c) => c.role),
    ["planner", "test-author", "executor", "verifier", "executor", "verifier", "retro"],
  );
  for (const name of names) {
    const command = JSON.parse(readFileSync(join(runDir, `${name}.command.json`), "utf8"));
    assert.ok(command.fake, `${name} was not a fake`);
  }

  // The verifier's rejection moved the second executor to rung 1: effort+1 on the same model.
  assert.equal(run.rung, 1);
  assert.deepEqual(
    run.rejections.map((r) => [r.iteration, r.source]),
    [[1, "verifier"]],
  );
  const [first, second] = run.children.filter((c) => c.role === "executor");
  assert.deepEqual(first.assignment, { model: "sonnet", effort: "high" });
  assert.deepEqual(second.assignment, { model: "sonnet", effort: "xhigh" });
  assert.ok(
    log.some((e) => e.text.includes(`executor ${second.iteration} started on rung 1`)),
    trail,
  );

  // The sealed-test commit comes first on the branch, before the first executor's commit.
  const branch = run.branch;
  const subjects = git(run.worktree, "log", "--reverse", "--format=%s", `${base}..HEAD`)
    .trim()
    .split("\n");
  assert.equal(subjects[0], SEAL_SUBJECT, subjects.join("\n"));
  assert.deepEqual(subjects.slice(1, 3), [
    "feat(clamp): add clamp",
    "fix(clamp): reject an inverted range",
  ]);
  const seal = git(run.worktree, "log", "--format=%H", "--grep", SEAL_SUBJECT, "-F", "HEAD")
    .trim()
    .split("\n");
  assert.equal(seal.length, 1);
  assert.deepEqual(
    git(run.worktree, "diff-tree", "-r", "--no-commit-id", "--name-only", seal[0]).trim(),
    "test/clamp.test.mjs",
  );
  // The seal commit sits directly on the base and is the parent of the first executor's commit,
  // and the engine committed it before it launched that executor.
  const feat = git(
    run.worktree,
    "log",
    "--format=%H",
    "--grep",
    "feat(clamp)",
    "-F",
    "HEAD",
  ).trim();
  assert.equal(git(run.worktree, "rev-parse", `${seal[0]}^`).trim(), base);
  assert.equal(git(run.worktree, "rev-parse", `${feat}^`).trim(), seal[0]);
  const sealMarkers = readdirSync(runDir).filter((f) => /^seal-.*\.json$/.test(f));
  assert.equal(sealMarkers.length, 1);
  const marker = JSON.parse(readFileSync(join(runDir, sealMarkers[0]), "utf8"));
  assert.deepEqual([marker.phase, marker.commit], ["committed", seal[0]]);
  const at = (text) => log.findIndex((e) => e.text.startsWith(text));
  assert.ok(at("test_authoring → executing") < at(`${first.name} started`), trail);
  assert.deepEqual(
    run.sealed.map((s) => s.path),
    ["test/clamp.test.mjs"],
  );
  // Both gates ran the sealed test as AC1's oracle and found its hash intact.
  assert.deepEqual(
    run.gateReport.gates.map((g) => [g.name, g.result]),
    [
      ["oracle:AC1", "pass"],
      ["test", "pass"],
    ],
  );
  assert.deepEqual(run.gateReport.sealed, [{ path: "test/clamp.test.mjs", ok: true }]);

  // Neither verifier changed the tree: the snapshot before each equals the tree after it.
  for (const name of verifiers) {
    const result = JSON.parse(readFileSync(join(runDir, `${name}.result.json`), "utf8"));
    assert.equal(result.mutated, undefined, `${name} mutated the tree: ${result.mutated}`);
    assert.equal(result.leaked, undefined, `${name} wrote outside its worktree`);
  }
  const lastSnapshot = JSON.parse(readFileSync(join(runDir, "snapshot.txt"), "utf8"));
  assert.equal(
    lastSnapshot.head,
    git(run.worktree, "log", "-1", "--format=%H", "--grep", "fix(clamp)", "-F", "HEAD").trim(),
  );

  // Finalize shipped the spec on the run branch and pushed it to the sandbox origin.
  const pushed = git(origin, "rev-parse", `refs/heads/${branch}`).trim();
  assert.equal(pushed, git(run.worktree, "rev-parse", "HEAD").trim());
  assert.match(readFileSync(join(run.worktree, ".marvin/task/001-clamp.md"), "utf8"), /shipped/);
  assert.equal(git(repo, "status", "--porcelain").trim(), "", "the main checkout changed");
});
