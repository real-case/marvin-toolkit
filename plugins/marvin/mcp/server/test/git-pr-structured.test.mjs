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

/**
 * A fake `gh` on PATH: `--version` succeeds (so `hasGh()` passes) and any other
 * invocation (i.e. `pr create …`) prints the PR URL on stdout and exits 0 — the
 * same shape the real CLI emits, without a network or a real GitHub repo.
 */
function fakeGhBin() {
  const binDir = mkdtempSync(join(tmpdir(), "marvin-bin-"));
  const gh = join(binDir, "gh");
  writeFileSync(
    gh,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "gh version 0.0.0"; exit 0; fi',
      `echo "${PR_URL}"`,
      "exit 0",
      "",
    ].join("\n"),
  );
  execFileSync("chmod", ["755", gh]);
  return binDir;
}

/** Init a git repo whose current branch matches the seeded task's branch. */
function seedRepo() {
  const repo = mkdtempSync(join(tmpdir(), "marvin-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  // An unborn branch is enough: `git branch --show-current` reports it, and the
  // fake gh needs no commits. Avoids requiring a git identity in CI.
  execFileSync("git", ["checkout", "-q", "-b", BRANCH], { cwd: repo });
  return repo;
}

/** Drive the live server: create-pr (captures the URL), then list (renders it). */
function createPrThenList(repo, tasksDir, binDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        CLAUDE_PROJECT_DIR: repo,
        MARVIN_TASKS_DIR: tasksDir,
      },
    });
    let buf = "";
    const out = {};
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

        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "git", arguments: { action: "create-pr" } },
          });
        } else if (msg.id === 2) {
          out.createPr = msg.result;
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "task", arguments: { action: "list" } },
          });
        } else if (msg.id === 3) {
          out.list = msg.result;
          clearTimeout(timer);
          child.kill();
          resolve(out);
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
        clientInfo: { name: "git-pr-test", version: "0" },
      },
    });
  });
}

test("git create-pr captures the PR URL and the task list renders it as PrRef", async () => {
  const repo = seedRepo();
  const tasksDir = mkdtempSync(join(tmpdir(), "marvin-tasks-"));
  const binDir = fakeGhBin();
  try {
    seedTask(tasksDir);

    const { createPr, list } = await createPrThenList(repo, tasksDir, binDir);

    // create-pr text surface confirms the captured URL
    const createText = createPr.content.map((c) => c.text).join("\n");
    assert.match(createText, /PR created: https:\/\/github\.com\/acme\/widget\/pull\/42/);

    // the URL was persisted onto the task frontmatter (stored, not resolved)
    const file = readdirSync(tasksDir).find((f) => f.endsWith(".md"));
    const onDisk = readFileSync(join(tasksDir, file), "utf8");
    assert.match(onDisk, /pr: https:\/\/github\.com\/acme\/widget\/pull\/42/);

    // widget surface: the list payload now carries a populated PrRef
    const card = list.structuredContent.tasks[0];
    assert.equal(card.pr.url, PR_URL);
    assert.equal(card.pr.number, 42, "number derived from the /pull/<n> path");
    assert.equal(card.id, "001");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(tasksDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
