import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { importTs } from "./_tsload.mjs";

const { buildRoleSettings: build } = await importTs("src/pipeline/settings.ts");

const base = mkdtempSync(join(tmpdir(), "pipe-settings-"));
after(() => rmSync(base, { recursive: true, force: true }));
const H = join(realpathSync(base), "h");
mkdirSync(H);
const buildRoleSettings = (role, hooksDir = H) => build(role, hooksDir);
const commands = (s, event) =>
  s.hooks[event].flatMap((m) => m.hooks.map((h) => h.command)).join("\n");

test("every role gets heartbeat, message log and the child guards", () => {
  for (const role of ["planner", "test-author", "executor", "verifier", "retro"]) {
    const s = buildRoleSettings(role);
    assert.match(commands(s, "PostToolUse"), /heartbeat\.mjs/);
    assert.match(commands(s, "PostToolUse"), /message-log\.mjs/);
    assert.match(commands(s, "PreToolUse"), /child-git-guard\.mjs/);
    assert.match(commands(s, "PreToolUse"), /child-mcp-guard\.mjs/);
    assert.equal(s.outputStyle, "default");
  }
});

test("role-specific guards go only where they belong", () => {
  const pre = (role) => commands(buildRoleSettings(role), "PreToolUse");
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
  const s = buildRoleSettings("executor");
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

test("hook commands name the real hooks directory, never a symlinked spelling of it", () => {
  const link = join(base, "hooks-link");
  symlinkSync(H, link);
  for (const role of ["planner", "test-author", "executor", "verifier", "retro"]) {
    const s = buildRoleSettings(role, link);
    const all = [...s.hooks.PreToolUse, ...s.hooks.PostToolUse].flatMap((m) =>
      m.hooks.map((h) => h.command),
    );
    assert.ok(all.length > 0);
    for (const command of all) {
      assert.ok(command.startsWith(`node "${H}/`) && command.endsWith('.mjs"'), command);
      assert.ok(!command.includes("hooks-link"), command);
    }
  }
});

test("a hooks directory that does not exist is an error, not a settings file full of dead paths", () => {
  assert.throws(() => buildRoleSettings("executor", join(base, "nope")), /ENOENT/);
});
