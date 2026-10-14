// The audit family's own structural pins. Four invariants no other gate covers:
//
//   1. The catalogue in audit-index.md and the files under audits/ are the same set,
//      in both directions. The index is the routing table audit-run resolves against,
//      so a spec with no row is unreachable and a row with no spec is a dead end.
//   2. Every spec follows the thirteen-section template of spec-authoring.md, and uses
//      only the S0-S4 vocabulary the contract pins.
//   3. Every `skills/…` path written anywhere in the family resolves under the plugin
//      root. scripts/lib/skill-datasets.mjs deliberately does NOT walk reference files
//      ("a `skills/…` path written in a reference file is knowingly unguarded"), and
//      this family is mostly reference files that point at one another.
//   4. The register schema in report-contract.md §6 and the required-field tuple in
//      references/tools/audit-verify.py are the same set. They are two statements of
//      one contract — the prose a report is written to, and the check that fails the
//      release — and a drift between them fails releases for a field the contract
//      never asked for, or passes a report missing one it did.
//
// The family ships as skills with no prompt and no commands/ wrapper, so lint-skills
// rule 6 has nothing to say about it; only rule 7 of lint-manifests reaches it, via
// the trigger datasets keyed on the skill directory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(repoRoot, "plugins", "marvin");
const refs = join(packDir, "skills", "audit-run", "references");
const auditsDir = join(refs, "audits");

const read = (path) => readFileSync(path, "utf8");

/** Every id/slug pair in the catalogue table of audit-index.md. */
function catalogueRows() {
  const rows = [];
  for (const line of read(join(refs, "audit-index.md")).split("\n")) {
    const match = line.match(/^\|\s*(A-\d{2})\s*\|\s*`([a-z0-9-]+)`\s*\|/);
    if (match) rows.push({ id: match[1], slug: match[2] });
  }
  return rows;
}

