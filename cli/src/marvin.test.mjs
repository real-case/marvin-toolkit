// Tests for the marvin CLI surface. Run with: node --test cli/src/marvin.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveLocal, resolveExplicit } from "./sources/local.mjs";
import { resolveInstalled } from "./sources/installed.mjs";
import { resolveSource } from "./source-resolver.mjs";
import { init } from "./commands/init.mjs";
import { status } from "./commands/status.mjs";
import { update } from "./commands/update.mjs";
import { list } from "./commands/list.mjs";

// ─── helpers ────────────────────────────────────────────────────────────────

async function mkTemp() { return fs.mkdtemp(path.join(os.tmpdir(), "marvin-test-")); }

/**
 * Build a fake marvin-toolkit clone at <root>/repo with one pack.
 */
async function setupClone(opts = {}) {
  const root = await mkTemp();
  const repo = path.join(root, "repo");
  const project = path.join(root, "project");
  await fs.mkdir(path.join(repo, ".claude-plugin"), { recursive: true });
  await fs.writeFile(path.join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "marvin-toolkit", plugins: [] }));
  const packRoot = path.join(repo, "plugins", "marvin-core-pack");
  await fs.mkdir(path.join(packRoot, ".claude-plugin"), { recursive: true });
  await fs.writeFile(path.join(packRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "marvin-core-pack", version: opts.version ?? "0.1.0-test" }, null, 2));
  await fs.mkdir(path.join(packRoot, "skills", "mn.demo"), { recursive: true });
  await fs.writeFile(path.join(packRoot, "skills", "mn.demo", "SKILL.md"),
    "---\nname: demo\ndescription: x\n---\n\nbody\n");
  await fs.mkdir(project, { recursive: true });
  return { root, repo, project, packRoot };
}

function captureStream() { let s = ""; return { write: (x) => { s += x; }, get: () => s }; }

function withCapturedOutput(fn) {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  let out = "", err = "";
  process.stdout.write = (x) => { out += x; return true; };
  process.stderr.write = (x) => { err += x; return true; };
  return Promise.resolve(fn()).finally(() => {
    process.stdout.write = o;
    process.stderr.write = e;
  }).then((code) => ({ code, out, err }));
}

// ─── resolvers ──────────────────────────────────────────────────────────────

test("resolveExplicit: accepts pack-root path directly", async () => {
  const { packRoot } = await setupClone();
  assert.equal(await resolveExplicit(packRoot, "marvin-core-pack"), packRoot);
});

test("resolveExplicit: accepts repo-root path (auto-prefixes plugins/<pack>)", async () => {
  const { repo, packRoot } = await setupClone();
  assert.equal(await resolveExplicit(repo, "marvin-core-pack"), packRoot);
});

test("resolveExplicit: returns null for non-marvin path", async () => {
  const tmp = await mkTemp();
  assert.equal(await resolveExplicit(tmp, "marvin-core-pack"), null);
});

test("resolveLocal: walks up from cwd to find marvin-toolkit clone", async () => {
  const { repo, packRoot } = await setupClone();
  const deep = path.join(repo, "plugins", "marvin-core-pack", "skills", "mn.demo");
  assert.equal(await resolveLocal("marvin-core-pack", deep), packRoot);
});

test("resolveLocal: returns null when no marvin-toolkit clone in ancestors", async () => {
  const tmp = await mkTemp();
  assert.equal(await resolveLocal("marvin-core-pack", tmp), null);
});

test("resolveSource: explicit > local > installed (skip tarball when --offline)", async () => {
  const { repo, packRoot } = await setupClone();
  const tmp = await mkTemp();
  // explicit
  let r = await resolveSource("marvin-core-pack", { source: repo, cwd: tmp, offline: true });
  assert.equal(r.path, packRoot);
  assert.equal(r.source, "explicit");
  // fallback to local when no --source
  r = await resolveSource("marvin-core-pack", { cwd: repo, offline: true });
  assert.equal(r.path, packRoot);
  assert.equal(r.source, "local");
});

