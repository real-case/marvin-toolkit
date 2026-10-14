import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";
import { claims, g, gateStage, runWorktree } from "./_gate-fixture.mjs";

/**
 * The engine carries the run's metrics record (`src/pipeline/metrics-carry.ts`): the delivery
 * gate appends the terminal block after the executor's last commit, so the engine's gate
 * tolerates that one path while its change is an append the metrics tool wrote, and finalize
 * commits it. These tests pin the classifier that decides "an append the tool wrote", and the
 * gate's use of it; finalize's use is in pipeline-learning.test.mjs.
 */

const carry = await importTs("src/pipeline/metrics-carry.ts");
const store = await importTs("src/storage/metrics.ts");

const SLUG = "demo";
const RECORD = ".marvin/metrics/001-demo.md";
const SPEC_PATH = ".marvin/task/001-demo.md";

const event = (slug = SLUG) => ({
  slug,
  source: "marvin-tm-executor",
  step: "§3",
  kind: "spec-gap",
  at: "2026-10-12T10:00:00.000Z",
  detail: "a by-product the contract did not name",
});
const terminal = (slug = SLUG, n = 1) => ({
  slug,
  rolled_up_at: `2026-10-12T1${n}:00:00.000Z`,
  base_branch: "dev",
  sources: { spec: "present", progress: "absent" },
  time: {},
  quality: {},
  rework: {},
  notes: [],
});

/** The record as the seal anchor and one live event leave it, committed with the run's work. */
const committedRecord = () =>
  store.recordHeader(SLUG) + store.recordBlock(store.METRIC_EVENT_TAG, event());

/** A run worktree whose base holds the record, as the engine's spec commit leaves it. */
function withRecord(body = committedRecord()) {
  const w = runWorktree({ [RECORD]: body });
  w.git_ = g.isolatedGit(w.path, w.gitDir);
  w.head = () => w.git("rev-parse", "HEAD");
  w.classify = (rel = RECORD, slug = SLUG, commit = w.head()) =>
    carry.classifyRecord(w.git_, commit, w.path, rel, slug);
  w.append = (text, rel = RECORD) => appendFileSync(join(w.path, rel), text);
  /** What the real delivery gate does on ALLOW, through the same writer. */
  w.deliver = (n = 1, slug = SLUG, rel = RECORD) =>
    store.appendTaskMetrics(join(w.path, rel), terminal(slug, n));
  return w;
}

// ── the record's path ────────────────────────────────────────────────────────

test("runRecord follows the writers' rule: the spec's own basename, or the slug's existing record", () => {
  const w = withRecord();
  const spec = "---\nslug: demo\nstatus: ready\n---\n# Demo\n";
  assert.deepEqual(carry.runRecord(w.path, SPEC_PATH, spec), { path: RECORD, slug: SLUG });
  assert.equal(carry.runRecordPath(w.path, SPEC_PATH, spec), RECORD);
  // A spec that names no slug falls back to its filename, and an existing record wins.
  assert.equal(carry.runRecordPath(w.path, "specs/demo.md", "# Demo\n"), RECORD);
  // A fresh slug with no record yet gets the spec's basename.
  assert.equal(
    carry.runRecordPath(w.path, "specs/007-other.md", "---\nslug: other\n---\n"),
    ".marvin/metrics/007-other.md",
  );
  // CRLF front matter is read like LF.
  assert.equal(carry.runRecordPath(w.path, SPEC_PATH, spec.replace(/\n/g, "\r\n")), RECORD);
});

test("runRecord files nothing where the seal anchor files nothing", () => {
  const w = withRecord();
  // A date-named spec with no declared slug would yield `09-04-thing`: kebab-case and wrong.
  assert.equal(carry.runRecord(w.path, "specs/2026-09-04-thing.md", "# x\n"), null);
  assert.equal(carry.runRecord(w.path, "specs/x.md", "---\nslug: Not_Kebab\n---\n"), null);
});

test("runRecord carries nothing while two files name a record for the slug", () => {
  const w = withRecord();
  const spec = "---\nslug: demo\nstatus: ready\n---\n# Demo\n";
  // An exact `<slug>.md` would win the writers' lookup over the committed numbered record.
  w.write(".marvin/metrics/demo.md", store.recordHeader(SLUG));
  assert.equal(carry.runRecord(w.path, SPEC_PATH, spec), null);
  rmSync(join(w.path, ".marvin/metrics/demo.md"));
  w.write(".marvin/metrics/002-demo.md", store.recordHeader(SLUG));
  assert.equal(carry.runRecord(w.path, SPEC_PATH, spec), null);
});