/** Every authored spec file, as an id/slug pair derived from its filename. */
function specFiles() {
  return readdirSync(auditsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const match = f.match(/^(A-\d{2})-([a-z0-9-]+)\.md$/);
      assert.ok(match, `audits/${f}: filename must be A-XX-<kebab-slug>.md`);
      return { id: match[1], slug: match[2], file: f };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

test("the catalogue and the spec files are the same set", () => {
  const key = (r) => `${r.id}-${r.slug}`;
  const catalogue = catalogueRows().map(key).sort();
  const specs = specFiles().map(key).sort();

  assert.equal(catalogue.length, 22, "the programme is twenty-two audits");
  assert.deepEqual(specs, catalogue, "every catalogue row has a spec file and the reverse");
});

test("the dependency matrix lists every audit exactly once", () => {
  const text = read(join(refs, "audit-index.md"));
  // Bounded to its own section: later tables in the same file also open rows with an
  // audit id, and an unbounded slice would count them as matrix rows.
  const start = text.indexOf("## Dependency matrix");
  assert.ok(start !== -1, "audit-index.md must carry a dependency matrix");
  const rest = text.indexOf("\n## ", start + 1);
  const matrix = text.slice(start, rest === -1 ? undefined : rest);
  const listed = [...matrix.matchAll(/^\|\s*(A-\d{2})\s*\|/gm)].map((m) => m[1]);
  const expected = catalogueRows().map((r) => r.id);
  assert.deepEqual([...listed].sort(), [...expected].sort());
  assert.equal(new Set(listed).size, listed.length, "no audit appears twice in the matrix");
});

test("every spec follows the thirteen-section template", () => {
  for (const spec of specFiles()) {
    const text = read(join(auditsDir, spec.file));
    const sections = [...text.matchAll(/^##\s+(\d{1,2})\.\s+(.+)$/gm)].map((m) => Number(m[1]));
    assert.deepEqual(
      sections,
      Array.from({ length: 13 }, (_, i) => i + 1),
      `audits/${spec.file}: sections must be 1…13 in order (see references/spec-authoring.md)`,
    );
    assert.match(
      text,
      /^# A-\d{2} — .+$/m,
      `audits/${spec.file}: must open with an "# A-XX — <name>" title`,
    );
    assert.match(
      text,
      /\*\*Audit question\.\*\*/,
      `audits/${spec.file}: must state its audit question`,
    );
  }
});

test("the family uses only the S0-S4 severity vocabulary", () => {
  const files = [
    ...specFiles().map((s) => ({ label: `audits/${s.file}`, path: join(auditsDir, s.file) })),
    { label: "report-contract.md", path: join(refs, "report-contract.md") },
  ];
  for (const { label, path } of files) {
    for (const match of read(path).matchAll(/\bS(\d+)\b/g)) {
      const level = Number(match[1]);
      assert.ok(level >= 0 && level <= 4, `${label}: severity S${level} is outside S0…S4`);
    }
  }
});

test("every skills/… path written in the family resolves", () => {
  const surfaces = [
    join(packDir, "skills", "audit-run", "SKILL.md"),
    join(packDir, "skills", "audit-plan", "SKILL.md"),
    join(packDir, "skills", "audit-summary", "SKILL.md"),
    ...readdirSync(refs)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(refs, f)),
    ...specFiles().map((s) => join(auditsDir, s.file)),
  ];
  for (const path of surfaces) {
    // Same extraction rule as scripts/lib/skill-datasets.mjs: at least two segments
    // and a file extension, so the `skills/…` prose idiom is not read as a path.
    for (const raw of read(path).match(/skills\/[^\s`"'()[\]{}<>|]+/g) ?? []) {
      const ref = raw.replace(/[.,;:!?]+$/, "");
      if (!/^skills\/[^/]+\/[^/]+/.test(ref) || !/\.[A-Za-z0-9]+$/.test(ref)) continue;
      assert.ok(
        existsSync(join(packDir, ref)),
        `${path.slice(repoRoot.length + 1)}: "${ref}" does not resolve under the plugin root`,
      );
    }
  }
});

test("the register schema and the release check agree on the required fields", () => {
  const contract = read(join(refs, "report-contract.md"));
  const block = contract.match(/```json findings\s*\n([\s\S]*?)\n```/);
  assert.ok(block, "report-contract.md §6 must carry a ```json findings``` example");
  const example = JSON.parse(block[1]);
  assert.equal(example.length, 1, "the example carries exactly one finding");

  const verifier = read(join(refs, "tools", "audit-verify.py"));
  const tuple = verifier.match(/required = \(([\s\S]*?)\)/);
  assert.ok(tuple, "audit-verify.py must declare a `required` tuple");
  const required = [...tuple[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  assert.deepEqual(
    Object.keys(example[0]).sort(),
    [...required].sort(),
    "the contract's example and audit-verify.py's required tuple must be the same field set",
  );

  // The consolidated register is the same schema plus its two additive fields.
  const summary = read(join(packDir, "skills", "audit-summary", "SKILL.md"));
  const merged = summary.match(/```json\s*\n(\{[\s\S]*?"severity_resolved_from"[\s\S]*?\})\n```/);
  assert.ok(merged, "audit-summary must show the consolidated register entry");
  const keys = Object.keys(JSON.parse(merged[1]));
  for (const field of required) {
    assert.ok(keys.includes(field), `the consolidated entry drops the required field "${field}"`);
  }
  assert.ok(keys.includes("sources"), "the consolidated entry must carry `sources`");
});

test("the release generators ship and are wired into the procedure", () => {
  const release = read(join(refs, "pdf-release.md"));
  for (const script of ["audit-pdf.py", "audit-verify.py"]) {
    const path = join(refs, "tools", script);
    assert.ok(existsSync(path), `references/tools/${script} must ship with the skill`);
    assert.ok(read(path).length > 1000, `references/tools/${script} looks truncated`);
    assert.ok(
      release.includes(`tools/${script}`),
      `pdf-release.md must tell the run how to reach ${script}`,
    );
  }
  // The font check is the reason the generator exists rather than a one-line pandoc call.
  assert.match(
    read(join(refs, "tools", "audit-pdf.py")),
    /CYRILLIC_PROBE/,
    "audit-pdf.py must verify Cyrillic coverage before registering a font",
  );
});

test("every contract cross-reference resolves", () => {
  const contract = read(join(refs, "report-contract.md"));
  // Derived from the contract's own headings, not hard-coded: the day an §11 is added,
  // the references that name it start passing rather than the test needing an edit.
  const sections = new Set([...contract.matchAll(/^##\s+(\d+)\.\s/gm)].map((m) => Number(m[1])));
  assert.ok(sections.size >= 9, "the contract must expose numbered sections");

  const surfaces = [
    ...["audit-run", "audit-plan", "audit-summary"].map((s) => ({
      label: `skills/${s}/SKILL.md`,
      path: join(packDir, "skills", s, "SKILL.md"),
    })),
    ...readdirSync(refs)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ label: `references/${f}`, path: join(refs, f) })),
    ...specFiles().map((s) => ({ label: `audits/${s.file}`, path: join(auditsDir, s.file) })),
  ];
  for (const { label, path } of surfaces) {
    const text = read(path);
    // `report-contract.md §6`, `report-contract.md` §6, and the sub-numbered form that
    // does not exist — §10.11 was written once and pointed at a checklist with no items.
    for (const m of text.matchAll(/report-contract\.md`?\s*§(\d+)(\.\d+)?/g)) {
      assert.ok(
        !m[2],
        `${label}: "report-contract.md §${m[1]}${m[2]}" — the contract has no sub-numbering`,
      );
      assert.ok(
        sections.has(Number(m[1])),
        `${label}: references report-contract.md §${m[1]}, which the contract does not have`,
      );
    }
  }
});

test("the Origin column carries one of the two decided values", () => {
  // The column's whole function is to say whether a row may be re-severitised when two
  // audits collide, so a compound or absent value leaves that question open.
  const allowed = new Set(["requirements", "derived"]);
  for (const spec of specFiles()) {
    const lines = read(join(auditsDir, spec.file)).split("\n");
    const header = lines.findIndex((l) => /^\|.*\bOrigin\b.*\|/.test(l) && l.includes("Severity"));
    assert.ok(
      header !== -1,
      `audits/${spec.file}: §6 needs a table with a Severity and an Origin column`,
    );
    // Split on UNESCAPED pipes only. A cell carrying a regex alternation writes `\|`,
    // which is one character of content and not a column boundary — A-10's timezone row
    // legitimately does, and a naive split reads it as eleven columns.
    const PIPE = " ";
    const cells = (line) =>
      line
        .replaceAll("\\|", PIPE)
        .split("|")
        .slice(1, -1)
        .map((c) => c.replaceAll(PIPE, "\\|").trim());
    const column = cells(lines[header]).findIndex((c) => c === "Origin");

    let rows = 0;
    for (let i = header + 2; i < lines.length && lines[i].startsWith("|"); i++) {
      const value = cells(lines[i])[column];
      if (value === undefined) continue;
      rows++;
      assert.ok(
        allowed.has(value.replace(/[`*]/g, "")),
        `audits/${spec.file}:${i + 1}: Origin is "${value}" — it must be requirements or derived`,
      );
    }
    assert.ok(rows > 0, `audits/${spec.file}: §6's threshold table has no rows`);
  }
});

test("specs stay within the declared length budget", () => {
  // 150-250 lines, the budget spec-authoring.md's checklist states. The ceiling is the
  // one that carries meaning: over it, a spec is usually filing a condition another audit
  // owns, or restating the contract.
  for (const spec of specFiles()) {
    // `wc -l` semantics: a trailing newline terminates the last line, it does not add one.
    const lines = read(join(auditsDir, spec.file)).replace(/\n$/, "").split("\n").length;
    assert.ok(
      lines >= 150 && lines <= 250,
      `audits/${spec.file}: ${lines} lines, outside the 150-250 budget in spec-authoring.md`,
    );
  }
});