test("resolveSource: throws ESOURCE with helpful message on total failure", async () => {
  const tmp = await mkTemp();
  // Hermeticise: redirect HOME so the installed resolver can't find a real pack.
  const origHome = process.env.HOME;
  process.env.HOME = await mkTemp();
  try {
    await assert.rejects(
      () => resolveSource("marvin-core-pack", { cwd: tmp, offline: true }),
      (err) => err.code === "ESOURCE" && /Could not resolve/i.test(err.message),
    );
  } finally { process.env.HOME = origHome; }
});

// ─── init ───────────────────────────────────────────────────────────────────

test("init: applies by default, materialises files into .claude/", async () => {
  const sb = await setupClone();
  const { code, out, err } = await withCapturedOutput(() =>
    init({ target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
           cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 0, `stderr: ${err}`);
  assert.match(out, /"mode": "apply"/);
  assert.ok(existsSync(path.join(sb.project, ".claude", "skills", "mn.demo", "SKILL.md")));
  assert.ok(existsSync(path.join(sb.project, ".claude", ".marvin-eject.json")));
});

test("init: --dry-run prints plan and writes nothing", async () => {
  const sb = await setupClone();
  const { code, out } = await withCapturedOutput(() =>
    init({ target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
           dryRun: true, cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 0);
  assert.match(out, /"mode": "dry-run"/);
  assert.equal(existsSync(path.join(sb.project, ".claude")), false);
});

test("init: rejects unknown --target with available list", async () => {
  const sb = await setupClone();
  const { code, err } = await withCapturedOutput(() =>
    init({ target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
           adapter: "definitely-not-a-real-target", cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 2);
  assert.match(err, /not supported/);
  assert.match(err, /Available:.*claude/);
});

test("init: missing target exits 2", async () => {
  const { code, err } = await withCapturedOutput(() => init({ target: null }));
  assert.equal(code, 2);
  assert.match(err, /<target> is required/);
});

// ─── status ─────────────────────────────────────────────────────────────────

test("status: with manifest reports installed-vs-latest", async () => {
  const sb = await setupClone({ version: "0.1.0-test" });
  // First eject to populate manifest.
  await withCapturedOutput(() => init({
    target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
    cwd: sb.project, projectRoot: sb.project,
  }));
  const { code, out } = await withCapturedOutput(() =>
    status({ source: sb.repo, offline: true, cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 0);
  assert.match(out, /marvin-core-pack/);
  assert.match(out, /skills\/mn\.demo/);
  assert.match(out, /0\.1\.0-test/);
  assert.match(out, /ok/);
});

test("status: --json emits structured rows", async () => {
  const sb = await setupClone({ version: "0.1.0-a" });
  await withCapturedOutput(() => init({
    target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
    cwd: sb.project, projectRoot: sb.project,
  }));
  const { code, out } = await withCapturedOutput(() =>
    status({ source: sb.repo, offline: true, json: true, cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].installed, "0.1.0-a");
  assert.equal(parsed.entries[0].upToDate, true);
});

test("status: detects outdated when manifest version lags source", async () => {
  const sb = await setupClone({ version: "0.1.0-old" });
  await withCapturedOutput(() => init({
    target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
    cwd: sb.project, projectRoot: sb.project,
  }));
  // Bump the source pack version after eject.
  await fs.writeFile(path.join(sb.packRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "marvin-core-pack", version: "0.2.0-new" }, null, 2));
  const { code, out } = await withCapturedOutput(() =>
    status({ source: sb.repo, offline: true, json: true, cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.equal(parsed.entries[0].upToDate, false);
  assert.equal(parsed.entries[0].latest, "0.2.0-new");
});

// ─── update ─────────────────────────────────────────────────────────────────

test("update: re-ejects every manifest entry with bumped version", async () => {
  const sb = await setupClone({ version: "0.1.0-old" });
  await withCapturedOutput(() => init({
    target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
    cwd: sb.project, projectRoot: sb.project,
  }));
  // Bump source pack
  await fs.writeFile(path.join(sb.packRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "marvin-core-pack", version: "0.2.0-new" }, null, 2));

  const { code } = await withCapturedOutput(() =>
    update({ source: sb.repo, offline: true, cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 0);

  const manifestPath = path.join(sb.project, ".claude", ".marvin-eject.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.ejected[0].sourceVersion, "0.2.0-new");

  const skillContent = await fs.readFile(path.join(sb.project, ".claude", "skills", "mn.demo", "SKILL.md"), "utf8");
  // exactly one header, with the new version
  assert.equal((skillContent.match(/<!-- marvin-eject:/g) ?? []).length, 1);
  assert.match(skillContent, /0\.2\.0-new/);
});

test("update: reports nothing-to-update when manifest is empty", async () => {
  const sb = await setupClone();
  await fs.mkdir(path.join(sb.project, ".claude"), { recursive: true });
  await fs.writeFile(path.join(sb.project, ".claude", ".marvin-eject.json"),
    JSON.stringify({ version: 1, ejected: [] }));
  const { code, err } = await withCapturedOutput(() =>
    update({ source: sb.repo, offline: true, cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 0);
  assert.match(err, /nothing to update/);
});

test("update: errors when no manifest exists", async () => {
  const sb = await setupClone();
  const { code, err } = await withCapturedOutput(() =>
    update({ source: sb.repo, offline: true, cwd: sb.project, projectRoot: sb.project }),
  );
  assert.equal(code, 2);
  assert.match(err, /no manifest/);
});

// ─── list ───────────────────────────────────────────────────────────────────

test("list: enumerates artifacts per pack", async () => {
  // Build a tiny repo with all 3 packs (just stubs).
  const sb = await setupClone();
  for (const p of ["marvin-security-pack", "marvin-taskmaster-pack"]) {
    const r = path.join(sb.repo, "plugins", p);
    await fs.mkdir(path.join(r, ".claude-plugin"), { recursive: true });
    await fs.writeFile(path.join(r, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: p, version: "0.0.1" }, null, 2));
  }
  const { code, out } = await withCapturedOutput(() =>
    list({ source: sb.repo, offline: true, json: true, cwd: sb.project }),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.equal(parsed.length, 3);
  const core = parsed.find((e) => e.pack === "marvin-core-pack");
  assert.deepEqual(core.artifacts.skills, ["mn.demo"]);
});

// ─── byte-identical: marvin init vs /mn.eject (acceptance #4) ─────────────

test("init: produces byte-identical output with eject-core run() (acceptance #4)", async () => {
  const sb = await setupClone();
  // Path A: marvin init
  await withCapturedOutput(() => init({
    target: "marvin-core-pack/skills/mn.demo", source: sb.repo, offline: true,
    cwd: sb.project, projectRoot: sb.project,
  }));
  const aSkill = await fs.readFile(path.join(sb.project, ".claude", "skills", "mn.demo", "SKILL.md"), "utf8");
  const aManifest = await fs.readFile(path.join(sb.project, ".claude", ".marvin-eject.json"), "utf8");

  // Reset and run path B: eject-core directly (simulating /mn.eject)
  const sb2 = await setupClone();
  const { run: runEject } = await import("./lib/eject-core.mjs");
  const stdout = captureStream(); const stderr = captureStream();
  await runEject(["marvin-core-pack/skills/mn.demo", "--source", sb2.repo, "--apply"], {
    cwd: sb2.project, projectRoot: sb2.project, stdout, stderr,
  });
  const bSkill = await fs.readFile(path.join(sb2.project, ".claude", "skills", "mn.demo", "SKILL.md"), "utf8");
  const bManifest = await fs.readFile(path.join(sb2.project, ".claude", ".marvin-eject.json"), "utf8");

  assert.equal(aSkill, bSkill, "skill must be byte-identical");
  assert.equal(aManifest, bManifest, "manifest must be byte-identical");
});

// ─── installed resolver smoke ──────────────────────────────────────────────

test("resolveInstalled: returns null when ~/.claude/plugins is absent", async () => {
  // Run with HOME pointed at a temp dir to ensure no installed packs.
  const tmp = await mkTemp();
  const origHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    assert.equal(await resolveInstalled("marvin-core-pack"), null);
  } finally {
    process.env.HOME = origHome;
  }
});
