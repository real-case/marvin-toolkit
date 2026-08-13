import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * Regression fence over the two shipped spec templates.
 *
 * The DoR gate's residue check only reports a `{…}` stub that is single-line,
 * letter- or `#`-leading, and at most seventy-one inner characters. A section
 * whose only stub falls outside that shape is invisible to the gate, and since
 * the section-presence check reads headings alone, such a section can ship
 * entirely unfilled with a PASS. The property asserted here is therefore stated
 * over **sections**: every `##` section that requires author fill-in carries at
 * least one stub the shipped scanner reports.
 *
 * The scanner is the shipped one — `checkPlaceholders` compiled from
 * `src/tools/spec.ts` via `_tsload.mjs` — so this fence can never disagree with
 * the gate about what counts, and it does no stripping of its own (the function
 * strips fenced blocks and inline code itself). It is called once **per
 * section**, never once per file: a whole-file call truncates its detail to
 * eight unique stubs while each template carries about twenty-six.
 */
const { checkPlaceholders } = await importTs("src/tools/spec.ts");

const here = dirname(fileURLToPath(import.meta.url));
// test → server → mcp → marvin
const templatesDir = join(here, "..", "..", "..", "skills", "task-start", "references");

/**
 * The `##` sections of each template that require author fill-in, pinned rather
 * than derived from the file: a section that loses its only stub must fail here,
 * not silently drop out of the loop. `## Spec Contract` and `## Host Bindings`
 * are excluded by decision — their fill-in lives inside fenced YAML the scanner
 * strips by design.
 */
const FILL_IN_SECTIONS = {
  "feature-spec-template.md": [
    "Goal",
    "Context",
    "Data & Config",
    "Chosen Approach",
    "Why this over alternatives",
    "Test Plan",
    "Definition of Done",
    "Non-goals",
    "Deferred slices",
    "Assumptions",
    "Open Questions",
    "Security / NFR",
    "Critic Verdict & Overrides",
    "Design Notes",
    "Future Considerations",
  ],
  "bugfix-spec-template.md": [
    "Problem",
    "Expected Behavior",
    "Reproduction Steps",
    "Root Cause Analysis",
    "Severity & Impact",
    "Fix Approach",
    "Regression Test Specification",
    "Definition of Done",
    "Non-goals",
    "Deferred slices",
    "Assumptions",
    "Open Questions",
    "Critic Verdict & Overrides",
    "Design Notes",
  ],
};

/** Split a template on its `##` headings → [heading, body] in file order. */
function sections(raw) {
  const out = [];
  let heading = null;
  let buf = [];
  const flush = () => {
    if (heading !== null) out.push([heading, buf.join("\n")]);
  };
  for (const line of raw.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      heading = m[1];
      buf = [];
    } else if (heading !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

const templates = Object.keys(FILL_IN_SECTIONS).map((file) => ({
  file,
  raw: readFileSync(join(templatesDir, file), "utf8"),
}));

test("every fill-in section of the shipped templates carries a stub the shipped scanner reports", () => {
  for (const { file, raw } of templates) {
    const pinned = FILL_IN_SECTIONS[file];
    const parsed = sections(raw);
    const bodies = new Map(parsed);

    // The pinned headings are the file's headings, not a stale copy of them.
    for (const heading of pinned) {
      assert.ok(bodies.has(heading), `${file}: pinned section "${heading}" is not in the template`);
    }

    // The set of sections the scanner reports is exactly the pinned list — a
    // section losing its only reachable stub fails loudly, and a newly stubbed
    // section must be pinned deliberately. Compared as sets: heading order is
    // not the property under test, so reordering two `##` sections — which
    // changes nothing about stub coverage — must not fail here.
    const reported = parsed
      .filter(([, body]) => checkPlaceholders(body).status === "fail")
      .map(([heading]) => heading);
    assert.deepEqual(
      [...reported].sort(),
      [...pinned].sort(),
      `${file}: sections carrying a reported stub differ from the pinned fill-in list`,
    );

    // …and every pinned section reports at least one stub on its own.
    for (const heading of pinned) {
      const check = checkPlaceholders(bodies.get(heading));
      assert.equal(
        check.status,
        "fail",
        `${file}: "${heading}" carries no stub the DoR gate can see — an unfilled section would pass`,
      );
    }
  }
});

test("both templates state that none is recorded as an advisory warning", () => {
  for (const { file, raw } of templates) {
    const assumptions = new Map(sections(raw)).get("Assumptions");
    assert.ok(assumptions, `${file}: no Assumptions section`);
    assert.match(assumptions, /"none"/, `${file}: Assumptions does not bless "none"`);
    assert.match(
      assumptions,
      /advisory warning/,
      `${file}: Assumptions does not say the DoR gate records "none" as an advisory warning`,
    );
  }
});