// ── the classifier ───────────────────────────────────────────────────────────

test("no file is absent, and the committed bytes are unchanged", () => {
  const w = withRecord();
  assert.deepEqual(w.classify(), { state: "unchanged" });
  rmSync(join(w.path, RECORD));
  assert.deepEqual(w.classify(), { state: "absent" });
  assert.deepEqual(w.classify(".marvin/metrics/002-none.md", "none"), { state: "absent" });
});

test("a terminal block the delivery gate appends is appended, with the bytes as read", () => {
  const w = withRecord();
  w.deliver();
  const out = w.classify();
  assert.equal(out.state, "appended");
  assert.ok(Buffer.isBuffer(out.bytes));
  assert.ok(out.bytes.equals(readFileSync(join(w.path, RECORD))));
});

test("live events and a second terminal block after a committed one are appended too", () => {
  const w = withRecord(committedRecord() + store.recordBlock(store.TASK_METRICS_TAG, terminal()));
  store.appendMetricEvent(join(w.path, RECORD), event());
  w.deliver(2);
  assert.equal(w.classify().state, "appended");
});

test("a rewritten earlier entry is refused, even when blocks are appended after it", () => {
  const w = withRecord();
  const abs = join(w.path, RECORD);
  writeFileSync(abs, readFileSync(abs, "utf8").replace("a by-product", "nothing"));
  w.deliver();
  const out = w.classify();
  assert.equal(out.state, "refused");
  assert.match(out.reason, /earlier entry was changed/);
});

test("foreign text after the record is refused, before or after a valid block", () => {
  for (const [label, act] of [
    ["prose alone", (w) => w.append("I also fixed the build.\n")],
    ["prose after a block", (w) => (w.deliver(), w.append("note\n"))],
    ["a block missing its blank line", (w) => w.append("```json task-metrics\n{}\n```\n")],
    [
      "an unknown tag",
      (w) => w.append(store.recordBlock("verify-run", { ...terminal(), slug: SLUG })),
    ],
  ]) {
    const w = withRecord();
    act(w);
    assert.equal(w.classify().state, "refused", label);
  }
});

test("a block that parses but is not what the tool writes, or not a valid entry, is refused", () => {
  const cases = [
    [
      "spaced JSON",
      "```json task-metrics\n" +
        JSON.stringify(terminal(), null, 1).replace(/\n/g, " ") +
        "\n```\n\n",
    ],
    ["a duplicate key", '```json metric-event\n{"slug":"demo","slug":"demo"}\n```\n\n'],
    [
      "a half-written event",
      store.recordBlock(store.METRIC_EVENT_TAG, { ...event(), detail: undefined }),
    ],
    [
      "a terminal block without its envelope",
      store.recordBlock(store.TASK_METRICS_TAG, { slug: SLUG }),
    ],
    ["not JSON", "```json task-metrics\n{slug: demo}\n```\n\n"],
  ];
  for (const [label, text] of cases) {
    const w = withRecord();
    w.append(text);
    const out = w.classify();
    assert.equal(out.state, "refused", label);
  }
});

test("an entry for another task is refused", () => {
  const w = withRecord();
  w.deliver(1, "other-task");
  const out = w.classify();
  assert.equal(out.state, "refused");
  assert.match(out.reason, /entry for other-task, not demo/);
});

test("a CRLF-mangled or non-UTF-8 append is refused", () => {
  const crlf = withRecord();
  crlf.append(store.recordBlock(store.TASK_METRICS_TAG, terminal()).replace(/\n/g, "\r\n"));
  assert.match(crlf.classify().reason, /UTF-8 text with LF/);
  const latin = withRecord();
  latin.append(Buffer.from([0x60, 0xff, 0xfe, 0x0a]));
  assert.match(latin.classify().reason, /UTF-8 text with LF/);
  // The whole file converted to CRLF breaks the committed prefix instead.
  const whole = withRecord();
  const abs = join(whole.path, RECORD);
  writeFileSync(abs, readFileSync(abs, "utf8").replace(/\n/g, "\r\n"));
  assert.equal(whole.classify().state, "refused");
});

