// catalog.test.mjs (spec 005-website-content-pipeline, F4) — the content-pipeline drift + shape +
// counts guard (AC1–AC3). Mirrors theme-tokens.test.mjs: node:test, assert/strict, sibling sources
// read by relative path (no cross-workspace package import). It regenerates via the pure helpers
// exported from the generator and compares against source + the committed file, so a plugin change
// that is not regenerated fails CI on both Node legs (the browser-free `test` runs on Node 20 + 22).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildCatalog,
  serializeCatalog,
  loadRegistry,
  GROUP_ORDER,
  GROUP_PREFIXES,
} from "../scripts/gen-catalog.mjs";

const here = import.meta.dirname;
const ROOT = join(here, "..", "..", ".."); // packages/site/test → repo root
const CATALOG_JSON = join(here, "..", "src", "data", "catalog.json");
const STATE_TS = join(ROOT, "plugins", "marvin", "mcp", "server", "src", "lib", "state.ts");
const PLUGIN_JSON = join(ROOT, "plugins", "marvin", ".claude-plugin", "plugin.json");

// Parse a `NAME = ["a", "b", ...]` string-array literal out of a TS source as text (used to guard
// the generator's reimplemented taxonomy against lib/state.ts without importing that module, which
// pulls in git / storage / fs at load).
function parseStringArray(source, name) {
  const m = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  assert.ok(m, `could not locate ${name} in state.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((q) => q[1]);
}

test("catalog identity, grouping and completeness match the registry", async () => {
  const catalog = await buildCatalog();
  const { PROMPTS } = await loadRegistry();

  // Identity: every registry command, in registry order.
  assert.equal(catalog.commands.length, PROMPTS.length, "command count must equal the registry");
  assert.equal(catalog.commands.length, 53, "the registry currently has 53 commands");
  assert.deepEqual(
    catalog.commands.map((c) => c.name),
    PROMPTS.map((p) => p.name),
    "catalog.commands must list the registry names in registry order",
  );

  // Grouping: groups[] is exactly the non-empty groups in GROUP_ORDER, counts partition the total.
  assert.deepEqual(
    catalog.groups.map((g) => g.key),
    GROUP_ORDER.filter((g) => catalog.commands.some((c) => c.group === g)),
    "groups[] must be the non-empty groups in GROUP_ORDER",
  );
  for (const g of catalog.groups) {
    assert.ok(g.blurb.length > 0, `group ${g.key} must have a blurb`);
    assert.equal(
      g.count,
      catalog.commands.filter((c) => c.group === g.key).length,
      `group ${g.key} count must match its commands`,
    );
  }
  assert.equal(
    catalog.groups.reduce((sum, g) => sum + g.count, 0),
    catalog.commands.length,
    "group counts must partition the commands",
  );
  for (const c of catalog.commands) {
    assert.ok(GROUP_ORDER.includes(c.group), `command ${c.name} has unknown group ${c.group}`);
  }

  // Completeness: every command has curated prose and at least 3 trigger phrases (fail-closed if a
  // registry command were ever missing from help-content).
  for (const c of catalog.commands) {
    assert.ok(c.blurb.length > 0, `command ${c.name} is missing a blurb`);
    assert.ok(c.description.length > 0, `command ${c.name} is missing a description`);
    assert.ok(
      Array.isArray(c.phrases) && c.phrases.length >= 3,
      `command ${c.name} must have at least 3 trigger phrases`,
    );
  }

  // Taxonomy guard: the generator's copy must match lib/state.ts (drift-proofs the reimplementation).
  const stateTs = readFileSync(STATE_TS, "utf8");
  assert.deepEqual(
    GROUP_PREFIXES,
    parseStringArray(stateTs, "GROUP_PREFIXES"),
    "generator GROUP_PREFIXES drifted from lib/state.ts",
  );
  assert.deepEqual(
    GROUP_ORDER,
    parseStringArray(stateTs, "GROUP_ORDER"),
    "generator GROUP_ORDER drifted from lib/state.ts",
  );
});

test("counts equal an independent recount of the plugin sources", async () => {
  const catalog = await buildCatalog();
  const { PROMPTS } = await loadRegistry();
  const plugin = JSON.parse(readFileSync(PLUGIN_JSON, "utf8"));

  // prompts is cross-checked against the registry; tools / agents / widgets are pinned to the
  // current known-good literals — the independent, non-circular oracle (a miscount in the
  // generator's own enumeration cannot pass a self-referential check). Bump these when the plugin
  // grows: the site's advertised counts are a deliberate, guarded number.
  assert.deepEqual(catalog.counts, {
    prompts: PROMPTS.length,
    tools: 13,
    agents: 10,
    widgets: 9,
    version: plugin.version,
    license: plugin.license,
  });
  assert.equal(PROMPTS.length, 53, "the registry currently has 53 commands");
});

test("committed catalog.json is in sync with the generator", async () => {
  const committed = readFileSync(CATALOG_JSON, "utf8");
  const fresh = serializeCatalog(await buildCatalog());
  assert.equal(
    committed,
    fresh,
    "src/data/catalog.json is stale — run `npm run gen:catalog -w @marvin-toolkit/site` and commit the result",
  );
});

/**
 * Is this SKILL.md flagged human-run? A line-oriented reader, deliberately unlike the
 * generator's `indexOf` + regex at gen-catalog.mjs:79-83 — a guard that repeats the
 * implementation's own extraction cannot detect a bug in it. Self-contained on purpose:
 * importing a YAML parser here would make `yaml` a phantom dependency of this workspace,
 * resolved only through root hoisting, which is the cross-workspace coupling the spec
 * rejected Variant 2 to avoid.
 */
function isHumanRun(file) {
  let lines;
  try {
    lines = readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return false; // a skill directory with no readable SKILL.md carries no flag
  }
  if (lines[0]?.trim() !== "---") return false;
  const close = lines.indexOf("---", 1);
  if (close === -1) return false;
  for (const line of lines.slice(1, close)) {
    const [key, ...rest] = line.split(":");
    if (key?.trim() !== "disable-model-invocation") continue;
    return (
      rest
        .join(":")
        .trim()
        .replace(/^["']|["']$/g, "") === "true"
    );
  }
  return false;
}

/**
 * The 👤 flag on the public catalog must come from skill frontmatter.
 *
 * The expected set is read here, from `plugins/marvin/skills/`, and deliberately NOT via the
 * generator's own reader — a guard that calls the implementation it checks compares a value with
 * itself. Same reason `GROUP_PREFIXES` above is parsed out of `state.ts` as text.
 */
test("catalog human flags match skill frontmatter", async () => {
  const skillsDir = join(ROOT, "plugins", "marvin", "skills");
  const expected = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => isHumanRun(join(skillsDir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();

  assert.ok(expected.length > 0, "the repo has at least one human-run skill");

  const catalog = await buildCatalog();
  const flagged = catalog.commands
    .filter((c) => c.human)
    .map((c) => c.name)
    .sort();
  assert.deepEqual(flagged, expected, "generated catalog agrees with frontmatter");

  // A command with no skill of its own is never human-run — `track-*` are registry-only.
  const trackFlagged = catalog.commands.filter((c) => c.group === "track" && c.human);
  assert.deepEqual(trackFlagged, [], "skill-less commands are not flagged");

  // And the committed file the site actually ships agrees too.
  const committed = JSON.parse(readFileSync(CATALOG_JSON, "utf8"));
  assert.deepEqual(
    committed.commands
      .filter((c) => c.human)
      .map((c) => c.name)
      .sort(),
    expected,
    "committed catalog.json agrees with frontmatter",
  );
});
