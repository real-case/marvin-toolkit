import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AuditReport as AuditReportContract } from "@marvin-toolkit/mcp-shared/contracts";
import { parseAuditBlock } from "../lib/reports.js";

/**
 * Reader for the `sec-*` Tier-2 structured findings (ADR-0024, #7). Each
 * `sec-*` scanner writes a prose report under `.marvin/security/<kind>-report.md`
 * and appends a machine-readable ` ```json audit-report ` block (the
 * `verify-result` precedent). This module recovers those blocks so the `audit`
 * tool can surface them as typed `structuredContent`.
 *
 * The block parsing itself (schema mirror + extraction) lives in
 * `lib/reports.ts`, shared with the `report` tool's unified envelope scan —
 * one parser, two consumers.
 */

export interface MalformedAudit {
  filename: string;
  reason: string;
}

export interface ReadAuditsResult {
  reports: AuditReportContract[];
  malformed: MalformedAudit[];
}

/**
 * Read every `sec-*` report under the security dir and recover its typed
 * `audit-report` block. A report `.md` with **no** block is skipped silently (a
 * valid legacy prose report, or a scanner that has not adopted Tier-2 yet); a
 * report whose block is present-but-invalid (bad JSON or fails the schema) is
 * collected into `malformed` so one bad block degrades one report, not the whole
 * listing (the `handoff` fail-open precedent). Reports are returned newest-first
 * by `scanned_at`, tie-broken by filename for determinism.
 */
export function readAllAuditReports(securityDir: string): ReadAuditsResult {
  if (!existsSync(securityDir)) return { reports: [], malformed: [] };

  const found: { report: AuditReportContract; filename: string }[] = [];
  const malformed: MalformedAudit[] = [];

  let filenames: string[];
  try {
    filenames = readdirSync(securityDir).sort();
  } catch {
    // an unreadable directory counts as empty — the zero-state doctrine
    return { reports: [], malformed: [] };
  }

  for (const filename of filenames) {
    if (!filename.endsWith(".md")) continue;

    let raw: string;
    try {
      raw = readFileSync(join(securityDir, filename), "utf8");
    } catch {
      continue;
    }

    const parsed = parseAuditBlock(raw);
    if (parsed.kind === "none") continue; // no Tier-2 block → skip, not malformed
    if (parsed.kind === "invalid") {
      malformed.push({ filename, reason: parsed.reason });
      continue;
    }

    found.push({ report: parsed.report, filename });
  }

  found.sort(
    (a, b) =>
      b.report.scanned_at.localeCompare(a.report.scanned_at) ||
      a.filename.localeCompare(b.filename),
  );
  return { reports: found.map((f) => f.report), malformed };
}