test("a symlink in the record's place, or on the way to it, is refused and never followed", () => {
  const outside = mkdtempSync(join(tmpdir(), "carry-outside-"));
  const w = withRecord();
  const valid =
    readFileSync(join(w.path, RECORD), "utf8") +
    store.recordBlock(store.TASK_METRICS_TAG, terminal());
  writeFileSync(join(outside, "001-demo.md"), valid);
  rmSync(join(w.path, RECORD));
  symlinkSync(join(outside, "001-demo.md"), join(w.path, RECORD));
  assert.match(w.classify().reason, /symbolic link/);

  const d = withRecord();
  const dir = join(d.path, ".marvin", "metrics");
  renameSync(dir, join(outside, "metrics"));
  writeFileSync(join(outside, "metrics", "001-demo.md"), valid);
  symlinkSync(join(outside, "metrics"), dir);
  assert.match(d.classify().reason, /\.marvin\/metrics is a symbolic link/);
});

test("a record with a second hard link is refused", () => {
  const w = withRecord();
  w.deliver();
  linkSync(join(w.path, RECORD), join(mkdtempSync(join(tmpdir(), "carry-link-")), "twin.md"));
  assert.match(w.classify().reason, /hard link/);
});

test("a directory in the record's place is refused", () => {
  const w = withRecord();
  rmSync(join(w.path, RECORD));
  mkdirSync(join(w.path, RECORD, "inner"), { recursive: true });
  writeFileSync(join(w.path, RECORD, "inner", "x.md"), committedRecord());
  assert.match(w.classify().reason, /not a regular file/);
});

test("a record the commit lacks must be the tool's header and its blocks, nothing else", () => {
  const w = runWorktree();
  const git = g.isolatedGit(w.path, w.gitDir);
  const head = w.git("rev-parse", "HEAD");
  const classify = () => carry.classifyRecord(git, head, w.path, RECORD, SLUG);
  const abs = join(w.path, RECORD);

  store.ensureRecord(abs, SLUG);
  assert.equal(classify().state, "appended", "the seal anchor's header alone");
  store.appendTaskMetrics(abs, terminal());
  assert.equal(classify().state, "appended", "the header and a terminal block");

  writeFileSync(abs, "# Notes\n\n" + store.recordBlock(store.TASK_METRICS_TAG, terminal()));
  assert.match(classify().reason, /record header/);
  writeFileSync(
    abs,
    store.recordHeader("other") + store.recordBlock(store.TASK_METRICS_TAG, terminal()),
  );
  assert.equal(classify().state, "refused", "another slug's header");
});

test("an untracked record git's ignore rules exclude is ignored, whatever it holds", () => {
  const w = runWorktree({ ".gitignore": ".marvin/metrics/\n" });
  const git = g.isolatedGit(w.path, w.gitDir);
  w.write(RECORD, "anything at all\n");
  assert.deepEqual(carry.classifyRecord(git, w.git("rev-parse", "HEAD"), w.path, RECORD, SLUG), {
    state: "ignored",
  });
});

test("a record whose committed entry is a symlink is refused", () => {
  const w = runWorktree();
  mkdirSync(join(w.path, ".marvin", "metrics"), { recursive: true });
  symlinkSync("elsewhere.md", join(w.path, RECORD));
  w.commit("a committed link");
  rmSync(join(w.path, RECORD));
  writeFileSync(join(w.path, RECORD), committedRecord());
  const git = g.isolatedGit(w.path, w.gitDir);
  assert.match(
    carry.classifyRecord(git, w.git("rev-parse", "HEAD"), w.path, RECORD, SLUG).reason,
    /not a regular file in/,
  );
});

// ── the gate ─────────────────────────────────────────────────────────────────

const OPTION = { metricsRecord: { path: RECORD, slug: SLUG } };
const uncommitted = (report) => claims(report).filter((c) => c.startsWith("uncommitted work"));

test("the delivery gate's append is not uncommitted work when the gate carries the record", () => {
  const w = withRecord();
  w.write("src/a.mjs", "export const a = 1;\n");
  w.commit("the executor's work");
  w.deliver();
  const report = gateStage(w, { ...OPTION, contractFiles: ["src/a.mjs"] });
  assert.deepEqual(report.blockers, []);
  assert.equal(report.passed, true);
  // Without the option the gate reads the append as it always has.
  assert.deepEqual(uncommitted(gateStage(w)), [`uncommitted work: ${RECORD}`]);
});

