import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { AuditListPayload, AuditReport, Severity } from "@marvin-toolkit/mcp-shared/contracts";
import { readAllAuditReports } from "../storage/security.js";
import type { ServerEnv } from "../lib/env.js";
import { AUDIT_WIDGET_URI } from "../resources/widgets.js";

const AuditInput = z.object({
  action: z.enum(["list"]).optional(),
});

export function buildAuditTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "audit",
    description:
      "List the structured security-audit reports the sec-* scanners wrote under .marvin/security/ " +
      "(ADR-0024 #7): each scanner's typed audit-report block, newest first, with per-severity counts. " +
      "Terminals see the text summary; MCP Apps hosts get the AuditListPayload widget payload.",
    inputSchema: AuditInput,
    // Bind the audit `ui://` widget for MCP Apps hosts (ADR-0024 #7). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: AUDIT_WIDGET_URI } },
    // Only one action today (list); the optional enum leaves room to grow
    // (e.g. a `show` detail action) without a breaking schema change.
    handler: () => Promise.resolve(runList(env)),
  });
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

function runList(env: ServerEnv): ToolResult {
  const { reports, malformed } = readAllAuditReports(env.securityDir);

  const body =
    reports.length === 0
      ? "_No audit reports yet — run a `/marvin:sec-*` scan (e.g. `/marvin:sec-scan`)._"
      : reports.map(formatReportLine).join("\n");
  const warning =
    malformed.length > 0
      ? `\n\n_⚠ ${malformed.length} report(s) with an invalid audit-report block: ${malformed
          .map((m) => m.filename)
          .join(", ")} (re-run the scanner)_`
      : "";

  return {
    content: [
      { type: "text", text: `# Security audit reports (${reports.length})\n\n${body}${warning}` },
    ],
    // Widget payload for MCP Apps hosts (ADR-0024) — the audit-viewer (#7).
    structuredContent: buildPayload(reports),
  };
}

/** One line per report: kind, when, total findings, and a severity breakdown. */
function formatReportLine(r: AuditReport): string {
  const total = r.findings.length;
  const breakdown = SEVERITY_ORDER.filter((s) => (r.summary[s] ?? 0) > 0)
    .map((s) => `${s} ${r.summary[s]}`)
    .join(", ");
  const when = r.scanned_at.slice(0, 10);
  const target = r.target ? ` \`${r.target}\`` : "";
  const counts = breakdown ? ` — ${breakdown}` : "";
  return `- **${r.kind}**${target} · ${total} finding(s)${counts} · ${when}`;
}

/** Map the recovered reports to the AuditListPayload widget contract. */
function buildPayload(reports: AuditReport[]): AuditListPayload {
  return { reports };
}
