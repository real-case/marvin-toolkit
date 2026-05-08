// Tests for eject.mjs. Run with: node --test eject.test.mjs
// Covers all 8 Phase-0 acceptance criteria.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseArgs, parseTarget, replaceExistingHeader, injectHeader, todayUtc,
  upsertManifestEntry, run,
} from "./eject.mjs";

// ─── helpers ────────────────────────────────────────────────────────────────

async function mkTempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "marvin-eject-test-"));
  return dir;
}

/**
 * Build a fake pack root at `<root>/<packName>/` and a project root at
 * `<root>/project/`. Returns absolute paths to both.
 */
async function setupSandbox(opts = {}) {
  const root = await mkTempRoot();
  const packName = opts.packName ?? "marvin-core-pack";
  const packVersion = opts.packVersion ?? "0.1.0-test";
  const packRoot = path.join(root, packName);
  const projectRoot = path.join(root, "project");
  await fs.mkdir(path.join(packRoot, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(packRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: packName, version: packVersion }, null, 2),
  );
  await fs.mkdir(projectRoot, { recursive: true });
  return { root, packRoot, projectRoot, packName, packVersion };
}

async function writeFile(absPath, content) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);
}

function captureStream() {
  let data = "";
  return { write: (s) => { data += s; }, get: () => data };
}

async function callRun(argv, opts = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await run(argv, { stdout, stderr, ...opts });
  return { code, stdout: stdout.get(), stderr: stderr.get() };
}

// ─── unit: parseArgs ────────────────────────────────────────────────────────

test("parseArgs: positional target + flags", () => {
  const r = parseArgs(["marvin-core-pack", "--apply"]);
  assert.equal(r.target, "marvin-core-pack");
  assert.equal(r.apply, true);
  assert.equal(r.only, null);
  assert.equal(r.source, null);
});

test("parseArgs: --only with comma list", () => {
  const r = parseArgs(["marvin-core-pack", "--only", "skills,commands"]);
  assert.deepEqual(r.only, ["skills", "commands"]);
});

test("parseArgs: --only with equals form", () => {
  const r = parseArgs(["marvin-core-pack", "--only=agents"]);
  assert.deepEqual(r.only, ["agents"]);
});

test("parseArgs: rejects unknown --only kind", () => {
  assert.throws(() => parseArgs(["marvin-core-pack", "--only", "bogus"]), /skills,commands,agents/);
});

test("parseArgs: rejects unknown flag", () => {
  assert.throws(() => parseArgs(["--bogus"]));
});

// ─── unit: parseTarget ──────────────────────────────────────────────────────

test("parseTarget: whole pack", () => {
  assert.deepEqual(parseTarget("marvin-core-pack"), { pack: "marvin-core-pack", kind: null, name: null });
});

test("parseTarget: single artifact", () => {
  assert.deepEqual(parseTarget("marvin-core-pack/skills/mn.commit"), { pack: "marvin-core-pack", kind: "skill", name: "mn.commit" });
  assert.deepEqual(parseTarget("marvin-core-pack/commands/mn.pr"), { pack: "marvin-core-pack", kind: "command", name: "mn.pr" });
  assert.deepEqual(parseTarget("marvin-core-pack/agents/marvin-x"), { pack: "marvin-core-pack", kind: "agent", name: "marvin-x" });
});

test("parseTarget: rejects unknown pack (acceptance #6)", () => {
  assert.throws(() => parseTarget("bogus-pack"), /unknown pack/);
});

test("parseTarget: rejects malformed shape", () => {
  assert.throws(() => parseTarget("marvin-core-pack/skills"));
  assert.throws(() => parseTarget("marvin-core-pack/foo/bar"));
});

// ─── unit: header replacement (acceptance #2) ───────────────────────────────

test("replaceExistingHeader: removes literal-prefix match for the same pack", () => {
  const before = [
    "<!-- marvin-eject: source=marvin-core-pack@0.1.0 ejected-at=2025-01-01 -->",
    "",
    "body line",
    "",
  ].join("\n");
  const after = replaceExistingHeader(before, "marvin-core-pack");
  assert.ok(!after.includes("marvin-eject"));
  assert.ok(after.includes("body line"));
});

