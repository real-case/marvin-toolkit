import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", "..", "..", "skills");

/** The 8 sec-* scanners that emit a Tier-2 audit-report block (ADR-0024 #7). */
const SCANNERS = [
  "sec-scan",
  "sec-secrets",
  "sec-deps",
  "sec-iac",
  "sec-ci",
  "sec-threat-model",
  "sec-compliance",
  "sec-pentest",
];

/** A schema-valid audit-report block, the canonical shape the skills mirror. */
const VALID_BLOCK = {
  kind: "scan",
  scanned_at: "2026-07-04T10:00:00Z",
  target: "acme-api",
  summary: { high: 1, medium: 1 },
  findings: [
    {
      id: "SCAN-1",
      severity: "high",
      title: "SQL injection in login handler",
      category: "OWASP A05:2025",
      file: "src/auth/login.ts",
      line: 42,
      remediation: "Use parameterized queries",
    },
    {
      id: "SCAN-2",
      severity: "medium",
      title: "Missing Content-Security-Policy header",
      category: "OWASP A02:2025",
      file: "src/server.ts",
      remediation: "Set a restrictive CSP header",
    },
  ],
};

/** Wrap a raw block body in a prose report with the fenced audit-report block. */
function reportWithBlock(blockBody) {
  return `# Security report\n\nProse summary here.\n\n\`\`\`json audit-report\n${blockBody}\n\`\`\`\n`;
}

/** Extract the first fenced audit-report block body from a skill markdown. */
function extractBlock(text) {
  const m = text.match(/```json audit-report\n([\s\S]*?)\n```/);
  return m?.[1] ?? null;
}

/** Drive the live server: initialize, then call the `audit` `list` action. */
const listAudits = (securityDir) =>
  callTool(
    "audit",
    { action: "list" },
    { env: { CLAUDE_PROJECT_DIR: securityDir, MARVIN_SECURITY_DIR: securityDir } },
  );

const textOf = (result) => result.content.map((c) => c.text).join("\n");

test("audit list emits AuditListPayload for a valid report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-audit-"));
  try {
    writeFileSync(
      join(dir, "scan-report.md"),
      reportWithBlock(JSON.stringify(VALID_BLOCK, null, 2)),
    );

    const result = await listAudits(dir);

    assert.match(textOf(result), /# Security audit reports \(1\)/);
    const sc = result.structuredContent;
    assert.ok(sc, "structuredContent present on the list result");
    assert.equal(sc.reports.length, 1);
    const [r] = sc.reports;
    assert.equal(r.kind, "scan");
    assert.equal(r.findings.length, 2);
    assert.equal(r.summary.high, 1);
    assert.equal(r.findings[0].file, "src/auth/login.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed audit-report block is isolated, valid reports survive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-audit-"));
  try {
    writeFileSync(
      join(dir, "scan-report.md"),
      reportWithBlock(JSON.stringify(VALID_BLOCK, null, 2)),
    );
    // present-but-invalid: not JSON at all
    writeFileSync(join(dir, "deps-report.md"), reportWithBlock("{ this is not valid json"));

    const result = await listAudits(dir);

    const sc = result.structuredContent;
    assert.equal(sc.reports.length, 1, "only the valid report is returned");
    assert.equal(sc.reports[0].kind, "scan");
    // the malformed one is surfaced in the text, not silently dropped
    assert.match(textOf(result), /invalid audit-report block/);
    assert.match(textOf(result), /deps-report\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a report without an audit-report block is skipped, not malformed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-audit-"));
  try {
    writeFileSync(
      join(dir, "scan-report.md"),
      reportWithBlock(JSON.stringify(VALID_BLOCK, null, 2)),
    );
    // legacy prose-only report — no audit-report block at all
    writeFileSync(join(dir, "legacy-report.md"), "# Old report\n\nJust prose, no block.\n");

    const result = await listAudits(dir);

    const sc = result.structuredContent;
    assert.equal(sc.reports.length, 1, "the block-less report is skipped");
    assert.doesNotMatch(
      textOf(result),
      /invalid audit-report block/,
      "skipped, not flagged malformed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty security dir returns a zero-state payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-audit-"));
  try {
    const result = await listAudits(dir);

    assert.match(textOf(result), /No audit reports yet/);
    const sc = result.structuredContent;
    assert.ok(sc, "structuredContent present even when empty");
    assert.deepEqual(sc.reports, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every sec-* skill example block is a valid audit-report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-audit-"));
  try {
    for (const name of SCANNERS) {
      const md = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
      const block = extractBlock(md);
      assert.ok(
        block,
        `${name}/SKILL.md must embed a literal \`\`\`json audit-report example block`,
      );
      // seed the skill's own example as a report and let the real reader judge it
      writeFileSync(join(dir, `${name}.md`), reportWithBlock(block));
    }

    const result = await listAudits(dir);

    const sc = result.structuredContent;
    assert.equal(sc.reports.length, SCANNERS.length, "all 8 skill example blocks validate");
    assert.doesNotMatch(
      textOf(result),
      /invalid audit-report block/,
      "no skill template is rejected by the reader",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
