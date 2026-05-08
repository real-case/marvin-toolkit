// Tests for the Codex adapter. Run via:
//   node --test cli/src/adapters/codex.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import url from "node:url";

import codexAdapter from "./codex.mjs";
import { run as runEject } from "../lib/eject-core.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(cliRoot, "..");
const FIXTURE_TODAY = "2026-05-08";
const FIXTURE_ROOT = path.join(cliRoot, "test", "fixtures", "codex", "marvin-core-pack");

// ─── unit: shape ────────────────────────────────────────────────────────────

test("codexAdapter: implements the contract", () => {
  assert.equal(codexAdapter.name, "codex");
  for (const m of ["unsupported", "pathFor", "render", "manifestPath", "manifestSchema", "postWrite", "unsupportedPack"]) {
    assert.ok(typeof codexAdapter[m] === "function", `missing ${m}`);
  }
});

// ─── unit: unsupportedPack ──────────────────────────────────────────────────

test("codexAdapter.unsupportedPack: refuses marvin-taskmaster-pack", () => {
  const w = codexAdapter.unsupportedPack("marvin-taskmaster-pack");
  assert.ok(w);
  assert.match(w.reason, /subagent/i);
  assert.match(w.suggestion, /docs\/codex-target/);
});

test("codexAdapter.unsupportedPack: allows marvin-core-pack", () => {
  assert.equal(codexAdapter.unsupportedPack("marvin-core-pack"), null);
});

// ─── unit: per-artifact unsupported ────────────────────────────────────────

test("codexAdapter.unsupported: rejects agents with a clear reason", () => {
  const w = codexAdapter.unsupported({ kind: "agent", name: "research" });
  assert.ok(w);
  assert.match(w.reason, /subagent/i);
});

test("codexAdapter.unsupported: rejects commands (commands are pointers to same-named skills)", () => {
  const w = codexAdapter.unsupported({ kind: "command", name: "mn.commit" });
  assert.ok(w);
  assert.match(w.reason, /thin pointers/);
});

test("codexAdapter.unsupported: accepts skills", () => {
  assert.equal(codexAdapter.unsupported({ kind: "skill", name: "mn.commit" }), null);
});

// ─── unit: pathFor ──────────────────────────────────────────────────────────

test("codexAdapter.pathFor: SKILL.md → .codex/prompts/<name>.md", () => {
  assert.equal(
    codexAdapter.pathFor({ kind: "skill", name: "mn.commit" }, "SKILL.md"),
    ".codex/prompts/mn.commit.md",
  );
});

test("codexAdapter.pathFor: non-SKILL files inside a skill folder → null (skipped)", () => {
  assert.equal(codexAdapter.pathFor({ kind: "skill", name: "mn.eject" }, "eject.mjs"), null);
  assert.equal(codexAdapter.pathFor({ kind: "skill", name: "mn.eject" }, "scripts/foo.sh"), null);
});

// ─── unit: render ───────────────────────────────────────────────────────────

test("codexAdapter.render: strips frontmatter and injects origin header", () => {
  const src = "---\nname: test\ndescription: x\n---\n\nbody line\n";
  const out = codexAdapter.render({ kind: "skill", name: "mn.demo" }, src, {
    isMarkdown: true, packName: "marvin-core-pack", packVersion: "0.1.0", today: "2026-01-01",
  });
  assert.ok(!out.includes("name: test"), "frontmatter must be stripped");
  assert.match(out, /^<!-- marvin-eject:/);
  assert.match(out, /body line/);
});

test("codexAdapter.render: passes non-markdown through unchanged", () => {
  const src = "binary blob";
  const out = codexAdapter.render({ kind: "skill", name: "x" }, src, {
    isMarkdown: false, packName: "p", packVersion: "v", today: "t",
  });
  assert.equal(out, src);
});

test("codexAdapter.render: idempotent on re-run with same args", () => {
  const src = "---\nname: t\n---\n\nbody\n";
  const opts = { isMarkdown: true, packName: "p", packVersion: "v", today: "t" };
  const once = codexAdapter.render({ kind: "skill", name: "x" }, src, opts);
  const twice = codexAdapter.render({ kind: "skill", name: "x" }, once, opts);
  assert.equal(once, twice);
  assert.equal((twice.match(/<!-- marvin-eject:/g) ?? []).length, 1);
});

// ─── unit: manifest ─────────────────────────────────────────────────────────

test("codexAdapter.manifestPath: lives under .codex/", () => {
  assert.equal(codexAdapter.manifestPath(), ".codex/.marvin-eject.json");
});

// ─── integration: byte-identical with committed fixture (acceptance #1) ────

test("codexAdapter: marvinx init marvin-core-pack --target=codex matches committed fixture", async () => {
  const scratch = await fs.mkdtemp(path.join(repoRoot, ".tmp-codex-fixture-test-"));
  try {
    const code = await runEject(
      ["marvin-core-pack", "--source", repoRoot, "--apply"],
      { cwd: scratch, projectRoot: scratch, adapter: codexAdapter, today: FIXTURE_TODAY,
        stdout: { write: () => {} } },
    );
    assert.equal(code, 0);

    const expected = await readTreeRecursive(path.join(FIXTURE_ROOT, ".codex"));
    const actual = await readTreeRecursive(path.join(scratch, ".codex"));
    assert.deepEqual(actual.paths, expected.paths, "file set must match the fixture");
    for (const p of expected.paths) {
      assert.equal(actual.contents[p], expected.contents[p], `content mismatch at ${p}`);
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

// ─── integration: postWrite emits MCP TOML when pack ships .mcp.json ───────

test("codexAdapter.postWrite: emits TOML snippet for .mcp.json", async () => {
  const out = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(s); return true; };
  try {
    await codexAdapter.postWrite({
      skipped: [],
      mcpHint: { servers: ["context7"], config: { mcpServers: {
        context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"], env: { TOKEN: "abc" } },
      } } },
    }, "/tmp/whatever");
  } finally {
    process.stdout.write = origWrite;
  }
  const printed = out.join("");
  assert.match(printed, /\[mcp_servers\.context7\]/);
  assert.match(printed, /command = "npx"/);
  assert.match(printed, /args = \["-y", "@upstash\/context7-mcp"\]/);
  assert.match(printed, /\[mcp_servers\.context7\.env\]/);
  assert.match(printed, /TOKEN = "abc"/);
});

test("codexAdapter.postWrite: silent when no skipped + no mcp", async () => {
  const out = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(s); return true; };
  try {
    await codexAdapter.postWrite({ skipped: [], mcpHint: null }, "/tmp/x");
  } finally { process.stdout.write = origWrite; }
  assert.equal(out.join(""), "");
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function readTreeRecursive(root) {
  const paths = [];
  const contents = {};
  await walk(root, "");
  paths.sort();
  return { paths, contents };

  async function walk(dir, prefix) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? path.posix.join(prefix, e.name) : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs, rel);
      else if (e.isFile()) {
        paths.push(rel);
        contents[rel] = await fs.readFile(abs, "utf8");
      }
    }
  }
}
