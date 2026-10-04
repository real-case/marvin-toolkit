import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

const { buildRoleSettings } = await importTs("src/pipeline/settings.ts");
const commands = (s, event) =>
  s.hooks[event].flatMap((m) => m.hooks.map((h) => h.command)).join("\n");

test("every role gets heartbeat, message log and the child guards", () => {
  for (const role of ["planner", "test-author", "executor", "verifier", "retro"]) {
    const s = buildRoleSettings(role, "/h");
    assert.match(commands(s, "PostToolUse"), /\/h\/heartbeat\.mjs/);
    assert.match(commands(s, "PostToolUse"), /\/h\/message-log\.mjs/);
    assert.match(commands(s, "PreToolUse"), /\/h\/child-git-guard\.mjs/);
    assert.match(commands(s, "PreToolUse"), /\/h\/child-mcp-guard\.mjs/);
    assert.equal(s.outputStyle, "default");
  }
});

test("role-specific guards go only where they belong", () => {
  const pre = (role) => commands(buildRoleSettings(role, "/h"), "PreToolUse");
  assert.match(pre("verifier"), /readonly-guard/);
  assert.match(pre("retro"), /readonly-guard/);
  assert.doesNotMatch(pre("executor"), /readonly-guard/);
  assert.match(pre("executor"), /sealed-guard/);
  assert.match(pre("test-author"), /test-path-guard/);
  assert.doesNotMatch(pre("planner"), /sealed-guard|test-path-guard/);
  for (const role of ["planner", "test-author", "executor"])
    assert.match(pre(role), /worktree-boundary-guard/);
});

test("the MCP guard covers every marvin tool a child could misuse", () => {
  const s = buildRoleSettings("executor", "/h");
  const entry = s.hooks.PreToolUse.find((m) =>
    m.hooks.some((h) => /child-mcp-guard\.mjs/.test(h.command)),
  );
  assert.equal(entry.matcher, "mcp__.*marvin.*__(task|tracker|spec|adr|lessons|verify|report)$");
  const matcher = new RegExp(entry.matcher);
  for (const tool of ["task", "tracker", "spec", "adr", "lessons", "verify", "report"]) {
    assert.ok(matcher.test(`mcp__plugin_marvin_marvin__${tool}`), tool);
    assert.ok(matcher.test(`mcp__marvin__${tool}`), tool);
  }
  for (const tool of ["task-detail", "dashboard", "help", "summary"]) {
    assert.ok(!matcher.test(`mcp__plugin_marvin_marvin__${tool}`), tool);
  }
});
