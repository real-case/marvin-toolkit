import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ReportListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { importTs } from "./_tsload.mjs";

/**
 * Tests for the `report` tool module (`src/tools/report.ts`) — text fallback,
 * payload contract, selected passthrough and the widget binding. The tool is
 * driven through its `handler` directly (compiled via `_tsload.mjs`): it is
 * deliberately not registered with the server yet — WP-E owns `server.ts` /
 * `resources/widgets.ts` wiring — so the stdio driver cannot reach it.
 */
const mod = await importTs("src/tools/report.ts");

const DAY_MS = 24 * 60 * 60 * 1000;

const AUDIT_BLOCK = JSON.stringify({
  kind: "scan",
  scanned_at: "2026-07-14T10:00:00Z",
  summary: { high: 1 },
  findings: [
    {
      id: "SCAN-1",
      severity: "high",
      title: "SQL injection in login handler",
      category: "OWASP A05:2025",
    },
  ],
});

/** Seed a realistic `.marvin/` tree; returns the ServerEnv slice the tool reads. */
function seedProject(root) {
  const marvin = join(root, ".marvin");
  for (const d of ["security", "refactor", "task", "handoff"]) {
    mkdirSync(join(marvin, d), { recursive: true });
  }
  const now = Date.now();
  const at = (path, content, ageMs) => {
    writeFileSync(path, content);
    utimesSync(path, new Date(now - ageMs), new Date(now - ageMs));
  };

  at(
    join(marvin, "security", "scan-report.md"),
    `# Security report\n\n\`\`\`json audit-report\n${AUDIT_BLOCK}\n\`\`\`\n`,
    9 * DAY_MS, // past the freshness window → stale
  );
  at(
    join(marvin, "refactor", "001-audit-core.md"),
    "# Refactoring audit — core\n\n| ID | Title | Severity | Effort | Evidence | Direction |\n|----|----|----|----|----|----|\n| F1 | God module | high | large | `src/server.ts:12` | Split it |\n",
    2 * DAY_MS,
  );
  at(
    join(marvin, "task", "verification.md"),
    '# Verification\n\n```json verify-result\n{"verdict":"PASS","gates":[{"name":"test","status":"pass","code":0}]}\n```\n',
    5 * 60 * 60 * 1000,
  );
  at(join(marvin, "handoff", "007-release-prep.md"), "# Handoff — release prep\n\nBody.\n", DAY_MS);
  // one malformed security report → a one-line note in the text fallback
  at(
    join(marvin, "security", "deps-report.md"),
    "# Report\n\n```json audit-report\n{ not json\n```\n",
    DAY_MS,
  );

  return {
    projectDir: root,
    securityDir: join(marvin, "security"),
    handoffDir: join(marvin, "handoff"),
  };
}

const textOf = (result) => result.content.map((c) => c.text).join("\n");

const withProject = (fn) => async () => {
  const root = mkdtempSync(join(tmpdir(), "marvin-report-tool-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("the module exports the widget URI and binds it via tool meta", () => {
  assert.equal(mod.REPORTS_WIDGET_URI, "ui://marvin/reports.html");
  const tool = mod.buildReportTool({
    projectDir: "/nope",
    securityDir: "/nope",
    handoffDir: "/nope",
  });
  assert.equal(tool.name, "report");
  assert.deepEqual(tool.meta, { ui: { resourceUri: "ui://marvin/reports.html" } });
});

test(
  "list emits a grouped text fallback plus a contract-valid ReportListPayload",
  withProject(async (root) => {
    const tool = mod.buildReportTool(seedProject(root));
    const result = await tool.handler({});

    const text = textOf(result);
    assert.match(text, /# Reports \(4\)/);
    for (const heading of ["## Security (1)", "## Refactor (1)", "## Task (1)", "## Handoff (1)"]) {
      assert.ok(text.includes(heading), `missing ${heading}`);
    }
    assert.match(text, /1 finding\(s\) \(high 1\)/, "summary chip in the line");
    assert.match(text, /\*\*stale\*\*/, "the 9-day-old scan is marked stale");
    assert.match(text, /\dd ago|\dh ago/, "ages rendered");
    // the malformed file gets a one-line note, and is not an envelope
    assert.match(text, /skipped 1 file\(s\)/);
    assert.match(text, /deps-report\.md/);

    const sc = result.structuredContent;
    assert.ok(sc, "structuredContent present");
    const parsed = ReportListPayload.safeParse(sc);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues ?? []));
    assert.equal(sc.reports.length, 4);
    assert.equal(sc.selected, undefined, "no selected key without input");
    // newest first: verification (5h) < handoff (1d) < refactor (2d) < security (9d)
    assert.deepEqual(
      sc.reports.map((r) => r.group),
      ["task", "handoff", "refactor", "security"],
    );
    assert.equal(sc.reports.at(-1).stale, true);
  }),
);

test(
  "selected passes through to the payload untouched",
  withProject(async (root) => {
    const tool = mod.buildReportTool(seedProject(root));
    const result = await tool.handler({ selected: ".marvin/task/verification.md" });
    assert.equal(result.structuredContent.selected, ".marvin/task/verification.md");
  }),
);

test(
  "an empty project yields a friendly text and an empty payload, never a throw",
  withProject(async (root) => {
    const tool = mod.buildReportTool({
      projectDir: root,
      securityDir: join(root, ".marvin", "security"),
      handoffDir: join(root, ".marvin", "handoff"),
    });
    const result = await tool.handler({});
    assert.match(textOf(result), /No reports yet/);
    assert.deepEqual(result.structuredContent, { reports: [] });
  }),
);
