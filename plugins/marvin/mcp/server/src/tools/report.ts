import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type {
  ReportEnvelope,
  ReportGroup,
  ReportListPayload,
} from "@marvin-toolkit/mcp-shared/contracts";
import { buildReportList, type ScanNote } from "../lib/reports.js";
import type { ServerEnv } from "../lib/env.js";

/**
 * The unified reports viewer tool (docs/design/reports-widget.md). One `list`
 * action scans every document marvin generates under `.marvin/` — security
 * reports (via the shared audit-report block parser), refactor registers and
 * plans, task specs + verification.md, handoffs — and emits the whole set as a
 * `ReportListPayload`: one envelope per document, newest first, with
 * server-computed staleness and continuation commands as data. Terminals get
 * the grouped markdown fallback; MCP Apps hosts render the reports widget.
 */

/** The `ui://` binding WP-E wires into `resources/widgets.ts` (ADR-0024). */
export const REPORTS_WIDGET_URI = "ui://marvin/reports.html";

const ReportInput = z.object({
  action: z.enum(["list"]).optional(),
  selected: z
    .string()
    .optional()
    .describe(
      "Deep-link: report id (project-relative path) to pre-select in the widget, " +
        "e.g. `.marvin/task/verification.md`.",
    ),
});

export function buildReportTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "report",
    description:
      "List every report marvin generated under .marvin/ — security scans, refactor " +
      "registers and plans, task specs, verification.md, handoffs — as one unified set, " +
      "newest first, with per-report freshness. Terminals see the grouped text summary; " +
      "MCP Apps hosts get the ReportListPayload reports widget.",
    inputSchema: ReportInput,
    // Bind the reports `ui://` widget for MCP Apps hosts (ADR-0024). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: REPORTS_WIDGET_URI } },
    // Only one action today (list); the optional enum leaves room to grow
    // (e.g. a `show` detail action) without a breaking schema change.
    handler: (input) => Promise.resolve(runList(env, input)),
  });
}

const GROUP_ORDER: ReportGroup[] = ["security", "refactor", "task", "handoff"];

const GROUP_LABELS: Record<ReportGroup, string> = {
  security: "Security",
  refactor: "Refactor",
  task: "Task",
  handoff: "Handoff",
};

function runList(env: ServerEnv, input: z.infer<typeof ReportInput>): ToolResult {
  const { reports, notes } = buildReportList({
    security: env.securityDir,
    refactor: join(env.projectDir, ".marvin", "refactor"),
    task: join(env.projectDir, ".marvin", "task"),
    handoff: env.handoffDir,
  });

  const payload: ReportListPayload = {
    reports,
    ...(input.selected ? { selected: input.selected } : {}),
  };

  return {
    content: [{ type: "text", text: renderList(reports, notes) }],
    // Widget payload for MCP Apps hosts (ADR-0024) — the reports viewer.
    structuredContent: payload,
  };
}

// ── text fallback ────────────────────────────────────────────────────────────

function renderList(reports: ReportEnvelope[], notes: ScanNote[]): string {
  const lines: string[] = [`# Reports (${reports.length})`, ""];

  if (reports.length === 0) {
    lines.push(
      "_No reports yet — run `/marvin:sec-scan`, `/marvin:refactor-audit` or " +
        "`/marvin:task-verify` to generate the first one._",
    );
  } else {
    for (const group of GROUP_ORDER) {
      const inGroup = reports.filter((r) => r.group === group);
      if (inGroup.length === 0) continue;
      lines.push(`## ${GROUP_LABELS[group]} (${inGroup.length})`, "");
      for (const r of inGroup) lines.push(formatReportLine(r));
      lines.push("");
    }
  }

  if (notes.length > 0) {
    lines.push(
      "",
      `_⚠ skipped ${notes.length} file(s):_`,
      ...notes.map((n) => `- \`${n.file}\` — ${n.reason}`),
    );
  }
  return lines.join("\n").trimEnd();
}

/** One line per report: title, summary chip, age (+ staleness), source path. */
function formatReportLine(r: ReportEnvelope): string {
  const stale = r.stale ? " · **stale**" : "";
  return `- **${r.title}** — ${formatSummary(r)} · ${formatAge(r.generatedAt)}${stale} · \`${r.path}\``;
}

function formatSummary(r: ReportEnvelope): string {
  const s = r.summary;
  if (s.kind === "findings") {
    const total = s.counts.critical + s.counts.high + s.counts.medium + s.counts.low;
    const breakdown = (["critical", "high", "medium", "low"] as const)
      .filter((k) => s.counts[k] > 0)
      .map((k) => `${k} ${s.counts[k]}`)
      .join(", ");
    return `${total} finding(s)${breakdown ? ` (${breakdown})` : ""}`;
  }
  if (s.kind === "checks") {
    return s.total === 0
      ? "0 checks"
      : s.failed > 0
        ? `${s.done}/${s.total} checks, ${s.failed} failed`
        : `${s.done}/${s.total} checks`;
  }
  return s.tag;
}

/** Compact age from an ISO timestamp: `5m`, `3h`, `12d` ago. */
function formatAge(iso: string): string {
  const ms = Math.max(0, Date.now() - Date.parse(iso));
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
