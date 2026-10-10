#!/usr/bin/env node
// Task 20 scenario 2 of the autopilot plan: the live sandbox. The same 3-file Node project the
// deterministic sandbox uses (test/fixtures/autopilot-sandbox/project), driven through
// `marvin-pipe init/start/await` with REAL `claude -p` children, every one on the override model
// (Haiku by default). It costs money and needs a logged-in `claude`, so it is not part of
// `npm test`, and it refuses to start without MARVIN_LIVE=1.
//
// Nothing external is created. Origin is a bare repository in a temp dir; the executor's PR step
// goes to the sandbox `gh` shim the runtime puts first on every child's PATH
// (MARVIN_PIPELINE_SANDBOX=1, src/pipeline/sandbox.ts); CI is MARVIN_PIPELINE_FAKE_CI=green; and
// the `gh` on this script's own PATH is a stub that fails, so nothing in the engine reaches GitHub.
//
// This script plays the orchestrator the way /marvin:autopilot would, minus what only an
// interactive session can do (the user's own approval, push notifications, lines in the
// invocation language): it approves the spec, answers child questions with their own
// recommendations under `--answered-by orchestrator`, and cancels a halted run so that the retro
// still runs. At the end it prints a JSON summary and the headless checks.
//
//   MARVIN_LIVE=1 node scripts/autopilot-live-sandbox.mjs [--model haiku] [--max-usd 5]
//     [--max-min 60] [--stage-a standard] [--clean]
//
// The temp dir (run dir, child logs, origin) is kept for inspection unless --clean is passed.

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "test", "fixtures", "autopilot-sandbox", "project");
const cli = join(root, "plugins", "marvin", "mcp", "server", "dist", "marvin-pipe.js");

const { values: opts } = parseArgs({
  options: {
    model: { type: "string", default: "haiku" },
    "max-usd": { type: "string", default: "5" },
    "max-min": { type: "string", default: "60" },
    "stage-a": { type: "string", default: "standard" },
    clean: { type: "boolean", default: false },
  },
});
const maxUsd = Number(opts["max-usd"]);
const maxMs = Number(opts["max-min"]) * 60_000;

if (process.env.MARVIN_LIVE !== "1") {
  console.error(
    "autopilot-live-sandbox: launches real claude sessions and costs money; set MARVIN_LIVE=1",
  );
  process.exit(2);
}
if (/fable/i.test(opts.model)) {
  console.error("autopilot-live-sandbox: Fable is not allowed");
  process.exit(2);
}
if (!existsSync(cli)) {
  console.error(`autopilot-live-sandbox: no bundle at ${cli}; run npm run build`);
  process.exit(2);
}

const home = mkdtempSync(join(tmpdir(), "autopilot-live-"));
const stubBin = join(home, "bin");
mkdirSync(stubBin);
// The engine's own `gh` fails; a child finds the sandbox shim before it.
writeFileSync(join(stubBin, "gh"), "#!/bin/sh\necho 'gh: live-sandbox stub' >&2\nexit 97\n", {
  mode: 0o755,
});

const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (k === "NODE_TEST_CONTEXT" || k.startsWith("MARVIN_") || k.startsWith("GIT_")) continue;
  env[k] = v;
}
Object.assign(env, {
  PATH: `${stubBin}:${process.env.PATH}`,
  GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  MARVIN_PIPELINE_HOME: join(home, "state"),
  MARVIN_PIPELINE_SANDBOX: "1",
  MARVIN_PIPELINE_MODEL_OVERRIDE: opts.model,
  MARVIN_PIPELINE_FAKE_CI: "green",
});

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const pipe = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`marvin-pipe ${args[0]}: ${r.stderr.trim()}`);
  return r.stdout;
};
const log = (line) =>
  process.stderr.write(`[live ${new Date().toISOString().slice(11, 19)}] ${line}\n`);

// ---------------------------------------------------------------------------------- the sandbox

writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\temail = sandbox@example.com\n\tname = Sandbox\n");
const origin = join(home, "origin.git");
git(home, "init", "-q", "--bare", "-b", "dev", origin);
const repo = join(home, "autopilot-sandbox");
git(home, "clone", "-q", origin, repo);
git(repo, "checkout", "-q", "-b", "dev");
cpSync(fixture, repo, { recursive: true });
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "chore: sandbox project");
git(repo, "push", "-q", "origin", "HEAD:dev");

