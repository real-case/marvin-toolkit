import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  AuditKind,
  AuditListPayload,
  AuditReport,
  Finding,
  LinkRef,
  Severity,
} from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { Markdown } from "../../primitives/Markdown";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";
import { MvRoot, MV_FONT_MONO, SEVERITY_TOKENS, TOKENS, type MvTheme } from "../../theme";

/**
 * The audit widget (ADR-0024 #7) — a severity-triage viewer over the structured
 * sec-* findings the `audit` tool already returns as `AuditListPayload`. It
 * flattens every report's findings into ONE master list, sorts it critical→info,
 * and offers a severity filter (the ADR-0024 headline). Split into a pure
 * {@link AuditListView} (props-only, no SDK) and the App wiring below — the same
 * shape as task-list — so the render is unit-testable without a transport and the
 * same view serves both production (`useApp`) and the mock-host seam paths.
 *
 * Flat, not two-level: severity triage is cross-cutting (a critical secret and a
 * critical injection matter equally regardless of which scanner found them), so
 * findings sort/filter across ALL reports at once; each row keeps its source
 * scanner as an annotation so per-report context is not lost.
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the view
 * renders inside {@link MvRoot} — so production, seam, tests and stories all get
 * the token scope — and every color is a `var(--…)` token reference. Sans is the
 * base type; mono appears only on code-like values (locations, command names).
 */

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

/**
 * Severity → `{ text, bg }` tint pair for pills and active filter chips. The four
 * ranked severities take the semantic scale; `info` ranks nothing, so it sits on
 * the neutral second surface step (the same treatment as the scanner-kind tag).
 */
const SEVERITY_TONE: Record<Severity, { text: string; bg: string }> = {
  critical: SEVERITY_TOKENS.critical,
  high: SEVERITY_TOKENS.high,
  medium: SEVERITY_TOKENS.medium,
  low: SEVERITY_TOKENS.low,
  info: { text: TOKENS.t2, bg: TOKENS.srf2 },
};

/**
 * The widget panel — the one element that paints the family canvas (`MvRoot`
 * deliberately does not): `bg` ground, 0.5px hairline, 4px radius, 14px inset.
 */
const panelStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  padding: "14px",
};

/** Card surface — one step up from the canvas; hosts the master-detail split. */
const cardStyle: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  // Clips row hover/selection fills at the rounded corners.
  overflow: "hidden",
};

/** A finding flattened out of its report, carrying the report context it needs. */
interface FindingRow {
  /** Stable React key: report index + finding id, unique across reports. */
  key: string;
  finding: Finding;
  kind: AuditKind;
  target?: string;
  scanned_at: string;
}

/**
 * Pill geometry shared by the severity dot-pills and the neutral tags, so the two
 * colourways can never drift apart. Labels stay lowercase data (severities and
 * scanner kinds already are) — the family has no uppercase badges.
 */
const pillBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "1px 9px",
  borderRadius: "4px",
  fontSize: "11.5px",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

/** The 5px currentColor dot that leads a severity/status pill (never a tag). */
const pillDotStyle: CSSProperties = {
  width: "5px",
  height: "5px",
  borderRadius: "50%",
  background: "currentColor",
  flex: "none",
};

/** Neutral tag — srf2 ground, secondary text, no dot (a scanner name ranks nothing). */
const neutralTagStyle: CSSProperties = {
  ...pillBaseStyle,
  background: TOKENS.srf2,
  color: TOKENS.t2,
};

/** A severity dot-pill (or, with an explicit tone, any status pill). */
function SeverityPill({ severity }: { severity: Severity }) {
  const tone = SEVERITY_TONE[severity];
  return (
    <span style={{ ...pillBaseStyle, background: tone.bg, color: tone.text }}>
      <span style={pillDotStyle} aria-hidden="true" />
      {severity}
    </span>
  );
}

/** Mono code chip — locations and command names; the only mono in the widget. */
const codeChipStyle: CSSProperties = {
  fontFamily: MV_FONT_MONO,
  fontSize: "11px",
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  padding: "1px 6px",
};

