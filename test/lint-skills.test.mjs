// Tests for the authored-surface linter.
//
// Every case spawns the REAL runner through the shared scaffolder and asserts the
// failure TEXT as well as the non-zero status — the standard the sibling suite
// states, because the runner exits 1 for several reasons unrelated to the rule
// under test.
//
// The six rules are one table, and the table's shape is asserted against
// SURFACE_CATEGORIES: a body covering three would otherwise satisfy the criterion
// exactly as one covering six, and a seventh rule added later would pass
// unwitnessed. The clean-root case is what stops a checker that rejects everything
// from passing all six.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SURFACE_CATEGORIES } from "../scripts/lib/skill-datasets.mjs";
import { scaffoldLintRoot } from "./_lint-root.mjs";

const LINTER = "scripts/lint-skills.mjs";

/**
 * A root that passes all six rules: one skill, one agent with a `tools:`
 * allowlist, one wrapper for the one non-track prompt, and a resolving reference.
 * Each table row below breaks exactly one thing in it.
 */
function cleanRoot(root) {
  const r = scaffoldLintRoot(root, { script: LINTER });
  r.writeSkill("alpha");
  r.writeAgent("marvin-probe");
  r.writeCommand("alpha", "description: alpha fixture", "Read `skills/alpha/SKILL.md` first.");
  r.writePrompts(["alpha", "track-list"]);
  return r;
}

/** Run `fn` against a throwaway root; the root is always removed. */
function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "marvin-lint-skills-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const OVER_BUDGET = "x".repeat(1100);

/** One row per SURFACE_CATEGORIES entry: break one rule, expect it named. */
const ROWS = [
  {
    category: "unknownFrontmatterKeys",
    label: "a command carrying a key only agents may use",
    break: (r) => r.writeCommand("alpha", "description: alpha fixture\nmodel: opus"),
    expected: /commands: commands\/alpha\.md carries frontmatter key "model"/,
  },
  {
    category: "badDescriptions",
    label: "a description over the budget",
    break: (r) =>
      r.writeAgent("marvin-probe", `name: marvin-probe\ndescription: ${OVER_BUDGET}\ntools: Read`),
    expected:
      /agents: agents\/marvin-probe\.md description is 1100 characters, over the 1024 budget/,
  },
  {
    category: "nameMismatches",
    label: "an agent whose name disagrees with its filename",
    break: (r) => r.writeAgent("marvin-probe", "name: marvin-other\ndescription: d\ntools: Read"),
    expected:
      /agents: agents\/marvin-probe\.md declares name "marvin-other" but its filename is "marvin-probe"/,
  },
  {
    category: "danglingSkillRefs",
    label: "a body pointing at a skill that does not exist",
    break: (r) =>
      r.writeCommand("alpha", "description: alpha fixture", "Read `skills/nosuch/SKILL.md`."),
    expected:
      /commands: commands\/alpha\.md references "skills\/nosuch\/SKILL\.md", which does not resolve/,
  },
  {
    category: "untooledAgents",
    label: "an unwhitelisted agent with no tools allowlist",
    break: (r) => r.writeAgent("marvin-probe", "name: marvin-probe\ndescription: d"),
    expected: /agents: agents\/marvin-probe\.md omits a `tools:` allowlist/,
  },
  {
    category: "wrapperDrift",
    label: "a non-track prompt with no wrapper",
    break: (r) => r.writePrompts(["alpha", "beta", "track-list"]),
    expected: /commands: prompt "beta" has no commands\/beta\.md/,
  },
];

test("every new check rejects a violating root, by message — one row per SURFACE_CATEGORIES entry", () => {
  // Shape first: without this a body covering three rules passes as readily as one
  // covering six, and a seventh rule added later slips in unwitnessed.
  assert.equal(ROWS.length, SURFACE_CATEGORIES.length, "one row per surface category");
  assert.deepEqual(
    ROWS.map((r) => r.category).sort(),
    [...SURFACE_CATEGORIES].sort(),
    "the rows cover each surface category exactly once",
  );

  for (const row of ROWS) {
    withRoot((root) => {
      const r = cleanRoot(root);
      row.break(r);
      const { failed, output } = r.runLinter();
      assert.ok(failed, `${row.category}: ${row.label} must exit non-zero`);
      assert.match(
        output,
        /lint-skills: FAILED/,
        `${row.category}: must fail through its reporter`,
      );
      assert.match(output, row.expected, `${row.category}: ${output}`);
    });
  }
});

test("the shipped-shape clean root passes", () => {
  withRoot((root) => {
    const { failed, output } = cleanRoot(root).runLinter();
    assert.equal(failed, false, `clean root should pass, got: ${output}`);
    assert.match(output, /lint-skills: OK/);
  });
});

