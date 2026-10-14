import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const taskVerify = read("plugins/marvin/skills/task-verify/SKILL.md");
const secGate = read("plugins/marvin/skills/sec-gate/SKILL.md");
const config = read("docs/configuration.md");
const changelog = read("plugins/marvin/CHANGELOG.md");

const start = config.indexOf("### Scanners as gates");
const rest = config.slice(start + 1);
const next = rest.search(/\n##+ /);
const scanners = config.slice(start, next === -1 ? undefined : start + 1 + next);

test("skills recommend gates.extra for scanners", () => {
  for (const doc of [taskVerify, secGate]) {
    assert.ok(doc.includes("gates.extra"));
    assert.ok(doc.includes("not-run"));
  }
  assert.ok(taskVerify.includes('"command": "gitleaks detect"'));
});

test("outdated chaining advice is gone", () => {
  const banned = [
    "stripped silently",
    "is chained onto",
    "means chaining it onto",
    "chained onto an existing gate",
    "does fail when its binary is missing",
  ];
  for (const doc of [taskVerify, secGate, scanners]) {
    for (const phrase of banned) assert.ok(!doc.includes(phrase), phrase);
  }
});

test("configuration scanner section uses gates.extra", () => {
  assert.ok(start >= 0);
  assert.ok(scanners.includes("gates.extra") || scanners.includes("#gatesextra"));
  for (const needle of ['"extra"', '"command": "gitleaks detect"', "not-run", "its own"]) {
    assert.ok(scanners.includes(needle), needle);
  }
});

test("a surviving chain is marked as the pre-0.29.0 route", () => {
  for (const doc of [taskVerify, secGate, scanners]) {
    for (const block of doc.split(/\n\s*\n/)) {
      if (block.includes("&& gitleaks")) assert.ok(block.includes("0.29.0"), block);
    }
  }
});

test("changelog records the advice change", () => {
  const m = changelog.match(/^## \[([^\]]+)\][^\n]*\n([\s\S]*?)(?=^## \[|$(?![\s\S]))/m);
  assert.ok(m);
  assert.equal(m[1], "0.29.5");
  assert.ok(m[2].includes("gates.extra"));
});
