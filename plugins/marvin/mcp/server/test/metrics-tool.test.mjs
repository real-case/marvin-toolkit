import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, withSession } from "./_driver.mjs";

/**
 * The `metrics` tool over stdio (ADR-0043): `record` stamps `at`, refuses a
 * non-kebab slug, refuses an event missing its kind's fields, and refuses an
 * unknown key (strict input, like `spec` and `report`); `rollup` derives one
 * terminal block from a tmp project's spec, journals and receipt, reports
 * whether git ignores the record, and appends a second block on a second
 * delivery of which the reader takes the last.
 */

const textOf = (r) => r.content.map((c) => c.text).join("\n");
const blockOf = (text, tag) => {
  const m = text.match(new RegExp("```json " + tag + "\\n([\\s\\S]*?)\\n```"));
  assert.ok(m, `no ${tag} block in:\n${text}`);
  return JSON.parse(m[1]);
};

const SPEC = [
  "---",
  "slug: demo-slug",
  "type: feature",
  "status: ready",
  "risk: low",
  "created: 2026-09-03",
  "contract_sha: 8f6a5d1c2b3e4f70",
  "---",
  "",
  "# Demo",
  "",
  "```yaml spec-contract",
  "files:",
  "  - id: F1",
  "    path: src/a.ts",
  "    action: edit",
  "    satisfies: [AC1]",
  "criteria:",
  "  - id: AC1",
  "    statement: it works",
  "    implemented_by: [F1]",
  '    oracle: { kind: command, ref: "true" }',
  "```",
  "",
].join("\n");

