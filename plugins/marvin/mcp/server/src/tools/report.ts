import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type {
  ReportEnvelope,
  ReportFinding,
  ReportGroup,
  ReportListPayload,
} from "@marvin-toolkit/mcp-shared/contracts";
import { buildReportList, TriageState, type ReportDirs, type ScanNote } from "../lib/reports.js";
import {
  BASELINE_FILENAME,
  ensureTriageDir,
  nextBaseline,
  readBaseline,
  reconcile,
  writeBaseline,
  type BaselineEntry,
} from "../lib/triage.js";
import type { ServerEnv } from "../lib/env.js";

/**
 * The unified reports viewer tool (docs/design/reports-widget.md). The `list`
 * action scans every document marvin generates under `.marvin/` — security
 * reports (via the shared audit-report block parser), refactor registers and
 * plans, task specs + verification.md, handoffs, critique receipts (ADR-0039)
 * — and emits the whole set as a
 * `ReportListPayload`: one envelope per document, newest first, with
 * server-computed staleness and continuation commands as data. Terminals get
 * the grouped markdown fallback; MCP Apps hosts render the reports widget.
 *
 * The `triage` action answers the question a single run cannot — what is new
 * and what is still open — by reconciling the live findings against a stored
 * baseline (ADR-0038). Both actions run that reconciliation, so the widget and
 * the terminal see the same identity data; only `snapshot: true` writes.
 */

/** The `ui://` binding WP-E wires into `resources/widgets.ts` (ADR-0024). */
export const REPORTS_WIDGET_URI = "ui://marvin/reports.html";

const ReportInput = z
  .object({
    // Stays `.optional()`: an absent action means `list`, which is what both
    // prose doors, `scripts/mcp-call.mjs` and every existing caller do. The
    // `.strict()` below governs UNDECLARED keys only — it says nothing about
    // whether a declared key is required.
    action: z.enum(["list", "triage"]).optional(),
    selected: z
      .string()
      .optional()
      .describe(
        "Deep-link: report id (project-relative path) to pre-select in the widget, " +
          "e.g. `.marvin/task/verification.md`.",
      ),
    snapshot: z
      .boolean()
      .default(false)
      .describe(
        "Record the current findings as the new triage baseline. The ONLY writing " +
          "path in this tool — default false, because the tool is widget-bound and an " +
          "always-writing reconciliation would let merely opening the panel consume " +
          "the baseline.",
      ),
  })
  // Opted in deliberately (ADR-0038): a caller who INTENDS `snapshot: true` and
  // mistypes the key would otherwise get a successful-looking call that wrote
  // nothing, after which every later triage reports the whole finding set as
  // new. The silent no-op that looks like success is the failure worth an error.
  .strict();

export function buildReportTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "report",
    description:
      "List every report marvin generated under .marvin/ — security scans, refactor " +
      "registers and plans, task specs, verification.md, handoffs, critique receipts — " +
      "as one unified set, " +
      'newest first, with per-report freshness. `action: "triage"` adds the ' +
      "new/persisting/regressed/resolved roll-up against the stored baseline; " +
      "`snapshot: true` records the current findings as that baseline. Terminals see " +
      "the grouped text summary; MCP Apps hosts get the ReportListPayload reports widget.",
    inputSchema: ReportInput,
    // Bind the reports `ui://` widget for MCP Apps hosts (ADR-0024). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    //
    // The binding is TOOL-level: every action inherits the widget whether or
    // not it wants one. That is precisely why the write sits behind a
    // default-false `snapshot` flag rather than behind the `triage` action.
    meta: { ui: { resourceUri: REPORTS_WIDGET_URI } },
    handler: (input) => Promise.resolve(run(env, input)),
  });
}

const GROUP_ORDER: ReportGroup[] = ["security", "refactor", "task", "handoff", "critique"];

/**
 * Total by construction: the one enumeration in this package that fails the
 * build when `ReportGroup` widens and a member is forgotten. The other three
 * (`GROUP_ORDER`, the dirs literal, `ReportDirs`) accept a missing member
 * silently, which is why `test/report-groups.test.mjs` exists.
 */
const GROUP_LABELS: Record<ReportGroup, string> = {
  security: "Security",
  refactor: "Refactor",
  task: "Task",
  handoff: "Handoff",
  critique: "Critique",
};