// The task in the invocation language (Russian) and in English, as the skill hands both to init.
const task = join(home, "task.txt");
const taskEn = join(home, "task-en.txt");
writeFileSync(
  task,
  "Добавь функцию clamp(x, lo, hi) в src/math.mjs: она возвращает x, ограниченное диапазоном [lo, hi], и бросает RangeError, если lo > hi. Покрой её тестами.\n",
);
writeFileSync(
  taskEn,
  "Add a function clamp(x, lo, hi) to src/math.mjs: it returns x limited to the range [lo, hi], and throws a RangeError when lo > hi. Cover it with tests.\n",
);

const init = JSON.parse(
  pipe(
    "init",
    "--repo",
    repo,
    "--base",
    "dev",
    "--lang",
    "ru",
    "--orch",
    "Sandbox",
    "--stage-a",
    opts["stage-a"],
    "--task-file",
    task,
    "--task-en-file",
    taskEn,
  ),
);
const { runDir } = init;
log(`run ${init.runId} at ${runDir}`);
const started = Date.now();
const { pid: enginePid } = JSON.parse(pipe("start", "--run", runDir));
log(`engine pid ${enginePid}`);

// --------------------------------------------------------------------------- the orchestrator

const readRun = () => JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
const spent = (run) => run.children.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
const answered = new Set();
const answers = [];
let aborted = null;
let finalStage = null;
let restarts = 0;

function answer(id, kind, payload, by) {
  const file = join(home, `answer-${id}.json`);
  writeFileSync(file, JSON.stringify(payload));
  const args = ["judge", "--run", runDir, "--id", id, "--answer-file", file];
  if (by) args.push("--answered-by", by);
  pipe(...args);
  answered.add(id);
  answers.push({ id, kind, answer: payload.kind, ...(by ? { answeredBy: by } : {}) });
  log(`answered ${id} ${kind}: ${payload.kind}${by ? ` (by ${by})` : ""}`);
}

function handleJudgment(id, kind, requestPath) {
  if (answered.has(id)) return;
  const { payload } = JSON.parse(readFileSync(requestPath, "utf8"));
  switch (kind) {
    case "spec_approval":
      // The skill passes no --answered-by on an approval: it is always the user's. Here this
      // script stands in for the user.
      log(`spec ${payload.spec?.path} tier=${payload.tier} criteria=${payload.spec?.criteria}`);
      return answer(id, kind, { kind: "approve" });
    case "planner_questions":
    case "executor_questions": {
      const qs = payload.questions ?? [];
      if (qs.length === 0) {
        const text = "The sealed test stands: it asserts what the spec says. Make it pass.";
        return answer(id, kind, { kind: "answers", text, count: 0 }, "orchestrator");
      }
      const text = qs.map((q) => `${q.id}: ${q.recommendation} (your recommendation, accepted)`);
      return answer(
        id,
        kind,
        { kind: "answers", text: text.join("\n"), count: qs.length },
        "orchestrator",
      );
    }
    case "unverified":
      return answer(
        id,
        kind,
        answers.some((a) => a.kind === kind)
          ? { kind: "cancel", reason: "unverified twice in the live sandbox" }
          : { kind: "retry" },
      );
    case "no_ci":
      return answer(id, kind, { kind: "proceed", reason: "the sandbox has no CI" });
    case "halt":
      log(`halt: ${payload.reason}${payload.detail ? ` — ${payload.detail}` : ""}`);
      aborted ??= `halted: ${payload.reason}`;
      return answer(id, kind, { kind: "cancel", reason: `live sandbox: ${payload.reason}` });
    default:
      log(`unknown judgment kind ${kind}; cancelling`);
      return answer(id, kind, { kind: "cancel", reason: `unhandled judgment ${kind}` });
  }
}

