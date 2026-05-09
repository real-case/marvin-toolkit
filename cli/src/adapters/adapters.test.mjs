// Tests for the adapter contract and registry. Run via:
//   node --test cli/src/adapters/adapters.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import claudeAdapter from "./claude.mjs";
import { getAdapter, listTargets, DEFAULT_TARGET } from "./index.mjs";

const REQUIRED_METHODS = ["unsupported", "pathFor", "render", "manifestPath", "manifestSchema"];

test("registry: exposes claude adapter under DEFAULT_TARGET", () => {
  assert.equal(DEFAULT_TARGET, "claude");
  assert.equal(getAdapter("claude"), claudeAdapter);
  assert.ok(listTargets().includes("claude"));
});

test("registry: throws EUNKNOWNTARGET for unregistered name", () => {
  assert.throws(
    () => getAdapter("bogus-target"),
    (err) => err.code === "EUNKNOWNTARGET" && /Available: claude/.test(err.message),
  );
});

test("claudeAdapter: implements the full contract surface", () => {
  for (const m of REQUIRED_METHODS) {
    assert.ok(typeof claudeAdapter[m] === "function", `claudeAdapter.${m} must be a function`);
  }
  assert.equal(claudeAdapter.name, "claude");
});

test("claudeAdapter.pathFor: resolves all artifact kinds correctly", () => {
  const skill = { kind: "skill", name: "mn.commit" };
  const cmd = { kind: "command", name: "mn.pr" };
  const agent = { kind: "agent", name: "onboarding" };
  assert.equal(claudeAdapter.pathFor(skill, "SKILL.md"), ".claude/skills/mn.commit/SKILL.md");
  assert.equal(claudeAdapter.pathFor(skill, "scripts/foo.sh"), ".claude/skills/mn.commit/scripts/foo.sh");
  assert.equal(claudeAdapter.pathFor(cmd, "ignored"), ".claude/commands/mn.pr.md");
  assert.equal(claudeAdapter.pathFor(agent, "ignored"), ".claude/agents/onboarding.md");
});

test("claudeAdapter.pathFor: throws on unknown kind", () => {
  assert.throws(() => claudeAdapter.pathFor({ kind: "bogus", name: "x" }, "y"));
});

test("claudeAdapter.unsupported: claude supports all kinds", () => {
  for (const kind of ["skill", "command", "agent"]) {
    assert.equal(claudeAdapter.unsupported({ kind, name: "x" }), null);
  }
});

test("claudeAdapter.render: injects header into markdown content", () => {
  const src = "---\nname: test\n---\n\nbody\n";
  const out = claudeAdapter.render({ kind: "skill", name: "mn.demo" }, src, {
    isMarkdown: true, packName: "marvin-core-pack", packVersion: "0.1.0", today: "2026-01-01",
  });
  assert.match(out, /<!-- marvin-eject: source=marvin-core-pack@0\.1\.0 ejected-at=2026-01-01 -->/);
});

test("claudeAdapter.render: passes through non-markdown content unchanged", () => {
  const src = "#!/bin/bash\necho hello\n";
  const out = claudeAdapter.render({ kind: "skill", name: "mn.demo" }, src, {
    isMarkdown: false, packName: "marvin-core-pack", packVersion: "0.1.0", today: "2026-01-01",
  });
  assert.equal(out, src);
});

test("claudeAdapter.manifestPath returns Claude location", () => {
  assert.equal(claudeAdapter.manifestPath(), ".claude/.marvin-eject.json");
});

test("claudeAdapter.manifestSchema is JSON Schema-shaped", () => {
  const schema = claudeAdapter.manifestSchema();
  assert.ok(schema.$schema);
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.ejected);
});

test("claudeAdapter.postWrite is a no-op (does not throw)", async () => {
  await claudeAdapter.postWrite?.({}, "/tmp/whatever");
});
