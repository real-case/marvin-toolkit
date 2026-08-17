// Tests for the skill-surface / trigger-eval audit.
//
// Every fixture below is chosen so a plausible WRONG implementation yields a
// different value, not merely so the right one passes. The coverage tree has
// EQUAL counts and disjoint names, so a length comparison — the defect being
// repaired — passes it while a set comparison does not. The parity tree pairs
// absent-on-both-sides against flagged-but-unmarked, so a naive `===` against
// undefined fails the first case. The canonical tree carries all four accepted
// forms plus both rejected ones, so neither an over-strict nor an under-strict
// rule survives.
//
// The last two tests spawn the real linter and the real self-test. Both assert
// the VIOLATION TEXT as well as the status, because both processes exit non-zero
// for several reasons that have nothing to do with the rule under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditSkillDatasets,
  readSkillFlags,
  skillDatasetFailures,
  AUDIT_CATEGORIES,
  DATASET_CATEGORIES,
  SURFACE_CATEGORIES,
} from "../scripts/lib/skill-datasets.mjs";
import { validateDataset } from "../evals/trigger/lib/schema.mjs";
import { scaffoldLintRoot } from "./_lint-root.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED_SKILLS = join(repoRoot, "plugins", "marvin", "skills");
const SHIPPED_DATASETS = join(repoRoot, "evals", "trigger", "datasets");