test("replaceExistingHeader: leaves headers from OTHER packs intact", () => {
  const before = [
    "<!-- marvin-eject: source=marvin-other-pack@0.1.0 ejected-at=2025-01-01 -->",
    "",
    "body line",
  ].join("\n");
  const after = replaceExistingHeader(before, "marvin-core-pack");
  assert.ok(after.includes("marvin-other-pack"));
});

test("replaceExistingHeader: idempotent on content with no header", () => {
  const content = "body only\n";
  assert.equal(replaceExistingHeader(content, "marvin-core-pack"), content);
});

// ─── unit: frontmatter detection (acceptance #3) ────────────────────────────

test("injectHeader: inserts after frontmatter close", () => {
  const src = "---\nname: test\ndescription: x\n---\n\nbody\n";
  const out = injectHeader(src, "marvin-core-pack", "0.1.0", "2025-01-01");
  assert.match(out, /^---\nname: test\ndescription: x\n---\n\n<!-- marvin-eject:/);
  assert.ok(out.includes("body"));
});

test("injectHeader: inserts at top when no frontmatter", () => {
  const src = "Just a body, no frontmatter.\n";
  const out = injectHeader(src, "marvin-core-pack", "0.1.0", "2025-01-01");
  assert.match(out, /^<!-- marvin-eject: source=marvin-core-pack@0\.1\.0/);
});

test("injectHeader: handles body that coincidentally starts with `---`", () => {
  // A body whose first line is `---` but with no closing `---` MUST be
  // treated as no-frontmatter (insert at top, don't slice into the body).
  const src = "---\nThis is not frontmatter, just an HR-like line.\n\nbody\n";
  const out = injectHeader(src, "marvin-core-pack", "0.1.0", "2025-01-01");
  assert.match(out, /^<!-- marvin-eject:/);
  assert.ok(out.includes("This is not frontmatter"));
});

test("injectHeader: idempotent across re-runs (acceptance #1)", () => {
  const src = "---\nname: test\n---\n\nbody\n";
  const once = injectHeader(src, "marvin-core-pack", "0.1.0", "2025-01-01");
  const twice = injectHeader(once, "marvin-core-pack", "0.1.0", "2025-01-01");
  assert.equal(once, twice);
  // exactly one header line
  assert.equal((twice.match(/<!-- marvin-eject:/g) ?? []).length, 1);
});

test("injectHeader: re-run with different version replaces in-place, not stacks", () => {
  const src = "---\nname: test\n---\n\nbody\n";
  const v1 = injectHeader(src, "marvin-core-pack", "0.1.0", "2025-01-01");
  const v2 = injectHeader(v1, "marvin-core-pack", "0.2.0", "2025-02-02");
  assert.equal((v2.match(/<!-- marvin-eject:/g) ?? []).length, 1);
  assert.ok(v2.includes("0.2.0"));
  assert.ok(!v2.includes("0.1.0"));
});

// ─── unit: manifest upsert ──────────────────────────────────────────────────

test("upsertManifestEntry: inserts on first call", () => {
  const m = { version: 1, ejected: [] };
  const e = { source: "marvin-core-pack", sourceVersion: "0.1.0", ejectedAt: "2025-01-01", artifact: "skills/mn.commit", files: [".claude/skills/mn.commit/SKILL.md"] };
  upsertManifestEntry(m, e);
  assert.equal(m.ejected.length, 1);
});

test("upsertManifestEntry: replaces on duplicate (source, artifact)", () => {
  const m = { version: 1, ejected: [
    { source: "marvin-core-pack", sourceVersion: "0.1.0", ejectedAt: "2025-01-01", artifact: "skills/mn.commit", files: ["a"] },
  ]};
  upsertManifestEntry(m, {
    source: "marvin-core-pack", sourceVersion: "0.2.0", ejectedAt: "2025-02-02", artifact: "skills/mn.commit", files: ["b"],
  });
  assert.equal(m.ejected.length, 1);
  assert.equal(m.ejected[0].sourceVersion, "0.2.0");
  assert.deepEqual(m.ejected[0].files, ["b"]);
});

// ─── integration: dry-run ───────────────────────────────────────────────────

