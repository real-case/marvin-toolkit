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
  pluginDir: "/m/plugins/marvin",
  branch: "feature/OSI-1--x",
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

const readOnly = cmd.readOnlyAllowedTools(["npx vitest run"]);
const ROLE_TOOLS = {
  planner: writing,
  "test-author": writing,
  executor: writing,
  verifier: readOnly,
  retro: readOnly,
};

test("every role is isolated from user/local settings and foreign MCP servers", () => {
  for (const [role, allowedTools] of Object.entries(ROLE_TOOLS)) {
    const { argv } = cmd.buildChildCommand({ ...base, role, allowedTools });
    assert.equal(after(argv, "--setting-sources"), "project", role);
    assert.ok(argv.includes("--strict-mcp-config"), role);
    assert.equal(after(argv, "--plugin-dir"), "/m/plugins/marvin", role);
  }
});

test("the plugin dir is required, non-empty and absolute", () => {
  for (const pluginDir of [undefined, "", "plugins/marvin"]) {
    assert.throws(
      () => cmd.buildChildCommand({ ...base, role: "executor", allowedTools: writing, pluginDir }),
      /pluginDir/,
      String(pluginDir),
    );
  }
});

test("read-only roles disallow every edit tool and git push", () => {
  for (const role of ["verifier", "retro"]) {
    const { argv } = cmd.buildChildCommand({ ...base, role, allowedTools: readOnly });
    const d = argv.indexOf("--disallowedTools");
    assert.deepEqual(argv.slice(d + 1, d + 6), [
      "Edit",
      "Write",
      "NotebookEdit",
      "MultiEdit",
      "Bash(git push:*)",
    ]);
  }
});

test("children learn the run branch, or an empty one before it exists", () => {
  for (const [role, allowedTools] of Object.entries(ROLE_TOOLS)) {
    assert.equal(
      cmd.buildChildCommand({ ...base, role, allowedTools }).env.MARVIN_PIPELINE_BRANCH,
      "feature/OSI-1--x",
    );
    assert.equal(
      cmd.buildChildCommand({ ...base, role, allowedTools, branch: null }).env
        .MARVIN_PIPELINE_BRANCH,
      "",
    );
  }
});

test("verifier is allowlist-only, edit tools denied, CI mode on", () => {
  const allowed = cmd.readOnlyAllowedTools(["npx vitest run"]);
  const { argv, env } = cmd.buildChildCommand({ ...base, role: "verifier", allowedTools: allowed });
  assert.equal(after(argv, "--permission-mode"), "dontAsk");
  assert.ok(argv.includes("Bash(npx vitest run:*)"));
  assert.ok(!argv.some((a) => a.startsWith("Bash(npm run")));
  const d = argv.indexOf("--disallowedTools");
  assert.deepEqual(argv.slice(d + 1, d + 4), ["Edit", "Write", "NotebookEdit"]);
  assert.ok(argv.includes("MultiEdit"));
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
        cmd.buildChildCommand({
          ...base,
          role: "executor",
          assignment: { model, effort: "high" },
          allowedTools: writing,
        }),
      /Fable is not allowed/,
    );
  }
});

test("F1: prefix validation rejects syntax characters and accepts valid prefixes", () => {
  for (const char of ["(", ")", ",", "*", "\n"]) {
    assert.throws(() => cmd.writingAllowedTools([`npm${char}run`]), /invalid allowlist prefix/);
    assert.throws(() => cmd.readOnlyAllowedTools([`git${char}diff`]), /invalid allowlist prefix/);
  }
  assert.throws(() => cmd.writingAllowedTools(["  npm run  "]), /invalid allowlist prefix/);
  assert.throws(() => cmd.writingAllowedTools([""]), /invalid allowlist prefix/);
  // Valid prefixes with colon accepted
  const w = cmd.writingAllowedTools(["npm run test:run"]);
  assert.ok(w.includes("Bash(npm run test:run:*)"));
  const r = cmd.readOnlyAllowedTools(["git status"]);
  assert.ok(r.includes("Bash(git status:*)"));
});

test("F2: model allowlist rejects aliases and non-standard models", () => {
  for (const model of ["default", "best", "gpt-5"]) {
    assert.throws(
      () =>
        cmd.buildChildCommand({
          ...base,
          role: "executor",
          assignment: { model, effort: "high" },
          allowedTools: writing,
        }),
      /model not allowed/,
    );
  }
  // Fable still rejected with its own message
  assert.throws(
    () =>
      cmd.buildChildCommand({
        ...base,
        role: "executor",
        assignment: { model: "claude-fable-5-1", effort: "high" },
        allowedTools: writing,
      }),
    /Fable is not allowed/,
  );
  // Standard models accepted
  for (const model of [
    "opus",
    "sonnet",
    "haiku",
    "claude-sonnet-5-5",
    "claude-opus-4-1-20250701",
  ]) {
    const { argv } = cmd.buildChildCommand({
      ...base,
      role: "executor",
      assignment: { model, effort: "high" },
      allowedTools: writing,
    });
    assert.equal(after(argv, "--model"), model);
  }
});

test("F3: role validation and read-only allowlist enforcement", () => {
  // Unknown role throws
  assert.throws(
    () => cmd.buildChildCommand({ ...base, role: "unknown_role", allowedTools: writing }),
    /unknown role/,
  );
  // Read-only role cannot have write tools
  const writingTools = cmd.writingAllowedTools(["git", "npm run"]);
  assert.throws(
    () => cmd.buildChildCommand({ ...base, role: "verifier", allowedTools: writingTools }),
    /read-only role.*cannot be granted.*mcp__plugin_marvin_marvin/,
  );
  // Read-only role cannot have Edit/Write/NotebookEdit/MultiEdit
  for (const tool of ["Edit", "Write", "NotebookEdit", "MultiEdit"]) {
    assert.throws(
      () =>
        cmd.buildChildCommand({
          ...base,
          role: "verifier",
          allowedTools: [...cmd.READ_BASE_TOOLS, tool],
        }),
      new RegExp(`read-only role.*cannot be granted.*${tool}`),
    );
  }
});

test("modelFamily names the family of an alias or a full model id", () => {
  for (const [model, family] of [
    ["opus", "opus"],
    ["sonnet", "sonnet"],
    ["haiku", "haiku"],
    ["claude-opus-5-5", "opus"],
    ["claude-sonnet-5-5", "sonnet"],
    ["claude-haiku-4-5", "haiku"],
    ["claude-opus-4-1-20250701", "opus"],
  ]) {
    assert.equal(cmd.modelFamily(model), family, model);
  }
});

test("modelFamily refuses Fable first, in any case, then anything outside the allowlist", () => {
  for (const model of ["fable", "claude-fable-5-1", "Fable", "FABLE", "claude-opus-fable-1"]) {
    assert.throws(
      () => cmd.modelFamily(model),
      new RegExp(`^Error: Fable is not allowed \\(user rule\\): ${model}$`),
      model,
    );
  }
  for (const model of ["default", "best", "gpt-5", "gpt-x", "claude-opus", "Opus", "opus ", ""]) {
    assert.throws(() => cmd.modelFamily(model), /model not allowed: /, JSON.stringify(model));
  }
});
