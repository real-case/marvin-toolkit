import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hooks = fileURLToPath(new URL("../../../pipeline/hooks/", import.meta.url));
const { readonlyViolation } = await import(join(hooks, "readonly-guard.mjs"));
const { childGitViolation } = await import(join(hooks, "child-git-guard.mjs"));

test("read-only guard allows reading and probing", () => {
  for (const c of [
    "git diff dev...HEAD --stat",
    "npx vitest run src/a.test.ts",
    "gh pr view 12 --json state",
    "git log --oneline -5 2>&1 | tail -5",
    "cat a.ts > /dev/null",
  ]) {
    assert.equal(readonlyViolation(c), null, c);
  }
});

test("read-only guard denies every write path", () => {
  for (const c of [
    "git commit -m x",
    "git checkout dev",
    "git stash",
    "rm -rf node_modules",
    "npx prettier --write .",
    "npx eslint . --fix",
    "sed -i '' s/a/b/ f.ts",
    "echo x > src/a.ts",
    "npm install lodash",
    "gh api -X POST repos/o/r/issues",
    "gh pr merge 5",
    "npx vitest run -u",
  ]) {
    assert.notEqual(readonlyViolation(c), null, c);
  }
});

test("child git guard keeps children on their branch", () => {
  for (const c of [
    "git switch dev",
    "git checkout dev",
    "git worktree add ../x",
    "git push --force",
    "git push origin dev",
    "git branch -m x",
    "gh pr merge 3",
    "gh pr ready 3",
  ]) {
    assert.notEqual(childGitViolation(c, "dev"), null, c);
  }
  for (const c of [
    "git checkout -- src/a.ts",
    "git push -u origin HEAD",
    "git merge origin/dev",
    "git commit -m 'feat: x'",
  ]) {
    assert.equal(childGitViolation(c, "dev"), null, c);
  }
});

test("the boundary guard denies writes outside the worktree, including the main checkout (S10)", () => {
  const call = (file_path) =>
    spawnSync(process.execPath, [join(hooks, "worktree-boundary-guard.mjs")], {
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path } }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: "/state/worktrees/osint/r1",
      },
      encoding: "utf8",
    }).status;
  assert.equal(call("/state/worktrees/osint/r1/src/a.ts"), 0);
  assert.equal(call("src/a.ts"), 0);
  assert.equal(call("/Users/u/osint-chat-client/src/a.ts"), 2);
  assert.equal(call("/state/worktrees/osint/r1/../r2/src/a.ts"), 2);
  assert.equal(call("/state/worktrees/osint/r10/src/a.ts"), 2);
});

test("heartbeat nudges once the interval has elapsed, then re-arms", () => {
  const run = mkdtempSync(join(tmpdir(), "pipe-"));
  const env = {
    ...process.env,
    MARVIN_PIPELINE_RUN: run,
    MARVIN_PIPELINE_CHILD: "r1-executor-1",
    MARVIN_PIPELINE_ORCH: "Autopilot",
    MARVIN_PIPELINE_HEARTBEAT_S: "300",
  };
  const fire = () =>
    spawnSync(process.execPath, [join(hooks, "heartbeat.mjs")], {
      input: "{}",
      env,
      encoding: "utf8",
    }).stdout;
  assert.equal(fire(), "");
  writeFileSync(join(run, "r1-executor-1.heartbeat"), String(Date.now() - 301_000));
  assert.match(
    JSON.parse(fire()).hookSpecificOutput.additionalContext,
    /SendMessage to "Autopilot"/,
  );
  assert.equal(fire(), "");
});

test("message log records the report and resets the timer", () => {
  const run = mkdtempSync(join(tmpdir(), "pipe-"));
  const env = {
    ...process.env,
    MARVIN_PIPELINE_RUN: run,
    MARVIN_PIPELINE_CHILD: "r1-executor-1",
  };
  const payload = JSON.stringify({
    tool_name: "SendMessage",
    tool_input: { to: "Autopilot", message: "[r1-executor-1] done: AC1" },
  });
  spawnSync(process.execPath, [join(hooks, "message-log.mjs")], {
    input: payload,
    env,
    encoding: "utf8",
  });
  const event = JSON.parse(readFileSync(join(run, "events.jsonl"), "utf8").trim());
  assert.equal(event.kind, "report");
  assert.equal(event.text, "[r1-executor-1] done: AC1");
  assert.ok(
    Date.now() - Number(readFileSync(join(run, "r1-executor-1.heartbeat"), "utf8")) < 5_000,
  );
});
