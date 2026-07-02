import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

const BRANCH = "001--capture-the-pr-url";
const PR_URL = "https://github.com/acme/widget/pull/42";

/**
 * Seed a task .md the kanban storage layer accepts (numeric-prefixed filename,
 * frontmatter id matching the seq, no `pr` yet) into a tasks dir kept SEPARATE
 * from the git repo so it never dirties the worktree.
 */
function seedTask(tasksDir) {
  mkdirSync(tasksDir, { recursive: true });
  const md = [
    "---",
    'id: "001"',
    "type: bug",
    "status: review",
    "title: Capture the PR URL at create time",
    `branch: ${BRANCH}`,
    'created: "2026-06-20T10:00:00.000Z"',
    'updated: "2026-06-20T10:00:00.000Z"',
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
  writeFileSync(join(tasksDir, "001--capture-the-pr-url.md"), md);
}

/** Init a git repo on the given branch. */
function seedRepo(branch) {
  const repo = mkdtempSync(join(tmpdir(), "marvin-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  // An unborn branch is enough: `git branch --show-current` reports it and no
  // commits are needed. Avoids requiring a git identity in CI.
  execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: repo });
  return repo;
}

/** Drive the live server over stdio: run the given tools/call requests in order. */
function callSequence(repo, tasksDir, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: repo,
        MARVIN_TASKS_DIR: tasksDir,
      },
    });
    let buf = "";
    const results = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
    const sendCall = (idx) =>
      send({ jsonrpc: "2.0", id: 2 + idx, method: "tools/call", params: calls[idx] });

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

        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          sendCall(0);
        } else if (typeof msg.id === "number" && msg.id >= 2) {
          results.push(msg.result);
          const next = msg.id - 1;
          if (next < calls.length) {
            sendCall(next);
          } else {
            clearTimeout(timer);
            child.kill();
            resolve(results);
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
        clientInfo: { name: "link-pr-test", version: "0" },
      },
    });
  });
}

test("task link-pr persists the PR URL and the task list renders it as PrRef", async () => {
  const repo = seedRepo(BRANCH);
  const tasksDir = mkdtempSync(join(tmpdir(), "marvin-tasks-"));
  try {
    seedTask(tasksDir);

    const [linkPr, list] = await callSequence(repo, tasksDir, [
      { name: "task", arguments: { action: "link-pr", url: PR_URL } },
      { name: "task", arguments: { action: "list" } },
    ]);

    // link-pr text surface confirms the linked task and URL
    const linkText = linkPr.content.map((c) => c.text).join("\n");
    assert.match(linkText, /Linked PR to \*\*001\*\*/);
    assert.match(linkText, /https:\/\/github\.com\/acme\/widget\/pull\/42/);
    assert.notEqual(linkPr.isError, true);

    // the URL was persisted onto the task frontmatter (stored, not resolved)
    const file = readdirSync(tasksDir).find((f) => f.endsWith(".md"));
    const onDisk = readFileSync(join(tasksDir, file), "utf8");
    assert.match(onDisk, /pr: https:\/\/github\.com\/acme\/widget\/pull\/42/);

    // widget surface: the list payload now carries a populated PrRef
    const card = list.structuredContent.tasks[0];
    assert.equal(card.pr.url, PR_URL);
    assert.equal(card.pr.number, 42, "number derived from the /pull/<n> path");
    assert.equal(card.id, "001");

    // text surface: the list table renders the pr column as a link
    const listText = list.content.map((c) => c.text).join("\n");
    assert.match(listText, /\[#42\]\(https:\/\/github\.com\/acme\/widget\/pull\/42\)/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("task link-pr errors when neither taskId nor the branch resolves a task", async () => {
  const repo = seedRepo("unlinked-branch");
  const tasksDir = mkdtempSync(join(tmpdir(), "marvin-tasks-"));
  try {
    seedTask(tasksDir); // exists, but its branch does not match the repo's

    const [linkPr] = await callSequence(repo, tasksDir, [
      { name: "task", arguments: { action: "link-pr", url: PR_URL } },
    ]);

    assert.equal(linkPr.isError, true);
    const text = linkPr.content.map((c) => c.text).join("\n");
    assert.match(text, /No task is linked to the current branch/);

    // nothing was written
    const onDisk = readFileSync(join(tasksDir, "001--capture-the-pr-url.md"), "utf8");
    assert.doesNotMatch(onDisk, /^pr:/m);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("task link-pr rejects a non-http(s) url", async () => {
  const repo = seedRepo(BRANCH);
  const tasksDir = mkdtempSync(join(tmpdir(), "marvin-tasks-"));
  try {
    seedTask(tasksDir);

    const [linkPr] = await callSequence(repo, tasksDir, [
      { name: "task", arguments: { action: "link-pr", url: "not-a-url" } },
    ]);

    assert.equal(linkPr.isError, true);
    assert.match(linkPr.content.map((c) => c.text).join("\n"), /Not an http\(s\) URL/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(tasksDir, { recursive: true, force: true });
  }
});
