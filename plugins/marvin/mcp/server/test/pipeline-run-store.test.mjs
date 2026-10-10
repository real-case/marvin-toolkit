import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

const rs = await importTs("src/pipeline/run-store.ts");
const NOW = new Date("2026-10-04T09:12:00Z");
const fresh = () =>
  rs.initRun({
    id: "r20261004-0912-00ab",
    repoRoot: "/repo/osint",
    base: "dev",
    lang: "ru",
    orchestratorName: "Autopilot",
    task: "Добавить фильтр",
    taskEnglish: "Add a filter",
    stageA: "standard",
    now: NOW,
  });

test("run id is sortable and stamped in UTC", () => {
  assert.equal(
    rs.newRunId(NOW, () => 0.5),
    "r20261004-0912-7fff",
  );
});

test("a saved run loads back identically and leaves no temp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  rs.saveRun(dir, fresh());
  assert.deepEqual(rs.loadRun(dir), fresh());
  assert.deepEqual(readdirSync(dir), ["run.json"]);
});

test("only declared transitions are legal", () => {
  assert.equal(rs.transition(fresh(), "planning", NOW).stage, "planning");
  assert.throws(
    () => rs.transition(fresh(), "executing", NOW),
    /illegal transition intake -> executing/,
  );
  const approval = { ...fresh(), stage: "awaiting_approval" };
  assert.equal(rs.transition(approval, "test_authoring", NOW).stage, "test_authoring");
  assert.throws(
    () => rs.transition({ ...fresh(), stage: "executing" }, "verifying", NOW),
    /illegal/,
  );
});

test("halting needs a reason, leads to retro, and is refused once halted", () => {
  assert.throws(() => rs.transition(fresh(), "halted", NOW), /requires a reason/);
  const halted = rs.transition(fresh(), "halted", NOW, "user cancelled");
  assert.equal(halted.haltReason, "user cancelled");
  assert.equal(rs.transition(halted, "retro", NOW).stage, "retro");
  assert.throws(() => rs.transition(halted, "halted", NOW, "again"), /cannot halt/);
});

test("events append and read back in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  rs.appendEvent(dir, {
    ts: NOW.toISOString(),
    kind: "report",
    actor: "r1-executor-1",
    text: "a",
  });
  rs.appendEvent(dir, {
    ts: NOW.toISOString(),
    kind: "note",
    actor: "engine",
    text: "b",
    data: { notify: true },
  });
  assert.deepEqual(
    rs.readEvents(dir).map((e) => e.text),
    ["a", "b"],
  );
});

test("state root honours MARVIN_PIPELINE_HOME", () => {
  assert.equal(
    rs.runDirFor("/x/osint-chat-client", "r1", { MARVIN_PIPELINE_HOME: "/s" }),
    "/s/osint-chat-client/r1",
  );
});

test("a run file written before ciSince and executorQuestionRounds existed still loads, with both at their defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  const { ciSince, executorQuestionRounds, ...old } = fresh();
  assert.deepEqual([ciSince, executorQuestionRounds], [null, 0]);
  writeFileSync(join(dir, "run.json"), JSON.stringify(old));
  const loaded = rs.loadRun(dir);
  assert.deepEqual([loaded.ciSince, loaded.executorQuestionRounds], [null, 0]);
  const stamped = { ...old, ciSince: "2026-10-04T10:00:00.000Z", executorQuestionRounds: 2 };
  assert.deepEqual(rs.Run.parse(stamped).executorQuestionRounds, 2);
  assert.throws(() => rs.Run.parse({ ...old, ciSince: 5 }), /ciSince/);
  assert.throws(
    () => rs.Run.parse({ ...old, executorQuestionRounds: -1 }),
    /executorQuestionRounds/,
  );
});