test("run: dry-run on a single skill prints JSON plan, exit 0", async () => {
  const sb = await setupSandbox();
  await writeFile(path.join(sb.packRoot, "skills", "mn.demo", "SKILL.md"),
    "---\nname: demo\ndescription: x\n---\n\nbody\n");

  const { code, stdout, stderr } = await callRun(
    ["marvin-core-pack/skills/mn.demo", "--source", sb.packRoot],
    { projectRoot: sb.projectRoot, cwd: sb.projectRoot },
  );
  assert.equal(code, 0, `stderr was: ${stderr}`);
  const plan = JSON.parse(stdout);
  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.pack, "marvin-core-pack");
  assert.deepEqual(plan.creates, [".claude/skills/mn.demo/SKILL.md"]);
  assert.deepEqual(plan.overwrites, []);
  // Nothing should have been written.
  assert.equal(existsSync(path.join(sb.projectRoot, ".claude")), false);
});

// ─── integration: apply + idempotency (acceptance #1) ───────────────────────

test("run: --apply twice produces byte-identical manifest, no header dup", async () => {
  const sb = await setupSandbox();
  await writeFile(path.join(sb.packRoot, "skills", "mn.demo", "SKILL.md"),
    "---\nname: demo\ndescription: x\n---\n\nbody\n");

  const first = await callRun(
    ["marvin-core-pack/skills/mn.demo", "--source", sb.packRoot, "--apply"],
    { projectRoot: sb.projectRoot, cwd: sb.projectRoot },
  );
  assert.equal(first.code, 0, `stderr: ${first.stderr}`);

  const manifest1 = await fs.readFile(path.join(sb.projectRoot, ".claude", ".marvin-eject.json"), "utf8");
  const skill1 = await fs.readFile(path.join(sb.projectRoot, ".claude", "skills", "mn.demo", "SKILL.md"), "utf8");

  const second = await callRun(
    ["marvin-core-pack/skills/mn.demo", "--source", sb.packRoot, "--apply"],
    { projectRoot: sb.projectRoot, cwd: sb.projectRoot },
  );
  assert.equal(second.code, 0);

  const manifest2 = await fs.readFile(path.join(sb.projectRoot, ".claude", ".marvin-eject.json"), "utf8");
  const skill2 = await fs.readFile(path.join(sb.projectRoot, ".claude", "skills", "mn.demo", "SKILL.md"), "utf8");

  assert.equal(manifest1, manifest2, "manifest must be byte-identical on re-run");
  assert.equal(skill1, skill2, "ejected file must be byte-identical on re-run");
  assert.equal((skill2.match(/<!-- marvin-eject:/g) ?? []).length, 1, "exactly one header line");
});

// ─── integration: --only (acceptance #5) ────────────────────────────────────

test("run: --only filters to requested kinds on whole-pack target", async () => {
  const sb = await setupSandbox();
  await writeFile(path.join(sb.packRoot, "skills", "mn.s1", "SKILL.md"),
    "---\nname: s1\ndescription: x\n---\n\nbody\n");
  await writeFile(path.join(sb.packRoot, "commands", "mn.c1.md"),
    "---\ndescription: cmd\n---\n\nbody\n");
  await writeFile(path.join(sb.packRoot, "agents", "marvin-a1.md"),
    "---\ndescription: agent\n---\n\nbody\n");

  const { code, stdout } = await callRun(
    ["marvin-core-pack", "--only", "skills,commands", "--source", sb.packRoot, "--apply"],
    { projectRoot: sb.projectRoot, cwd: sb.projectRoot },
  );
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  const artifacts = report.written.map((w) => w.artifact);
  assert.ok(artifacts.includes("skills/mn.s1"));
  assert.ok(artifacts.includes("commands/mn.c1"));
  assert.ok(!artifacts.some((a) => a.startsWith("agents/")), "agents must be skipped");
  assert.equal(existsSync(path.join(sb.projectRoot, ".claude", "agents")), false);
});

// ─── integration: unknown pack (acceptance #6) ──────────────────────────────

test("run: unknown pack exits with code 2", async () => {
  const { code, stderr } = await callRun(["bogus-pack"]);
  assert.equal(code, 2);
  assert.match(stderr, /unknown pack/);
});

test("run: malformed args exit with code 2", async () => {
  const { code, stderr } = await callRun(["--apply"]); // missing target
  assert.equal(code, 2);
  assert.match(stderr, /target is required/);
});

