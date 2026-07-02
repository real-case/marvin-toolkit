import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

const TITLE = "Wire structuredContent through task list";
const TRACKER = "OSI-42";

/**
 * Drive the live server: create one bug task (with a tracker id), then call the
 * `task` `list` action and return the raw `tools/call` result so the test can
 * assert the ADR-0024 `structuredContent` (TaskListPayload) the widget consumes —
 * not just the rendered text. A `.marvin/config.json` with a tracker template is
 * written first so `tracker_url` derivation is exercised end-to-end.
 */
function createThenListStructured(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir },
    });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }

        if (msg.method === "elicitation/create" && msg.id != null) {
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: { action: "accept", content: { title: TITLE, tracker_id: TRACKER } },
          });
          continue;
        }
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "task", arguments: { action: "create", type: "bug" } },
          });
        } else if (msg.id === 2) {
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "task", arguments: { action: "list" } },
          });
        } else if (msg.id === 3) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result);
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: { elicitation: {} },
        clientInfo: { name: "structured-test", version: "0" },
      },
    });
  });
}

test("task list emits a TaskListPayload structuredContent alongside the text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-sc-"));
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ tracker_url_template: "https://tracker.example/browse/{tracker_id}" }),
    );

    const result = await createThenListStructured(dir);

    // text surface still present (terminal fallback unchanged)
    const text = result.content.map((c) => c.text).join("\n");
    assert.match(text, /# Tasks \(1\)/);

    // widget surface: the typed payload
    const sc = result.structuredContent;
    assert.ok(sc, "structuredContent present on the list result");
    assert.equal(sc.tasks.length, 1);
    // ADR-0026: counts is an open per-key record (every configured key present,
    // default set here) plus the closed per-role roll-up.
    assert.equal(sc.counts.todo, 1);
    assert.equal(sc.counts.wip, 0, "unused configured keys present at 0");
    assert.equal(sc.role_counts.todo, 1);
    assert.equal(sc.role_counts.wip, 0);

    const card = sc.tasks[0];
    assert.equal(card.id, "001");
    assert.equal(card.type, "bug");
    assert.deepEqual(card.status, { key: "todo", role: "todo" }, "status is {key, role}");
    assert.equal(card.title, TITLE);
    assert.equal(card.tracker_id, TRACKER);
    assert.equal(card.tracker_url, "https://tracker.example/browse/OSI-42");
    assert.equal(card.pr, null, "pr is null until PR-URL capture lands");
    assert.equal(typeof card.branch, "string");
    assert.ok(card.created && card.updated, "timestamps present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
