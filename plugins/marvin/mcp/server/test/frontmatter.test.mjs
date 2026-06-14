import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

// A title that stresses the YAML codec: colon-space (forces quoting), double
// quotes, parens, ampersand — all printable ASCII (TaskTitle requires it).
const TITLE = 'Fix: the "tricky" title (v2) & more';
const TRACKER = "OSI-7";

/**
 * Drive the live server through the kanban `task` tool — create a task (which
 * goes through stringifyFrontmatter) then list it (parseFrontmatter) — so the
 * full YAML-codec round-trip is exercised end-to-end through the real kanban
 * path. Responds to the create form's elicitation request as a client would.
 * Project dir is a fresh temp dir (not a git repo), so no branch elicitation.
 */
function createThenList(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir },
    });
    let buf = "";
    let createText = "";
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

        // Server-initiated elicitation request → accept with the form content.
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
          createText = msg.result.content.map((c) => c.text).join("\n");
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "task", arguments: { action: "list" } },
          });
        } else if (msg.id === 3) {
          clearTimeout(timer);
          const listText = msg.result.content.map((c) => c.text).join("\n");
          child.kill();
          resolve({ createText, listText });
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
        clientInfo: { name: "fm-test", version: "0" },
      },
    });
  });
}

test("kanban task frontmatter round-trips through the YAML codec (create → list)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-fm-"));
  try {
    const { createText, listText } = await createThenList(dir);

    // create went through stringifyFrontmatter and reported success
    assert.match(createText, /Created task \*\*001\*\*/);

    // list parsed the file back and rendered the exact title + tracker verbatim —
    // the special characters survived stringify → parse intact.
    assert.ok(listText.includes(TITLE), `list output missing exact title:\n${listText}`);
    assert.ok(listText.includes(TRACKER), `list output missing tracker:\n${listText}`);

    // and the on-disk file the codec wrote is valid YAML frontmatter
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1, "exactly one task file written");
    const raw = readFileSync(join(dir, files[0]), "utf8");
    assert.ok(raw.startsWith("---\n"), "file has YAML frontmatter");
    assert.ok(raw.includes("status: todo"), "status persisted as a string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
