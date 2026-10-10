import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

// The CLI runs as the bundle, the way an orchestrator invokes it, so `npm run build` comes first.
const cli = fileURLToPath(new URL("../dist/marvin-pipe.js", import.meta.url));
const rs = await importTs("src/pipeline/run-store.ts");
const { lockHolderPid } = await importTs("src/pipeline/loop.ts");

const envFor = (home) => ({ ...process.env, MARVIN_PIPELINE_HOME: home });
const pipe = (home, ...args) =>
  execFileSync(process.execPath, [cli, ...args], { env: envFor(home), encoding: "utf8" });
const pipeFails = (home, ...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { env: envFor(home), encoding: "utf8" });
  assert.notEqual(r.status, 0, `expected marvin-pipe ${args[0]} to fail; stdout: ${r.stdout}`);
  return r.stderr;
};

function initIn(home, repo, extra = {}) {
  const ru = join(home, "task.txt");
  const en = join(home, "task.en.txt");
  writeFileSync(ru, extra.task ?? "Добавить фильтр по тегам");
  writeFileSync(en, extra.taskEn ?? "Add a tag filter");
  return JSON.parse(
    pipe(
      home,
      "init",
      "--repo",
      repo,
      "--base",
      "dev",
      "--lang",
      extra.lang ?? "ru",
      "--orch",
      "Autopilot",
      "--stage-a",
      extra.stageA ?? "standard",
      "--task-file",
      ru,
      "--task-en-file",
      en,
    ),
  );
}

test("init creates a run outside the repo; status and list read it back", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const { runId, runDir } = initIn(home, "/x/osint-chat-client");
  assert.ok(runDir.startsWith(home));
  const status = JSON.parse(pipe(home, "status", "--run", runDir));
  assert.deepEqual(
    [status.id, status.stage, status.lang, status.task.english, status.engineAlive],
    [runId, "intake", "ru", "Add a tag filter", false],
  );
  assert.match(pipe(home, "list", "--repo", "/x/osint-chat-client"), new RegExp(runId));
  assert.deepEqual(JSON.parse(pipe(home, "list", "--repo", "/x/other")), []);
  assert.equal(JSON.parse(pipe(home, "list")).length, 1);
});

test("init refuses a stage-a outside the tiers and an orchestrator name with spaces", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const t = join(home, "t.txt");
  writeFileSync(t, "x");
  const base = ["init", "--repo", "/x/r", "--base", "dev", "--lang", "en"];
  const files = ["--task-file", t, "--task-en-file", t];
  assert.match(
    pipeFails(home, ...base, "--orch", "A", "--stage-a", "huge", ...files),
    /--stage-a must be one of light, standard, heavy/,
  );
  assert.match(
    pipeFails(home, ...base, "--orch", "two words", "--stage-a", "light", ...files),
    /invalid orchestrator name/,
  );
});

test("an unknown command or flag fails with a usage line, never a stack trace", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  assert.match(pipeFails(home, "frobnicate"), /^usage: marvin-pipe </);
  assert.match(pipeFails(home, "status", "--runn", "/x"), /^marvin-pipe status: /);
  assert.match(pipeFails(home, "status", "--run", join(home, "nope")), /no run at /);
});

test("attach names a new orchestrator beside run.json, which it leaves alone", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const { runDir } = initIn(home, "/x/r");
  const before = readFileSync(join(runDir, "run.json"), "utf8");
  pipe(home, "attach", "--run", runDir, "--orch", "Autopilot-2");
  assert.equal(readFileSync(join(runDir, "run.json"), "utf8"), before);
  assert.equal(readFileSync(join(runDir, "orchestrator.txt"), "utf8"), "Autopilot-2\n");
  assert.equal(JSON.parse(pipe(home, "status", "--run", runDir)).orchestrator, "Autopilot-2");
  assert.match(pipeFails(home, "attach", "--run", runDir, "--orch", "a;b"), /invalid orchestrator/);
});

test("judge validates the answer against the judgment kind and the run's state", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const { runDir } = initIn(home, "/x/r", { lang: "en", stageA: "light" });
  const id = "001-spec_approval";
  mkdirSync(join(runDir, "judgments"));
  writeFileSync(
    join(runDir, "judgments", `${id}.request.json`),
    JSON.stringify({ id, kind: "spec_approval", payload: {} }),
  );
  const wrong = join(home, "wrong.json");
  const right = join(home, "right.json");
  writeFileSync(wrong, JSON.stringify({ kind: "answers", text: "x", count: 1 }));
  writeFileSync(right, JSON.stringify({ kind: "approve" }));

  // A well-formed approval is still refused while the run is not where the judgment was raised.
  assert.match(
    pipeFails(home, "judge", "--run", runDir, "--id", id, "--answer-file", right),
    /refused/,
  );

  // The state that raised the judgment: a planned spec awaiting approval.
  const run = rs.loadRun(runDir);
  rs.saveRun(runDir, {
    ...run,
    stage: "awaiting_approval",
    worktree: "/x/wt",
    branch: "autopilot/r",
    specPath: "/x/wt/.marvin/task/001-x.md",
    tier: "light",
    pendingJudgment: { id, kind: "spec_approval" },
  });
  assert.match(
    pipeFails(home, "judge", "--run", runDir, "--id", id, "--answer-file", wrong),
    /invalid answer to 001-spec_approval/,
  );
  assert.equal(existsSync(join(runDir, "judgments", `${id}.answer.json`)), false);
  pipe(home, "judge", "--run", runDir, "--id", id, "--answer-file", right);
  assert.ok(existsSync(join(runDir, "judgments", `${id}.answer.json`)));
  assert.match(
    pipeFails(home, "judge", "--run", runDir, "--id", id, "--answer-file", right),
    /already answered/,
  );
});

