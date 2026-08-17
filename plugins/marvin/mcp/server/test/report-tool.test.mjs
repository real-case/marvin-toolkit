import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { ReportListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { importTs } from "./_tsload.mjs";

/**
 * Tests for the `report` tool module (`src/tools/report.ts`) — text fallback,
 * payload contract, selected passthrough and the widget binding. The tool is
 * driven through its `handler` directly (compiled via `_tsload.mjs`) — a unit
 * seam that stays independent of the committed dist bundle; the registered
 * stdio surface is covered separately by `widget-resource.test.mjs`.
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

const CRITIC_BLOCK = JSON.stringify({
  critic: "marvin-tm-diff-critic",
  subject: "demo",
  judged_at: "2026-07-15T10:00:00.000Z",
  compliance: { verdict: "PASS", blockers: 0, warnings: 0 },
  quality: { verdict: "BLOCK", blockers: 1, warnings: 0 },
});

/** Seed a realistic `.marvin/` tree; returns the ServerEnv slice the tool reads. */
function seedProject(root) {
  const marvin = join(root, ".marvin");
  for (const d of ["security", "refactor", "task", "handoff", "critique"]) {
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
  at(
    join(marvin, "critique", "001-demo.md"),
    `# Diff Critique: feat/demo\n\nProse.\n\n\`\`\`json critic-verdict\n${CRITIC_BLOCK}\n\`\`\`\n`,
    3 * 60 * 60 * 1000,
  );
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
    critiqueDir: join(marvin, "critique"),
    // Deliberately NOT created here: AC4 asserts the tool does not create it.
    reportDir: join(marvin, "report"),
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
    critiqueDir: "/nope",
    reportDir: "/nope",
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
    assert.match(text, /# Reports \(5\)/);
    for (const heading of [
      "## Security (1)",
      "## Refactor (1)",
      "## Task (1)",
      "## Handoff (1)",
      "## Critique (1)",
    ]) {
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
    assert.equal(sc.reports.length, 5);
    assert.equal(sc.selected, undefined, "no selected key without input");
    // newest first: critique (3h) < verification (5h) < handoff (1d) < refactor
    // (2d) < security (9d) — sorted by mtime, never by group
    assert.deepEqual(
      sc.reports.map((r) => r.group),
      ["critique", "task", "handoff", "refactor", "security"],
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
      critiqueDir: join(root, ".marvin", "critique"),
      reportDir: join(root, ".marvin", "report"),
    });
    const result = await tool.handler({});
    assert.match(textOf(result), /No reports yet/);
    assert.deepEqual(result.structuredContent, { reports: [] });
  }),
);

// ── triage dispatch and the fail-closed snapshot flag (ADR-0038) ────────────

test(
  "triage renders the state roll-up and annotates the payload's findings",
  withProject(async (root) => {
    const env = seedProject(root);
    const tool = mod.buildReportTool(env);

    const first = await tool.handler({ action: "triage" });
    const text = textOf(first);
    assert.match(text, /# Finding triage \(2 live finding\(s\)\)/);
    assert.match(text, /No baseline recorded yet/);
    assert.match(text, /- \*\*new\*\*: 2/);
    assert.match(text, /- \*\*persisting\*\*: 0/);
    assert.match(text, /- \*\*resolved\*\*: 0/);
    assert.match(text, /no baseline was written/);

    // the reconciliation is read-only but it is NOT a no-op: the payload the
    // widget receives carries the same identity data the terminal just printed
    const annotated = first.structuredContent.reports
      .flatMap((r) => r.body.findings ?? [])
      .filter((f) => f.state !== undefined);
    assert.equal(annotated.length, 2);
    for (const f of annotated) assert.equal(f.state, "new");

    // record the baseline, then triage again: the same findings now persist
    const recorded = await tool.handler({ action: "triage", snapshot: true });
    assert.match(textOf(recorded), /Baseline recorded: 2 fingerprint\(s\)/);

    const second = await tool.handler({ action: "triage" });
    assert.match(textOf(second), /- \*\*new\*\*: 0/);
    assert.match(textOf(second), /- \*\*persisting\*\*: 2/);
  }),
);

test(
  "neither list nor an unflagged triage creates the report directory or writes a baseline",
  withProject(async (root) => {
    const env = seedProject(root);
    const tool = mod.buildReportTool(env);
    const baseline = join(env.reportDir, "triage.json");

    assert.equal(existsSync(env.reportDir), false, "precondition: nothing there yet");

    await tool.handler({ action: "list" });
    // The DIRECTORY, not merely the file: a read that creates `.marvin/report/`
    // is already a side effect on the user's tree.
    assert.equal(existsSync(env.reportDir), false, "list created the directory");
    assert.equal(existsSync(baseline), false, "list wrote a baseline");

    await tool.handler({});
    assert.equal(existsSync(env.reportDir), false, "a bare call created the directory");

    await tool.handler({ action: "triage" });
    assert.equal(existsSync(env.reportDir), false, "an unflagged triage created the directory");
    assert.equal(existsSync(baseline), false, "an unflagged triage wrote a baseline");

    // …and only the explicit flag writes. The tool is widget-bound at TOOL
    // level, so an action-keyed write would let merely opening the panel
    // consume the baseline: every finding recorded as seen, and the next
    // triage reporting nothing new no matter what changed.
    await tool.handler({ action: "triage", snapshot: true });
    assert.equal(existsSync(baseline), true, "snapshot: true wrote exactly one baseline");
    assert.deepEqual(readdirSync(env.reportDir).sort(), [".gitignore", "triage.json"]);
    const stored = JSON.parse(readFileSync(baseline, "utf8"));
    assert.equal(stored.version, 1);
    assert.equal(stored.findings.length, 2);
  }),
);

test(
  "list keeps its grouped fallback while still reconciling — snapshot works on it too",
  withProject(async (root) => {
    const env = seedProject(root);
    const tool = mod.buildReportTool(env);

    const result = await tool.handler({ action: "list", snapshot: true });
    assert.match(textOf(result), /# Reports \(5\)/, "the list rendering is unchanged");
    assert.equal(existsSync(join(env.reportDir, "triage.json")), true);
  }),
);

test(
  "the critique group renders in the text fallback",
  withProject(async (root) => {
    const tool = mod.buildReportTool(seedProject(root));
    const text = textOf(await tool.handler({}));

    // End-to-end proof that ALL THREE enumerations in tools/report.ts moved: a
    // missed GROUP_ORDER entry produces a report that exists in the payload and
    // is invisible in the text, which is the only surface Claude Code renders.
    assert.match(text, /## Critique \(1\)/);
    assert.match(text, /Diff Critique: feat\/demo/);
    // The derived roll-up rides the document tag — PASS + BLOCK rolls up to BLOCK.
    assert.match(text, /critique · BLOCK/);

    // In GROUP_ORDER position: last, after Handoff.
    const order = ["## Security", "## Refactor", "## Task", "## Handoff", "## Critique"];
    const positions = order.map((h) => text.indexOf(h));
    assert.ok(
      positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])),
      `sections out of GROUP_ORDER position: ${JSON.stringify(positions)}`,
    );
  }),
);
