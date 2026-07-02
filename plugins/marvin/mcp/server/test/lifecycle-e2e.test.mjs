import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * End-to-end lifecycle sweep (WP5, finding 10): drive the full task chain —
 * create → start → move → review → link-pr → done → archive → list — through
 * the live server over stdio, exactly as an MCP host would, and assert both
 * the tool answers and the on-disk board state after every hop. The chain
 * runs argument-complete on a host WITHOUT elicitation support, proving the
 * WP3 input contract holds through the whole lifecycle; the interactive
 * confirmation paths (bulk archive) run separately on a capable host.
 */

/**
 * Drive the live server over stdio: run the given tools/call requests in
 * order. Options mirror input-contract.test.mjs:
 *   - elicitation: declare the client capability (default true).
 *   - accept: content used to answer every elicitation/create (cancel if null).
 * Resolves to { results, elicitations }.
 */
function drive(env, calls, { elicitation = true, accept = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let buf = "";
    const results = [];
    let elicitations = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 30000);
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

        if (msg.method === "elicitation/create" && msg.id != null) {
          elicitations += 1;
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: accept ? { action: "accept", content: accept } : { action: "cancel" },
          });
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
            resolve({ results, elicitations });
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
        capabilities: elicitation ? { elicitation: {} } : {},
        clientInfo: { name: "lifecycle-e2e-test", version: "0" },
      },
    });
  });
}

const textOf = (result) => result.content.map((c) => c.text).join("\n");

/**
 * Init a git repo on a `dev` branch with one commit, so the `start` action's
 * createBranchFromBase (checkout dev → checkout -b <task branch>) has a real
 * base to branch from. Identity and signing are pinned per-invocation so the
 * test never depends on host git config.
 */