/**
 * Assemble, reconcile, render — and write only when asked.
 *
 * The reconciliation is read-only and runs for BOTH actions, so a terminal and
 * a widget never disagree about a finding's identity. `snapshot: true` is the
 * one path that touches the filesystem: it is a separate flag rather than a
 * third action because the widget binding is tool-level, so an action-keyed
 * write would be reachable by any host that merely opens the panel.
 */
function run(env: ServerEnv, input: z.infer<typeof ReportInput>): ToolResult {
  const now = Date.now();
  // Named rather than inlined so `test/report-groups.test.mjs` can read its keys
  // as text: a group missing here is a directory that is never scanned, and the
  // literal compiles fine without it.
  const scanDirs: ReportDirs = {
    security: env.securityDir,
    refactor: join(env.projectDir, ".marvin", "refactor"),
    task: join(env.projectDir, ".marvin", "task"),
    handoff: env.handoffDir,
    critique: env.critiqueDir,
  };
  const { reports, notes } = buildReportList(scanDirs);

  const baselinePath = join(env.reportDir, BASELINE_FILENAME);
  const baseline = readBaseline(baselinePath);
  const { envelopes, resolved } = reconcile(reports, baseline, now);

  let recorded: BaselineEntry[] | null = null;
  if (input.snapshot === true) {
    recorded = nextBaseline(reports, baseline, now);
    ensureTriageDir(env.reportDir);
    writeBaseline(baselinePath, recorded, now);
  }

  const payload: ReportListPayload = {
    reports: envelopes,
    ...(input.selected ? { selected: input.selected } : {}),
  };

  const text =
    input.action === "triage"
      ? renderTriage(envelopes, resolved, notes, { baselineExists: baseline.length > 0, recorded })
      : renderList(envelopes, notes);

  return {
    content: [{ type: "text", text }],
    // Widget payload for MCP Apps hosts (ADR-0024) — the reports viewer.
    structuredContent: payload,
  };
}

// ── triage roll-up ───────────────────────────────────────────────────────────

/** Every reconciled finding — the ones the pass actually annotated. */
function reconciledFindings(reports: ReportEnvelope[]): ReportFinding[] {
  return reports.flatMap((r) => {
    const body = r.body as { findings?: ReportFinding[] };
    return (body.findings ?? []).filter((f) => f.state !== undefined);
  });
}

/**
 * The observable this action exists to produce: counts per state and the
 * resolved set, so a wrong reconciliation is visible in the text fallback
 * without a debugger. `resolved` is a roll-up line and never a finding state —
 * there is no row left on disk to carry it.
 */
function renderTriage(
  reports: ReportEnvelope[],
  resolved: BaselineEntry[],
  notes: ScanNote[],
  ctx: { baselineExists: boolean; recorded: BaselineEntry[] | null },
): string {
  const findings = reconciledFindings(reports);
  const lines: string[] = [`# Finding triage (${findings.length} live finding(s))`, ""];

  if (!ctx.baselineExists) {
    lines.push(
      "_No baseline recorded yet — every finding reads as **new**. Run this again with " +
        "`snapshot: true` to record the current state as the baseline._",
      "",
    );
  }

  for (const state of TriageState.options) {
    const inState = findings.filter((f) => f.state === state);
    lines.push(`- **${state}**: ${inState.length}`);
  }
  lines.push(`- **resolved**: ${resolved.length}`);
  lines.push("");

  for (const state of TriageState.options) {
    const inState = findings.filter((f) => f.state === state);
    if (inState.length === 0) continue;
    lines.push(`## ${state} (${inState.length})`, "");
    for (const f of inState) {
      const where = f.file ? ` — \`${f.file}\`` : "";
      lines.push(`- [${f.severity}] ${f.title}${where} · \`${f.fingerprint}\``);
    }
    lines.push("");
  }

  if (resolved.length > 0) {
    lines.push(`## resolved (${resolved.length})`, "");
    lines.push(
      "_Gone from every current report; listed by identity because no row remains to " +
        "describe them._",
      "",
    );
    for (const e of resolved) lines.push(`- \`${e.fingerprint}\` · first seen ${e.firstSeen}`);
    lines.push("");
  }

  lines.push(
    ctx.recorded
      ? `_Baseline recorded: ${ctx.recorded.length} fingerprint(s)._`
      : "_Read-only: no baseline was written. Pass `snapshot: true` to record this state._",
  );

  if (notes.length > 0) {
    lines.push(
      "",
      `_⚠ skipped ${notes.length} file(s):_`,
      ...notes.map((n) => `- \`${n.file}\` — ${n.reason}`),
    );
  }
  return lines.join("\n").trimEnd();
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