/** Ghost button base — hover (srf2 ground, primary text) lives in the widget CSS. */
const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  font: "inherit",
  fontSize: "12px",
  letterSpacing: "inherit",
  color: TOKENS.t2,
  background: "transparent",
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  padding: "3px 10px",
};

/** Microlabel — the uppercase section heading grade (Evidence / Remediation). */
const microlabelStyle: CSSProperties = {
  margin: "0 0 4px",
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

/** Aligned digits (chip counts, dates) — the mockup's `.num` treatment. */
const numStyle: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

// ── widget-local pseudo-class styling ────────────────────────────────────────
// Hover states cannot live inline, so the widget injects one id-keyed <style>
// element at render time — the same idempotent lifecycle as MvRoot's token sheet.

/** id of the injected `<style>` element — the once-per-document key. */
const AUDIT_STYLE_ID = "mv-audit-styles";

const AUDIT_CSS = `
.mvroot .mvaud-gbtn:hover{background:${TOKENS.srf2};color:${TOKENS.t1}}
`;

/** Put the widget's hover stylesheet into the document exactly once. */
function ensureAuditStyles(): void {
  if (typeof document === "undefined" || document.getElementById(AUDIT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = AUDIT_STYLE_ID;
  style.textContent = AUDIT_CSS;
  document.head.appendChild(style);
}

/** Flatten reports → findings, sorted critical→info (tie-break newest report, id). */
function flattenFindings(reports: AuditReport[]): FindingRow[] {
  const rows: FindingRow[] = [];
  reports.forEach((report, ri) => {
    for (const finding of report.findings) {
      rows.push({
        key: `${ri}:${finding.id}`,
        finding,
        kind: report.kind,
        target: report.target,
        scanned_at: report.scanned_at,
      });
    }
  });
  rows.sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(a.finding.severity) - SEVERITY_ORDER.indexOf(b.finding.severity);
    if (bySeverity !== 0) return bySeverity;
    const byTime = b.scanned_at.localeCompare(a.scanned_at);
    if (byTime !== 0) return byTime;
    return a.finding.id.localeCompare(b.finding.id);
  });
  return rows;
}

/** Count findings per severity across the rows (drives the filter chips). */
function severityCounts(rows: FindingRow[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of rows) counts[row.finding.severity] += 1;
  return counts;
}

/**
 * One filter chip — "All" or a single severity, with its count. Resting chips are
 * hairline-outlined secondary text; the active chip drops its border and takes
 * `tone` (the severity tint, or the accent tint for "All"), so the engaged filter
 * reads in the same colour language as the pills it filters.
 */
function FilterChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: { text: string; bg: string };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        font: "inherit",
        fontSize: "11.5px",
        fontWeight: 500,
        letterSpacing: "inherit",
        cursor: "pointer",
        borderRadius: "4px",
        border: `0.5px solid ${active ? "transparent" : TOKENS.bd}`,
        background: active ? tone.bg : "transparent",
        color: active ? tone.text : TOKENS.t2,
        padding: "2px 10px",
      }}
    >
      {label} <span style={{ ...numStyle, opacity: 0.6 }}>{count}</span>
    </button>
  );
}