// ─── integration: mid-run failure (acceptance #4) ───────────────────────────

test("run: mid-run failure produces partial manifest + non-zero exit + stderr listing", async () => {
  const sb = await setupSandbox();
  await writeFile(path.join(sb.packRoot, "skills", "mn.ok", "SKILL.md"),
    "---\nname: ok\ndescription: x\n---\n\nbody\n");
  await writeFile(path.join(sb.packRoot, "skills", "mn.bad", "SKILL.md"),
    "---\nname: bad\ndescription: x\n---\n\nbody\n");

  // Pre-create the destination for mn.bad as a directory so writing the file fails (EISDIR).
  await fs.mkdir(path.join(sb.projectRoot, ".claude", "skills", "mn.bad", "SKILL.md"), { recursive: true });

  const { code, stdout, stderr } = await callRun(
    ["marvin-core-pack", "--only", "skills", "--source", sb.packRoot, "--apply"],
    { projectRoot: sb.projectRoot, cwd: sb.projectRoot },
  );
  assert.equal(code, 1, "exit code must be non-zero on mid-run failure");
  assert.match(stderr, /mn\.bad\/SKILL\.md/);

  const manifestPath = path.join(sb.projectRoot, ".claude", ".marvin-eject.json");
  assert.ok(existsSync(manifestPath), "partial manifest must still be written");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const artifacts = manifest.ejected.map((e) => e.artifact);
  assert.ok(artifacts.includes("skills/mn.ok"), "successful artifact recorded in manifest");
  assert.ok(!artifacts.includes("skills/mn.bad"), "failed artifact NOT recorded in manifest");

  const report = JSON.parse(stdout);
  assert.ok(report.failures.length >= 1);
});

// ─── integration: source resolution dev-mode ────────────────────────────────

test("run: dev-mode resolution works when cwd looks like marvin-toolkit repo", async () => {
  const sb = await setupSandbox();
  // Build a fake repo layout: <repoRoot>/.claude-plugin/marketplace.json + plugins/marvin-core-pack
  const repoRoot = path.join(sb.root, "repo");
  await fs.mkdir(path.join(repoRoot, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "marvin-toolkit", plugins: [] }),
  );
  await fs.mkdir(path.join(repoRoot, "plugins"), { recursive: true });
  await fs.cp(sb.packRoot, path.join(repoRoot, "plugins", "marvin-core-pack"), { recursive: true });
  await writeFile(path.join(repoRoot, "plugins", "marvin-core-pack", "skills", "mn.demo", "SKILL.md"),
    "---\nname: demo\ndescription: x\n---\n\nbody\n");
  const projectRoot = path.join(sb.root, "project2");
  await fs.mkdir(projectRoot, { recursive: true });

  const { code, stdout } = await callRun(
    ["marvin-core-pack/skills/mn.demo"],
    { projectRoot, cwd: repoRoot },
  );
  assert.equal(code, 0);
  const plan = JSON.parse(stdout);
  assert.deepEqual(plan.creates, [".claude/skills/mn.demo/SKILL.md"]);
});

// ─── integration: MCP hint ──────────────────────────────────────────────────

test("run: pack with .mcp.json surfaces hint in plan, never copies it", async () => {
  const sb = await setupSandbox();
  await writeFile(path.join(sb.packRoot, "skills", "mn.demo", "SKILL.md"),
    "---\nname: demo\ndescription: x\n---\n\nbody\n");
  await fs.writeFile(
    path.join(sb.packRoot, ".mcp.json"),
    JSON.stringify({ mcpServers: { foo: {}, bar: {} } }),
  );

  const { code, stdout } = await callRun(
    ["marvin-core-pack", "--source", sb.packRoot, "--apply"],
    { projectRoot: sb.projectRoot, cwd: sb.projectRoot },
  );
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.deepEqual(report.mcpHint, { servers: ["foo", "bar"] });
  // .mcp.json must NOT have been copied to the project.
  assert.equal(existsSync(path.join(sb.projectRoot, ".mcp.json")), false);
});

// ─── unit: todayUtc format ──────────────────────────────────────────────────

test("todayUtc returns YYYY-MM-DD", () => {
  assert.match(todayUtc(), /^\d{4}-\d{2}-\d{2}$/);
});
