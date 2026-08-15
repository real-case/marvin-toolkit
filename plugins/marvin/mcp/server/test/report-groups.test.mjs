import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

/**
 * The group-set guard (ADR-0039).
 *
 * Adding a `ReportGroup` touches around thirty sites, of which exactly ONE
 * fails the build when it is forgotten (`GROUP_LABELS`, a total
 * `Record<ReportGroup, string>`). Every other enumeration — `GROUP_ORDER`, the
 * tool's scan-dirs literal, the `ReportDirs` interface, the widget's `GROUPS`
 * segment table — accepts a missing member silently, and the prose sites that
 * enumerate the families in words are checked by nothing at all. So the
 * omission does not fail a build: it ships as a user-visible lie in a command
 * description. This file derives the group set from the contract and asserts it
 * against all of them at once.
 *
 * **Two readers, and each enumeration needs a specific one.** The
 * `parseStringArray` technique proven at `packages/site/test/catalog.test.mjs`
 * (`NAME\s*=\s*\[([^\]]*)\]`) matches none of the five literals below
 * unmodified — one carries a type annotation, one is wrapped in `z.enum(...)`,
 * one is an array of tuples whose first `]` is not the closing one, and two are
 * object literals. {@link arrayLiteral} and {@link objectKeys} walk brackets
 * with a depth counter instead, which handles all five.
 *
 * **Why text and not imports.** None of the five is an exported runtime value:
 * `GROUP_ORDER` and `GROUP_LABELS` are module-private, the dirs literal is
 * inside a function body, `ReportDirs` is a TypeScript interface that exists in
 * no runtime object, and `GROUPS` lives in a widget module this server test
 * does not build. Reading `ReportGroup` itself out of `contracts/report.ts` as
 * text avoids dragging zod and the whole contracts index into a `node:test`
 * run. Only `DECAYS` and `isStale` load through `_tsload.mjs`, because the
 * former is exported precisely so its keys can be read as a runtime object.
 *
 * **The prose fence is a MENTION check, and is documented as one.** A file
 * could satisfy it by accident for a word like `task`, and it cannot see
 * whether the mention sits in the sentence that enumerates groups —
 * `lib/reports.ts` is the extreme case, satisfied by its own
 * `scan<Group>Reports` function names, which is why the currency of its two doc
 * comments is that file's own obligation rather than this fence's. What the
 * fence does catch is the failure that actually happens: a new group name
 * appearing nowhere in a file that enumerates groups. It catches it in all
 * twelve at once.
 */

const here = dirname(fileURLToPath(import.meta.url));
// test → server → mcp → marvin → plugins → repo root
const ROOT = join(here, "..", "..", "..", "..", "..");

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const CONTRACT = "packages/marvin-mcp-shared/src/contracts/report.ts";
const TOOL = "plugins/marvin/mcp/server/src/tools/report.ts";
const LIB = "plugins/marvin/mcp/server/src/lib/reports.ts";
const WIDGET = "packages/marvin-widgets/src/widgets/reports/ReportsWidget.tsx";

/**
 * Walk from `open` (the index of an opening bracket) to its match, counting
 * depth and skipping over string literals so a bracket inside a quote cannot
 * close the literal early. Returns the inner text.
 */
