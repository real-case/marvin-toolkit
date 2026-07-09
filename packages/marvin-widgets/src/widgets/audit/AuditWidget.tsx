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
 */

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

/** A finding flattened out of its report, carrying the report context it needs. */
interface FindingRow {
  /** Stable React key: report index + finding id, unique across reports. */
  key: string;
  finding: Finding;
  kind: AuditKind;
  target?: string;
  scanned_at: string;
}

// Per-severity chip/badge colouring: host CSS variables where a matching one
// exists (danger/info/secondary), literal fallbacks for the amber/orange middle
// that the host contract does not define. The badge is a small chip, so the fixed
// fallbacks read fine in both host themes.
const SEVERITY_COLOR: Record<Severity, CSSProperties> = {
  critical: {
    background: "var(--color-background-danger, #fdecea)",
    color: "var(--color-text-danger, #b00020)",
  },
  high: { background: "#fff1e6", color: "#b3450b" },
  medium: { background: "#fff8e1", color: "#8a6d00" },
  low: {
    background: "var(--color-background-info, #eef4ff)",
    color: "var(--color-text-info, #0b57d0)",
  },
  info: {
    background: "var(--color-background-secondary, #f0f0f0)",
    color: "var(--color-text-secondary, #555)",
  },
};

function severityBadgeStyle(sev: Severity): CSSProperties {
  return {
    display: "inline-block",
    padding: "0.05rem 0.4rem",
    borderRadius: "var(--border-radius-sm, 4px)",
    fontSize: "0.75em",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    ...SEVERITY_COLOR[sev],
  };
}

const linkButtonStyle: CSSProperties = {
  font: "inherit",
  border: "1px solid var(--color-border-primary, #d0d0d0)",
  borderRadius: "var(--border-radius-sm, 4px)",
  background: "transparent",
  color: "var(--color-text-info, #0b57d0)",
  padding: "0.2rem 0.5rem",
};