/** The detail pane for one finding: fields + evidence/remediation markdown + links. */
function FindingDetail({
  row,
  onOpenLink,
}: {
  row: FindingRow;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const { finding, kind, target, scanned_at } = row;
  const links = finding.links ?? [];
  const location = finding.file
    ? finding.line
      ? `${finding.file}:${finding.line}`
      : finding.file
    : null;
  return (
    <div>
      <h2
        data-testid="detail-title"
        style={{
          margin: "0 0 8px",
          fontSize: "14.5px",
          fontWeight: 500,
          letterSpacing: "-0.01em",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <SeverityPill severity={finding.severity} />
        <span>{finding.title}</span>
      </h2>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "2px 12px",
          margin: 0,
          fontSize: "12.5px",
        }}
      >
        <dt style={{ color: TOKENS.t3 }}>Category</dt>
        <dd style={{ margin: 0 }}>{finding.category}</dd>
        <dt style={{ color: TOKENS.t3 }}>Scanner</dt>
        <dd style={{ margin: 0 }}>{kind}</dd>
        {target ? (
          <>
            <dt style={{ color: TOKENS.t3 }}>Target</dt>
            <dd style={{ margin: 0 }}>{target}</dd>
          </>
        ) : null}
        {location ? (
          <>
            <dt style={{ color: TOKENS.t3 }}>Location</dt>
            <dd style={{ margin: 0 }}>
              <code style={codeChipStyle}>{location}</code>
            </dd>
          </>
        ) : null}
        <dt style={{ color: TOKENS.t3 }}>Scanned</dt>
        <dd style={{ margin: 0, ...numStyle }}>{formatDate(scanned_at)}</dd>
      </dl>
      {finding.evidence ? (
        <section data-testid="finding-evidence" style={{ marginTop: "12px" }}>
          <h3 style={microlabelStyle}>Evidence</h3>
          <Markdown source={finding.evidence} />
        </section>
      ) : null}
      {finding.remediation ? (
        <section data-testid="finding-remediation" style={{ marginTop: "12px" }}>
          <h3 style={microlabelStyle}>Remediation</h3>
          <Markdown source={finding.remediation} />
        </section>
      ) : null}
      {links.length > 0 ? (
        <div style={{ marginTop: "12px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {links.map((link) => {
            const action = classifyLink(link);
            return (
              <button
                key={`${link.kind}:${link.url ?? link.ref ?? link.label}`}
                type="button"
                className="mvaud-gbtn"
                onClick={() => onOpenLink?.(link)}
                style={{ ...ghostButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
              >
                {action.type === "external" ? "↗ " : ""}
                {link.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export interface AuditListViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: AuditListPayload | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /** Open a link through the host. Omitted in pure-render contexts (tests/story). */
  onOpenLink?: (link: LinkRef) => void;
  /**
   * Pin the widget to one theme (stories only — the visual-regression dark
   * variants). Production leaves it unset so the host/OS scheme applies.
   */
  theme?: MvTheme;
}

/**
 * Pure presentational audit view. Renders a title header, a severity filter, and
 * a master-detail list of findings sorted critical→info; carries no SDK
 * dependency, so it is driven purely by props in tests, the story, and both
 * wiring paths. Owns only the (widget-local) severity-filter selection. Every
 * render branch — states included — sits inside the same `MvRoot` + panel, so
 * both wiring paths and all story states share one theme scope.
 */
export function AuditListView({ data, connecting, error, onOpenLink, theme }: AuditListViewProps) {
  ensureAuditStyles();
  // `null` = the "All" filter (show every severity). Widget-local — no host call.
  const [filter, setFilter] = useState<Severity | null>(null);

  let body;
  if (error) {
    body = (
      <div data-testid="audit-error" style={{ color: TOKENS.red, fontSize: "12.5px" }}>
        Couldn’t load audit reports: {error}
      </div>
    );
  } else if (!data) {
    body = (
      <div data-testid="audit-connecting" style={{ color: TOKENS.t3, fontSize: "12.5px" }}>
        {connecting === false ? "No data." : "Connecting…"}
      </div>
    );
  } else if (data.reports.length === 0) {
    // Degraded empty — no reports at all: nothing has been scanned.
    body = (
      <div data-testid="audit-empty" style={{ color: TOKENS.t2, fontSize: "12.5px" }}>
        No audit reports yet — run a <code style={codeChipStyle}>/marvin:sec-*</code> scan (e.g.{" "}
        <code style={codeChipStyle}>/marvin:sec-scan</code>).
      </div>
    );
  } else {
    const rows = flattenFindings(data.reports);

    if (rows.length === 0) {
      // Positive empty — reports exist but none carries a finding: a clean scan.
      body = (
        <div
          data-testid="audit-clear"
          style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px" }}
        >
          <span
            style={{
              ...pillBaseStyle,
              background: SEVERITY_TOKENS.clean.bg,
              color: SEVERITY_TOKENS.clean.text,
            }}
          >
            <span style={pillDotStyle} aria-hidden="true" />
            clean
          </span>
          <span>
            No findings across {data.reports.length} report
            {data.reports.length === 1 ? "" : "s"} — all clear.
          </span>
        </div>
      );
    } else {
      const counts = severityCounts(rows);
      const present = SEVERITY_ORDER.filter((s) => counts[s] > 0);
      const visible = filter ? rows.filter((r) => r.finding.severity === filter) : rows;

      body = (
        <>
          <header data-testid="audit-counts" style={{ margin: "2px 0 12px" }}>
            <span style={{ fontSize: "16px", fontWeight: 500, letterSpacing: "-0.015em" }}>
              Audit findings
            </span>
          </header>
          <div
            data-testid="severity-filter"
            role="group"
            aria-label="filter by severity"
            style={{ display: "flex", gap: "5px", flexWrap: "wrap", margin: "0 0 10px" }}
          >
            <FilterChip
              label="All"
              count={rows.length}
              active={filter === null}
              tone={{ text: TOKENS.act, bg: TOKENS.acbg }}
              onClick={() => setFilter(null)}
            />
            {present.map((s) => (
              <FilterChip
                key={s}
                label={s}
                count={counts[s]}
                active={filter === s}
                tone={SEVERITY_TONE[s]}
                onClick={() => setFilter(s)}
              />
            ))}
          </div>
          <div style={cardStyle}>
            <ListDetail
              // Remount on filter change so selection resets to the top result.
              key={filter ?? "all"}
              items={visible}
              ariaLabel="findings"
              getKey={(row) => row.key}
              emptyLabel="No findings for this severity."
              renderRow={(row) => (
                // Two stacked rows, not one flow: pills on their own line keep the
                // title starting at a fixed left edge, so titles scan as a column
                // instead of each one being indented by whatever the pills ahead
                // of it measured.
                <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span
                    style={{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}
                  >
                    <SeverityPill severity={row.finding.severity} />
                    <span style={neutralTagStyle}>{row.kind}</span>
                  </span>
                  <span style={{ fontWeight: 500 }}>{row.finding.title}</span>
                </span>
              )}
              renderDetail={(row) => <FindingDetail row={row} onOpenLink={onOpenLink} />}
            />
          </div>
        </>
      );
    }
  }

  return (
    <MvRoot theme={theme}>
      <div style={panelStyle}>{body}</div>
    </MvRoot>
  );
}

/**
 * The transport seam (mirrors task-list/task-detail). `useApp` hard-wires a
 * `PostMessageTransport` to `window.parent`, which is `=== window` under happy-dom
 * (no iframe nesting), so the automated test injects an `App` + in-memory transport
 * instead. Production omits `seam` and takes the live path.
 */
export interface AuditSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface AuditWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: AuditSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount (tests always inject, production never
 * does), so this wrapper calls no hooks itself and the two children each own their
 * hook order.
 */
export function AuditWidget({ seam }: AuditWidgetProps) {
  return seam ? <AuditSeamWidget seam={seam} /> : <AuditLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function AuditLiveWidget() {
  const [data, setData] = useState<AuditListPayload | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-audit", version: "0.8.0" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as AuditListPayload);
        }
      };
    },
  });
  const onOpenLink = (link: LinkRef) => {
    if (app) void dispatchLink(app, link).catch(() => {});
  };
  return (
    <AuditListView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onOpenLink={onOpenLink}
    />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function AuditSeamWidget({ seam }: { seam: AuditSeam }) {
  const [data, setData] = useState<AuditListPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as AuditListPayload);
      }
    };
    app.connect(transport).then(
      () => {
        if (!cancelled) setConnected(true);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [seam]);

  const onOpenLink = (link: LinkRef) => {
    void dispatchLink(seam.app, link).catch(() => {});
  };

  return (
    <AuditListView data={data} connecting={!connected} error={error} onOpenLink={onOpenLink} />
  );
}