function balanced(source, open, closer) {
  const opener = source[open];
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced ${opener} at ${open}`);
}

/** Every double-quoted string in a fragment, in source order. */
const quoted = (fragment) => [...fragment.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

/**
 * A bracket-array literal read as text, tolerating an intervening type
 * annotation (`const GROUP_ORDER: ReportGroup[] = [...]`) and a `z.enum(...)`
 * wrapper. For a nested array of tuples the FIRST string of each inner pair is
 * taken — `GROUPS` pairs a key with a display label.
 */
function arrayLiteral(source, name, label) {
  const decl = new RegExp(`\\b${name}\\b[^=\\n]*=\\s*(?:z\\.enum\\(\\s*)?\\[`);
  const m = decl.exec(source);
  assert.ok(m, `could not locate the ${name} array literal in ${label}`);
  const body = balanced(source, m.index + m[0].length - 1, "]");

  const inner = [...body.matchAll(/\[[^\]]*\]/g)].map((x) => x[0]);
  if (inner.length > 0) return inner.map((pair) => quoted(pair)[0]);
  return quoted(body);
}

/**
 * The top-level keys of an object literal or interface body, read as text.
 * `opener` is a regex whose match ENDS at the `{` — which lets one reader serve
 * `const X: T = {`, a literal inside a function body, and `interface X {`.
 */
function objectKeys(source, opener, label) {
  const m = opener.exec(source);
  assert.ok(m, `could not locate the ${label} object literal`);
  const body = balanced(source, m.index + m[0].length - 1, "}");

  const keys = [];
  let depth = 0;
  for (const line of body.split("\n")) {
    const key = depth === 0 ? line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/) : null;
    if (key) keys.push(key[1]);
    depth += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
  }
  return keys;
}

const asSet = (values) => [...new Set(values)].sort();

test("every enumeration and every pinned prose site carries the whole group set", async () => {
  // The one source of truth: the contract enum, read as text.
  const GROUPS = arrayLiteral(read(CONTRACT), "ReportGroup", CONTRACT);
  assert.ok(GROUPS.length >= 4, `implausible group set: ${JSON.stringify(GROUPS)}`);
  assert.ok(GROUPS.includes("critique"), "the fifth group is in the contract (ADR-0039)");
  const expected = asSet(GROUPS);

  // ── the code enumerations ────────────────────────────────────────────────
  const tool = read(TOOL);
  const lib = read(LIB);

  assert.deepEqual(asSet(arrayLiteral(tool, "GROUP_ORDER", TOOL)), expected, "GROUP_ORDER");
  assert.deepEqual(
    asSet(objectKeys(tool, /GROUP_LABELS[^=\n]*=\s*{/, "GROUP_LABELS")),
    expected,
    "GROUP_LABELS",
  );
  assert.deepEqual(
    asSet(objectKeys(tool, /scanDirs[^=\n]*=\s*{/, "the report tool's scan-dirs literal")),
    expected,
    "a group missing here is a directory that is never scanned",
  );
  assert.deepEqual(
    asSet(objectKeys(lib, /interface\s+ReportDirs\s*{/, "ReportDirs")),
    expected,
    "ReportDirs",
  );

  // The widget's segment table is the group set plus the synthetic `all`.
  assert.deepEqual(
    asSet(arrayLiteral(read(WIDGET), "GROUPS", WIDGET)),
    asSet([...expected, "all"]),
    "the widget toolbar renders one segment per group, plus All",
  );

  // ── staleness, as runtime values ─────────────────────────────────────────
  const reports = await importTs("src/lib/reports.ts");
  assert.deepEqual(asSet(Object.keys(reports.DECAYS)), expected, "DECAYS is total over the union");

  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const decaying = expected.filter((g) => reports.isStale(g, now - 365 * DAY_MS, now));
  assert.deepEqual(
    decaying,
    ["refactor", "security"],
    "exactly the two present-tense groups decay — the assertion the old default branch made unwriteable",
  );

  // ── the prose fence ──────────────────────────────────────────────────────
  const PROSE_SITES = [
    TOOL,
    "plugins/marvin/mcp/server/src/prompts/index.ts",
    "plugins/marvin/commands/reports.md",
    "packages/marvin-mcp-shared/src/help-content.ts",
    "plugins/marvin/mcp/server/src/resources/widgets.ts",
    LIB,
    "docs/commands.md",
    "plugins/marvin/skills/report-export/SKILL.md",
    "docs/design/reports-widget.md",
    "CLAUDE.md",
    "docs/architecture.md",
    "docs/configuration.md",
  ];

  for (const site of PROSE_SITES) {
    const text = read(site);
    for (const group of expected) {
      assert.ok(text.includes(group), `${site} never mentions the "${group}" group`);
    }
  }
});
