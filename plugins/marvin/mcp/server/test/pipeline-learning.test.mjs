import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { importTs } from "./_tsload.mjs";
import { repoWithOrigin, sh } from "./_pipeline-git.mjs";

const l = await importTs("src/pipeline/learning.ts");
const rs = await importTs("src/pipeline/run-store.ts");
const wtm = await importTs("src/pipeline/worktree.ts");
const seal = await importTs("src/pipeline/seal.ts");
const lessonStore = await importTs("src/storage/lessons.ts");

const TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

test("lessons tied to the contract paths and role rank first", () => {
  const lessons = [
    {
      id: "a",
      title: "Toast assertions are vacuous",
      tags: ["role:executor"],
      body: "src/app/chats/toast.ts",
    },
    { id: "b", title: "Unrelated", tags: [], body: "docs only" },
    { id: "c", title: "Payments rounding", tags: ["role:verifier"], body: "payments" },
  ];
  assert.deepEqual(
    l
      .rankLessons(lessons, { role: "executor", paths: ["src/app/chats/toast.ts"], limit: 8 })
      .map((x) => x.id),
    ["a"],
  );
  assert.equal(l.lessonsMarkdown([]), "(none)");
});

test("ranking honours the limit, keeps input order on a tie, and never ranks a role tag alone", () => {
  const lessons = [
    { id: "x", title: "Payments rounding", tags: [], body: "payments" },
    { id: "y", title: "Payments retries", tags: [], body: "payments" },
    { id: "z", title: "Payments ledger", tags: [], body: "payments" },
    { id: "only-role", title: "Nothing relevant", tags: ["role:executor"], body: "elsewhere" },
  ];
  const tied = l.rankLessons(lessons, { role: "executor", paths: ["src/payments/x.ts"], limit: 2 });
  assert.deepEqual(
    tied.map((x) => x.id),
    ["x", "y"],
  );
  const ledger = l.rankLessons(lessons, {
    role: "executor",
    paths: ["src/payments/ledger.ts"],
    limit: 3,
  });
  assert.deepEqual(
    ledger.map((x) => x.id),
    ["z", "x", "y"],
  );
  const all = l.rankLessons(lessons, { role: "executor", paths: ["src/payments/x.ts"], limit: 9 });
  assert.ok(!all.some((x) => x.id === "only-role"));
  assert.equal(
    l.lessonsMarkdown([{ id: "a", title: "T", tags: [], body: "" }]),
    "- T — .marvin/memory/a.md",
  );
});

const rec = (ts, cats, exposed = ["L1"]) => ({
  ts,
  findingCategories: cats,
  exposedLessons: exposed,
});
const before5 = Array.from({ length: 5 }, (_, i) => rec(`2026-09-0${i + 1}`, ["test-quality"], []));
const afterSame = Array.from({ length: 5 }, (_, i) => rec(`2026-10-1${i}`, ["test-quality"]));
const afterBetter = Array.from({ length: 5 }, (_, i) => rec(`2026-10-1${i}`, []));
const item = { id: "L1", kind: "lesson", createdAt: "2026-10-01", targetCategory: "test-quality" };

test("efficacy proposes pruning only with enough exposure and no drop", () => {
  assert.equal(l.efficacy([...before5, ...afterSame], [item])[0].verdict, "prune-candidate");
  assert.equal(l.efficacy([...before5, ...afterBetter], [item])[0].verdict, "keep");
  assert.equal(l.efficacy([...before5, ...afterSame.slice(0, 2)], [item])[0].verdict, "too-early");
});

test("efficacy has nothing to compare against without five records before the item existed", () => {
  assert.equal(l.efficacy(afterSame, [item])[0].verdict, "too-early");
  assert.equal(l.efficacy([...before5.slice(0, 4), ...afterSame], [item])[0].verdict, "too-early");
  const verdict = l.efficacy([...before5, ...afterSame], [item])[0];
  assert.deepEqual(
    [verdict.exposure, verdict.before, verdict.after, verdict.verdict],
    [5, 1, 1, "prune-candidate"],
  );
});

test("efficacy reads the ten records before the item, in time order, and exposure for a check is every later run", () => {
  const old = Array.from({ length: 10 }, (_, i) => rec(`2026-08-${10 + i}`, [], []));
  const recent = Array.from({ length: 5 }, (_, i) => rec(`2026-09-1${i}`, ["test-quality"], []));
  const shuffled = [...afterBetter, ...recent, ...old].reverse();
  const out = l.efficacy(shuffled, [item])[0];
  assert.equal(out.before, 0.5);
  const check = {
    id: "c1",
    kind: "check",
    createdAt: "2026-10-01",
    targetCategory: "test-quality",
  };
  const unexposed = afterSame.map((r) => ({ ...r, exposedLessons: [] }));
  assert.equal(l.efficacy([...before5, ...unexposed], [check])[0].verdict, "prune-candidate");
  assert.equal(l.efficacy([...before5, ...unexposed], [item])[0].verdict, "too-early");
});

const NOW = new Date("2026-10-04T12:00:00Z");
const child = (role, costUsd, cacheReadTokens, iteration = 0) => ({
  name: `r1-${role}-${iteration}`,
  role,
  iteration,
  sessionId: null,
  pid: null,
  assignment: { model: "sonnet", effort: "medium" },
  startedAt: NOW.toISOString(),
  endedAt: null,
  status: "done",
  costUsd,
  cacheReadTokens,
});
const makeRun = (patch = {}) =>
  rs.Run.parse({
    ...rs.initRun({
      id: "r1",
      repoRoot: "/repo",
      base: "dev",
      lang: "en",
      orchestratorName: "o",
      task: "t",
      taskEnglish: "t",
      stageA: "standard",
      now: NOW,
    }),
    ...patch,
  });