function seedRepo() {
  const repo = mkdtempSync(join(tmpdir(), "marvin-lifecycle-repo-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q");
  git("checkout", "-q", "-b", "dev");
  git(
    "-c",
    "user.name=marvin-test",
    "-c",
    "user.email=test@marvin.local",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  return repo;
}

function seedTask(tasksDir, { id, status, title = `Seeded task ${id}` }) {
  mkdirSync(tasksDir, { recursive: true });
  const md = [
    "---",
    `id: "${id}"`,
    "type: bug",
    `status: ${status}`,
    `title: ${title}`,
    `branch: fix/${id}--seeded-task`,
    'created: "2026-06-20T10:00:00.000Z"',
    'updated: "2026-06-20T10:00:00.000Z"',
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
  writeFileSync(join(tasksDir, `${id}--seeded-task.md`), md);
}

const mdFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith(".md"));

test("full lifecycle: create → start → move → review → link-pr → done → archive → list, argument-complete with zero elicitations", async () => {
  const repo = seedRepo();
  const tasksDir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-tasks-"));
  const env = { CLAUDE_PROJECT_DIR: repo, MARVIN_TASKS_DIR: tasksDir };
  const taskFile = "001--login-timeout-on-retry.md";
  const branch = "fix/001--login-timeout-on-retry";
  const prUrl = "https://github.com/acme/widget/pull/7";
  const statusOnDisk = (dir = tasksDir) =>
    readFileSync(join(dir, taskFile), "utf8").match(/^status: (.*)$/m)[1];
  try {
    // The chain runs in three server sessions with on-disk assertions between
    // them — board state must survive restarts, it lives in the files alone.
    const a = await drive(
      env,
      [
        {
          name: "task",
          arguments: { action: "create", type: "bug", title: "Login timeout on retry" },
        },
        { name: "task", arguments: { action: "start", taskId: "001" } },
      ],
      { elicitation: false },
    );

    assert.equal(a.elicitations, 0);
    const [create, start] = a.results;
    // create: task file lands with an ADR-0019 branch name; start: the task
    // branch is created from dev and checked out, status → wip
    assert.match(textOf(create), /Created task \*\*001\*\*/);
    assert.match(textOf(start), /Started \*\*001\*\*/);
    assert.match(textOf(start), new RegExp(`Branch: \`fix/001--login-timeout-on-retry\``));
    assert.deepEqual(mdFiles(tasksDir), [taskFile]);
    assert.equal(statusOnDisk(), "wip");
    const onBranch = execFileSync("git", ["branch", "--show-current"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    assert.equal(onBranch, branch, "start checked out the task branch");

    const b = await drive(
      env,
      [
        { name: "task", arguments: { action: "move", taskId: "001", status: "blocked" } },
        { name: "task", arguments: { action: "move", taskId: "001", status: "wip" } },
        { name: "task", arguments: { action: "review" } },
        { name: "task", arguments: { action: "link-pr", url: prUrl } },
        { name: "task", arguments: { action: "done" } },
      ],
      { elicitation: false },
    );

    assert.equal(b.elicitations, 0);
    for (const [i, r] of b.results.entries()) {
      assert.notEqual(r.isError, true, `step ${i} failed`);
    }
    const [moveOut, moveBack, review, linkPr, done] = b.results;
    // move: the generic transition reaches blocked and back (reverse moves work);
    // review / link-pr / done resolve the task from the current branch — no taskId
    assert.match(textOf(moveOut), /`wip` → `blocked`/);
    assert.match(textOf(moveBack), /`blocked` → `wip`/);
    assert.match(textOf(review), /Moved \*\*001\*\* to \*\*review\*\*/);
    assert.match(textOf(linkPr), /Linked PR to \*\*001\*\*/);
    assert.match(textOf(done), /Marked \*\*001\*\* as \*\*done\*\*/);
    assert.equal(statusOnDisk(), "done");
    assert.match(readFileSync(join(tasksDir, taskFile), "utf8"), /pr: https:/);

    const c = await drive(
      env,
      [
        { name: "task", arguments: { action: "archive", taskId: "001" } },
        { name: "task", arguments: { action: "list" } },
      ],
      { elicitation: false },
    );

    assert.equal(c.elicitations, 0);
    const [archive, list] = c.results;
    // archive: the file leaves the board directory for archive/, content intact
    assert.match(textOf(archive), /Archived \*\*001\*\*/);
    assert.deepEqual(mdFiles(tasksDir), [], "board directory is empty");
    assert.deepEqual(mdFiles(join(tasksDir, "archive")), [taskFile]);
    assert.equal(statusOnDisk(join(tasksDir, "archive")), "done");
    const archived = readFileSync(join(tasksDir, "archive", taskFile), "utf8");
    assert.match(archived, new RegExp(`pr: ${prUrl}`), "linked PR survives archival");

    // list: archived tasks are off the board and out of the payload; footer counts them
    const listText = textOf(list);
    assert.match(listText, /# Tasks \(0\)/);
    assert.match(listText, /_No tasks yet/);
    assert.match(listText, /1 archived task\(s\) in `archive\/`/);
    assert.equal(list.structuredContent.tasks.length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("bulk archive asks for confirmation and moves only done-role tasks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "done" });
    seedTask(tasksDir, { id: "002", status: "wip" });
    seedTask(tasksDir, { id: "003", status: "done" });

    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [
        { name: "task", arguments: { action: "archive" } },
        { name: "task", arguments: { action: "list" } },
      ],
      { accept: { archive: "yes" } },
    );

    assert.equal(elicitations, 1, "one confirmation form");
    assert.match(textOf(results[0]), /Archived 2 task\(s\)/);
    assert.match(textOf(results[0]), /003, 001/, "both done tasks named");
    assert.deepEqual(mdFiles(tasksDir), ["002--seeded-task.md"], "wip task stays");
    assert.deepEqual(mdFiles(join(tasksDir, "archive")).sort(), [
      "001--seeded-task.md",
      "003--seeded-task.md",
    ]);
    const listText = textOf(results[1]);
    assert.match(listText, /# Tasks \(1\)/);
    assert.match(listText, /2 archived task\(s\) in `archive\/`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bulk archive declined leaves the board untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "done" });

    const { results } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "archive" } }],
      { accept: { archive: "no" } },
    );

    assert.match(textOf(results[0]), /Cancelled — no changes made/);
    assert.deepEqual(mdFiles(tasksDir), ["001--seeded-task.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bulk archive with confirm:true runs formless on a host without elicitation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "done" });

    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "archive", confirm: true } }],
      { elicitation: false },
    );

    assert.equal(elicitations, 0);
    assert.match(textOf(results[0]), /Archived 1 task\(s\)/);
    assert.deepEqual(mdFiles(join(tasksDir, "archive")), ["001--seeded-task.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bulk archive without confirm on a host without elicitation names the arguments to pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "done" });

    const { results } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "archive" } }],
      { elicitation: false },
    );

    assert.equal(results[0].isError, true);
    const text = textOf(results[0]);
    assert.match(text, /does not support interactive forms/);
    assert.match(text, /`taskId`/);
    assert.match(text, /`confirm: true`/);
    assert.deepEqual(mdFiles(tasksDir), ["001--seeded-task.md"], "nothing moved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive of a non-done task is refused with the role-check error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "wip" });

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "archive", taskId: "001" } },
    ]);

    assert.equal(results[0].isError, true);
    assert.match(textOf(results[0]), /status "wip".*done-role status \(done\)/);
    assert.deepEqual(mdFiles(tasksDir), ["001--seeded-task.md"], "nothing moved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive with nothing to archive answers honestly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "todo" });

    const { results, elicitations } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "archive" } },
    ]);

    assert.equal(elicitations, 0, "no confirmation for an empty candidate set");
    assert.notEqual(results[0].isError, true);
    assert.match(textOf(results[0]), /nothing to archive/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archived and malformed ids stay reserved; list keeps working around both", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    // 001 was archived in some earlier session; 002 has broken frontmatter.
    const archive = join(tasksDir, "archive");
    seedTask(tasksDir, { id: "001", status: "done" });
    mkdirSync(archive, { recursive: true });
    renameSync(join(tasksDir, "001--seeded-task.md"), join(archive, "001--seeded-task.md"));
    writeFileSync(
      join(tasksDir, "002--broken.md"),
      ["---", 'id: "002"', "type: bug", "status: todo", "---", "", "Broken.", ""].join("\n"),
    );

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "create", type: "chore", title: "After the archive" } },
      { name: "task", arguments: { action: "list" } },
    ]);

    assert.match(
      textOf(results[0]),
      /Created task \*\*003\*\*/,
      "001 (archived) and 002 (malformed) are both reserved",
    );
    const listText = textOf(results[1]);
    assert.match(listText, /# Tasks \(1\)/, "archive dir and malformed file are off the board");
    assert.match(listText, /⚠ 1 malformed file\(s\): 002--broken\.md/);
    assert.match(listText, /1 archived task\(s\) in `archive\/`/);
    assert.equal(results[1].structuredContent.tasks.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config round-trip mid-session: read defaults, update, the next lifecycle call sees it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-lifecycle-"));
  const template = "https://tracker.local/browse/{tracker_id}";
  try {
    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [
        { name: "task", arguments: { action: "config" } },
        { name: "task", arguments: { action: "config", tracker_url_template: template } },
        { name: "task", arguments: { action: "config" } },
        {
          name: "task",
          arguments: { action: "create", type: "bug", title: "Tracked task", tracker_id: "OSI-9" },
        },
        { name: "task", arguments: { action: "list" } },
      ],
      { elicitation: false },
    );

    assert.equal(elicitations, 0, "read → update → lifecycle, all argument-complete");
    for (const [i, r] of results.entries()) {
      assert.notEqual(r.isError, true, `step ${i} failed`);
    }
    const [before, update, after, , list] = results;

    // read: defaults, no file; update: the first edit creates the file
    assert.match(textOf(before), /\*\*tracker_url_template:\*\* _not set_/);
    assert.match(textOf(update), /config\.json/);
    assert.equal(
      JSON.parse(readFileSync(join(dir, ".marvin", "config.json"), "utf8")).tracker_url_template,
      template,
    );

    // read-back and the lifecycle surface both see the update in the SAME
    // session — config is loaded per call, not snapshotted at startup
    assert.match(textOf(after), new RegExp(`\\*\\*tracker_url_template:\\*\\* \`${template}\``));
    const card = list.structuredContent.tasks[0];
    assert.equal(card.tracker_id, "OSI-9");
    assert.equal(card.tracker_url, "https://tracker.local/browse/OSI-9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
