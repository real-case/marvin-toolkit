#!/usr/bin/env node
// Deterministic backend for the mn.eject skill. Single-file ESM, no deps,
// Node 20+. Invoked by SKILL.md and (in PR-1) by the marvinx CLI.
//
// Contract:
//   node eject.mjs <target> [--only <kinds>] [--apply] [--source <pack-root>]
// Exit codes:
//   0  success (or dry-run plan emitted)
//   1  runtime failure during --apply (partial manifest written)
//   2  validation failure (unknown pack, malformed args, missing source)

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const KNOWN_PACKS = new Set([
  "marvin-core-pack",
  "marvin-security-pack",
  "marvin-taskmaster-pack",
]);
const KIND_DIRS = { skill: "skills", command: "commands", agent: "agents" };
const VALID_KINDS = new Set(["skills", "commands", "agents"]);
const HEADER_PREFIX = "<!-- marvin-eject: source=";

// ─── arg parsing ────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = { target: null, only: null, apply: false, source: null, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--only") out.only = argv[++i] ?? null;
    else if (arg.startsWith("--only=")) out.only = arg.slice("--only=".length);
    else if (arg === "--source") out.source = argv[++i] ?? null;
    else if (arg.startsWith("--source=")) out.source = arg.slice("--source=".length);
    else if (arg.startsWith("--")) throw new ValidationError(`unknown flag: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new ValidationError(`unexpected extra arguments: ${positional.slice(1).join(" ")}`);
  out.target = positional[0] ?? null;
  if (out.only !== null) {
    const kinds = out.only.split(",").map((s) => s.trim()).filter(Boolean);
    for (const k of kinds) {
      if (!VALID_KINDS.has(k)) throw new ValidationError(`--only kind must be one of skills,commands,agents (got "${k}")`);
    }
    out.only = kinds;
  }
  return out;
}

export class ValidationError extends Error { constructor(msg) { super(msg); this.name = "ValidationError"; } }

// ─── target parsing ─────────────────────────────────────────────────────────

export function parseTarget(target) {
  if (!target) throw new ValidationError("target is required");
  const parts = target.split("/");
  const pack = parts[0];
  if (!KNOWN_PACKS.has(pack)) {
    throw new ValidationError(
      `unknown pack "${pack}". Must be one of: ${[...KNOWN_PACKS].join(", ")}`
    );
  }
  if (parts.length === 1) return { pack, kind: null, name: null };
  if (parts.length !== 3) throw new ValidationError(`malformed target: "${target}". Expected "<pack>" or "<pack>/<kind>/<name>"`);
  const kindPlural = parts[1];
  if (!VALID_KINDS.has(kindPlural)) throw new ValidationError(`unknown kind "${kindPlural}" in target. Use skills, commands, or agents`);
  const kind = { skills: "skill", commands: "command", agents: "agent" }[kindPlural];
  return { pack, kind, name: parts[2] };
}

// ─── pack root resolution ───────────────────────────────────────────────────

export async function resolvePackRoot(packName, sourceOverride, cwd = process.cwd()) {
  if (sourceOverride) {
    const direct = path.resolve(sourceOverride);
    if (await isPackRoot(direct, packName)) return direct;
    const nested = path.join(direct, "plugins", packName);
    if (await isPackRoot(nested, packName)) return nested;
    throw new ValidationError(`--source "${sourceOverride}" does not contain pack "${packName}"`);
  }
  const devRoot = await findDevRoot(cwd);
  if (devRoot) {
    const candidate = path.join(devRoot, "plugins", packName);
    if (await isPackRoot(candidate, packName)) return candidate;
  }
  const installed = await findInstalledPack(packName);
  if (installed) return installed;
  throw new ValidationError(
    `Pack "${packName}" not found. Either run from the marvin-toolkit repo, ` +
    `pass --source <path>, or install it first: /plugin install ${packName}@marvin-toolkit`
  );
}

async function isPackRoot(dir, packName) {
  try {
    const manifestPath = path.join(dir, ".claude-plugin", "plugin.json");
    const m = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return m.name === packName;
  } catch { return false; }
}

async function findDevRoot(start) {
  let dir = path.resolve(start);
  while (true) {
    const marketplace = path.join(dir, ".claude-plugin", "marketplace.json");
    try {
      const m = JSON.parse(await fs.readFile(marketplace, "utf8"));
      if (m.name === "marvin-toolkit") return dir;
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function findInstalledPack(packName) {
  const root = path.join(os.homedir(), ".claude", "plugins");
  if (!existsSync(root)) return null;
  // Shallow recursive search (depth ≤ 4) for `<packName>` under a path that contains 'marvin-toolkit'.
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === packName && full.includes("marvin-toolkit") && await isPackRoot(full, packName)) return full;
      if (depth < 4) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

// ─── manifest read ──────────────────────────────────────────────────────────

export async function readPackManifest(packRoot) {
  const p = path.join(packRoot, ".claude-plugin", "plugin.json");
  const data = JSON.parse(await fs.readFile(p, "utf8"));
  if (!data.name || !data.version) throw new ValidationError(`pack manifest at ${p} missing name/version`);
  return { name: data.name, version: data.version };
}

// ─── artifact enumeration ───────────────────────────────────────────────────

export async function enumerateArtifacts(target, packRoot, only) {
  const { kind, name } = parseTarget(target);
  if (kind && name) {
    const artifact = await buildSingleArtifact(packRoot, kind, name);
    return [artifact];
  }
  const wantedKinds = only ?? ["skills", "commands", "agents"];
  const artifacts = [];
  for (const dirName of wantedKinds) {
    const kindSingular = { skills: "skill", commands: "command", agents: "agent" }[dirName];
    const dir = path.join(packRoot, dirName);
    if (!existsSync(dir)) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (kindSingular === "skill" && entry.isDirectory()) {
        artifacts.push(await buildSingleArtifact(packRoot, "skill", entry.name));
      } else if ((kindSingular === "command" || kindSingular === "agent") && entry.isFile() && entry.name.endsWith(".md")) {
        const baseName = entry.name.replace(/\.md$/, "");
        artifacts.push(await buildSingleArtifact(packRoot, kindSingular, baseName));
      }
    }
  }
  return artifacts;
}

async function buildSingleArtifact(packRoot, kind, name) {
  const dirName = KIND_DIRS[kind];
  if (kind === "skill") {
    const sourcePath = path.join(packRoot, "skills", name);
    if (!existsSync(sourcePath)) throw new ValidationError(`skills/${name} not found in pack`);
    const files = await listFilesRecursive(sourcePath);
    return { kind, name, sourcePath, files: files.map((rel) => ({
      from: path.join(sourcePath, rel),
      toRel: path.posix.join(".claude", "skills", name, rel.split(path.sep).join("/")),
      isMarkdown: rel.toLowerCase().endsWith(".md"),
    })) };
  }
  const sourcePath = path.join(packRoot, dirName, `${name}.md`);
  if (!existsSync(sourcePath)) throw new ValidationError(`${dirName}/${name}.md not found in pack`);
  return { kind, name, sourcePath, files: [{
    from: sourcePath,
    toRel: path.posix.join(".claude", dirName, `${name}.md`),
    isMarkdown: true,
  }] };
}

async function listFilesRecursive(dir, prefix = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const rel = prefix ? path.join(prefix, e.name) : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFilesRecursive(full, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

// ─── header injection ───────────────────────────────────────────────────────

export function injectHeader(content, packName, version, today) {
  const cleaned = replaceExistingHeader(content, packName);
  const headerLine = `${HEADER_PREFIX}${packName}@${version} ejected-at=${today} -->`;
  const fmEnd = findFrontmatterEnd(cleaned);
  if (fmEnd === -1) {
    // No frontmatter — header goes at the very top, followed by a blank line.
    return `${headerLine}\n\n${cleaned}`;
  }
  // With frontmatter — insert blank line, header, blank line after closing `---`.
  const before = cleaned.slice(0, fmEnd);
  const after = cleaned.slice(fmEnd);
  return `${before}\n${headerLine}\n${after}`;
}

// Returns the index immediately after the closing `---` of the frontmatter block,
// or -1 if the file has no frontmatter. Distinguishes a body that coincidentally
// starts with `---` (no second delimiter found within reasonable scan).
function findFrontmatterEnd(content) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return -1;
  const firstLineEnd = content.indexOf("\n");
  // Look for a closing `---` line. Must be exactly `---` on its own line.
  const closingPattern = /\n---(?:\r?\n|$)/;
  const rest = content.slice(firstLineEnd + 1);
  const match = rest.match(closingPattern);
  if (!match) return -1;
  const closingStart = firstLineEnd + 1 + match.index;
  const closingEnd = closingStart + match[0].length;
  return closingEnd;
}

// TODO(user): pick the header-replacement strategy.
//
// PURPOSE: when re-ejecting, an old `<!-- marvin-eject: source=<pack>@... -->`
// header from a previous run must be removed BEFORE we inject the new one.
// Otherwise re-runs stack duplicate headers (acceptance criterion 1 + 2).
//
// CONSTRAINTS:
//   - Match by literal prefix `${HEADER_PREFIX}<packName>@` (criterion 2).
//   - Only remove headers for THIS pack — leave headers from other Marvin packs alone.
//   - Re-running must produce byte-identical output to the prior run.
//   - Must handle: header at top of file, header after frontmatter,
//     header followed by a blank line that should also collapse.
//
// STRATEGY OPTIONS (5–10 lines each, you pick one):
//
//   (a) Single regex with anchors. Concise but watch for headers that happen
//       to appear inside fenced code blocks — those should NOT be touched
//       (though no current pack does this).
//
//   (b) Line-by-line scan: split by \n, drop the first matching line plus the
//       blank line immediately after it, rejoin. Verbose but explicit.
//
//   (c) Markdown-AST pass with a tiny custom parser. Robust but overkill —
//       and would pull in a dep we deliberately don't want.
//
// Default below is (b) — explicit and trade-off-free. Swap if you prefer (a).
export function replaceExistingHeader(content, packName) {
  const matchPrefix = `${HEADER_PREFIX}${packName}@`;
  const lines = content.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith(matchPrefix)) {
      i++; // drop the header line
      if (i < lines.length && lines[i] === "") i++; // drop the blank line that follows it
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

// ─── manifest upsert ────────────────────────────────────────────────────────

export async function readManifest(projectRoot) {
  const p = path.join(projectRoot, ".claude", ".marvin-eject.json");
  if (!existsSync(p)) return { version: 1, ejected: [] };
  try {
    const data = JSON.parse(await fs.readFile(p, "utf8"));
    if (!data.ejected) return { version: 1, ejected: [] };
    return data;
  } catch { return { version: 1, ejected: [] }; }
}

export function upsertManifestEntry(manifest, entry) {
  const key = (e) => `${e.source}::${e.artifact}`;
  const k = key(entry);
  const idx = manifest.ejected.findIndex((e) => key(e) === k);
  if (idx >= 0) manifest.ejected[idx] = entry;
  else manifest.ejected.push(entry);
  manifest.ejected.sort((a, b) => key(a).localeCompare(key(b)));
  return manifest;
}

export function manifestEntryFor(artifact, packName, packVersion, today) {
  const kindPlural = KIND_DIRS[artifact.kind];
  return {
    source: packName,
    sourceVersion: packVersion,
    ejectedAt: today,
    artifact: `${kindPlural}/${artifact.name}`,
    files: artifact.files.map((f) => f.toRel),
  };
}

// ─── MCP hint extraction ────────────────────────────────────────────────────

export async function extractMcpHint(packRoot) {
  const p = path.join(packRoot, ".mcp.json");
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(await fs.readFile(p, "utf8"));
    const servers = data?.mcpServers;
    if (!servers || typeof servers !== "object") return null;
    const names = Object.keys(servers);
    if (names.length === 0) return null;
    return { servers: names };
  } catch { return null; }
}

// ─── execution ──────────────────────────────────────────────────────────────

export function todayUtc() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function executePlan(plan, projectRoot) {
  // TODO(user): pick the atomicity strategy.
  //
  // PURPOSE: write all CopyOps for all artifacts. Acceptance criterion 4
  // requires "best-effort": on a mid-run failure, the script must:
  //   (i)   exit non-zero,
  //   (ii)  write a partial manifest reflecting only the SUCCESSFUL copies,
  //   (iii) list the failed file in stderr.
  //
  // STRATEGY OPTIONS:
  //
  //   (a) Sequential try/catch per file with an accumulator. Simplest;
  //       failures are reported in order; stops at the first hard failure
  //       OR continues past it (your call — `failFast` flag below).
  //
  //   (b) Promise.allSettled across all files. Reports every failure but
  //       loses ordering, and a hard fault (e.g. ENOSPC) might cascade
  //       silently if you don't surface stderr loudly enough.
  //
  //   (c) Stage-then-flush: write everything to a temp dir, then atomic
  //       rename into place. Real atomicity, but rename-across-mounts
  //       fails on some filesystems and the partial-manifest contract
  //       above already implies non-atomicity is acceptable.
  //
  // Default below is (a) with `failFast=false` — every file gets its own
  // chance, all failures bubble up to stderr, and the manifest reflects
  // exactly what landed on disk. Swap if you prefer (b) or (c).
  const written = [];
  const failures = [];
  for (const artifact of plan.artifacts) {
    const successFiles = [];
    for (const op of artifact.files) {
      try {
        const destAbs = path.join(projectRoot, op.toRel);
        await fs.mkdir(path.dirname(destAbs), { recursive: true });
        if (op.isMarkdown) {
          const src = await fs.readFile(op.from, "utf8");
          const out = injectHeader(src, plan.packName, plan.packVersion, plan.today);
          await fs.writeFile(destAbs, out);
        } else {
          await fs.copyFile(op.from, destAbs);
        }
        successFiles.push(op.toRel);
      } catch (err) {
        failures.push({ file: op.toRel, error: err.message });
      }
    }
    if (successFiles.length > 0) {
      written.push({ artifact, files: successFiles });
    }
  }
  return { written, failures };
}

export async function writeManifest(projectRoot, manifest) {
  const dir = path.join(projectRoot, ".claude");
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, ".marvin-eject.json");
  await fs.writeFile(p, JSON.stringify(manifest, null, 2) + "\n");
}

// ─── plan / report builders ─────────────────────────────────────────────────

export async function buildPlan({ target, only, source, projectRoot, cwd }) {
  const { pack: packName } = parseTarget(target);
  const packRoot = await resolvePackRoot(packName, source, cwd ?? projectRoot);
  const { version: packVersion } = await readPackManifest(packRoot);
  const artifacts = await enumerateArtifacts(target, packRoot, only);
  if (artifacts.length === 0) throw new ValidationError(`no artifacts matched target "${target}"`);
  const mcpHint = await extractMcpHint(packRoot);
  const today = todayUtc();
  const existingManifest = await readManifest(projectRoot);
  const overwrites = [];
  const creates = [];
  for (const a of artifacts) {
    for (const op of a.files) {
      const dest = path.join(projectRoot, op.toRel);
      if (existsSync(dest)) overwrites.push(op.toRel);
      else creates.push(op.toRel);
    }
  }
  return {
    packName, packVersion, packRoot, today, artifacts, mcpHint,
    creates, overwrites, existingManifest,
  };
}

function buildDryRunReport(plan) {
  return {
    mode: "dry-run",
    pack: plan.packName,
    version: plan.packVersion,
    target: { artifacts: plan.artifacts.map((a) => `${KIND_DIRS[a.kind]}/${a.name}`) },
    creates: plan.creates,
    overwrites: plan.overwrites,
    mcpHint: plan.mcpHint,
  };
}

function buildApplyReport(plan, exec) {
  return {
    mode: "apply",
    pack: plan.packName,
    version: plan.packVersion,
    written: exec.written.map((w) => ({
      artifact: `${KIND_DIRS[w.artifact.kind]}/${w.artifact.name}`,
      files: w.files,
    })),
    failures: exec.failures,
    mcpHint: plan.mcpHint,
  };
}

// ─── main ───────────────────────────────────────────────────────────────────

export async function run(argv, opts = {}) {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const cwd = opts.cwd ?? process.cwd();
  const projectRoot = opts.projectRoot ?? cwd;

  let parsed;
  try { parsed = parseArgs(argv); } catch (err) { stderr.write(`error: ${err.message}\n`); return 2; }
  if (parsed.help) { stdout.write(usage()); return 0; }

  let plan;
  try { plan = await buildPlan({ target: parsed.target, only: parsed.only, source: parsed.source, projectRoot, cwd }); }
  catch (err) {
    if (err instanceof ValidationError) { stderr.write(`error: ${err.message}\n`); return 2; }
    throw err;
  }

  if (!parsed.apply) {
    stdout.write(JSON.stringify(buildDryRunReport(plan), null, 2) + "\n");
    return 0;
  }

  const exec = await executePlan(plan, projectRoot);

  // Update manifest with successful artifacts only.
  const manifest = plan.existingManifest;
  for (const w of exec.written) {
    manifest.ejected = upsertManifestEntry(manifest, manifestEntryFor(w.artifact, plan.packName, plan.packVersion, plan.today)).ejected;
  }
  // Override files list to reflect what actually landed (best-effort partials).
  for (const w of exec.written) {
    const kindPlural = KIND_DIRS[w.artifact.kind];
    const key = `${plan.packName}::${kindPlural}/${w.artifact.name}`;
    const entry = manifest.ejected.find((e) => `${e.source}::${e.artifact}` === key);
    if (entry) entry.files = w.files;
  }
  try { await writeManifest(projectRoot, manifest); }
  catch (err) {
    stderr.write(`error: failed to write manifest: ${err.message}\n`);
    return 1;
  }

  stdout.write(JSON.stringify(buildApplyReport(plan, exec), null, 2) + "\n");
  if (exec.failures.length > 0) {
    for (const f of exec.failures) stderr.write(`failed: ${f.file} (${f.error})\n`);
    return 1;
  }
  return 0;
}

function usage() {
  return [
    "usage: node eject.mjs <target> [--only kinds] [--apply] [--source path]",
    "",
    "  <target>           <pack> | <pack>/skills/<name> | <pack>/commands/<name> | <pack>/agents/<name>",
    "  --only kinds       comma-separated subset: skills,commands,agents",
    "  --apply            execute the plan (default is dry-run)",
    "  --source path      explicit pack root (skips dev/installed resolution)",
    "  --help, -h         print this message",
    "",
  ].join("\n");
}

// CLI entrypoint when invoked directly (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(path.sep).join("/")));
if (isMain) {
  run(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`unexpected error: ${err.stack ?? err.message}\n`);
    process.exit(1);
  });
}