const sectionHeadingStyle: CSSProperties = {
  margin: "0 0 0.25rem",
  fontSize: "0.8rem",
  opacity: 0.6,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

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

/** Count findings per severity across the rows (drives the header + filter chips). */
function severityCounts(rows: FindingRow[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of rows) counts[row.finding.severity] += 1;
  return counts;
}

/** One filter chip — "All" or a single severity, with its count. */
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        font: "inherit",
        fontSize: "0.8em",
        cursor: "pointer",
        borderRadius: "var(--border-radius-sm, 4px)",
        border: active
          ? "1px solid var(--color-text-info, #0b57d0)"
          : "1px solid var(--color-border-primary, #d0d0d0)",
        background: active ? "var(--color-background-info, #eef4ff)" : "transparent",
        color: "var(--color-text-primary, #1a1a1a)",
        padding: "0.15rem 0.5rem",
      }}
    >
      {label} <span style={{ opacity: 0.6 }}>{count}</span>
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
          margin: "0 0 0.5rem",
          fontSize: "1.1rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span style={severityBadgeStyle(finding.severity)}>{finding.severity}</span>
        <span>{finding.title}</span>
      </h2>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "0.15rem 0.75rem",
          margin: 0,
        }}
      >
        <dt style={{ opacity: 0.6 }}>Category</dt>
        <dd style={{ margin: 0 }}>{finding.category}</dd>
        <dt style={{ opacity: 0.6 }}>Scanner</dt>
        <dd style={{ margin: 0 }}>{kind}</dd>
        {target ? (
          <>
            <dt style={{ opacity: 0.6 }}>Target</dt>
            <dd style={{ margin: 0 }}>{target}</dd>
          </>
        ) : null}
        {location ? (
          <>
            <dt style={{ opacity: 0.6 }}>Location</dt>
            <dd style={{ margin: 0 }}>
              <code>{location}</code>
            </dd>
          </>
        ) : null}
        <dt style={{ opacity: 0.6 }}>Scanned</dt>
        <dd style={{ margin: 0 }}>{formatDate(scanned_at)}</dd>
      </dl>
      {finding.evidence ? (
        <section data-testid="finding-evidence" style={{ marginTop: "0.75rem" }}>
          <h3 style={sectionHeadingStyle}>Evidence</h3>
          <Markdown source={finding.evidence} />
        </section>
      ) : null}
      {finding.remediation ? (
        <section data-testid="finding-remediation" style={{ marginTop: "0.75rem" }}>
          <h3 style={sectionHeadingStyle}>Remediation</h3>
          <Markdown source={finding.remediation} />
        </section>
      ) : null}
      {links.length > 0 ? (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {links.map((link) => {
            const action = classifyLink(link);
            return (
              <button
                key={`${link.kind}:${link.url ?? link.ref ?? link.label}`}
                type="button"
                onClick={() => onOpenLink?.(link)}
                style={{ ...linkButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
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
}

/**
 * Pure presentational audit view. Renders a findings-count header, a severity
 * filter, and a master-detail list of findings sorted critical→info; carries no
 * SDK dependency, so it is driven purely by props in tests, the story, and both
 * wiring paths. Owns only the (widget-local) severity-filter selection.
 */
export function AuditListView({ data, connecting, error, onOpenLink }: AuditListViewProps) {
  // `null` = the "All" filter (show every severity). Widget-local — no host call.
  const [filter, setFilter] = useState<Severity | null>(null);

  if (error) {
    return (
      <div
        data-testid="audit-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00020)" }}
      >
        Couldn’t load audit reports: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="audit-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No data." : "Connecting…"}
      </div>
    );
  }

  // Degraded empty — no reports at all: nothing has been scanned.
  if (data.reports.length === 0) {
    return (
      <div data-testid="audit-empty" style={{ padding: "1rem", opacity: 0.7 }}>
        No audit reports yet — run a <code>/marvin:sec-*</code> scan (e.g.{" "}
        <code>/marvin:sec-scan</code>).
      </div>
    );
  }

  const rows = flattenFindings(data.reports);

  // Positive empty — reports exist but none carries a finding: a clean scan.
  if (rows.length === 0) {
    return (
      <div data-testid="audit-clear" style={{ padding: "1rem" }}>
        No findings across {data.reports.length} report{data.reports.length === 1 ? "" : "s"} — all
        clear.
      </div>
    );
  }

  const counts = severityCounts(rows);
  const present = SEVERITY_ORDER.filter((s) => counts[s] > 0);
  const visible = filter ? rows.filter((r) => r.finding.severity === filter) : rows;
  const breakdown = present.map((s) => `${s} ${counts[s]}`).join(" · ");

  return (
    <div
      style={{
        // fontFamily, not the `font` shorthand: the shorthand requires a size, so
        // a family-only `font:` is invalid CSS — the declaration is dropped and
        // the widget renders in the host default serif.
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--color-text-primary, #1a1a1a)",
      }}
    >
      <header
        data-testid="audit-counts"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.75rem",
          padding: "0.5rem 0.25rem",
          borderBottom: "1px solid var(--color-border-primary, #e2e2e2)",
          marginBottom: "0.5rem",
        }}
      >
        <strong>
          {rows.length} {rows.length === 1 ? "finding" : "findings"}
        </strong>
        <span style={{ opacity: 0.7, fontSize: "0.9em" }}>{breakdown}</span>
      </header>
      <div
        data-testid="severity-filter"
        role="group"
        aria-label="filter by severity"
        style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.5rem" }}
      >
        <FilterChip
          label="All"
          count={rows.length}
          active={filter === null}
          onClick={() => setFilter(null)}
        />
        {present.map((s) => (
          <FilterChip
            key={s}
            label={s}
            count={counts[s]}
            active={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>
      <ListDetail
        // Remount on filter change so selection resets to the top result.
        key={filter ?? "all"}
        items={visible}
        ariaLabel="findings"
        getKey={(row) => row.key}
        emptyLabel="No findings for this severity."
        renderRow={(row) => (
          <span>
            <span style={severityBadgeStyle(row.finding.severity)}>{row.finding.severity}</span>
            <span style={{ opacity: 0.6, margin: "0 0.4rem" }}>{row.kind}</span>
            {row.finding.title}
          </span>
        )}
        renderDetail={(row) => <FindingDetail row={row} onOpenLink={onOpenLink} />}
      />
    </div>
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
    appInfo: { name: "marvin-audit", version: "0.20.0" },
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