test("judge --answered-by records who settled the judgment, and only once it is written", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const { runDir } = initIn(home, "/x/r", { lang: "en", stageA: "light" });
  const id = "001-planner_questions";
  mkdirSync(join(runDir, "judgments"));
  const questions = [{ id: "Q1", text: "?", recommendation: "a", why_blocking: "b" }];
  writeFileSync(
    join(runDir, "judgments", `${id}.request.json`),
    JSON.stringify({ id, kind: "planner_questions", payload: { questions } }),
  );
  const run = rs.loadRun(runDir);
  rs.saveRun(runDir, {
    ...run,
    stage: "awaiting_answer",
    worktree: "/x/wt",
    branch: "autopilot/r",
    awaitingRole: "planner",
    pendingJudgment: { id, kind: "planner_questions" },
  });
  const answer = join(home, "a.json");
  writeFileSync(answer, JSON.stringify({ kind: "answers", text: "Q1: a", count: 1 }));
  const answered = () =>
    rs.readEvents(runDir).filter((e) => e.kind === "answer" && e.data?.answeredBy);

  assert.match(
    pipeFails(
      home,
      "judge",
      "--run",
      runDir,
      "--id",
      id,
      "--answer-file",
      answer,
      "--answered-by",
      "bot",
    ),
    /--answered-by must be one of orchestrator, user/,
  );
  assert.equal(existsSync(join(runDir, "judgments", `${id}.answer.json`)), false);
  assert.equal(answered().length, 0);

  pipe(
    home,
    "judge",
    "--run",
    runDir,
    "--id",
    id,
    "--answer-file",
    answer,
    "--answered-by",
    "user",
  );
  const events = answered();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { id, answeredBy: "user" });
  assert.notEqual(events[0].data.notify, true);

  pipeFails(
    home,
    "judge",
    "--run",
    runDir,
    "--id",
    id,
    "--answer-file",
    answer,
    "--answered-by",
    "user",
  );
  assert.equal(answered().length, 1);
});

test("await reports a pending judgment, and a deadline with nothing to say is a rearm", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const { runDir } = initIn(home, "/x/r");
  const quiet = pipe(home, "await", "--run", runDir, "--deadline-min", "0.001");
  assert.ok(quiet.trim().length > 0);
  mkdirSync(join(runDir, "judgments"));
  writeFileSync(
    join(runDir, "judgments", "001-halt.request.json"),
    JSON.stringify({ id: "001-halt", kind: "halt", payload: {} }),
  );
  assert.match(
    pipe(home, "await", "--run", runDir, "--deadline-min", "0.05"),
    /JUDGMENT 001-halt halt/,
  );
});

test("start detaches an engine whose output goes to engine.log, and it releases the run", async () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  // A repository that does not exist: the engine takes the lock, fails to prepare, and exits.
  const { runDir } = initIn(home, join(home, "no-such-repo"));
  const { pid } = JSON.parse(pipe(home, "start", "--run", runDir));
  assert.ok(pid > 0);
  // start returns only once its engine took the run, so an await armed next never reads it as down.
  assert.equal(lockHolderPid(runDir), pid);
  const log = join(runDir, "engine.log");
  const deadline = Date.now() + 30_000;
  while (
    Date.now() < deadline &&
    !/marvin-pipe engine: /.test(existsSync(log) ? readFileSync(log, "utf8") : "")
  ) {
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.match(readFileSync(log, "utf8"), /marvin-pipe engine: /);
  assert.equal(JSON.parse(pipe(home, "status", "--run", runDir)).engineAlive, false);
});

test("start fails, with the engine's own reason, when the engine exits before it takes the run", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const { runDir } = initIn(home, join(home, "no-such-repo"));
  // A model override outside the sandbox stops the engine before it touches the lock.
  const r = spawnSync(process.execPath, [cli, "start", "--run", runDir], {
    env: { ...envFor(home), MARVIN_PIPELINE_MODEL_OVERRIDE: "haiku", MARVIN_PIPELINE_SANDBOX: "" },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /exited before it took the run: .*honoured only with MARVIN_PIPELINE_SANDBOX=1/,
  );
  assert.equal(lockHolderPid(runDir), null);
});

test("assess prints a spec's tier, its reasons and every role's assignment", () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  const repo = mkdtempSync(join(tmpdir(), "pipe-repo-"));
  const spec = join(repo, "spec.md");
  writeFileSync(
    spec,
    "---\nslug: x\ntype: feature\nrisk: high\n---\n# X\n\n```yaml spec-contract\nfiles:\n  - path: src/a.ts\n    action: modify\ncriteria:\n  - id: AC1\n```\n",
  );
  const out = JSON.parse(pipe(home, "assess", "--spec", spec, "--repo", repo));
  assert.equal(out.tier, "heavy");
  assert.match(out.reasons.join(" "), /risk high/);
  assert.deepEqual(Object.keys(out.assignments).sort(), [...rs.ROLES].sort());
});