function killAll(reason) {
  log(`aborting: ${reason}`);
  aborted = reason;
  try {
    process.kill(enginePid, "SIGTERM");
  } catch {
    /* already gone */
  }
  for (const c of readRun().children) {
    if (c.status === "running" && c.pid) {
      try {
        process.kill(-c.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}

loop: for (;;) {
  const r = spawnSync(process.execPath, [cli, "await", "--run", runDir, "--deadline-min", "3"], {
    env,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`await: ${r.stderr}`);
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    const [head, ...rest] = line.split(" ");
    if (head === "EVENT") log(line);
    if (head === "JUDGMENT") handleJudgment(rest[0], rest[1], rest.slice(2).join(" "));
    if (head === "STAGE" && (rest[0] === "ready" || rest[0] === "done")) {
      finalStage = rest[0];
      break loop;
    }
    if (head === "ENGINE" && rest[0] === "down") {
      if (++restarts > 3) {
        aborted = "the engine kept failing";
        break loop;
      }
      log("engine down; restarting");
      try {
        pipe("start", "--run", runDir);
      } catch (error) {
        log(String(error.message));
      }
    }
  }
  const run = readRun();
  if (spent(run) > maxUsd) {
    killAll(`cost ${spent(run).toFixed(2)} USD over the ${maxUsd} USD cap`);
    break;
  }
  if (Date.now() - started > maxMs) {
    killAll(`wall time over ${opts["max-min"]} min`);
    break;
  }
}

// ------------------------------------------------------------------------------------ the report

const wallMs = Date.now() - started;
const run = readRun();
const events = readFileSync(join(runDir, "events.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

/** The stream-json events of a child's log, skipping lines that do not parse. */
function childLog(name) {
  const file = join(runDir, `${name}.log.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

const CYRILLIC = /[Ѐ-ӿ]/;
const perChild = run.children.map((c) => {
  const evs = childLog(c.name);
  const assistant = evs.filter((e) => e.type === "assistant");
  const firstUsage = assistant[0]?.message?.usage ?? null;
  const texts = assistant.flatMap((e) =>
    (e.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text),
  );
  const command = JSON.parse(readFileSync(join(runDir, `${c.name}.command.json`), "utf8"));
  const models = [...new Set(assistant.map((e) => e.message?.model).filter(Boolean))];
  return {
    name: c.name,
    role: c.role,
    iteration: c.iteration,
    status: c.status,
    model: command.argv[command.argv.indexOf("--model") + 1],
    modelsSeen: models,
    costUsd: c.costUsd,
    cacheReadTokens: c.cacheReadTokens,
    firstRequestCacheRead: firstUsage?.cache_read_input_tokens ?? null,
    durationMin: c.endedAt ? (Date.parse(c.endedAt) - Date.parse(c.startedAt)) / 60_000 : null,
    nonEnglishLines: texts.filter((t) => CYRILLIC.test(t)).length,
  };
});

const perRole = {};
for (const c of perChild) perRole[c.role] = (perRole[c.role] ?? 0) + (c.costUsd ?? 0);

// A report from the executor at least every 6 min of its wall time: the gaps between its start,
// each of its `report` events and its end.
const reportGaps = run.children
  .filter((c) => c.role === "executor")
  .map((c) => {
    const start = Date.parse(c.startedAt);
    const end = c.endedAt ? Date.parse(c.endedAt) : Date.now();
    const marks = events
      .filter((e) => e.kind === "report" && e.actor === c.name)
      .map((e) => Date.parse(e.ts));
    const points = [start, ...marks, end].sort((a, b) => a - b);
    let worst = 0;
    for (let i = 1; i < points.length; i++) worst = Math.max(worst, points[i] - points[i - 1]);
    return {
      name: c.name,
      wallMin: (end - start) / 60_000,
      reports: marks.length,
      maxGapMin: worst / 60_000,
    };
  });

const executors = perChild.filter((c) => c.role === "executor");
const second = executors[1] ?? null;
const checks = {
  reachedReady: run.stage === "ready",
  progressEvery6Min: reportGaps.every((g) => g.maxGapMin <= 6),
  childLogsEnglish: perChild.every((c) => c.nonEnglishLines === 0),
  noFableModel: perChild.every(
    (c) => !/fable/i.test(c.model) && c.modelsSeen.every((m) => !/fable/i.test(m)),
  ),
  d13CacheReadIteration2:
    second === null ? "n/a: one executor iteration" : (second.firstRequestCacheRead ?? 0) > 0,
};

const summary = {
  runId: run.id,
  runDir,
  finalStage: run.stage,
  awaitStage: finalStage,
  haltReason: run.haltReason,
  aborted,
  prUrl: run.prUrl,
  tier: run.tier,
  wallMin: Math.round(wallMs / 600) / 100,
  totalCostUsd: Math.round(spent(run) * 10000) / 10000,
  perRoleCostUsd: Object.fromEntries(
    Object.entries(perRole).map(([k, v]) => [k, Math.round(v * 10000) / 10000]),
  ),
  children: perChild,
  executorReports: reportGaps,
  answers,
  checks,
  pushedBranch: run.branch ? git(origin, "branch", "--list", run.branch).trim() || null : null,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (opts.clean) rmSync(home, { recursive: true, force: true });
else log(`kept ${home}`);
process.exitCode = run.stage === "ready" ? 0 : 1;
