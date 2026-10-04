import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

const cmd = await importTs("src/pipeline/command.ts");
const base = {
  name: "r1-executor-1",
  cwd: "/wt",
  runDir: "/state/r1",
  orchestratorName: "Autopilot",
  base: "dev",
  assignment: { model: "sonnet", effort: "high" },
  prompt: "TASK CONTEXT…",
  settingsPath: "/state/r1/executor.settings.json",
  systemPromptPath: "/state/r1/executor.system.md",
  schema: "{}",
};
const after = (argv, flag) => argv[argv.indexOf(flag) + 1];

const writing = cmd.writingAllowedTools(["git", "npm run", "npx"]);

test("executor runs headless in acceptEdits with an explicit allowlist and prompts auto-denied", () => {
  const { argv, env, cwd } = cmd.buildChildCommand({
    ...base,
    role: "executor",
    allowedTools: writing,
  });
  assert.deepEqual(argv.slice(0, 3), ["claude", "-p", "TASK CONTEXT…"]);
  assert.equal(after(argv, "-n"), "r1-executor-1");
  assert.equal(after(argv, "--model"), "sonnet");
  assert.equal(after(argv, "--effort"), "high");
  assert.equal(after(argv, "--permission-mode"), "acceptEdits");
  assert.equal(after(argv, "--permission-prompts"), "none");
  assert.ok(argv.includes("mcp__plugin_marvin_marvin"));
  assert.ok(argv.includes("Bash(npm run:*)"));
  assert.equal(env.MARVIN_PIPELINE_ROLE, "executor");
  assert.equal(env.MARVIN_PIPELINE_BASE, "dev");
  assert.equal(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, "1");
  assert.equal(env.BASH_DEFAULT_TIMEOUT_MS, "600000");
  assert.equal(env.HUSKY, "0");
  assert.equal(env.CI, undefined);
  assert.equal(cwd, "/wt");
});

test("every role needs an explicit allowlist; auto mode is never used", () => {
  for (const role of ["planner", "test-author", "executor"]) {
    assert.throws(() => cmd.buildChildCommand({ ...base, role }), /allowedTools/);
    assert.ok(
      !cmd.buildChildCommand({ ...base, role, allowedTools: writing }).argv.includes("auto"),
    );
  }
});

test("a plugin dir is passed only when configured", () => {
  assert.ok(
    !cmd
      .buildChildCommand({ ...base, role: "executor", allowedTools: writing })
      .argv.includes("--plugin-dir"),
  );
  const { argv } = cmd.buildChildCommand({
    ...base,
    role: "executor",
    allowedTools: writing,
    pluginDir: "/m/plugins/marvin",
  });
  assert.equal(after(argv, "--plugin-dir"), "/m/plugins/marvin");
});

test("verifier is allowlist-only, edit tools denied, CI mode on", () => {
  const allowed = cmd.readOnlyAllowedTools(["npx vitest run"]);
  const { argv, env } = cmd.buildChildCommand({ ...base, role: "verifier", allowedTools: allowed });
  assert.equal(after(argv, "--permission-mode"), "dontAsk");
  assert.ok(argv.includes("Bash(npx vitest run:*)"));
  assert.ok(!argv.some((a) => a.startsWith("Bash(npm run")));
  const d = argv.indexOf("--disallowedTools");
  assert.deepEqual(argv.slice(d + 1, d + 4), ["Edit", "Write", "NotebookEdit"]);
  assert.equal(env.CI, "true");
});

test("read-only roles without an allowlist are refused", () => {
  for (const role of ["verifier", "retro"])
    assert.throws(() => cmd.buildChildCommand({ ...base, role }), /allowedTools/);
});

test("the test-author learns which paths it may write", () => {
  const { env } = cmd.buildChildCommand({
    ...base,
    role: "test-author",
    allowedTools: writing,
    testPathPattern: "\\.test\\.tsx?$",
  });
  assert.equal(env.MARVIN_PIPELINE_TEST_PATTERN, "\\.test\\.tsx?$");
});

test("resume carries the session id", () => {
  assert.equal(
    after(
      cmd.buildChildCommand({
        ...base,
        role: "planner",
        allowedTools: writing,
        resumeSessionId: "c354963a",
      }).argv,
      "--resume",
    ),
    "c354963a",
  );
});

test("no command ever bypasses permissions", () => {
  for (const role of ["planner", "executor", "test-author"]) {
    assert.ok(
      !cmd
        .buildChildCommand({ ...base, role, allowedTools: writing })
        .argv.some((a) => /bypass|dangerously/i.test(a)),
    );
  }
});

test("Fable is refused for every role", () => {
  for (const model of ["fable", "claude-fable-5-1", "Fable"]) {
    assert.throws(
      () =>
        cmd.buildChildCommand({ ...base, role: "executor", assignment: { model, effort: "high" } }),
      /Fable is not allowed/,
    );
  }
});