test("the aggregate reads the run's own fields: categories, repeats, per-role cost, who answered", () => {
  const run = makeRun({
    tier: "heavy",
    tierReasons: ["touches payments"],
    iteration: 3,
    rung: 1,
    haltReason: "cap",
    assumptions: ["a1"],
    rejections: [
      {
        iteration: 1,
        source: "gate",
        fingerprints: ["test-quality|a.ts|AC1", "scope||", "|no-category|"],
      },
      {
        iteration: 2,
        source: "verifier",
        fingerprints: ["test-quality|a.ts|AC1", "criterion|b.ts|AC2"],
      },
    ],
    children: [
      child("executor", 1.5, 100),
      child("executor", 0.5, null, 1),
      child("verifier", null, 10),
    ],
  });
  const answer = (answeredBy) => ({
    ts: "t",
    kind: "answer",
    actor: "o",
    text: "",
    data: { answeredBy },
  });
  const events = [
    answer("orchestrator"),
    answer("user"),
    answer("orchestrator"),
    { ts: "t", kind: "question", actor: "p", text: "?", data: { answeredBy: "user" } },
    { ts: "t", kind: "answer", actor: "o", text: "" },
  ];
  const agg = l.aggregate(run, events);
  assert.deepEqual(agg, {
    tier: "heavy",
    tierReasons: ["touches payments"],
    iterations: 3,
    rung: 1,
    rejections: run.rejections,
    findingCategories: ["test-quality", "scope", "criterion"],
    repeatedFingerprints: ["test-quality|a.ts|AC1"],
    questions: { byOrchestrator: 2, byUser: 1 },
    perRole: [
      { role: "executor", costUsd: 2, cacheReadTokens: 100 },
      { role: "verifier", costUsd: 0, cacheReadTokens: 10 },
    ],
    halted: "cap",
    assumptions: ["a1"],
  });
  const record = l.calibrationRecord(run, agg, ["L1", "L2"]);
  assert.deepEqual(record, {
    ts: run.updatedAt,
    runId: "r1",
    tier: "heavy",
    stageA: "standard",
    signalsReasons: ["touches payments"],
    aggregate: agg,
    findingCategories: agg.findingCategories,
    exposedLessons: ["L1", "L2"],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

const goodRetro = () => ({
  checks: [
    {
      id: "no-console",
      pattern: "console\\.log",
      message: "no console.log",
      severity: "major",
      category: "convention",
    },
  ],
  proposals: [
    {
      target: "marvin",
      file: "skills/task-implement/SKILL.md",
      change: "c",
      rationale: "r",
      evidence: ["F1"],
    },
  ],
  lessons: [
    {
      type: "gotcha",
      title: "T",
      body: "B",
      tags: ["role:executor"],
      target_category: "test-quality",
      evidence: ["F2"],
    },
  ],
  prune: [],
});

test("retro output: checks deduplicate by id, proposals go to the run dir, lessons go through storage", () => {
  const wt = tmp("pipe-wt-");
  const runDir = tmp("pipe-run-");
  mkdirSync(join(wt, ".marvin", "pipeline"), { recursive: true });
  writeFileSync(
    join(wt, ".marvin", "pipeline", "checks.yaml"),
    "- { id: only, pattern: 'x', message: 'm' }\n",
  );
  const added = [];
  l.applyRetro({
    worktree: wt,
    runDir,
    retro: {
      checks: [
        { id: "only", pattern: "y", message: "dup" },
        {
          id: "no-console",
          pattern: "console\\.log",
          message: "no console.log",
          severity: "major",
          category: "convention",
        },
      ],
      proposals: [
        {
          target: "marvin",
          file: "skills/task-implement/SKILL.md",
          change: "c",
          rationale: "r",
          evidence: ["F1"],
        },
      ],
      lessons: [
        {
          type: "gotcha",
          title: "T",
          body: "B",
          tags: ["role:executor"],
          target_category: "test-quality",
          evidence: ["F2"],
        },
      ],
      prune: [],
    },
    addLesson: (root, lesson) => added.push([root, lesson.title]),
  });
  const checks = readFileSync(join(wt, ".marvin", "pipeline", "checks.yaml"), "utf8");
  assert.equal((checks.match(/id: only/g) ?? []).length, 1);
  assert.match(checks, /no-console/);
  assert.match(
    readFileSync(join(runDir, "proposals", "1-marvin.md"), "utf8"),
    /skills\/task-implement\/SKILL.md/,
  );
  assert.deepEqual(added, [[wt, "T"]]);
});

const REJECTIONS = [
  ["a proposal target outside the enum", (r) => (r.proposals[0].target = "other"), /target/],
  ["a proposal target that is a path", (r) => (r.proposals[0].target = "../../x"), /target/],
  ["a check id with an uppercase letter", (r) => (r.checks[0].id = "No-Console"), /checks\.0\.id/],
  ["a check id that is a path", (r) => (r.checks[0].id = "../x"), /checks\.0\.id/],
  ["a check id with a leading dash", (r) => (r.checks[0].id = "-x"), /checks\.0\.id/],
  ["a check id of 65 characters", (r) => (r.checks[0].id = "a".repeat(65)), /checks\.0\.id/],
  ["an empty check id", (r) => (r.checks[0].id = ""), /checks\.0\.id/],
  ["a pattern that does not compile", (r) => (r.checks[0].pattern = "("), /checks\.0\.pattern/],
  [
    "a pattern longer than 500 characters",
    (r) => (r.checks[0].pattern = "a".repeat(501)),
    /checks\.0\.pattern/,
  ],
  ["an empty pattern", (r) => (r.checks[0].pattern = ""), /checks\.0\.pattern/],
  [
    "a severity outside the gate's set",
    (r) => (r.checks[0].severity = "critical"),
    /checks\.0\.severity/,
  ],
  [
    "a path_pattern that does not compile",
    (r) => (r.checks[0].path_pattern = "["),
    /checks\.0\.path_pattern/,
  ],
  [
    "an exclude_pattern that does not compile",
    (r) => (r.checks[0].exclude_pattern = "(?<"),
    /checks\.0\.exclude_pattern/,
  ],
  ["a check without a message", (r) => delete r.checks[0].message, /checks\.0\.message/],
  ["a lesson with an empty title", (r) => (r.lessons[0].title = ""), /lessons\.0\.title/],
  ["a lesson whose title is blank", (r) => (r.lessons[0].title = "  "), /lessons\.0\.title/],
  [
    "a lesson title of 201 characters",
    (r) => (r.lessons[0].title = "t".repeat(201)),
    /lessons\.0\.title/,
  ],
  ["a lesson title spanning two lines", (r) => (r.lessons[0].title = "a\nb"), /lessons\.0\.title/],
  ["a lesson with an empty body", (r) => (r.lessons[0].body = ""), /lessons\.0\.body/],
  ["a lesson whose body is whitespace", (r) => (r.lessons[0].body = " \n "), /lessons\.0\.body/],
  ["a lesson type outside the taxonomy", (r) => (r.lessons[0].type = "idea"), /lessons\.0\.type/],
  ["a lesson tag holding a comma", (r) => (r.lessons[0].tags = ["a,b"]), /lessons\.0\.tags\.0/],
  [
    "a lesson target_category that is a path",
    (r) => (r.lessons[0].target_category = "../x"),
    /lessons\.0\.target_category/,
  ],
  ["a missing prune array", (r) => delete r.prune, /prune/],
  ["a checks value that is not an array", (r) => (r.checks = {}), /checks/],
  ["a prune entry without a reason", (r) => (r.prune = [{ id: "x" }]), /prune\.0\.reason/],
];

for (const [label, mutate, expected] of REJECTIONS) {
  test(`retro output with ${label} is rejected before anything is written`, () => {
    const wt = tmp("pipe-wt-");
    const runDir = tmp("pipe-run-");
    const retro = goodRetro();
    retro.prune = [{ id: "keep-me", reason: "fine" }];
    mutate(retro);
    const added = [];
    assert.throws(
      () => l.applyRetro({ worktree: wt, runDir, retro, addLesson: (r, x) => added.push(x) }),
      (error) => {
        assert.match(error.message, /^retro output rejected/);
        assert.match(error.message, expected);
        return true;
      },
    );
    assert.deepEqual(readdirSync(wt), []);
    assert.deepEqual(readdirSync(runDir), []);
    assert.deepEqual(added, []);
  });
}

test("retro output that is not an object at all is rejected", () => {
  for (const retro of [null, undefined, "x", 3, [], { checks: null }]) {
    const wt = tmp("pipe-wt-");
    const runDir = tmp("pipe-run-");
    assert.throws(
      () => l.applyRetro({ worktree: wt, runDir, retro, addLesson: () => {} }),
      /retro output rejected/,
    );
    assert.deepEqual(readdirSync(wt), []);
    assert.deepEqual(readdirSync(runDir), []);
  }
});

test("a retro whose arrays are all empty is accepted and writes nothing to the worktree", () => {
  const wt = tmp("pipe-wt-");
  const runDir = tmp("pipe-run-");
  const out = l.applyRetro({
    worktree: wt,
    runDir,
    retro: { checks: [], proposals: [], lessons: [], prune: [] },
    addLesson: () => assert.fail("no lessons to add"),
  });
  assert.deepEqual(out.written, []);
  assert.deepEqual(readdirSync(wt), []);
});

test("extra fields from the child are dropped and optional rule fields survive", () => {
  const wt = tmp("pipe-wt-");
  const runDir = tmp("pipe-run-");
  const retro = {
    ...goodRetro(),
    status: "done",
    summary: "s",
    checks: [
      {
        id: "x",
        pattern: "a",
        path_pattern: "\\.ts$",
        exclude_pattern: "\\.test\\.ts$",
        message: "m",
        evidence: ["F1"],
        sneaky: "no",
      },
    ],
  };
  l.applyRetro({ worktree: wt, runDir, retro, addLesson: () => {} });
  const [rule] = parse(readFileSync(join(wt, ".marvin", "pipeline", "checks.yaml"), "utf8"));
  assert.deepEqual(rule, {
    id: "x",
    pattern: "a",
    path_pattern: "\\.ts$",
    exclude_pattern: "\\.test\\.ts$",
    message: "m",
  });
});

test("an existing checks.yaml that is not a list of rules with string ids is never replaced", () => {
  const bad = [
    ["a mapping", "id: x\n"],
    ["a scalar", "hello\n"],
    ["a rule without an id", "- { pattern: x, message: m }\n"],
    ["a numeric id", "- { id: 5, pattern: x, message: m }\n"],
    ["a list holding a string", "- just text\n"],
    ["broken YAML", "- { id: a\n"],
  ];
  for (const [label, body] of bad) {
    const wt = tmp("pipe-wt-");
    const runDir = tmp("pipe-run-");
    mkdirSync(join(wt, ".marvin", "pipeline"), { recursive: true });
    const file = join(wt, ".marvin", "pipeline", "checks.yaml");
    writeFileSync(file, body);
    assert.throws(
      () => l.applyRetro({ worktree: wt, runDir, retro: goodRetro(), addLesson: () => {} }),
      /checks\.yaml/,
      label,
    );
    assert.equal(readFileSync(file, "utf8"), body, label);
    assert.deepEqual(readdirSync(runDir), [], label);
  }
});

test("an empty or comment-only checks.yaml counts as no rules", () => {
  for (const body of ["", "[]\n", "# nothing yet\n"]) {
    const wt = tmp("pipe-wt-");
    mkdirSync(join(wt, ".marvin", "pipeline"), { recursive: true });
    const file = join(wt, ".marvin", "pipeline", "checks.yaml");
    writeFileSync(file, body);
    l.applyRetro({
      worktree: wt,
      runDir: tmp("pipe-run-"),
      retro: goodRetro(),
      addLesson: () => {},
    });
    assert.deepEqual(
      parse(readFileSync(file, "utf8")).map((r) => r.id),
      ["no-console"],
    );
  }
});

test("rules deduplicate inside one retro, round-trip through YAML, and an unchanged file is not rewritten", () => {
  const wt = tmp("pipe-wt-");
  const runDir = tmp("pipe-run-");
  const awkward = "a: b # c 'd' \"e\" \\\\ \\. [x]";
  const retro = {
    ...goodRetro(),
    checks: [
      { id: "dup", pattern: awkward, message: "first: one #two" },
      { id: "dup", pattern: "other", message: "second" },
    ],
  };
  const first = l.applyRetro({ worktree: wt, runDir, retro, addLesson: () => {} });
  const file = join(wt, ".marvin", "pipeline", "checks.yaml");
  assert.deepEqual(first.written, [".marvin/pipeline/checks.yaml"]);
  assert.deepEqual(parse(readFileSync(file, "utf8")), [
    { id: "dup", pattern: awkward, message: "first: one #two" },
  ]);
  const second = l.applyRetro({ worktree: wt, runDir, retro, addLesson: () => {} });
  assert.deepEqual(second.written, []);
});

test("checks.yaml and the proposals are written whole: the old file is replaced, never written through", () => {
  const wt = tmp("pipe-wt-");
  const runDir = tmp("pipe-run-");
  const outside = join(tmp("pipe-out-"), "outside.yaml");
  const original = "- { id: keep, pattern: k, message: m }\n";
  writeFileSync(outside, original);
  mkdirSync(join(wt, ".marvin", "pipeline"), { recursive: true });
  const checks = join(wt, ".marvin", "pipeline", "checks.yaml");
  symlinkSync(outside, checks);
  const proposalTarget = join(tmp("pipe-out-"), "proposal.md");
  writeFileSync(proposalTarget, "untouched\n");
  mkdirSync(join(runDir, "proposals"));
  symlinkSync(proposalTarget, join(runDir, "proposals", "1-marvin.md"));

  l.applyRetro({ worktree: wt, runDir, retro: goodRetro(), addLesson: () => {} });

  assert.equal(readFileSync(outside, "utf8"), original);
  assert.equal(lstatSync(checks).isSymbolicLink(), false);
  assert.deepEqual(
    parse(readFileSync(checks, "utf8")).map((r) => r.id),
    ["keep", "no-console"],
  );
  assert.equal(readFileSync(proposalTarget, "utf8"), "untouched\n");
  assert.equal(lstatSync(join(runDir, "proposals", "1-marvin.md")).isSymbolicLink(), false);
  assert.deepEqual(readdirSync(join(wt, ".marvin", "pipeline")), ["checks.yaml"]);
  assert.deepEqual(readdirSync(join(runDir, "proposals")), ["1-marvin.md"]);
});

test("proposal files are named from the index and the enum only, and prune proposals go beside them", () => {
  const wt = tmp("pipe-wt-");
  const runDir = tmp("pipe-run-");
  const retro = goodRetro();
  retro.proposals = [
    { target: "marvin", file: "../../etc/passwd", change: "c1", rationale: "r1", evidence: [] },
    { target: "project", file: "a.md", change: "c2", rationale: "r2", evidence: ["F1", "F2"] },
  ];
  retro.prune = [
    { id: "old-lesson", reason: "no drop after 6 runs" },
    { id: "chk", reason: "never fired" },
  ];
  l.applyRetro({ worktree: wt, runDir, retro, addLesson: () => {} });
  assert.deepEqual(readdirSync(join(runDir, "proposals")).sort(), [
    "1-marvin.md",
    "2-project.md",
    "prune.md",
  ]);
  assert.match(
    readFileSync(join(runDir, "proposals", "2-project.md"), "utf8"),
    /- Evidence: F1, F2/,
  );
  assert.equal(
    readFileSync(join(runDir, "proposals", "prune.md"), "utf8"),
    "- old-lesson: no drop after 6 runs\n- chk: never fired\n",
  );
});

test("a lesson the store reports as a near-duplicate is recorded in the run dir, not added", () => {
  const wt = tmp("pipe-wt-");
  const runDir = tmp("pipe-run-");
  const retro = goodRetro();
  retro.lessons.push({ ...retro.lessons[0], title: "Second" });
  const out = l.applyRetro({
    worktree: wt,
    runDir,
    retro,
    addLesson: (_root, lesson) =>
      lesson.title === "T" ? { duplicateOf: "old-slug" } : { added: [".marvin/memory/second.md"] },
  });
  assert.deepEqual(out.duplicates, [{ title: "T", of: "old-slug" }]);
  assert.deepEqual(out.written, [".marvin/pipeline/checks.yaml", ".marvin/memory/second.md"]);
  const note = readFileSync(join(runDir, "proposals", "duplicate-lessons.md"), "utf8");
  assert.match(note, /T/);
  assert.match(note, /old-slug/);
  assert.doesNotMatch(note, /Second/);
});

test("finalizing a spec flips status and appends Delivery, nothing else", () => {
  const spec = "---\nslug: x\nstatus: in-progress\nrisk: low\n---\n# X\n\nBody.\n";
  const out = l.finalizeSpec(spec, {
    pr: "https://github.com/o/r/pull/1",
    iterations: 2,
    runId: "r1",
  });
  assert.equal(
    out.replace("status: shipped", "status: in-progress").split("\n\n## Delivery")[0],
    spec.trimEnd(),
  );
  assert.match(
    out,
    /## Delivery\n\n- PR: https:\/\/github.com\/o\/r\/pull\/1\n- Pipeline run: r1 \(2 iterations\)/,
  );
});

const DELIVERY = { pr: "https://github.com/o/r/pull/1", iterations: 2, runId: "r1" };

test("only the front matter's status is flipped: a body line saying status is never touched", () => {
  const spec = [
    "---",
    "slug: x",
    "status: in-progress",
    "---",
    "# X",
    "",
    "```yaml",
    "status: draft",
    "```",
    "",
    "status: in-progress",
    "",
  ].join("\n");
  const out = l.finalizeSpec(spec, DELIVERY);
  assert.equal(out.split("\n")[2], "status: shipped");
  assert.equal(out.match(/^status: shipped$/gm).length, 1);
  assert.match(out, /```yaml\nstatus: draft\n```\n\nstatus: in-progress\n\n## Delivery/);
});

test("a spec with no status in its front matter throws, even when the body has one", () => {
  const spec = "---\nslug: x\nrisk: low\n---\n# X\n\nstatus: in-progress\n";
  assert.throws(() => l.finalizeSpec(spec, DELIVERY), /status/);
});

test("front matter must open the file and close on a line that is exactly ---", () => {
  assert.throws(() => l.finalizeSpec("# X\n\nstatus: in-progress\n", DELIVERY), /front matter/);
  assert.throws(() => l.finalizeSpec("\n---\nstatus: a\n---\n", DELIVERY), /front matter/);
  assert.throws(() => l.finalizeSpec("---\nstatus: a\n", DELIVERY), /front matter/);
  const spec = "---\nslug: x\n----\nrisk: low\n--- \nstatus: in-progress\n---\n# X\n";
  const out = l.finalizeSpec(spec, DELIVERY);
  assert.match(out, /^---\nslug: x\n----\nrisk: low\n--- \nstatus: shipped\n---\n# X\n/);
});

test("a key that only contains the word status is not the status key", () => {
  const spec = "---\nslug: x\nmeta:\n  status: nested\nstatus_note: a\nstatus: draft\n---\n# X\n";
  const out = l.finalizeSpec(spec, DELIVERY);
  assert.match(
    out,
    /^---\nslug: x\nmeta:\n {2}status: nested\nstatus_note: a\nstatus: shipped\n---\n/,
  );
});

test("a spec written with CRLF line endings comes back with LF", () => {
  const spec = "---\r\nslug: x\r\nstatus: draft\r\n---\r\n# X\r\n\r\nBody.\r\n";
  const out = l.finalizeSpec(spec, DELIVERY);
  assert.ok(!out.includes("\r"));
  assert.match(out, /^---\nslug: x\nstatus: shipped\n---\n# X\n\nBody\.\n\n## Delivery\n\n- PR:/);
});

test("finalizing twice with the same delivery gives the same text, and a new delivery replaces the old one", () => {
  const spec = "---\nslug: x\nstatus: draft\n---\n# X\n\nBody.\n";
  const once = l.finalizeSpec(spec, DELIVERY);
  assert.equal(l.finalizeSpec(once, DELIVERY), once);
  assert.equal(once.match(/^## Delivery$/gm).length, 1);
  const again = l.finalizeSpec(once, {
    pr: "https://github.com/o/r/pull/9",
    iterations: 4,
    runId: "r2",
  });
  assert.equal(again.match(/^## Delivery$/gm).length, 1);
  assert.match(
    again,
    /- PR: https:\/\/github.com\/o\/r\/pull\/9\n- Pipeline run: r2 \(4 iterations\)\n$/,
  );
  assert.doesNotMatch(again, /pull\/1\b/);
});

test("an existing Delivery section is replaced in place, a later section stays, a fenced heading is not one", () => {
  const body = [
    "---",
    "slug: x",
    "status: shipped",
    "---",
    "# X",
    "",
    "```md",
    "## Delivery",
    "",
    "- PR: example",
    "```",
    "",
    "## Delivery",
    "",
    "- PR: https://github.com/o/r/pull/1",
    "- Pipeline run: r0 (1 iterations)",
    "",
    "## Notes",
    "",
    "Kept.",
    "",
  ].join("\n");
  const out = l.finalizeSpec(body, DELIVERY);
  assert.equal(
    out,
    [
      "---",
      "slug: x",
      "status: shipped",
      "---",
      "# X",
      "",
      "```md",
      "## Delivery",
      "",
      "- PR: example",
      "```",
      "",
      "## Delivery",
      "",
      "- PR: https://github.com/o/r/pull/1",
      "- Pipeline run: r1 (2 iterations)",
      "",
      "## Notes",
      "",
      "Kept.",
      "",
    ].join("\n"),
  );
  const onlyFenced = "---\nstatus: draft\n---\n# X\n\n~~~\n## Delivery\n~~~\n";
  const appended = l.finalizeSpec(onlyFenced, DELIVERY);
  assert.match(appended, /~~~\n## Delivery\n~~~\n\n## Delivery\n\n- PR: /);
  assert.equal(l.finalizeSpec(appended, DELIVERY), appended);
});

test("a line that opens and closes a backtick span is not a code fence", () => {
  const spec =
    "---\nstatus: draft\n---\n# X\n\n```not a fence``` here\n\n## Delivery\n\n- PR: old\n";
  const out = l.finalizeSpec(spec, DELIVERY);
  assert.equal(out.match(/^## Delivery$/gm).length, 1);
  assert.doesNotMatch(out, /PR: old/);
});

test("a PR url or run id holding a line break is refused", () => {
  const spec = "---\nstatus: draft\n---\n# X\n";
  assert.throws(() => l.finalizeSpec(spec, { ...DELIVERY, pr: "u\n## Injected" }), /line break/);
  assert.throws(() => l.finalizeSpec(spec, { ...DELIVERY, runId: "r\r1" }), /line break/);
});

test("calibration records append, and a run's record is replaced rather than repeated", () => {
  const wt = tmp("pipe-wt-");
  const run = makeRun();
  const agg = l.aggregate(run, []);
  const file = join(wt, ".marvin", "pipeline", "calibration.jsonl");
  l.appendCalibration(wt, l.calibrationRecord(run, agg, []));
  l.appendCalibration(wt, l.calibrationRecord(makeRun({ id: "r2" }), agg, ["L1"]));
  l.appendCalibration(wt, l.calibrationRecord(run, agg, ["L9"]));
  const lines = readFileSync(file, "utf8").trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(
    lines.map((x) => [x.runId, x.exposedLessons]),
    [
      ["r1", ["L9"]],
      ["r2", ["L1"]],
    ],
  );
  writeFileSync(file, `not json\n${readFileSync(file, "utf8")}`);
  l.appendCalibration(wt, l.calibrationRecord(makeRun({ id: "r3" }), agg, []));
  const text = readFileSync(file, "utf8").trimEnd().split("\n");
  assert.equal(text[0], "not json");
  assert.equal(text.length, 4);
  assert.deepEqual(readdirSync(join(wt, ".marvin", "pipeline")), ["calibration.jsonl"]);
});

test("seal.ts exports the single-quote shell escaping the format command reuses", () => {
  assert.equal(seal.shellQuote("a b"), "'a b'");
  assert.equal(seal.shellQuote("it's"), "'it'\\''s'");
  assert.equal(
    seal.formatTestOne("node --test {file}", "it's.test.mjs"),
    `node --test ${seal.shellQuote("it's.test.mjs")}`,
  );
});

const SPEC = "---\nslug: demo\nstatus: in-progress\nrisk: low\n---\n# Demo\n\nBody.\n";
const SPEC_PATH = ".marvin/task/001-demo.md";
const SUBJECT = "chore(demo): ship spec; lessons and calibration from run r1";

/** A repo with an origin, a run worktree on its own branch with the spec committed and pushed. */
function prFixture({ specPath = SPEC_PATH } = {}) {
  const repo = repoWithOrigin();
  const origin = sh(repo, "remote", "get-url", "origin");
  const made = wtm.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r1",
    worktreesRoot: tmp("pipe-wts-"),
  });
  const abs = join(made.path, specPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, SPEC);
  sh(made.path, "add", ".");
  sh(made.path, "commit", "-m", "spec");
  sh(made.path, "push", "origin", `HEAD:refs/heads/${made.branch}`);
  const run = makeRun({
    prUrl: "https://github.com/o/r/pull/1",
    branch: made.branch,
    specPath,
    worktree: made.path,
    iteration: 2,
    tier: "standard",
    tierReasons: ["one file"],
    rejections: [{ iteration: 1, source: "gate", fingerprints: ["test-quality|a.ts|AC1"] }],
  });
  return {
    repo,
    origin,
    wt: made.path,
    gitDir: made.gitDir,
    branch: made.branch,
    baseSha: made.baseSha,
    specPath,
    run,
    runDir: tmp("pipe-run-"),
    opts(extra = {}) {
      return {
        run,
        runDir: this.runDir,
        worktree: made.path,
        gitDir: made.gitDir,
        retro: goodRetro(),
        events: [],
        exposedLessons: ["L1"],
        formatCommand: null,
        ...extra,
      };
    },
  };
}

const head = (cwd) => sh(cwd, "rev-parse", "HEAD");
const status = (cwd) => sh(cwd, "status", "--porcelain", "--untracked-files=all");
const commitCount = (fx) => Number(sh(fx.wt, "rev-list", "--count", `${fx.baseSha}..HEAD`));

test("finalizing a run with a PR commits exactly the files it wrote and pushes the run branch", () => {
  const fx = prFixture();
  const devBefore = sh(fx.origin, "rev-parse", "refs/heads/dev");
  const headBefore = head(fx.wt);
  writeFileSync(join(fx.wt, "stray.txt"), "staged by someone else\n");
  sh(fx.wt, "add", "stray.txt");
  writeFileSync(join(fx.wt, "untracked.txt"), "not ours\n");
  writeFileSync(join(fx.wt, "package-lock.json"), '{ "edited": true }\n');

  const out = l.finalizeRun(fx.opts());

  const slug = ".marvin/memory/t.md";
  assert.equal(out.shipped, true);
  assert.equal(out.pushed, true);
  assert.equal(out.commit, head(fx.wt));
  assert.notEqual(out.commit, headBefore);
  assert.equal(commitCount(fx), 2);
  assert.equal(sh(fx.wt, "log", "-1", "--format=%s"), SUBJECT);
  const message = sh(fx.wt, "log", "-1", "--format=%B");
  assert.equal(message.split("\n").at(-1), TRAILER);
  const committed = sh(fx.wt, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split(
    "\n",
  );
  assert.deepEqual(
    committed.sort(),
    [
      ".marvin/memory/MEMORY.md",
      slug,
      ".marvin/pipeline/calibration.jsonl",
      ".marvin/pipeline/checks.yaml",
      SPEC_PATH,
    ].sort(),
  );
  assert.deepEqual([...out.written].sort(), committed.sort());
  assert.equal(sh(fx.wt, "diff", "--cached", "--name-only"), "stray.txt");
  assert.equal(sh(fx.wt, "diff", "--name-only"), "package-lock.json");
  assert.equal(sh(fx.wt, "ls-files", "--others", "--exclude-standard"), "untracked.txt");

  assert.equal(sh(fx.origin, "rev-parse", `refs/heads/${fx.branch}`), head(fx.wt));
  assert.equal(sh(fx.origin, "rev-parse", "refs/heads/dev"), devBefore);

  const spec = readFileSync(join(fx.wt, SPEC_PATH), "utf8");
  assert.match(spec, /^---\nslug: demo\nstatus: shipped\nrisk: low\n---\n/);
  assert.match(
    spec,
    /## Delivery\n\n- PR: https:\/\/github.com\/o\/r\/pull\/1\n- Pipeline run: r1 \(2 iterations\)\n$/,
  );
  const [calibration] = readFileSync(join(fx.wt, ".marvin/pipeline/calibration.jsonl"), "utf8")
    .trimEnd()
    .split("\n")
    .map(JSON.parse);
  assert.equal(calibration.runId, "r1");
  assert.deepEqual(calibration.findingCategories, ["test-quality"]);
  assert.deepEqual(calibration.exposedLessons, ["L1"]);
  assert.deepEqual(
    parse(readFileSync(join(fx.wt, ".marvin/pipeline/checks.yaml"), "utf8")).map((r) => r.id),
    ["no-console"],
  );
  const lesson = readFileSync(join(fx.wt, slug), "utf8");
  assert.match(lesson, /type: gotcha/);
  assert.match(lesson, /tags: .*role:executor.*target:test-quality/);
  assert.match(lesson, /source: pipeline:r1/);
  assert.match(readFileSync(join(fx.wt, ".marvin/memory/MEMORY.md"), "utf8"), /\[T\]\(/);
  assert.match(readFileSync(join(fx.runDir, "proposals", "1-marvin.md"), "utf8"), /SKILL\.md/);
});

test("a run with no PR keeps its retro output in the run dir: nothing is committed or pushed, the worktree stays clean", () => {
  const fx = prFixture();
  const noPr = makeRun({ ...fx.run, prUrl: null });
  const headBefore = head(fx.wt);
  const remoteBefore = sh(fx.origin, "for-each-ref", "--format=%(refname) %(objectname)");

  const out = l.finalizeRun(fx.opts({ run: noPr }));

  assert.deepEqual([out.shipped, out.commit, out.pushed, out.written], [false, null, false, []]);
  assert.equal(head(fx.wt), headBefore);
  assert.equal(status(fx.wt), "");
  assert.equal(readFileSync(join(fx.wt, SPEC_PATH), "utf8"), SPEC);
  assert.equal(sh(fx.origin, "for-each-ref", "--format=%(refname) %(objectname)"), remoteBefore);
  assert.deepEqual(readdirSync(fx.runDir).sort(), [
    "calibration.json",
    "proposals",
    "retro-output.json",
  ]);
  const saved = JSON.parse(readFileSync(join(fx.runDir, "retro-output.json"), "utf8"));
  assert.equal(saved.lessons[0].title, "T");
  assert.equal(saved.checks[0].id, "no-console");
  assert.equal(JSON.parse(readFileSync(join(fx.runDir, "calibration.json"), "utf8")).runId, "r1");
  assert.match(readFileSync(join(fx.runDir, "proposals", "1-marvin.md"), "utf8"), /SKILL\.md/);
});

test("a run with no PR still refuses a retro that does not validate", () => {
  const fx = prFixture();
  const noPr = makeRun({ ...fx.run, prUrl: null });
  const retro = goodRetro();
  retro.proposals[0].target = "elsewhere";
  assert.throws(() => l.finalizeRun(fx.opts({ run: noPr, retro })), /retro output rejected/);
  assert.deepEqual(readdirSync(fx.runDir), []);
});

test("an invalid retro, a bad branch or a missing spec path stops finalize before it writes anything", () => {
  const cases = [
    ["an invalid retro", { retro: { ...goodRetro(), checks: [{ id: "BAD" }] } }, /retro output/],
    ["an unsafe branch", { run: { branch: "a..b" } }, /branch/],
    ["a branch that looks like an option", { run: { branch: "--force" } }, /branch/],
    ["no branch", { run: { branch: null } }, /branch/],
    ["no spec path", { run: { specPath: null } }, /spec/],
    ["a spec path outside the worktree", { run: { specPath: "../x.md" } }, /spec/],
    ["a spec that is not there", { run: { specPath: "docs/none.md" } }, /ENOENT|spec/],
    ["a run id with a line break", { run: { id: "r1\nx" } }, /run id/],
  ];
  for (const [label, patch, expected] of cases) {
    const fx = prFixture();
    const headBefore = head(fx.wt);
    const opts = fx.opts();
    if (patch.run) opts.run = { ...fx.run, ...patch.run };
    if (patch.retro) opts.retro = patch.retro;
    assert.throws(() => l.finalizeRun(opts), expected, label);
    assert.equal(head(fx.wt), headBefore, label);
    assert.equal(status(fx.wt), "", label);
    assert.deepEqual(readdirSync(fx.runDir), [], label);
  }
});

test("the format command runs once over every written path, shell-quoted, before the commit", () => {
  const fx = prFixture({ specPath: "docs/it's a spec.md" });
  const dir = tmp("pipe-fmt-");
  const log = join(dir, "argv.json");
  const script = join(dir, "fmt.mjs");
  writeFileSync(
    script,
    [
      'import { appendFileSync, writeFileSync } from "node:fs";',
      "const [log, ...files] = process.argv.slice(2);",
      "writeFileSync(log, JSON.stringify(files));",
      'for (const f of files) if (f.endsWith(".md")) appendFileSync(f, "<!-- formatted -->\\n");',
    ].join("\n"),
  );
  const out = l.finalizeRun(
    fx.opts({
      formatCommand: [process.execPath, script, log].map(seal.shellQuote).join(" "),
    }),
  );
  const argv = JSON.parse(readFileSync(log, "utf8"));
  assert.deepEqual([...argv].sort(), out.written.map((p) => join(fx.wt, p)).sort());
  assert.ok(argv.includes(join(fx.wt, "docs/it's a spec.md")));
  assert.match(sh(fx.wt, "show", `HEAD:docs/it's a spec.md`), /<!-- formatted -->$/);
  assert.equal(status(fx.wt), "");
});

test("a blank format command is no format command", () => {
  const fx = prFixture();
  const out = l.finalizeRun(fx.opts({ formatCommand: "  " }));
  assert.equal(out.pushed, true);
  assert.equal(status(fx.wt), "");
});

test("a failing format command throws, commits nothing and puts the written files back", () => {
  const fx = prFixture();
  mkdirSync(join(fx.wt, ".marvin", "memory"), { recursive: true });
  lessonStore.addLesson(join(fx.wt, ".marvin", "memory"), {
    type: "process",
    title: "Earlier unrelated lesson",
    body: "kept",
  });
  sh(fx.wt, "add", ".");
  sh(fx.wt, "commit", "-m", "earlier lesson");
  sh(fx.wt, "push", "origin", `HEAD:refs/heads/${fx.branch}`);
  const headBefore = head(fx.wt);
  const remoteBefore = sh(fx.origin, "rev-parse", `refs/heads/${fx.branch}`);
  const memoryBefore = readFileSync(join(fx.wt, ".marvin/memory/MEMORY.md"), "utf8");

  assert.throws(
    () =>
      l.finalizeRun(
        fx.opts({ formatCommand: `${seal.shellQuote(process.execPath)} -e "process.exit(3)"` }),
      ),
    /format/,
  );

  assert.equal(head(fx.wt), headBefore);
  assert.equal(sh(fx.origin, "rev-parse", `refs/heads/${fx.branch}`), remoteBefore);
  assert.equal(status(fx.wt), "");
  assert.equal(readFileSync(join(fx.wt, ".marvin/memory/MEMORY.md"), "utf8"), memoryBefore);
  assert.equal(readFileSync(join(fx.wt, SPEC_PATH), "utf8"), SPEC);
  for (const gone of [
    ".marvin/pipeline/checks.yaml",
    ".marvin/pipeline/calibration.jsonl",
    ".marvin/memory/t.md",
  ]) {
    assert.equal(existsSync(join(fx.wt, gone)), false, gone);
  }
});

test("a lesson that duplicates one already in the store is skipped and recorded in the run dir", () => {
  const fx = prFixture();
  mkdirSync(join(fx.wt, ".marvin", "memory"), { recursive: true });
  const old = lessonStore.addLesson(join(fx.wt, ".marvin", "memory"), {
    type: "gotcha",
    title: "Toast assertions are vacuous",
    body: "already known",
  });
  sh(fx.wt, "add", ".");
  sh(fx.wt, "commit", "-m", "earlier lesson");
  sh(fx.wt, "push", "origin", `HEAD:refs/heads/${fx.branch}`);
  const retro = goodRetro();
  retro.lessons = [
    { ...retro.lessons[0], title: "Toast assertions are vacuous" },
    { ...retro.lessons[0], title: "Cache keys must carry the tenant" },
  ];

  const out = l.finalizeRun(fx.opts({ retro }));

  assert.deepEqual(readdirSync(join(fx.wt, ".marvin", "memory")).sort(), [
    "MEMORY.md",
    "cache-keys-must-carry-the-tenant.md",
    `${old.slug}.md`,
  ]);
  assert.ok(out.written.includes(".marvin/memory/cache-keys-must-carry-the-tenant.md"));
  assert.ok(out.written.includes(".marvin/memory/MEMORY.md"));
  assert.ok(!out.written.includes(`.marvin/memory/${old.slug}.md`));
  const note = readFileSync(join(fx.runDir, "proposals", "duplicate-lessons.md"), "utf8");
  assert.match(note, /Toast assertions are vacuous/);
  assert.match(note, new RegExp(old.slug));
  assert.equal(status(fx.wt), "");
});

test("the engine's commit and push run with husky off and never skip a hook by flag", () => {
  const fx = prFixture();
  const hooks = join(fx.repo, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  for (const name of ["pre-commit", "pre-push"]) {
    const file = join(hooks, name);
    writeFileSync(file, '#!/bin/sh\n[ "$HUSKY" = "0" ] && exit 0\necho "hook ran" >&2\nexit 1\n');
    chmodSync(file, 0o755);
  }
  assert.throws(() => sh(fx.wt, "commit", "--allow-empty", "-m", "probe"), /hook ran/);
  const out = l.finalizeRun(fx.opts());
  assert.equal(out.pushed, true);
  assert.equal(sh(fx.origin, "rev-parse", `refs/heads/${fx.branch}`), head(fx.wt));
});

test("a push the remote refuses is never forced: the local commit stays, the remote does not move", () => {
  const fx = prFixture();
  const other = join(tmp("pipe-other-"), "clone");
  sh(tmpdir(), "clone", fx.origin, other);
  sh(other, "config", "user.email", "o@o");
  sh(other, "config", "user.name", "o");
  sh(other, "checkout", "-B", fx.branch, `origin/${fx.branch}`);
  writeFileSync(join(other, "other.txt"), "someone else\n");
  sh(other, "add", ".");
  sh(other, "commit", "-m", "other");
  sh(other, "push", "origin", `HEAD:refs/heads/${fx.branch}`);
  const remote = sh(fx.origin, "rev-parse", `refs/heads/${fx.branch}`);

  assert.throws(() => l.finalizeRun(fx.opts()), /push|rejected/i);

  assert.equal(sh(fx.origin, "rev-parse", `refs/heads/${fx.branch}`), remote);
  assert.equal(commitCount(fx), 2);
});

test("finalize can be run again after a failed push: no second commit, one calibration line, one Delivery", () => {
  const fx = prFixture();
  sh(fx.wt, "remote", "set-url", "origin", join(tmp("pipe-gone-"), "missing.git"));
  assert.throws(() => l.finalizeRun(fx.opts()), /push|repository|fatal/i);
  assert.equal(commitCount(fx), 2);
  const committed = head(fx.wt);
  sh(fx.wt, "remote", "set-url", "origin", fx.origin);

  const again = l.finalizeRun(fx.opts());

  assert.equal(again.commit, null);
  assert.equal(again.pushed, true);
  assert.equal(head(fx.wt), committed);
  assert.equal(commitCount(fx), 2);
  assert.equal(sh(fx.origin, "rev-parse", `refs/heads/${fx.branch}`), committed);
  assert.equal(
    readFileSync(join(fx.wt, ".marvin/pipeline/calibration.jsonl"), "utf8").trimEnd().split("\n")
      .length,
    1,
  );
  assert.equal(readFileSync(join(fx.wt, SPEC_PATH), "utf8").match(/^## Delivery$/gm).length, 1);
  assert.equal(status(fx.wt), "");
});
