#!/usr/bin/env node
// gen-catalog.mjs — the website content pipeline (spec 005-website-content-pipeline, F1).
//
// Emits packages/site/src/data/catalog.json: the command catalog, the registry counts, and the
// version — all derived from the plugin sources at build time, so the site carries no
// hand-maintained number (FR-20). Wired as the `prebuild` / `predev` step; the committed JSON is
// byte-guarded by test/catalog.test.mjs and type-guarded by the `check:catalog` tsc pass.
//
// Sources, read fresh each run:
//   - plugins/marvin/mcp/server/src/prompts/index.ts  → PROMPTS (the 51-command identity + order)
//   - packages/marvin-mcp-shared/src/help-content.ts   → curated blurbs / details / phrases /
//                                                        examples / group blurbs (the same source
//                                                        the `help` tool + widget use — one system)
//   - plugins/marvin/.claude-plugin/plugin.json        → version + license
//   - plugins/marvin/{mcp/server/src/tools, agents, widgets} → tool / agent / widget counts
//
// The two `.ts` sources are pure data (a type-only import / no imports), so they are read by
// transpiling them in memory with the `typescript` devDep and importing the result as a data: URL
// — no Node flags, works on Node 20+ (only `astro build` needs Node 22). If a future edit gave
// either source a runtime import, the data: import would throw a bare-specifier error and the
// catalog.test.mjs suite would fail — the drift is CI-caught, not silent.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", ".."); // packages/site/scripts → repo root

const SERVER_SRC = join(ROOT, "plugins", "marvin", "mcp", "server", "src");
const PROMPTS_TS = join(SERVER_SRC, "prompts", "index.ts");
const HELP_CONTENT_TS = join(ROOT, "packages", "marvin-mcp-shared", "src", "help-content.ts");
const TOOLS_DIR = join(SERVER_SRC, "tools");
const AGENTS_DIR = join(ROOT, "plugins", "marvin", "agents");
const WIDGETS_DIR = join(ROOT, "plugins", "marvin", "widgets");
const PLUGIN_JSON = join(ROOT, "plugins", "marvin", ".claude-plugin", "plugin.json");
const OUT = join(here, "..", "src", "data", "catalog.json");

// ── command taxonomy — mirrors plugins/marvin/mcp/server/src/lib/state.ts:55-66 ──
// state.ts pulls in git / storage / fs at import, so it cannot be transpiled in isolation; this
// 5-line copy is guarded against drift by test/catalog.test.mjs, which parses the arrays out of
// state.ts as text and asserts equality.
export const GROUP_PREFIXES = ["adr", "pr", "task", "sec", "refactor", "track"];
export const GROUP_ORDER = ["core", "adr", "pr", "task", "sec", "refactor", "track"];

/**
 * Group of a prompt by its `<group>-<command>` prefix; bare names are "core" — including a bare
 * name that equals a prefix (the `/marvin:adr` create singleton is core; the `adr-*` lifecycle is
 * the group).
 */
export function groupOf(name) {
  const prefix = name.split("-")[0] ?? "";
  return prefix !== name && GROUP_PREFIXES.includes(prefix) ? prefix : "core";
}

// Human-run-only commands (their skills carry `disable-model-invocation: true`), flagged in the
// reference. Mirrors plugins/marvin/mcp/server/src/lib/help-data.ts:34 — the prompt registry does
// not surface the flag. Keep in sync if a skill's flag changes.
const HUMAN_RUN = new Set(["adr-accept", "adr-supersede", "adr-sync"]);

/**
 * Transpile a pure-data `.ts` source in memory and import it as a module. Both sources this reads
 * have only a type-only import / no imports, so the transpiled output is self-contained.
 */
async function loadTs(absPath) {
  const source = readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  });
  const url = "data:text/javascript;base64," + Buffer.from(outputText, "utf8").toString("base64");
  return import(url);
}

/** The prompt registry — the authoritative command list and order. */
export async function loadRegistry() {
  const mod = await loadTs(PROMPTS_TS);
  return { PROMPTS: mod.PROMPTS };
}

/** The curated help-content records shared with the `help` tool + widget. */
export async function loadHelpContent() {
  return loadTs(HELP_CONTENT_TS);
}

/**
 * Count the marvin MCP tools — `*.ts` under src/tools, excluding `*.test.ts`, that call
 * `defineTool(` (matches the tools registered in server.ts, and excludes any non-tool helper file).
 */
function countTools() {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => readFileSync(join(TOOLS_DIR, f), "utf8").includes("defineTool(")).length;
}

/** Count files with a given extension in a directory. */
function countExt(dir, ext) {
  return readdirSync(dir).filter((f) => f.endsWith(ext)).length;
}

/** Build the catalog object from the plugin sources. Pure — no file writes. */
export async function buildCatalog() {
  const { PROMPTS } = await loadRegistry();
  const hc = await loadHelpContent();
  const plugin = JSON.parse(readFileSync(PLUGIN_JSON, "utf8"));

  // Commands in registry (PROMPTS) order, each tagged with its group — NOT help.ts's GROUP_ORDER
  // flatten (which reorders); the group order lives in groups[] below. The Phase-3 catalog page
  // groups via the per-command `group` tag.
  const commands = PROMPTS.map((p) => {
    const example = hc.COMMAND_EXAMPLES[p.name];
    const base = {
      name: p.name,
      group: groupOf(p.name),
      blurb: hc.COMMAND_BLURBS[p.name] ?? "",
      description: hc.COMMAND_DETAILS[p.name] ?? "",
      phrases: [...(hc.COMMAND_PROMPTS[p.name] ?? [])],
    };
    // `example` is genuinely optional — emit the key only when present (matches help.ts).
    return example
      ? { ...base, example, human: HUMAN_RUN.has(p.name) }
      : { ...base, human: HUMAN_RUN.has(p.name) };
  });

  const groups = GROUP_ORDER.filter((g) => commands.some((c) => c.group === g)).map((g) => ({
    key: g,
    blurb: hc.GROUP_BLURBS[g] ?? "",
    count: commands.filter((c) => c.group === g).length,
  }));

  const counts = {
    prompts: PROMPTS.length,
    tools: countTools(),
    agents: countExt(AGENTS_DIR, ".md"),
    widgets: countExt(WIDGETS_DIR, ".html"),
    version: plugin.version,
    license: plugin.license,
  };

  return { version: plugin.version, counts, groups, commands };
}

/** The catalog's canonical serialization — the exact bytes the drift guard pins. */
export function serializeCatalog(catalog) {
  return JSON.stringify(catalog, null, 2) + "\n";
}

// Run directly (`node scripts/gen-catalog.mjs`) → write the catalog. Imported (by the test) →
// export only, so the committed file is never overwritten out from under the drift guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalog = await buildCatalog();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serializeCatalog(catalog));
  console.log(
    `[gen-catalog] wrote ${relative(ROOT, OUT)} — ${catalog.commands.length} commands, ` +
      `counts ${JSON.stringify(catalog.counts)}`,
  );
}
