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
