import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

/** One `adr` tools/call against the live stdio server. */
async function callAdr(projectDir, args) {
  const result = await callTool("adr", args, { env: { CLAUDE_PROJECT_DIR: projectDir } });
  return {
    text: result.content.map((c) => c.text).join("\n"),
    isError: !!result.isError,
    structured: result.structuredContent,
  };
}

const audit = (proj) => callAdr(proj, { action: "audit" });

function freshProject() {
  return mkdtempSync(join(tmpdir(), "marvin-adr-audit-"));
}

const id4 = (n) => String(n).padStart(4, "0");

function tableAdr({
  number,
  title,
  status = "**Accepted**",
  date = "2026-07-01",
  supersedes = "—",
  supersededBy = "—",
  sections,
}) {
  return [
    `# ADR ${id4(number)} — ${title}`,
    "",
    "| Field         | Value |",
    "| ------------- | ----- |",
    `| Status        | ${status} |`,
    `| Date          | ${date} |`,
    `| Supersedes    | ${supersedes} |`,
    `| Superseded by | ${supersededBy} |`,
    "",
    sections ?? "## Context\n\nWhy.\n\n## Decision\n\nWhat.\n\n## Consequences\n\nSo.",
    "",
  ].join("\n");
}

function seed(proj, filename, content) {
  const dir = join(proj, "docs", "adr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

function kindsOf(result) {
  return result.structured.findings.map((f) => f.kind).sort();
}

function findingsOf(result, kind) {
  return result.structured.findings.filter((f) => f.kind === kind);
}

// ── clean corpus ───────────────────────────────────────────────────────────

test("audit: a consistent corpus is clean (ok, no findings, no isError)", async () => {
  const proj = freshProject();
  try {
    seed(
      proj,
      "0001-old.md",
      tableAdr({
        number: 1,
        title: "Old",
        status: "**Superseded** by [ADR-0002](0002-new.md)",
        supersededBy: "[ADR-0002](0002-new.md)",
      }),
    );
    seed(
      proj,
      "0002-new.md",
      tableAdr({
        number: 2,
        title: "New",
        supersedes: "[ADR-0001](0001-old.md)",
        sections: "## Context\n\nExtends ADR-0001.\n\n## Decision\n\nX.\n\n## Consequences\n\nY.",
      }),
    );
    const result = await audit(proj);
    assert.equal(result.isError, false, result.text);
    assert.equal(result.structured.ok, true);
    assert.equal(result.structured.checked, 2);
    assert.deepEqual(result.structured.findings, []);
    assert.match(result.text, /Corpus clean/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── one lint class per corpus ──────────────────────────────────────────────

test("audit: malformed files are surfaced as error findings", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-good.md", tableAdr({ number: 1, title: "Good" }));
    seed(proj, "0002-broken.md", "# ADR 0002 — Broken\n\nNo header of either style.\n");
    const result = await audit(proj);
    assert.equal(result.isError, true);
    assert.equal(result.structured.ok, false);
    const findings = findingsOf(result, "malformed");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    assert.equal(findings[0].number, 2);
    assert.match(findings[0].message, /no status header/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("audit: an out-of-vocabulary status is its own lint class", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-draft.md", tableAdr({ number: 1, title: "Draft", status: "**Draft**" }));
    const result = await audit(proj);
    assert.equal(result.structured.ok, false);
    const findings = findingsOf(result, "invalid-status");
    assert.equal(findings.length, 1);
    assert.match(
      findings[0].message,
      /proposed \| accepted \| deprecated \| superseded \| rejected/,
    );
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("audit: duplicate numbers are errors, numbering holes are warnings", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-one.md", tableAdr({ number: 1, title: "One" }));
    seed(proj, "0001-also-one.md", tableAdr({ number: 1, title: "Also one" }));
    seed(proj, "0004-four.md", tableAdr({ number: 4, title: "Four" }));
    const result = await audit(proj);
    assert.equal(result.structured.ok, false);

    const dup = findingsOf(result, "duplicate-number");
    assert.equal(dup.length, 1);
    assert.equal(dup[0].severity, "error");
    assert.match(dup[0].message, /0001-also-one\.md/);
    assert.match(dup[0].message, /0001-one\.md/);

    const holes = findingsOf(result, "numbering-hole");
    assert.equal(holes.length, 1);
    assert.equal(holes[0].severity, "warning");
    assert.match(holes[0].message, /0002, 0003/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("audit: dangling ADR references are errors; code spans are exempt", async () => {
  const proj = freshProject();
  try {
    seed(
      proj,
      "0001-dangling.md",
      tableAdr({
        number: 1,
        title: "Dangling",
        sections:
          "## Context\n\nBuilds on ADR-0777.\n\n## Decision\n\nAn example in code: `see ADR-0888`.\n\n## Consequences\n\nNone.",
      }),
    );
    const result = await audit(proj);
    assert.equal(result.structured.ok, false);
    const findings = findingsOf(result, "dangling-reference");
    assert.equal(findings.length, 1, JSON.stringify(result.structured.findings));
    assert.match(findings[0].message, /ADR-0777/);
    assert.doesNotMatch(result.text, /ADR-0888/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("audit: broken supersede pairs — one-way links and status mismatches", async () => {
  const proj = freshProject();
  try {
    // 1 supersedes 2, but 2 carries no back-link (and stays accepted).
    seed(
      proj,
      "0001-fwd.md",
      tableAdr({ number: 1, title: "Fwd", supersedes: "[ADR-0002](0002-noback.md)" }),
    );
    seed(proj, "0002-noback.md", tableAdr({ number: 2, title: "No back" }));
    // 3 says superseded by 4, but 4 carries no Supersedes link.
    seed(
      proj,
      "0003-oneway.md",
      tableAdr({
        number: 3,
        title: "One way",
        status: "**Superseded** by [ADR-0004](0004-nofwd.md)",
        supersededBy: "[ADR-0004](0004-nofwd.md)",
      }),
    );
    seed(proj, "0004-nofwd.md", tableAdr({ number: 4, title: "No fwd" }));
    // 5 is marked superseded but names no successor.
    seed(proj, "0005-lost.md", tableAdr({ number: 5, title: "Lost", status: "**Superseded**" }));
    // 6 carries a Superseded-by link while still accepted; 7 links back properly.
    seed(
      proj,
      "0006-inconsistent.md",
      tableAdr({ number: 6, title: "Inconsistent", supersededBy: "[ADR-0007](0007-heir.md)" }),
    );
    seed(
      proj,
      "0007-heir.md",
      tableAdr({ number: 7, title: "Heir", supersedes: "[ADR-0006](0006-inconsistent.md)" }),
    );

    const result = await audit(proj);
    assert.equal(result.structured.ok, false);
    const messages = findingsOf(result, "broken-supersede-pair").map((f) => f.message);
    assert.equal(messages.length, 4, JSON.stringify(messages, null, 2));
    assert.ok(
      messages.some((m) => /ADR-0001 supersedes ADR-0002.*no Superseded-by link back/.test(m)),
    );
    assert.ok(
      messages.some((m) =>
        /ADR-0003 points at successor ADR-0004.*no Supersedes link back/.test(m),
      ),
    );
    assert.ok(messages.some((m) => /ADR-0005 is marked superseded but names no successor/.test(m)));
    assert.ok(
      messages.some((m) =>
        /ADR-0006 carries a Superseded-by link but its status is "accepted"/.test(m),
      ),
    );
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("audit: placeholder residue warns in proposed records and errs in ratified ones", async () => {
  const proj = freshProject();
  try {
    seed(
      proj,
      "0001-draft.md",
      tableAdr({
        number: 1,
        title: "Draft",
        status: "**Proposed**",
        sections:
          "## Context\n\n{Explain the forces}\n\n## Decision\n\nX.\n\n## Consequences\n\nY.",
      }),
    );
    seed(
      proj,
      "0002-shipped.md",
      tableAdr({
        number: 2,
        title: "Shipped",
        sections: "## Context\n\n{TODO}\n\n## Decision\n\nX.\n\n## Consequences\n\nY.",
      }),
    );
    // Braces inside fenced code are illustrative, not residue.
    seed(
      proj,
      "0003-code.md",
      tableAdr({
        number: 3,
        title: "Code",
        sections:
          '## Context\n\n```json\n{ "key": "value" }\n```\n\n## Decision\n\nX.\n\n## Consequences\n\nY.',
      }),
    );

    const result = await audit(proj);
    const findings = findingsOf(result, "placeholder-residue");
    assert.equal(findings.length, 2, JSON.stringify(result.structured.findings));
    const bySeverity = Object.fromEntries(findings.map((f) => [f.number, f.severity]));
    assert.equal(bySeverity[1], "warning");
    assert.equal(bySeverity[2], "error");
    assert.equal(result.structured.ok, false);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("audit: stale-index warnings — missing target, marker-less target, out-of-date block", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First" }));
    mkdirSync(join(proj, ".marvin"), { recursive: true });
    writeFileSync(
      join(proj, ".marvin", "config.json"),
      JSON.stringify({ adr: { index_file: "docs/DECISIONS.md" } }),
    );

    const missing = await audit(proj);
    assert.equal(missing.structured.ok, true, "warnings only");
    assert.equal(missing.isError, false);
    let stale = findingsOf(missing, "stale-index");
    assert.equal(stale.length, 1);
    assert.match(stale[0].message, /does not exist/);

    writeFileSync(join(proj, "docs", "DECISIONS.md"), "# Decisions\n\nNo markers here.\n");
    const markerless = await audit(proj);
    stale = findingsOf(markerless, "stale-index");
    assert.equal(stale.length, 1);
    assert.match(stale[0].message, /no managed markers/);

    // Generate, then grow the corpus → the managed block is out of date.
    await callAdr(proj, { action: "index" });
    const fresh = await audit(proj);
    assert.deepEqual(kindsOf(fresh), [], "regenerated index is clean");

    seed(proj, "0002-second.md", tableAdr({ number: 2, title: "Second" }));
    const outdated = await audit(proj);
    stale = findingsOf(outdated, "stale-index");
    assert.equal(stale.length, 1);
    assert.match(stale[0].message, /out of date/);
    assert.equal(outdated.structured.ok, true);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});
