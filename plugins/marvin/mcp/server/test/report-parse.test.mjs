import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the pure report-envelope parsers (`src/lib/reports.ts`) that
 * feed the `report` tool — per-group parsing against tmp-dir fixtures, the
 * staleness boundary, malformed-file skipping, and the merged newest-first
 * ordering. The parsers are exercised directly (compiled via `_tsload.mjs`) —
 * a unit seam independent of the committed dist bundle; the registered stdio
 * surface is covered separately by `widget-resource.test.mjs`.
 */
const lib = await importTs("src/lib/reports.ts");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-16T12:00:00.000Z");

const withDir = (fn) => async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-report-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Write a file and pin its mtime (staleness + ordering are mtime-driven). */
function writeAt(dir, filename, content, mtimeMs) {
  const path = join(dir, filename);
  writeFileSync(path, content);
  if (mtimeMs !== undefined) utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
  return path;
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const AUDIT_BLOCK = JSON.stringify({
  kind: "scan",
  scanned_at: "2026-07-14T10:00:00Z",
  summary: { high: 1, medium: 1 },
  findings: [
    {
      id: "SCAN-1",
      severity: "high",
      title: "SQL injection in login handler",
      category: "OWASP A05:2025",
      file: "src/auth/login.ts",
      line: 42,
    },
    {
      id: "SCAN-2",
      severity: "medium",
      title: "Missing CSP header",
      category: "OWASP A02:2025",
    },
  ],
});

const SECURITY_REPORT = `# Security report\n\nProse.\n\n\`\`\`json audit-report\n${AUDIT_BLOCK}\n\`\`\`\n`;

const REGISTER = `# Refactoring audit — fixture (2026-07-10)

Scope: whole project @ abc1234

## Findings register

| ID | Title | Severity | Effort | Evidence | Direction |
|----|-------|----------|--------|----------|-----------|
| F1 | God module: server.ts owns everything | high | medium | \`src/server.ts:1-120\`, \`src/lib/env.ts:40\` | Split registration, config and IO |
| F2 | Dead flag parsing | low | trivial | \`src/flags.ts:12\` | Delete the branch |
| F3 | Bad severity row | urgent | small | \`src/x.ts:1\` | Dropped, not fatal |
`;

const PLAN = `# Refactoring plan — storage split (2026-07-12)

## Steps

### Step 1 — Extract storage interface [done 2026-07-13]
- **Effort:** small

### Step 2 — Move config IO [blocked]

### Step 3 — Delete legacy paths [pending]

### Step 4 — Tighten types
`;

const VERIFICATION = `# Verification — 2026-07-15

\`\`\`json verify-result
{"verdict":"FAIL","gates":[{"name":"test","status":"pass","code":0},{"name":"lint","status":"fail","code":1},{"name":"build","status":"skip","code":null}]}
\`\`\`
`;

const SPEC = `---
slug: widget-family
status: ready
---
# Spec: widget family

Body text.
`;

const HANDOFF = `---
id: "007"
slug: release-prep
objective: Release prep
branch: dev
created: 2026-07-01T00:00:00.000Z
---
Next steps, no heading.
`;

// ── security group ───────────────────────────────────────────────────────────

test(
  "security: a valid audit-report block becomes a findings envelope with derived commands",
  withDir((dir) => {
    writeAt(dir, "scan-report.md", SECURITY_REPORT, NOW - 2 * DAY_MS);
    const { reports, notes } = lib.scanSecurityReports(dir, { now: NOW });

    assert.equal(notes.length, 0);
    assert.equal(reports.length, 1);
    const [r] = reports;
    assert.equal(r.group, "security");
    assert.equal(r.kind, "findings");
    assert.equal(r.title, "Security scan");
    assert.equal(r.id, ".marvin/security/scan-report.md");
    assert.equal(r.path, r.id);
    assert.equal(r.generatedBy, "sec-scan");
    assert.equal(r.rerunCommand, "/marvin:sec-scan");
    assert.equal(r.generatedAt, new Date(NOW - 2 * DAY_MS).toISOString());
    assert.equal(r.stale, false);
    assert.deepEqual(r.summary, {
      kind: "findings",
      counts: { critical: 0, high: 1, medium: 1, low: 0 },
    });
    assert.equal(r.body.findings.length, 2);
    assert.equal(r.body.findings[0].fixCommand, "/marvin:sec-fix scan SCAN-1");
    assert.equal(r.body.findings[0].file, "src/auth/login.ts");
  }),
);

test(
  "security: a malformed block is skipped with a note, a block-less report silently",
  withDir((dir) => {
    writeAt(dir, "scan-report.md", SECURITY_REPORT);
    writeAt(dir, "deps-report.md", "# Report\n\n```json audit-report\n{ not json\n```\n");
    writeAt(dir, "legacy-report.md", "# Old prose report, no block.\n");

    const { reports, notes } = lib.scanSecurityReports(dir, { now: NOW });
    assert.equal(reports.length, 1, "only the valid report survives");
    assert.equal(notes.length, 1, "the legacy prose report earns no note");
    assert.equal(notes[0].file, "deps-report.md");
    assert.match(notes[0].reason, /not valid JSON/);
  }),
);

// ── refactor group ───────────────────────────────────────────────────────────

test(
  "refactor: register rows parse best-effort — evidence location, effort scale, bad severity dropped",
  withDir((dir) => {
    writeAt(dir, "001-audit-core.md", REGISTER, NOW - 3 * DAY_MS);
    const { reports, notes } = lib.scanRefactorReports(dir, { now: NOW });

    assert.equal(notes.length, 0);
    assert.equal(reports.length, 1);
    const [r] = reports;
    assert.equal(r.kind, "findings");
    assert.equal(r.title, "Refactoring audit — fixture (2026-07-10)");
    assert.equal(r.generatedBy, "refactor-audit");
    assert.equal(r.rerunCommand, "/marvin:refactor-audit");

    const { findings } = r.body;
    assert.equal(findings.length, 2, "the invalid-severity row is dropped, not fatal");
    const [f1, f2] = findings;
    assert.equal(f1.id, "F1");
    assert.equal(f1.severity, "high");
    assert.equal(f1.effort, "M");
    assert.equal(f1.file, "src/server.ts");
    assert.equal(f1.line, 1);
    assert.equal(f1.direction, "Split registration, config and IO");
    assert.equal(f2.effort, "S");
    assert.deepEqual(r.summary.counts, { critical: 0, high: 1, medium: 0, low: 1 });
  }),
);

const REGISTER_PIPES = `# Refactoring smells — fixture (2026-07-11)

## Findings register

| ID | Title | Severity | Effort | Evidence | Direction |
|----|-------|----------|--------|----------|-----------|
| F1 | Stringly-typed gate keys | medium | small | \`"lint"\\|"test"\` compared as strings \\|\\| defaulted | Union type + const map |
`;

test(
  "refactor: escaped pipes inside register cells do not shift columns",
  withDir((dir) => {
    writeAt(dir, "003-smells-api.md", REGISTER_PIPES, NOW - DAY_MS);
    const { reports, notes } = lib.scanRefactorReports(dir, { now: NOW });

    assert.equal(notes.length, 0);
    const [r] = reports;
    assert.equal(r.body.findings.length, 1);
    const [f] = r.body.findings;
    // The escaped pipes stay inside their cells, unescaped to literal "|"s
    // (the parser also unwraps inline-code backticks while lifting file:line)…
    assert.equal(f.evidence, '"lint"|"test" compared as strings || defaulted');
    // …and the Direction cell survives instead of absorbing the severed tail.
    assert.equal(f.direction, "Union type + const map");
  }),
);

test(
  "scan: symlinked .md entries are skipped — no out-of-tree content in the payload",
  withDir((dir) => {
    const outside = mkdtempSync(join(tmpdir(), "marvin-outside-"));
    try {
      const target = writeAt(outside, "outside.md", REGISTER, NOW - DAY_MS);
      writeAt(dir, "001-audit-core.md", REGISTER, NOW - 3 * DAY_MS);
      symlinkSync(target, join(dir, "002-audit-planted.md"));
      const { reports, notes } = lib.scanRefactorReports(dir, { now: NOW });

      // Only the real file is scanned; the planted symlink is skipped silently.
      assert.equal(reports.length, 1);
      assert.equal(reports[0].id, ".marvin/refactor/001-audit-core.md");
      assert.equal(notes.length, 0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }),
);

test(
  "refactor: a plan becomes checks — step markers map to pass/fail/pending",
  withDir((dir) => {
    writeAt(dir, "002-plan-storage.md", PLAN, NOW - DAY_MS);
    const { reports } = lib.scanRefactorReports(dir, { now: NOW });

    assert.equal(reports.length, 1);
    const [r] = reports;
    assert.equal(r.kind, "checks");
    assert.equal(r.generatedBy, "refactor-plan");
    assert.deepEqual(r.summary, { kind: "checks", done: 1, total: 4, failed: 1 });
    assert.deepEqual(
      r.body.checks.map((c) => c.status),
      ["pass", "fail", "pending", "pending"],
    );
    assert.equal(r.body.checks[0].name, "Extract storage interface");
    assert.equal(r.body.checks[0].note, "2026-07-13");
  }),
);

test(
  "refactor: a register with no heading and no rows is skipped with a note; foreign files ignored",
  withDir((dir) => {
    writeAt(dir, "003-audit-empty.md", "just prose, nothing parseable\n");
    writeAt(dir, "README.md", "# Not a register\n");
    const { reports, notes } = lib.scanRefactorReports(dir, { now: NOW });

    assert.equal(reports.length, 0);
    assert.equal(notes.length, 1, "the foreign README earns no note");
    assert.equal(notes[0].file, "003-audit-empty.md");
  }),
);

// ── task group ───────────────────────────────────────────────────────────────

test(
  "task: verification.md maps verify-result gates to checks; specs become documents",
  withDir((dir) => {
    writeAt(dir, "verification.md", VERIFICATION, NOW - 5 * 60 * 60 * 1000);
    writeAt(dir, "014-widget-family.md", SPEC, NOW - 8 * DAY_MS);
    const { reports, notes } = lib.scanTaskReports(dir, { now: NOW });

    assert.equal(notes.length, 0);
    assert.equal(reports.length, 2);
    const verification = reports.find((r) => r.title === "Verification");
    assert.equal(verification.kind, "checks");
    assert.equal(verification.generatedBy, "task-verify");
    assert.equal(verification.rerunCommand, "/marvin:task-verify");
    assert.deepEqual(verification.summary, { kind: "checks", done: 1, total: 3, failed: 1 });
    assert.deepEqual(verification.body.checks, [
      { name: "test", status: "pass" },
      { name: "lint", status: "fail", note: "exit 1" },
      { name: "build", status: "pending" },
    ]);

    const spec = reports.find((r) => r.title === "Spec: widget family");
    assert.equal(spec.kind, "document");
    assert.deepEqual(spec.summary, { kind: "document", tag: "spec" });
    assert.equal(spec.generatedBy, "task-start");
    assert.match(spec.body.markdown, /^# Spec: widget family/);
    assert.doesNotMatch(spec.body.markdown, /slug: widget-family/, "frontmatter is stripped");
    assert.equal(spec.stale, false, "task documents never go stale, even past the window");
  }),
);

test(
  "task: a verification.md without a verify-result block is skipped with a note",
  withDir((dir) => {
    writeAt(dir, "verification.md", "# Verification\n\nProse only.\n");
    const { reports, notes } = lib.scanTaskReports(dir, { now: NOW });
    assert.equal(reports.length, 0);
    assert.equal(notes.length, 1);
    assert.match(notes[0].reason, /verify-result/);
  }),
);

// ── handoff group ────────────────────────────────────────────────────────────

test(
  "handoff: documents title from the first heading, falling back to frontmatter objective",
  withDir((dir) => {
    writeAt(dir, "007-release-prep.md", HANDOFF, NOW - 12 * DAY_MS);
    writeAt(dir, "008-with-heading.md", "# Handoff — widget work\n\nBody.\n", NOW - DAY_MS);
    const { reports, notes } = lib.scanHandoffReports(dir, { now: NOW });

    assert.equal(notes.length, 0);
    assert.equal(reports.length, 2);
    const bySeven = reports.find((r) => r.id.includes("007"));
    assert.equal(bySeven.title, "Release prep", "frontmatter objective when no heading");
    assert.equal(bySeven.group, "handoff");
    assert.deepEqual(bySeven.summary, { kind: "document", tag: "handoff" });
    assert.equal(bySeven.stale, false, "handoffs never go stale");
    const byEight = reports.find((r) => r.id.includes("008"));
    assert.equal(byEight.title, "Handoff — widget work");
  }),
);

// ── staleness boundary ───────────────────────────────────────────────────────

test(
  "staleness: security flips stale strictly past 7 days; task/handoff never",
  withDir((dir) => {
    writeAt(dir, "fresh-report.md", SECURITY_REPORT, NOW - (7 * DAY_MS - 60_000));
    writeAt(dir, "old-report.md", SECURITY_REPORT, NOW - (7 * DAY_MS + 60_000));
    const { reports } = lib.scanSecurityReports(dir, { now: NOW });

    const fresh = reports.find((r) => r.id.includes("fresh"));
    const old = reports.find((r) => r.id.includes("old"));
    assert.equal(fresh.stale, false, "one minute inside the window");
    assert.equal(old.stale, true, "one minute past the window");

    // the pure helper agrees on the exact boundary (> 7d, not >=)
    assert.equal(lib.isStale("security", NOW - 7 * DAY_MS, NOW), false);
    assert.equal(lib.isStale("refactor", NOW - 7 * DAY_MS - 1, NOW), true);
    assert.equal(lib.isStale("task", NOW - 30 * DAY_MS, NOW), false);
    assert.equal(lib.isStale("handoff", NOW - 30 * DAY_MS, NOW), false);
  }),
);

// ── merged list ──────────────────────────────────────────────────────────────

test("empty project: buildReportList over missing dirs yields an empty payload", () => {
  const ghost = join(tmpdir(), "marvin-report-does-not-exist");
  const { reports, notes } = lib.buildReportList(
    { security: ghost, refactor: ghost, task: ghost, handoff: ghost },
    { now: NOW },
  );
  assert.deepEqual(reports, []);
  assert.deepEqual(notes, []);
});

test(
  "ordering: the merged list is newest-first across groups",
  withDir(async (root) => {
    const dirs = {
      security: join(root, "security"),
      refactor: join(root, "refactor"),
      task: join(root, "task"),
      handoff: join(root, "handoff"),
    };
    for (const d of Object.values(dirs)) {
      rmSync(d, { recursive: true, force: true });
    }
    const { mkdirSync } = await import("node:fs");
    for (const d of Object.values(dirs)) mkdirSync(d);

    writeAt(dirs.security, "scan-report.md", SECURITY_REPORT, NOW - 3 * DAY_MS);
    writeAt(dirs.refactor, "001-audit-core.md", REGISTER, NOW - 2 * DAY_MS);
    writeAt(dirs.task, "verification.md", VERIFICATION, NOW - 1 * DAY_MS);
    writeAt(dirs.handoff, "007-release-prep.md", HANDOFF, NOW - 4 * DAY_MS);

    const { reports } = lib.buildReportList(dirs, { now: NOW });
    assert.deepEqual(
      reports.map((r) => r.group),
      ["task", "refactor", "security", "handoff"],
      "sorted by mtime descending, not by group",
    );
    const stamps = reports.map((r) => r.generatedAt);
    assert.deepEqual(stamps, [...stamps].sort().reverse());
  }),
);