// Quoting a scalar is legal YAML, and the toolchain already accepts it: the reader
// in evals/trigger/lib/catalog.mjs enforces `name` and `description` over these same
// files, inside the blocking `eval:self-test` step, and strips the quotes before
// comparing. A linter that judged the raw scalar would redden CI on `name: "commit"`
// — a third reader disagreeing with the two it joins, over punctuation rather than
// over a rule.
test("quoted frontmatter scalars are read as their unquoted value", () => {
  withRoot((root) => {
    const r = cleanRoot(root);
    writeFileSync(
      join(r.skillsDir, "alpha", "SKILL.md"),
      '---\nname: "alpha"\ndescription: "alpha fixture"\n---\n\nbody\n',
    );
    r.writeAgent("marvin-probe", "name: 'marvin-probe'\ndescription: 'probe fixture'\ntools: Read");
    r.writeCommand("alpha", 'description: "alpha fixture"', "Read `skills/alpha/SKILL.md` first.");

    const { failed, output } = r.runLinter();

    assert.equal(failed, false, `quoted scalars should pass, got: ${output}`);
    assert.match(output, /lint-skills: OK/);
  });

  // Stripping the quotes must not disable the rule underneath: a quoted name that
  // genuinely disagrees with its directory is still reported, by the value every
  // reader sees rather than by the doubled-quote raw one.
  withRoot((root) => {
    const r = cleanRoot(root);
    writeFileSync(
      join(r.skillsDir, "alpha", "SKILL.md"),
      '---\nname: "other"\ndescription: alpha fixture\n---\n\nbody\n',
    );

    const { failed, output } = r.runLinter();

    assert.ok(failed, "a quoted name that disagrees with its directory must still fail");
    assert.match(
      output,
      /skills: skills\/alpha\/SKILL\.md declares name "other" but its directory is "alpha"/,
    );
  });
});

// The idiom occurs four times in the shipped tree — it is how the repository
// explains that a `skills/` path resolves through all three entry points — so a
// naive rule that treats every `skills/`-prefixed token as a path makes this linter
// fail permanently on the tree it guards. Too narrow is the other fatal direction:
// requiring a leading backtick, which most real references happen to carry, would
// never see a genuinely broken reference written without one.
test("the skills-path prose idiom is not reported as a dangling reference", () => {
  withRoot((root) => {
    const r = cleanRoot(root);
    r.writeCommand(
      "alpha",
      "description: alpha fixture",
      "The `skills/…` path resolves through all three entry points.\n" +
        "Read skills/nosuch/SKILL.md, then skills/alpha/SKILL.md.\n",
    );

    const { failed, output } = r.runLinter();

    assert.ok(failed, "the genuine dangling reference must still fail the run");
    assert.match(output, /references "skills\/nosuch\/SKILL\.md"/, "the broken one is reported");
    assert.doesNotMatch(output, /skills\/…/, "the ellipsis idiom is prose, not a path");
    assert.doesNotMatch(output, /skills\/alpha/, "a resolving reference is not reported");
    assert.equal(
      output.split("\n").filter((l) => l.includes("does not resolve")).length,
      1,
      `exactly one dangling reference, got: ${output}`,
    );
  });
});

// The module is fail-OPEN on inputs — a check whose directory was not supplied is
// silent — so the runner has to be fail-closed, or a tree with no commands/ at all
// reports OK. Both halves of that division need a witness; this is the second.
test("an absent surface directory fails the run instead of skipping its rules", () => {
  withRoot((root) => {
    const r = scaffoldLintRoot(root, { script: LINTER, commands: false });
    r.writeSkill("alpha");
    r.writeAgent("marvin-probe");
    r.writePrompts(["alpha"]);

    const { failed, output } = r.runLinter();

    assert.ok(failed, "an absent commands/ must fail, not silently skip the wrapper rule");
    assert.match(output, /plugins\/marvin\/commands: directory is missing/);
  });
});

// If the transpile ever throws — a runtime import added to prompts/index.ts would
// do it — the runner must FAIL, not skip. A registry it could not read is exactly
// the shape of a guard that quietly stops guarding: wrapper coverage would report
// nothing and the run would print OK.
test("an unreadable prompt registry fails the run", () => {
  withRoot((root) => {
    const r = cleanRoot(root);
    writeFileSync(
      join(root, "plugins", "marvin", "mcp", "server", "src", "prompts", "index.ts"),
      // A RUNTIME import, not a type-only one: a bare specifier in a value position
      // survives the transpile and cannot resolve from a data: URL. (A type-only
      // import is elided, which is exactly why the registry is readable today.)
      'import { PROMPT_NAME } from "@marvin-toolkit/mcp-shared";\n' +
        "export const PROMPTS = [{ name: PROMPT_NAME }];\n",
    );

    const { failed, output } = r.runLinter();

    assert.ok(failed, "an unreadable registry must fail, not silently skip wrapper coverage");
    assert.match(output, /the prompt registry could not be read/);
  });
});
