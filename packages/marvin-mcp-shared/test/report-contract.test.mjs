import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ReportGroup,
  ReportBodyKind,
  ReportFinding,
  FindingsBody,
  ChecksBody,
  DocumentBody,
  ReportSummary,
  ReportEnvelope,
  ReportListPayload,
} from "../dist/contracts/index.js";

const NOW = "2026-07-16T00:00:00.000Z";

const FINDING = {
  id: "F1",
  severity: "high",
  title: "SQL injection in login handler",
};

const ENVELOPE = {
  id: ".marvin/security/scan-report.md",
  group: "security",
  kind: "findings",
  title: "Security scan",
  path: ".marvin/security/scan-report.md",
  generatedBy: "sec-scan",
  generatedAt: NOW,
  stale: false,
  summary: { kind: "findings", counts: { critical: 0, high: 1, medium: 0, low: 0 } },
  body: { findings: [FINDING] },
  links: [],
  rerunCommand: "/marvin:sec-scan",
};

test("ReportGroup and ReportBodyKind are closed vocabularies", () => {
  assert.equal(ReportGroup.safeParse("security").success, true);
  assert.equal(ReportGroup.safeParse("board").success, false);
  assert.equal(ReportBodyKind.safeParse("document").success, true);
  assert.equal(ReportBodyKind.safeParse("prose").success, false);
});

test("ReportFinding keeps audit Finding fields, relaxes category, adds refactor extras", () => {
  // audit-style finding with a taxonomy category still validates
  assert.equal(
    ReportFinding.safeParse({ ...FINDING, category: "OWASP A03:2025", file: "a.ts", line: 9 })
      .success,
    true,
  );
  // category is optional (refactor registers carry none)
  assert.equal(ReportFinding.safeParse(FINDING).success, true);
  // refactor extras: effort scale is S/M/L, direction and fixCommand are strings
  assert.equal(
    ReportFinding.safeParse({
      ...FINDING,
      effort: "M",
      direction: "Split registration and IO",
      fixCommand: "/marvin:sec-fix scan F1",
    }).success,
    true,
  );
  assert.equal(ReportFinding.safeParse({ ...FINDING, effort: "medium" }).success, false);
  assert.equal(ReportFinding.safeParse({ ...FINDING, severity: "sev1" }).success, false);
});

test("body kinds: findings with optional truncation, checks with status vocabulary, document markdown", () => {
  assert.equal(FindingsBody.safeParse({ findings: [FINDING], truncated: 13 }).success, true);
  assert.equal(FindingsBody.safeParse({ findings: [], truncated: -1 }).success, false);
  assert.equal(
    ChecksBody.safeParse({
      checks: [
        { name: "test", status: "pass" },
        { name: "lint", status: "fail", note: "7 errors" },
        { name: "typecheck", status: "pending" },
      ],
    }).success,
    true,
  );
  assert.equal(ChecksBody.safeParse({ checks: [{ name: "test", status: "warn" }] }).success, false);
  assert.equal(DocumentBody.safeParse({ markdown: "# Spec\n\nBody." }).success, true);
  assert.equal(DocumentBody.safeParse({}).success, false);
});

test("ReportSummary discriminates on kind with the three chip shapes", () => {
  assert.equal(
    ReportSummary.safeParse({
      kind: "findings",
      counts: { critical: 1, high: 2, medium: 0, low: 0 },
    }).success,
    true,
  );
  assert.equal(
    ReportSummary.safeParse({ kind: "checks", done: 2, total: 6, failed: 1 }).success,
    true,
  );
  assert.equal(ReportSummary.safeParse({ kind: "document", tag: "spec" }).success, true);
  // shapes do not cross kinds
  assert.equal(ReportSummary.safeParse({ kind: "checks", tag: "spec" }).success, false);
  assert.equal(ReportSummary.safeParse({ kind: "document", tag: "" }).success, false);
});

test("ReportEnvelope requires the full envelope and an ISO generatedAt", () => {
  assert.equal(ReportEnvelope.safeParse(ENVELOPE).success, true);
  assert.equal(ReportEnvelope.safeParse({ ...ENVELOPE, generatedAt: "yesterday" }).success, false);
  assert.equal(ReportEnvelope.safeParse({ ...ENVELOPE, group: "misc" }).success, false);
  assert.equal(ReportEnvelope.safeParse({ ...ENVELOPE, stale: "no" }).success, false);
  // rerunCommand is optional; links default to []
  const { rerunCommand: _r, links: _l, ...rest } = ENVELOPE;
  const parsed = ReportEnvelope.safeParse(rest);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.links, []);
});

test("ReportListPayload carries envelopes plus an optional selected id", () => {
  assert.equal(ReportListPayload.safeParse({ reports: [ENVELOPE] }).success, true);
  assert.equal(
    ReportListPayload.safeParse({ reports: [], selected: ".marvin/task/verification.md" }).success,
    true,
  );
  assert.equal(ReportListPayload.safeParse({ reports: [{ nope: true }] }).success, false);
});
