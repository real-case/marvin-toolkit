// command-refs.test.mjs — every `/marvin:<name>` the site prints must be a real command.
//
// Added after the site shipped `/marvin:verify` on two pages. `verify` is an MCP *tool*, not a
// prompt: it has no entry in the command registry, so no user could ever type it. The page was
// even self-inconsistent — pipeline.astro's stage heading read "STAGE 3 · task-verify" while its
// poster read "/marvin:verify" two lines below.
//
// Nothing caught it because the catalog guard only checks generated data against its sources, and
// these strings are hand-written prose inside .astro/.tsx markup. This closes that gap: it scans
// the site's own source for command references and checks each against the generated catalog, so
// a renamed, removed, or never-existed command fails on both CI legs instead of shipping.
//
// Mirrors catalog.test.mjs: node:test, assert/strict, sibling sources read by relative path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const here = import.meta.dirname;
const SRC = join(here, "..", "src");
const CATALOG_JSON = join(here, "..", "src", "data", "catalog.json");

/**
 * A command reference in site prose. Requires a lowercase letter after the colon, which
 * deliberately excludes the bare `/marvin:` prefix CommandCatalog.tsx renders before a
 * dynamically-supplied name (`<b>/marvin:</b>{name}`) — that one cannot go stale, since the name
 * comes from the catalog itself.
 *
 * Known limitation: this scans raw file text, so it also reads code comments. Prose *about* a
 * non-existent command therefore trips it just as a rendered one would. That is the conservative
 * direction to be wrong in, and the fix is to avoid literal slash spellings in comments for names
 * that are not commands — see the note in toolbox.astro's frontmatter. Skipping comments would
 * mean parsing two syntaxes (`//` in Astro frontmatter, `<!-- -->` in markup) for no real gain.
 */
const COMMAND_REF = /\/marvin:([a-z][a-z0-9-]*)/g;

/** Every .astro/.tsx file under src/, recursively. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    // .ts and .mjs joined .astro/.tsx in spec 013: src/lib/seo.ts composes the llms.txt body, which
    // is hand-authored prose naming commands — exactly the unguarded surface this file exists to
    // prevent, and the gap pipeline.astro:11-13 already documents. Widening added only two matches
    // at the time (catalog.ts and casts.ts, both `/marvin:task-start`); no .mjs lives under src/
    // today, so that half is future-proofing.
    return /\.(astro|tsx|ts|mjs)$/.test(entry.name) ? [path] : [];
  });
}

test("every /marvin: command the site prints exists in the generated catalog", () => {
  const known = new Set(JSON.parse(readFileSync(CATALOG_JSON, "utf8")).commands.map((c) => c.name));
  assert.ok(known.size > 0, "catalog must list commands");

  const files = sourceFiles(SRC);
  assert.ok(files.length > 0, "expected .astro/.tsx sources under src/");

  const bad = [];
  let seen = 0;

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const [, name] of line.matchAll(COMMAND_REF)) {
        seen++;
        if (!known.has(name)) {
          bad.push(`${relative(SRC, file)}:${i + 1} — /marvin:${name}`);
        }
      }
    });
  }

  // A regex that stopped matching would make this test vacuously green, so pin that it found work.
  assert.ok(seen >= 10, `expected to find command references; matched only ${seen}`);

  assert.deepEqual(
    bad,
    [],
    `the site references ${bad.length} command(s) absent from the catalog:\n  ${bad.join("\n  ")}\n` +
      `Check whether the name is an MCP *tool* rather than a prompt — tools (verify, spec, ` +
      `lessons, adr, …) have no /marvin: form. The nearest command is usually the right fix ` +
      `(e.g. verify → task-verify).`,
  );
});