/** A throwaway tree with a skills dir and a datasets dir. */
function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "marvin-skill-datasets-"));
  const skillsDir = join(root, "skills");
  const datasetsDir = join(root, "datasets");
  mkdirSync(skillsDir);
  mkdirSync(datasetsDir);
  return {
    root,
    skillsDir,
    datasetsDir,
    /** Write a SKILL.md. `flag` is the raw frontmatter value, or undefined for no key. */
    skill(name, flag) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      const line = flag === undefined ? "" : `disable-model-invocation: ${flag}\n`;
      writeFileSync(
        join(skillsDir, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} fixture\n${line}---\n\nbody\n`,
      );
    },
    /** Write a dataset. `extra` merges into the top level, `queries` defaults to []. */
    dataset(name, extra = {}) {
      writeFileSync(
        join(datasetsDir, `${name}.json`),
        JSON.stringify({ skill: name, target: name, queries: [], ...extra }, null, 2),
      );
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("coverage is a set comparison, not a count comparison", () => {
  const t = makeTree();
  try {
    // Two skills, two datasets — equal counts, disjoint in one position. A rule
    // that compares lengths sees 2 === 2 and reports nothing.
    t.skill("alpha");
    t.skill("beta");
    t.dataset("alpha");
    t.dataset("gamma");
    // Mirrors run.mjs:87 — the runner skips `_`-prefixed files, so the audit must too.
    t.dataset("_template");

    const audit = auditSkillDatasets({ skillsDir: t.skillsDir, datasetsDir: t.datasetsDir });

    assert.equal(audit.skills.length, audit.datasets.length, "fixture must have equal counts");
    assert.deepEqual(audit.missingDatasets, ["beta"]);
    assert.deepEqual(audit.orphanDatasets, ["gamma"]);
    assert.ok(!audit.datasets.includes("_template"), "_-prefixed files are not datasets");
    assert.deepEqual(audit.orphanDatasets.includes("_template"), false);
  } finally {
    t.cleanup();
  }
});

test("parity normalises an absent flag on both sides to false", () => {
  const t = makeTree();
  try {
    // Absent on BOTH sides is the shipped majority — 35 of 39 datasets omit the
    // field. A naive `dataset.disable_model_invocation === skillFlag` compares
    // undefined against false and reports every one of them.
    t.skill("quiet");
    t.dataset("quiet");
    // Flagged skill whose dataset omits the field: a genuine mismatch.
    t.skill("loud", "true");
    t.dataset("loud");
    // Agreeing pair, to prove the rule is not simply reporting everything flagged.
    t.skill("agreed", "true");
    t.dataset("agreed", { disable_model_invocation: true });
    // Flagged skill with NO dataset at all: reported as missing only, never twice.
    t.skill("orphaned", "true");

    const audit = auditSkillDatasets({ skillsDir: t.skillsDir, datasetsDir: t.datasetsDir });

    assert.deepEqual(audit.parityViolations, [
      { skill: "loud", frontmatter: true, dataset: false },
    ]);
    assert.deepEqual(audit.missingDatasets, ["orphaned"]);
    assert.ok(
      !audit.parityViolations.some((v) => v.skill === "orphaned"),
      "a skill with no dataset is reported under missingDatasets only",
    );
  } finally {
    t.cleanup();
  }
});

test("canonical form accepts the double-quoted literal and rejects a case variant and a single-quoted one", () => {
  const t = makeTree();
  try {
    // The four accepted forms are the INTERSECTION of the three shipped readers.
    t.skill("bare-true", "true");
    t.skill("quoted-true", '"true"');
    t.skill("bare-false", "false");
    t.skill("absent");
    // Rejected: gen-catalog.mjs:81 matches neither, so both would silently drop
    // the flag from the public site while catalog.mjs still honours 'true'.
    t.skill("cased", "True");
    t.skill("single-quoted", "'true'");
    for (const n of [
      "bare-true",
      "quoted-true",
      "bare-false",
      "absent",
      "cased",
      "single-quoted",
    ]) {
      t.dataset(n);
    }
    // Only the two genuinely human-run skills carry the dataset field, so parity
    // stays clean and cannot mask the canonical-form result.
    t.dataset("bare-true", { disable_model_invocation: true });
    t.dataset("quoted-true", { disable_model_invocation: true });

    const audit = auditSkillDatasets({ skillsDir: t.skillsDir, datasetsDir: t.datasetsDir });
    const flags = readSkillFlags(t.skillsDir);

    assert.deepEqual(
      audit.nonCanonicalFlags.map((f) => f.skill).sort(),
      ["cased", "single-quoted"],
      "exactly the two forms no shipped reader agrees on",
    );
    assert.equal(flags.get("quoted-true").human, true, "the quoted form IS human-run");
    assert.equal(flags.get("bare-true").human, true);
    assert.equal(flags.get("bare-false").human, false);
    assert.equal(flags.get("absent").human, false);
    assert.equal(flags.get("absent").canonical, true, "an absent key is canonical");
    assert.equal(
      flags.get("single-quoted").human,
      false,
      "non-canonical never counts as human-run",
    );
    assert.deepEqual(audit.parityViolations, []);
  } finally {
    t.cleanup();
  }
});

test("a competition winner must be reachable in the catalog", () => {
  const t = makeTree();
  try {
    t.skill("subject");
    t.skill("sibling");
    t.skill("human", "true");
    t.dataset("sibling");
    t.dataset("human", { disable_model_invocation: true });
    t.dataset("subject", {
      queries: [
        { id: "ok", kind: "competition", winner: "sibling", note: "n", mock_rate: 0 },
        { id: "ghost", kind: "competition", winner: "reports", note: "n", mock_rate: 0 },
        { id: "hidden", kind: "competition", winner: "human", note: "n", mock_rate: 0 },
      ],
    });

    const audit = auditSkillDatasets({ skillsDir: t.skillsDir, datasetsDir: t.datasetsDir });

    // catalogText renders skills only AND filters human-run ones out, so both are
    // equally unpickable. A rule checking only "is it a directory" misses `hidden`.
    assert.deepEqual(
      audit.unknownWinners.map((w) => [w.queryId, w.reason]),
      [
        ["ghost", "no-skill"],
        ["hidden", "human-run"],
      ],
    );
  } finally {
    t.cleanup();
  }
});

test("notes are required on negatives and competition rows but not positives", () => {
  const t = makeTree();
  try {
    t.skill("subject");
    t.dataset("subject", {
      queries: [
        { id: "p", kind: "positive", mock_rate: 1 },
        { id: "n-ok", kind: "negative", note: "routes elsewhere", mock_rate: 0 },
        { id: "n-bad", kind: "negative", mock_rate: 0 },
        { id: "n-blank", kind: "negative", note: "   ", mock_rate: 0 },
        { id: "no-rate", kind: "positive" },
      ],
    });

    const audit = auditSkillDatasets({ skillsDir: t.skillsDir, datasetsDir: t.datasetsDir });

    assert.deepEqual(
      audit.missingNotes.map((m) => m.queryId),
      ["n-bad", "n-blank"],
      "a whitespace-only note counts as missing; a positive without one does not",
    );
    assert.deepEqual(
      audit.missingMockRate.map((m) => m.queryId),
      ["no-rate"],
    );
  } finally {
    t.cleanup();
  }
});

test("the shipped tree satisfies every enforced invariant", () => {
  const audit = auditSkillDatasets({
    skillsDir: SHIPPED_SKILLS,
    datasetsDir: SHIPPED_DATASETS,
  });
  for (const key of [
    "missingDatasets",
    "orphanDatasets",
    "parityViolations",
    "nonCanonicalFlags",
    "unknownWinners",
    "missingNotes",
    "missingMockRate",
  ]) {
    assert.deepEqual(audit[key], [], `${key}: ${JSON.stringify(audit[key])}`);
  }
  assert.deepEqual(audit.skills, audit.datasets, "skill and dataset name sets are equal");

  // Zero schema warnings is a bar the whole corpus already meets; asserting it
  // here is what stops a new dataset shipping unmeasured.
  for (const name of audit.datasets) {
    const ds = JSON.parse(readFileSync(join(SHIPPED_DATASETS, `${name}.json`), "utf8"));
    const result = validateDataset(ds);
    assert.equal(result.ok, true, `${name}: ${result.errors.join(", ")}`);
    assert.deepEqual(result.warnings, [], `${name} warnings`);
  }
});

test("the two new datasets meet the authoring protocol", () => {
  const NEIGHBOURS = {
    "report-export": ["reports", "sec-report"],
    "widget-preview": ["dashboard", "help"],
  };

  for (const [name, neighbours] of Object.entries(NEIGHBOURS)) {
    const ds = JSON.parse(readFileSync(join(SHIPPED_DATASETS, `${name}.json`), "utf8"));
    const kinds = { positive: 0, negative: 0, competition: 0 };
    for (const q of ds.queries) kinds[q.kind] += 1;

    // Both bounds: the protocol is 8-10, and a lower bound alone would accept a
    // padded dataset as readily as a stub.
    assert.ok(
      kinds.positive >= 8 && kinds.positive <= 10,
      `${name}: ${kinds.positive} positives, protocol wants 8-10`,
    );
    assert.ok(
      kinds.negative >= 8 && kinds.negative <= 10,
      `${name}: ${kinds.negative} negatives, protocol wants 8-10`,
    );

    // The named neighbours are prompts with no SKILL.md, so they are absent from
    // the catalog a decider is shown. Naming one as a winner would make the query
    // pass for the wrong reason; naming it in a note is how the near-miss is justified.
    const winners = ds.queries.filter((q) => q.kind === "competition").map((q) => q.winner);
    const notes = ds.queries
      .filter((q) => q.kind === "negative")
      .map((q) => q.note ?? "")
      .join(" ");
    for (const neighbour of neighbours) {
      assert.ok(!winners.includes(neighbour), `${name}: ${neighbour} must not be a winner`);
      assert.ok(notes.includes(neighbour), `${name}: no negative note mentions ${neighbour}`);
    }
  }
});

test("lint-manifests fails on a violating root and passes on a clean one", () => {
  const t = makeTree();
  try {
    const root = scaffoldLintRoot(t.root);

    // One violation of each category the linter is responsible for.
    root.writeSkill("nodataset");
    root.writeSkill("mismatched", "true");
    root.writeDataset("mismatched");
    root.writeSkill("cased", "True");
    root.writeDataset("cased");

    // And one violation of each category it is NOT responsible for. These belong
    // to the harness and are asserted by self-test.mjs; without them here, widening
    // the linter's `keys` to all seven — or dropping the argument, whose default is
    // all seven — would pass every test in this file.
    root.writeDataset("orphan-only");
    root.writeSkill("noisy");
    root.writeDataset("noisy", {
      queries: [
        { id: "unnoted", kind: "negative" },
        { id: "ghostwinner", kind: "competition", winner: "nosuchskill", note: "n", mock_rate: 0 },
      ],
    });

    const { failed, output } = root.runLinter();
    assert.ok(failed, "the linter must exit non-zero on a violating root");
    assert.match(
      output,
      /lint-manifests: FAILED/,
      "must fail through its own reporter, not a crash",
    );
    assert.match(output, /nodataset/, "names the skill with no dataset");
    assert.match(output, /mismatched/, "names the parity mismatch");
    assert.match(output, /"True"/, "names the non-canonical raw value");
    assert.doesNotMatch(output, /orphan-only/, "orphan datasets belong to the self-test, not here");
    assert.doesNotMatch(output, /unnoted/, "the note rule belongs to the self-test");
    assert.doesNotMatch(output, /ghostwinner/, "winner reachability belongs to the self-test");

    // Same root with only the linter's OWN violations removed: the harness-owned
    // ones stay, so a clean exit here is also proof that the linter ignores them.
    rmSync(join(root.skillsDir, "nodataset"), { recursive: true, force: true });
    rmSync(join(root.skillsDir, "cased"), { recursive: true, force: true });
    rmSync(join(root.datasetsDir, "cased.json"), { force: true });
    root.writeDataset("mismatched", { disable_model_invocation: true });

    const clean = root.runLinter();
    assert.equal(clean.failed, false, `clean root should pass, got: ${clean.output}`);
    assert.match(clean.output, /lint-manifests: OK/);
  } finally {
    t.cleanup();
  }
});

test("the self-test fails on a mismatched fixture tree and passes on the shipped one", () => {
  const t = makeTree();
  try {
    // The fixture must satisfy every PRE-EXISTING self-test check, or the run goes
    // red for a reason unrelated to coverage and the assertion proves nothing:
    // self-test.mjs:51-56 hard-codes adr-accept and commit, and catalog.mjs throws
    // on absent frontmatter, an absent name/description, or a name that differs
    // from its directory.
    t.skill("adr-accept", "true");
    t.skill("commit");
    t.dataset("adr-accept", { disable_model_invocation: true });
    t.dataset("commit");
    // The mismatch under test, in both directions at once.
    t.skill("undocumented");
    t.dataset("stray");

    const run = () =>
      execFileSync(
        "node",
        [
          join(repoRoot, "evals", "trigger", "self-test.mjs"),
          "--skills",
          t.skillsDir,
          "--datasets",
          t.datasetsDir,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );

    let failed = false;
    let output = "";
    try {
      run();
    } catch (e) {
      failed = true;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    assert.ok(failed, "the self-test must exit non-zero when the name sets differ");
    assert.match(output, /undocumented/, "names the skill with no dataset");
    assert.match(output, /stray/, "names the dataset with no skill");
    assert.match(
      output,
      /✓ catalog marks disable-model-invocation/,
      "the pre-existing checks must PASS on this fixture, so only coverage can fail it",
    );

    // And the shipped tree is green.
    const shipped = execFileSync("node", [join(repoRoot, "evals", "trigger", "self-test.mjs")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(shipped, /self-test OK/);
  } finally {
    t.cleanup();
  }
});

// The tempting guard is `if (existsSync(a) && existsSync(b))`, which turns a blocking
// gate green over a skill surface with zero datasets. That is the "guard that cannot
// fail" defect a32a288 repaired in the drift guards, and it is invisible to every other
// test here because they all create both directories.
//
// BOTH branches get a witness. Pinning only the datasets branch would still accept a
// guard that is fail-open on the skills half — and that half is the worse silent state,
// since rule 5's own loop is `existsSync`-guarded too, so the entire skill surface
// disappearing would otherwise produce zero failures and print `lint-manifests: OK`.
for (const missing of ["skills", "datasets"]) {
  const label = missing === "skills" ? "plugins/marvin/skills" : "evals/trigger/datasets";

  test(`lint-manifests fails when ${label} is missing`, () => {
    const t = makeTree();
    try {
      const root = scaffoldLintRoot(t.root, {
        skills: missing !== "skills",
        datasets: missing !== "datasets",
      });
      // The surviving directory is populated and internally consistent, so nothing
      // but the absence itself can produce a failure.
      if (missing === "skills") {
        root.writeDataset("lonely");
      } else {
        root.writeSkill("lonely");
      }

      const { failed, output } = root.runLinter();

      assert.ok(failed, `an absent ${label} must fail, not silently skip the rules`);
      assert.match(output, new RegExp(`${label.replace("/", "\\/")}: directory is missing`));
    } finally {
      t.cleanup();
    }
  });
}

test("skillDatasetFailures reports only the categories it is asked for", () => {
  const t = makeTree();
  try {
    t.skill("nodataset");
    t.skill("subject");
    t.dataset("subject", {
      queries: [{ id: "n", kind: "negative", mock_rate: 0 }],
    });

    const all = skillDatasetFailures({ skillsDir: t.skillsDir, datasetsDir: t.datasetsDir });
    const scoped = skillDatasetFailures({
      skillsDir: t.skillsDir,
      datasetsDir: t.datasetsDir,
      keys: ["missingDatasets"],
    });

    assert.ok(all.some((l) => l.includes("nodataset")));
    assert.ok(all.some((l) => l.includes("needs a note")));
    assert.deepEqual(scoped.length, 1, "the keys filter must actually narrow the report");
    assert.match(scoped[0], /nodataset/);
  } finally {
    t.cleanup();
  }
});

// The only thing in the repository that can fail on the category split.
//
// Measured: nothing else imports a category constant — the consumers are
// self-test.mjs, lint-skills.mjs and this module's own `keys` default. And because
// a category whose input was not supplied is EMPTY, the self-test's
// `filter(key => audit[key].length > 0)` yields `{}` for a thirteen-entry list
// exactly as for a seven-entry one. So an implementer who appends the six surface
// categories to AUDIT_CATEGORIES and never opens self-test.mjs satisfies every
// other check in the tree while widening a claim that call site cannot substantiate
// — it supplies neither agentsDir, commandsDir, packDir nor promptNames.
test("the category list is split so the self-test claims only what its call site supplies", () => {
  assert.deepEqual(DATASET_CATEGORIES, [
    "missingDatasets",
    "orphanDatasets",
    "parityViolations",
    "nonCanonicalFlags",
    "unknownWinners",
    "missingNotes",
    "missingMockRate",
  ]);
  assert.deepEqual(SURFACE_CATEGORIES, [
    "unknownFrontmatterKeys",
    "badDescriptions",
    "nameMismatches",
    "danglingSkillRefs",
    "untooledAgents",
    "wrapperDrift",
  ]);
  assert.deepEqual(
    AUDIT_CATEGORIES,
    [...DATASET_CATEGORIES, ...SURFACE_CATEGORIES],
    "the default key set must still mean everything",
  );

  const selfTest = readFileSync(join(repoRoot, "evals", "trigger", "self-test.mjs"), "utf8");
  assert.match(selfTest, /import \{[^}]*DATASET_CATEGORIES[^}]*\}/, "imports the dataset half");
  assert.match(selfTest, /DATASET_CATEGORIES\.filter\(/, "and iterates that half, not the union");
  assert.doesNotMatch(
    selfTest,
    /AUDIT_CATEGORIES/,
    "the self-test must not reach the surface categories at all",
  );
});