test("an untracked record holding the header and an append is carried, an unknown file is not", () => {
  const w = runWorktree();
  w.write("src/a.mjs", "export const a = 1;\n");
  w.commit("work");
  store.ensureRecord(join(w.path, RECORD), SLUG);
  store.appendTaskMetrics(join(w.path, RECORD), terminal());
  assert.deepEqual(uncommitted(gateStage(w, OPTION)), []);
  w.write(".marvin/metrics/002-other.md", store.recordHeader("other"));
  assert.deepEqual(uncommitted(gateStage(w, OPTION)), [
    "uncommitted work: .marvin/metrics/002-other.md",
  ]);
});

test("a rewritten record is uncommitted work, carried or not", () => {
  const w = withRecord();
  const abs = join(w.path, RECORD);
  writeFileSync(abs, readFileSync(abs, "utf8").replace("a by-product", "nothing"));
  w.deliver();
  assert.deepEqual(uncommitted(gateStage(w, OPTION)), [`uncommitted work: ${RECORD}`]);
});

test("another dirty record beside the carried one is still uncommitted work", () => {
  const w = withRecord();
  w.write(".marvin/metrics/002-other.md", store.recordHeader("other"));
  w.commit("another record");
  w.deliver();
  w.deliver(1, "other", ".marvin/metrics/002-other.md");
  assert.deepEqual(uncommitted(gateStage(w, OPTION)), [
    "uncommitted work: .marvin/metrics/002-other.md",
  ]);
});

test("a symlinked record is uncommitted work, even pointing at a valid append", () => {
  const w = withRecord();
  const outside = join(mkdtempSync(join(tmpdir(), "carry-gate-")), "001-demo.md");
  writeFileSync(outside, committedRecord() + store.recordBlock(store.TASK_METRICS_TAG, terminal()));
  rmSync(join(w.path, RECORD));
  symlinkSync(outside, join(w.path, RECORD));
  assert.deepEqual(uncommitted(gateStage(w, OPTION)), [`uncommitted work: ${RECORD}`]);
});

test("a gate command that appends a valid block is tolerated; one that rewrites the record is not", () => {
  const appender = withRecord();
  const block = store.recordBlock(store.TASK_METRICS_TAG, terminal());
  const script = join(mkdtempSync(join(tmpdir(), "carry-cmd-")), "append.mjs");
  writeFileSync(
    script,
    `import { appendFileSync } from "node:fs";\nappendFileSync(process.argv[2], ${JSON.stringify(block)});\n`,
  );
  const append = { name: "append", command: `node ${script} ${RECORD}` };
  const ok = gateStage(appender, { ...OPTION, gates: [append] });
  assert.deepEqual(
    claims(ok).filter((c) => c.startsWith("gates modified")),
    [],
  );

  const rewriter = withRecord();
  const rewrite = { name: "rewrite", command: `printf 'x\\n' > ${RECORD}` };
  const bad = gateStage(rewriter, { ...OPTION, gates: [rewrite] });
  assert.deepEqual(
    claims(bad).filter((c) => c.startsWith("gates modified")),
    [`gates modified tracked file ${RECORD}`],
  );

  // Already carried before the gates (status ` M` before and after), then rewritten by one.
  const late = withRecord();
  late.deliver();
  const relabel = {
    name: "relabel",
    command: `node -e "const f=process.argv[1],fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('a by-product','nothing'))" ${RECORD}`,
  };
  const relabelled = gateStage(late, { ...OPTION, gates: [relabel] });
  assert.deepEqual(
    claims(relabelled).filter((c) => c.startsWith("gates modified")),
    [`gates modified tracked file ${RECORD}`],
  );
});

test("the gate refuses a record option that is not a record path or a kebab slug", () => {
  const w = withRecord();
  for (const metricsRecord of [
    { path: "src/a.mjs", slug: SLUG },
    { path: "./.marvin/metrics/001-demo.md", slug: SLUG },
    { path: ".marvin/metrics/sub/001-demo.md", slug: SLUG },
    { path: RECORD, slug: "Not Kebab" },
  ]) {
    assert.throws(() => gateStage(w, { metricsRecord }), /metrics record/);
  }
  // null is no record at all: today's behaviour.
  assert.equal(gateStage(w, { metricsRecord: null }).passed, true);
});