/** A tmp project with a numbered spec; `.marvin/task/runs/` holds whatever the caller adds. */
function project({ withSpec = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-metrics-tool-"));
  mkdirSync(join(dir, ".marvin", "task", "runs"), { recursive: true });
  if (withSpec) writeFileSync(join(dir, ".marvin", "task", "007-demo-slug.md"), SPEC);
  return dir;
}

const block = (tag, payload) => "```json " + tag + "\n" + JSON.stringify(payload) + "\n```\n\n";

test("record stamps `at`, names the record after the spec's file, and falls back to <slug>.md without a spec", async () => {
  const dir = project();
  const bare = project({ withSpec: false });
  try {
    const r = await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      source: "task-implement",
      step: "6F",
      kind: "spec-gap",
      detail: "the spec did not say where the fixture lives",
      contractSha: "8f6a5d1c2b3e4f70",
      projectRoot: dir,
    });
    assert.notEqual(r.isError, true, textOf(r));
    const payload = blockOf(textOf(r), "metric-event");
    assert.equal(payload.record, ".marvin/metrics/007-demo-slug.md", "the spec's own basename");
    assert.match(payload.event.at, /^\d{4}-\d{2}-\d{2}T.*Z$/, "stamped by the tool");
    assert.equal(payload.event.kind, "spec-gap");
    assert.equal(payload.event.contract_sha, "8f6a5d1c2b3e4f70");
    assert.deepEqual(r.structuredContent.event, payload.event);
    const onDisk = readFileSync(join(dir, ".marvin", "metrics", "007-demo-slug.md"), "utf8");
    assert.match(onDisk, /^# Metrics — demo-slug/);
    assert.match(onDisk, /```json metric-event/);
    // No self-written .gitignore: the record is a shared, committed artifact.
    assert.deepEqual(readdirSync(join(dir, ".marvin", "metrics")), ["007-demo-slug.md"]);

    // a second event lands in the SAME record
    const r2 = await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      source: "task-implement",
      step: "fix-cycle",
      kind: "fix-round",
      loop: "verify-gate",
      round: 1,
      projectRoot: dir,
    });
    assert.notEqual(r2.isError, true, textOf(r2));
    assert.equal(readdirSync(join(dir, ".marvin", "metrics")).length, 1);
    assert.equal(
      onDisk.length <
        readFileSync(join(dir, ".marvin", "metrics", "007-demo-slug.md"), "utf8").length,
      true,
    );

    // task-start records against a draft the corpus cannot see yet: <slug>.md
    const draft = await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      source: "task-start",
      step: "7F",
      kind: "gate-call",
      gate: "dor",
      call: 1,
      verdict: "FAIL",
      projectRoot: bare,
    });
    assert.notEqual(draft.isError, true, textOf(draft));
    assert.equal(blockOf(textOf(draft), "metric-event").record, ".marvin/metrics/demo-slug.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

test("record refuses a non-kebab slug, a half-written event and an unknown key, and writes nothing", async () => {
  const dir = project();
  try {
    const bad = await callTool("metrics", {
      action: "record",
      slug: "../Escape Me",
      source: "task-implement",
      step: "6F",
      kind: "spec-gap",
      detail: "x",
      projectRoot: dir,
    });
    assert.equal(bad.isError, true);
    assert.match(textOf(bad), /not kebab-case/);

    // a critic-verdict without its pass number — the plan's own example
    const half = await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      source: "task-implement",
      step: "6F",
      kind: "critic-verdict",
      critic: "marvin-tm-diff-critic",
      verdict: "PASS",
      blockers: 0,
      warnings: 0,
      projectRoot: dir,
    });
    assert.equal(half.isError, true);
    assert.match(textOf(half), /requires pass/);
    assert.match(
      textOf(half),
      /critic, pass, verdict, blockers, warnings/,
      "the kind's field list is named",
    );

    // the wrong vocabulary for the kind
    const vocab = await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      source: "task-start",
      step: "7F",
      kind: "gate-call",
      gate: "dor",
      call: 1,
      verdict: "BLOCK",
      projectRoot: dir,
    });
    assert.equal(vocab.isError, true);
    assert.match(textOf(vocab), /PASS \| PASS WITH WARNINGS \| FAIL/);

    // strict input: a misspelt key is an error naming it, not a stripped field
    const strict = await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      source: "task-implement",
      step: "6F",
      kind: "spec-gap",
      detial: "typo",
      projectRoot: dir,
    });
    assert.equal(strict.isError, true);
    assert.match(textOf(strict), /detial/);

    // missing the common fields
    const common = await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      projectRoot: dir,
    });
    assert.equal(common.isError, true);
    assert.match(textOf(common), /needs `source`, `step`, `kind`/);

    assert.equal(existsSync(join(dir, ".marvin", "metrics")), false, "nothing was written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rollup derives one block from the spec, journals and receipt, reports `ignored`, and a second rollup appends a second block", async () => {
  const dir = project();
  try {
    // a git repository that ignores .marvin/ wholesale — the host-project trap
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, ".gitignore"), ".marvin/*\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: dir });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "root"],
      { cwd: dir },
    );
    // one undeclared change: an untracked file the contract does not name
    writeFileSync(join(dir, "src-a.txt"), "changed\n");

    const runs = join(dir, ".marvin", "task", "runs");
    writeFileSync(
      join(runs, "demo-slug.progress.md"),
      block("spec-progress", {
        slug: "demo-slug",
        source: "task-start",
        step: "1.5",
        kind: "step",
        detail: "d",
        at: "2026-09-03T10:00:00.000Z",
      }) +
        block("spec-progress", {
          slug: "demo-slug",
          source: "task-start",
          step: "9F",
          kind: "step",
          detail: "d",
          contract_sha: "8f6a5d1c2b3e4f70",
          at: "2026-09-03T10:10:00.000Z",
        }) +
        block("spec-progress", {
          slug: "demo-slug",
          source: "task-implement",
          step: "2.5",
          kind: "step",
          detail: "d",
          at: "2026-09-03T11:00:00.000Z",
        }) +
        block("spec-progress", {
          slug: "demo-slug",
          source: "task-implement",
          step: "5F",
          kind: "criterion",
          criterion: "AC1",
          detail: "d",
          at: "2026-09-03T11:02:00.000Z",
        }),
    );
    writeFileSync(
      join(runs, "demo-slug.verify.md"),
      block("verify-run", {
        slug: "demo-slug",
        kind: "run",
        at: "2026-09-03T11:03:00.000Z",
        verdict: "FAIL",
        mode: "feature",
        execution: "parallel",
        only: null,
        gates: [{ name: "test", status: "fail", durationMs: 10 }],
        wallClockMs: 10,
        sumOfGatesMs: 10,
        head_sha: null,
      }) +
        block("verify-run", {
          slug: "demo-slug",
          kind: "run",
          at: "2026-09-03T11:05:00.000Z",
          verdict: "PASS",
          mode: "feature",
          execution: "parallel",
          only: null,
          gates: [{ name: "test", status: "pass", durationMs: 10 }],
          wallClockMs: 10,
          sumOfGatesMs: 10,
          head_sha: null,
        }),
    );
    writeFileSync(
      join(runs, "demo-slug.md"),
      "# Verification Report\n\n```json verify-result\n" +
        JSON.stringify({
          verdict: "PASS",
          gates: [
            { name: "test", status: "pass", code: 0, durationMs: 4200 },
            { name: "lint", status: "not-run", code: null, durationMs: 0 },
          ],
          wallClockMs: 4300,
          sumOfGatesMs: 4200,
        }) +
        "\n```\n",
    );
    mkdirSync(join(dir, ".marvin", "critique"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "critique", "001-demo-slug.md"),
      "# Spec critique\n\n" +
        block("critic-verdict", {
          critic: "marvin-tm-spec-critic",
          subject: "demo-slug",
          judged_at: "2026-09-03T10:08:00.000Z",
          compliance: { verdict: "PASS", blockers: 0, warnings: 0 },
          quality: { verdict: "PASS WITH WARNINGS", blockers: 0, warnings: 2 },
        }),
    );

    // one live event, so the events source is present
    await callTool("metrics", {
      action: "record",
      slug: "demo-slug",
      source: "task-implement",
      step: "5F",
      kind: "spec-gap",
      detail: "x",
      projectRoot: dir,
    });

    const first = await callTool("metrics", {
      action: "rollup",
      slug: "demo-slug",
      base: "HEAD",
      projectRoot: dir,
    });
    assert.notEqual(first.isError, true, textOf(first));
    const text = textOf(first);
    const b = blockOf(text, "task-metrics");
    assert.equal(b.slug, "demo-slug");
    assert.equal(b.type, "feature");
    assert.equal(b.contract_sha, "8f6a5d1c2b3e4f70");
    assert.deepEqual(b.sources, {
      spec: "present",
      progress: "present",
      oracles: "absent",
      verify_journal: "present",
      verify_result: "present",
      critique: "present",
      events: "present",
      git: "present",
    });
    assert.equal(b.time.intake_ms, 600000, "T1 from the progress journal");
    assert.equal(b.time.first_green_ms, 180000, "T3: 11:02 → the first green full run at 11:05");
    assert.equal(b.rework.runs_before_green, 1, "the FAIL preceded it");
    assert.deepEqual(b.quality.not_run, { gates: 2, not_run: 1, share: 0.5 });
    assert.equal(b.quality.spec_gaps, 1);
    assert.equal(b.quality.critics.spec.quality.verdict, "PASS WITH WARNINGS");
    assert.equal(b.quality.critics.diff, null);
    assert.deepEqual(b.quality.scope_drift, { declared: 1, changed: 1, undeclared: ["src-a.txt"] });
    assert.equal(b.quality.oracle_strength.executable, 1);
    assert.ok(b.head_sha, "the head is recorded");
    assert.match(b.rolled_up_at, /^\d{4}-\d{2}-\d{2}T/);

    // the answer says the record is IGNORED — the host-project trap made visible at the first roll-up
    assert.equal(first.structuredContent.ignored, true);
    assert.match(text, /IGNORED/);
    assert.match(text, /!\.marvin\/metrics\//, "…and names the negation to add");
    assert.equal(first.structuredContent.terminal_blocks, 1);
    assert.match(text, /## Time[\s\S]*## Quality[\s\S]*## Rework/, "the three groups are rendered");
    assert.match(text, /T1 intake: 10m/);

    // a second delivery appends a second block; the reader takes the last
    const second = await callTool("metrics", {
      action: "rollup",
      slug: "demo-slug",
      base: "HEAD",
      projectRoot: dir,
    });
    assert.equal(second.structuredContent.terminal_blocks, 2);
    assert.match(textOf(second), /terminal blocks: 2 \(the last is authoritative\)/);
    const onDisk = readFileSync(join(dir, ".marvin", "metrics", "007-demo-slug.md"), "utf8");
    assert.equal(onDisk.match(/```json task-metrics/g).length, 2);
    assert.equal(onDisk.match(/```json metric-event/g).length, 1, "the live event is untouched");

    // once the negation is in place, the same roll-up reports the record as tracked
    writeFileSync(join(dir, ".gitignore"), ".marvin/*\n!.marvin/metrics/\n");
    const third = await callTool("metrics", {
      action: "rollup",
      slug: "demo-slug",
      base: "HEAD",
      projectRoot: dir,
    });
    assert.equal(third.structuredContent.ignored, false);
    assert.match(textOf(third), /git: tracked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rollup on a bare project still writes a block whose sources are all absent, and a bad base ref is a note", async () => {
  const dir = project({ withSpec: false });
  try {
    const r = await callTool("metrics", { action: "rollup", slug: "demo-slug", projectRoot: dir });
    assert.notEqual(r.isError, true, textOf(r));
    const b = blockOf(textOf(r), "task-metrics");
    assert.deepEqual(new Set(Object.values(b.sources)), new Set(["absent"]));
    assert.equal(b.time.active_ms, null);
    assert.equal(b.quality.spec_gaps, null, "no events → null, never zero");
    assert.equal(r.structuredContent.ignored, null, "not a git repository");
    assert.match(textOf(r), /git: not a git repository/);
    assert.equal(blockOf(textOf(r), "task-metrics").base_branch, "dev", "the config default");
    assert.ok(existsSync(join(dir, ".marvin", "metrics", "demo-slug.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the metrics tool is registered as the fourteenth tool, between spec and lessons", async () => {
  const listed = await withSession({}, (s) => s.request("tools/list", {}));
  const names = listed.tools.map((t) => t.name);
  assert.equal(names.length, 14);
  assert.equal(names[names.indexOf("spec") + 1], "metrics");
  assert.equal(names[names.indexOf("metrics") + 1], "lessons");
  const tool = listed.tools.find((t) => t.name === "metrics");
  assert.match(tool.description, /ADR-0043/);
  assert.equal(tool._meta?.ui, undefined, "text-only: no widget bound");
});
