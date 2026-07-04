import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AuditReport as AuditReportContract } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * Reader for the `sec-*` Tier-2 structured findings (ADR-0024, #7). Each
 * `sec-*` scanner writes a prose report under `.marvin/security/<kind>-report.md`
 * and appends a machine-readable ` ```json audit-report ` block (the
 * `verify-result` precedent). This module recovers those blocks so the `audit`
 * tool can surface them as typed `structuredContent`.
 *
 * The `AuditReport` data contract lives in `@marvin-toolkit/mcp-shared/contracts`
 * and is imported **type-only** above; the runtime zod schema is re-declared here
 * so the server never takes a runtime dependency on the separate contracts
 * package (the `storage/schema.ts` split — zod itself is bundled by tsup either
 * way, so this is about the module boundary, not bundle size). The two must stay
 * in lockstep: this mirrors `contracts/audit.ts` field-for-field.
 */
const Severity = z.enum(["critical", "high", "medium", "low", "info"]);

const AuditKind = z.enum([
  "scan",
  "secrets",
  "deps",
  "iac",
  "ci",
  "threat-model",
  "compliance",
  "pentest",
]);

const LinkRef = z.object({
  kind: z.enum(["pr", "tracker", "adr", "spec", "branch", "commit", "external"]),
  label: z.string().min(1),
  url: z.string().url().optional(),
  ref: z.string().optional(),
});

const Finding = z.object({
  id: z.string(),
  severity: Severity,
  title: z.string().min(1),
  category: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  evidence: z.string().optional(),
  remediation: z.string().optional(),
  links: z.array(LinkRef).optional(),
});

/** Runtime mirror of the `AuditReport` contract (`contracts/audit.ts`). */
export const AuditReport = z.object({
  kind: AuditKind,
  scanned_at: z.string().datetime(),
  target: z.string().optional(),
  summary: z.record(Severity, z.number().int().nonnegative()),
  findings: z.array(Finding),
});

/** Extract the first fenced ` ```json audit-report ` block's body, or null. */
function extractAuditBlock(text: string): string | null {
  const m = text.match(/```json audit-report\n([\s\S]*?)\n```/);
  return m?.[1] ?? null;
}

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

    const block = extractAuditBlock(raw);
    if (block === null) continue; // no Tier-2 block → skip, not malformed

    let json: unknown;
    try {
      json = JSON.parse(block);
    } catch {
      malformed.push({ filename, reason: "audit-report block is not valid JSON" });
      continue;
    }

    const parsed = AuditReport.safeParse(json);
    if (!parsed.success) {
      malformed.push({ filename, reason: parsed.error.issues.map((i) => i.message).join("; ") });
      continue;
    }

    found.push({ report: parsed.data as AuditReportContract, filename });
  }

  found.sort(
    (a, b) =>
      b.report.scanned_at.localeCompare(a.report.scanned_at) ||
      a.filename.localeCompare(b.filename),
  );
  return { reports: found.map((f) => f.report), malformed };
}
