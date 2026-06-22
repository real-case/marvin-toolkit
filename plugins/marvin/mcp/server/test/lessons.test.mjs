import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * Drive the live stdio server with CLAUDE_PROJECT_DIR pointed at a temp dir, so
 * the lessons store resolves to <tmp>/.marvin/memory. Returns the tool's text
 * output and isError flag for one `lessons` call.
 */
function callLessons(projectDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
    let buf = "";
    let initialized = false;
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
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "lessons", arguments: args },
          });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          try {
            const text = msg.result.content.map((c) => c.text).join("\n");
            resolve({ text, isError: !!msg.result.isError });
          } catch (err) {
            reject(err);
          }
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
        capabilities: {},
        clientInfo: { name: "lessons-test", version: "0" },
      },
    });
  });
}

function freshProject() {
  return mkdtempSync(join(tmpdir(), "marvin-lessons-"));
}

// add writes a lesson file + the MEMORY.md index under .marvin/memory.
test("add: persists a lesson file and indexes it", async () => {
  const proj = freshProject();
  try {
    const { text, isError } = await callLessons(proj, {
      action: "add",
      type: "bug-pattern",
      title: "Null user on expired session",
      body: "getUser() returns null after the JWT expires; guard the caller.",
      tags: "auth, jwt",
      source: "debug",
    });
    assert.equal(isError, false, text);
    assert.match(text, /Captured lesson/);

    const memoryDir = join(proj, ".marvin", "memory");
    assert.ok(existsSync(join(memoryDir, "MEMORY.md")), "MEMORY.md created");
    const lessonFiles = readdirSync(memoryDir).filter(
      (f) => f.endsWith(".md") && f !== "MEMORY.md",
    );
    assert.equal(lessonFiles.length, 1, "one lesson file written");

    const lesson = readFileSync(join(memoryDir, lessonFiles[0]), "utf8");
    assert.match(lesson, /type: bug-pattern/);
    assert.match(lesson, /tags: auth, jwt/);
    assert.match(lesson, /guard the caller/);

    const index = readFileSync(join(memoryDir, "MEMORY.md"), "utf8");
    assert.match(index, /Null user on expired session/);
    assert.match(index, /bug-pattern/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// search recalls a previously-added lesson by keyword (the capture→recall loop).
test("search: recalls an added lesson by keyword", async () => {
  const proj = freshProject();
  try {
    await callLessons(proj, {
      action: "add",
      type: "gotcha",
      title: "Vitest needs --run in CI",
      body: "Without --run vitest stays in watch mode and the CI job hangs.",
      tags: "ci, vitest",
    });
    const { text, isError } = await callLessons(proj, { action: "search", query: "vitest ci" });
    assert.equal(isError, false, text);
    assert.match(text, /Vitest needs --run in CI/);
    assert.match(text, /watch mode/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// search on an empty store reports nothing rather than erroring.
test("search: empty store returns a no-lessons message", async () => {
  const proj = freshProject();
  try {
    const { text, isError } = await callLessons(proj, { action: "search", query: "anything" });
    assert.equal(isError, false, text);
    assert.match(text, /No (matching )?lessons/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// add with missing required fields fails closed.
test("add: missing body fails with isError", async () => {
  const proj = freshProject();
  try {
    const { text, isError } = await callLessons(proj, {
      action: "add",
      type: "process",
      title: "Incomplete lesson",
    });
    assert.equal(isError, true, "missing body should error");
    assert.match(text, /requires/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});
