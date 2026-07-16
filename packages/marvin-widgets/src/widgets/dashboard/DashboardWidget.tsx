import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * The dashboard widget (ADR-0024 #8) — the marvin whole-toolbox status **panel**
 * over the `DashboardState` the existing read-only `dashboard` tool already returns.
 * Like task-summary / audit it is not a `<ListDetail>`: a `DashboardState` is a single
 * object of heterogeneous sections, so it renders as a header strip plus a responsive
 * grid of section cards (paths · config · kanban · artifacts · adr · security · refactor
 * · lessons · usage · commands).
 *
 * Split into a pure {@link DashboardView} (props-only, no SDK) and the App wiring below —
 * the same shape as the sibling widgets — so the render is unit-testable without a
 * transport, and one view serves production (`useApp`), the tests, and the story.
 *
 * `DashboardState` is fully structured (no `body_markdown`), so there is no `<Markdown>`
 * and no `LinkRef` — every value is a count, a status word, or a path rendered as an
 * escaped plain-text / `<code>` node. The extended sections (adr / security / refactor /
 * lessons / usage) are OPTIONAL on the contract: the `dashboard` tool emits them
 * present-but-zeroed on a fresh project, while the narrower `help` payload omits them —
 * so a card renders when its field is present (even at zero) and is omitted when the
 * field is absent. Nullable ages / windows are never dereferenced.
 */

// ── palette: host CSS variables with a literal fallback so every chip reads in either
// host theme (the pattern the sibling widgets use). ──────────────────────────────────
const NEUTRAL: CSSProperties = {
  background: "var(--color-background-secondary, #f0f0f0)",
  color: "var(--color-text-secondary, #555)",
};
const SUCCESS: CSSProperties = {
  background: "var(--color-background-success, #e6f4ea)",
  color: "var(--color-text-success, #137333)",
};
const DANGER: CSSProperties = {
  background: "var(--color-background-danger, #fdecea)",
  color: "var(--color-text-danger, #b00020)",
};
const INFO: CSSProperties = {
  background: "var(--color-background-info, #e8f0fe)",
  color: "var(--color-text-info, #0b57d0)",
};
const WARNING: CSSProperties = {
  background: "var(--color-background-warning, #fef7e0)",
  color: "var(--color-text-warning, #8a6d00)",
};

// The kanban role roll-up (ADR-0026): every StatusRole, in lifecycle order. `todo`
// reads as neutral; the rest carry a subtle progress/terminal colour.
const ROLE_ORDER = ["todo", "wip", "review", "done", "blocked"] as const;
const ROLE_COLOR: Record<string, CSSProperties> = {
  todo: NEUTRAL,
  wip: INFO,
  review: WARNING,
  done: SUCCESS,
  blocked: DANGER,
};

function badgeStyle(colors: CSSProperties): CSSProperties {
  return {
    display: "inline-block",
    padding: "0.05rem 0.4rem",
    borderRadius: "var(--border-radius-sm, 4px)",
    fontSize: "0.75em",
    fontWeight: 600,
    letterSpacing: "0.02em",
    ...colors,
  };
}

/** The widget frame — the whole widget as one rounded card on the host canvas. */
const frameStyle: CSSProperties = {
  border: "1px solid var(--color-border-primary, #e2e2e2)",
  borderRadius: "var(--border-radius-md, 8px)",
  // 0.75rem matches the card grid's own gap, so the inset around the grid reads
  // as one more gutter rather than a second, competing rhythm.
  padding: "0.75rem",
};

const chipStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.1rem 0.45rem",
  borderRadius: "var(--border-radius-sm, 4px)",
  fontSize: "0.8em",
  ...NEUTRAL,
};

const mutedStyle: CSSProperties = { opacity: 0.6, fontSize: "0.85em" };
const emptyNoteStyle: CSSProperties = { ...mutedStyle, fontStyle: "italic" };
const codeStyle: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.82em",
  wordBreak: "break-all",
};

/** Human-friendly file/report age: null → "none", 0 → "today", n → "Nd ago". */
function formatAge(days: number | null): string {
  if (days === null) return "none";
  if (days === 0) return "today";
  return `${days}d ago`;
}

/** `key: n` fragments for the non-zero entries of a counts record (stable key order). */
function nonZeroEntries(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts).filter(([, n]) => n > 0);
}

// ── small building blocks ────────────────────────────────────────────────────────────

function Badge({
  colors,
  children,
  testid,
}: {
  colors: CSSProperties;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <span data-testid={testid} style={badgeStyle(colors)}>
      {children}
    </span>
  );
}

/** A titled, bordered panel card — the unit of the dashboard grid. */
function Card({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  return (
    <section
      data-testid={testid}
      style={{
        border: "1px solid var(--color-border-primary, #e2e2e2)",
        borderRadius: "var(--border-radius-md, 8px)",
        padding: "0.6rem 0.7rem",
        minWidth: 0,
      }}
    >
      <h3
        style={{
          margin: "0 0 0.45rem",
          fontSize: "0.72rem",
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A big-number stat tile: the count over a muted label. */
function StatTile({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} style={{ minWidth: "3.2rem" }}>
      <div style={{ fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
      <div style={mutedStyle}>{label}</div>
    </div>
  );
}

/** A horizontal wrap of stat tiles. */
function TileRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem" }}>{children}</div>;
}

/** A `label: value` definition row for the config/paths cards. */
function DefRow({
  label,
  children,
  testid,
}: {
  label: string;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <div data-testid={testid} style={{ display: "flex", gap: "0.4rem", padding: "0.12rem 0" }}>
      <span style={{ ...mutedStyle, flex: "0 0 auto" }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

// ── section cards ─────────────────────────────────────────────────────────────────────

/** Header strip: title, version, git/gh availability, current branch. */
function Header({ data }: { data: DashboardState }) {
  return (
    <header
      data-testid="dashboard-header"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.4rem 0.7rem" }}
    >
      <strong style={{ fontSize: "1.1rem" }}>marvin · toolbox dashboard</strong>
      <Badge colors={INFO} testid="dashboard-version">
        v{data.version}
      </Badge>
      <Badge colors={data.git.has_git ? SUCCESS : NEUTRAL}>
        git {data.git.has_git ? "✓" : "✗"}
      </Badge>
      <Badge colors={data.git.has_gh ? SUCCESS : NEUTRAL}>gh {data.git.has_gh ? "✓" : "✗"}</Badge>
      <span data-testid="dashboard-branch" style={mutedStyle}>
        <code style={codeStyle}>{data.git.branch ?? "(not in a git repo)"}</code>
      </span>
    </header>
  );
}

function PathsCard({ paths }: { paths: DashboardState["paths"] }) {
  return (
    <Card title="Paths" testid="card-paths">
      <DefRow label="project">
        <code style={codeStyle}>{paths.project}</code>
      </DefRow>
      <DefRow label="tasks">
        <code style={codeStyle}>{paths.tasks_dir}</code>
      </DefRow>
      <DefRow label="config">
        <code style={codeStyle}>{paths.config_path}</code>
      </DefRow>
    </Card>
  );
}

function ConfigCard({ config }: { config: DashboardState["config"] }) {
  const gateEntries = config.gates
    ? Object.entries(config.gates).filter(([, cmd]) => typeof cmd === "string" && cmd.length > 0)
    : [];
  return (
    <Card title="Config" testid="card-config">
      <DefRow label="base">
        <code style={codeStyle}>{config.base_branch}</code>
      </DefRow>
      <DefRow label="tracker" testid="config-tracker">
        {config.tracker_url_template ? (
          <code style={codeStyle}>{config.tracker_url_template}</code>
        ) : (
          <span style={emptyNoteStyle}>not configured</span>
        )}
      </DefRow>
      <DefRow label="gates" testid="config-gates">
        {gateEntries.length > 0 ? (
          <span style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {gateEntries.map(([name]) => (
              <span key={name} style={chipStyle}>
                {name}
              </span>
            ))}
          </span>
        ) : (
          <span style={emptyNoteStyle}>defaults</span>
        )}
      </DefRow>
      <div data-testid="config-statuses" style={{ marginTop: "0.35rem" }}>
        <div style={mutedStyle}>statuses</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.2rem" }}>
          {config.statuses.map((s) => (
            <span key={s.key} style={chipStyle} data-role={s.role}>
              {s.key}
              {s.key === s.role ? "" : ` · ${s.role}`}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function KanbanCard({
  counts,
  roleCounts,
  statuses,
}: {
  counts: DashboardState["kanban_counts"];
  roleCounts: DashboardState["kanban_role_counts"];
  statuses: DashboardState["config"]["statuses"];
}) {
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  return (
    <Card title={`Kanban (${total})`} testid="card-kanban">
      <div
        data-testid="kanban-roles"
        style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.45rem" }}
      >
        {ROLE_ORDER.map((role) => (
          <Badge key={role} colors={ROLE_COLOR[role] ?? NEUTRAL}>
            {role} {roleCounts[role] ?? 0}
          </Badge>
        ))}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {statuses.map((s) => (
          <li
            key={s.key}
            data-testid="kanban-status"
            data-status={s.key}
            style={{ display: "flex", justifyContent: "space-between", padding: "0.1rem 0" }}
          >
            <span>
              {s.key}
              {s.key === s.role ? "" : <span style={mutedStyle}> ({s.role})</span>}
            </span>
            <strong>{counts[s.key] ?? 0}</strong>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ArtifactsCard({ artifacts }: { artifacts: DashboardState["artifacts"] }) {
  const v = artifacts.verification;
  const verificationLabel = !v ? "—" : v.exists ? formatAge(v.age_days) : "none";
  return (
    <Card title="Artifacts" testid="card-artifacts">
      <TileRow>
        <StatTile label="specs" value={artifacts.specs} testid="artifacts-specs" />
        <StatTile label="handoffs" value={artifacts.handoffs} />
        <StatTile label="audits" value={artifacts.audits} />
        <StatTile label="lessons" value={artifacts.lessons} />
      </TileRow>
      <DefRow label="verification" testid="artifacts-verification">
        <span>{verificationLabel}</span>
      </DefRow>
    </Card>
  );
}

function AdrCard({ adr }: { adr: NonNullable<DashboardState["adr"]> }) {
  const present = nonZeroEntries(adr.counts);
  return (
    <Card title={`Decisions · ADR (${adr.total})`} testid="card-adr">
      <DefRow label="corpus">
        <code style={codeStyle}>{adr.dir}</code>
      </DefRow>
      {present.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.2rem" }}>
          {present.map(([status, n]) => (
            <span key={status} style={chipStyle} data-adr-status={status}>
              {status} {n}
            </span>
          ))}
        </div>
      ) : (
        <p style={emptyNoteStyle}>No records yet.</p>
      )}
      {adr.malformed > 0 ? (
        <p data-testid="adr-malformed" style={{ ...mutedStyle, marginTop: "0.3rem" }}>
          ⚠ {adr.malformed} malformed
        </p>
      ) : null}
    </Card>
  );
}

function SecurityCard({ security }: { security: NonNullable<DashboardState["security"]> }) {
  return (
    <Card title="Security" testid="card-security">
      <TileRow>
        <StatTile label="reports" value={security.reports} testid="security-reports" />
        <StatTile
          label="newest"
          value={formatAge(security.newest_age_days)}
          testid="security-newest"
        />
      </TileRow>
    </Card>
  );
}

function RefactorCard({ refactor }: { refactor: NonNullable<DashboardState["refactor"]> }) {
  return (
    <Card title="Refactor" testid="card-refactor">
      <TileRow>
        <StatTile label="audits" value={refactor.audits} testid="refactor-audits" />
        <StatTile label="smells" value={refactor.smells} testid="refactor-smells" />
        <StatTile label="plans" value={refactor.plans} testid="refactor-plans" />
      </TileRow>
    </Card>
  );
}

function LessonsCard({ lessons }: { lessons: NonNullable<DashboardState["lessons"]> }) {
  const byType = nonZeroEntries(lessons.by_type);
  return (
    <Card title={`Lessons (${lessons.total})`} testid="card-lessons">
      {byType.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          {byType.map(([type, n]) => (
            <span key={type} style={chipStyle} data-lesson-type={type}>
              {type} {n}
            </span>
          ))}
        </div>
      ) : (
        <p style={emptyNoteStyle}>No lessons captured yet.</p>
      )}
    </Card>
  );
}

function UsageCard({ usage }: { usage: NonNullable<DashboardState["usage"]> }) {
  const windowLabel = usage.window
    ? `${usage.window.from.slice(0, 10)} → ${usage.window.to.slice(0, 10)}`
    : "—";
  return (
    <Card title={`Usage (${usage.events})`} testid="card-usage">
      <DefRow label="window" testid="usage-window">
        <span>{windowLabel}</span>
      </DefRow>
      {usage.top.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "0.2rem 0 0", padding: 0 }}>
          {usage.top.map((t) => (
            <li
              key={`${t.kind}:${t.name}`}
              data-testid="usage-top"
              style={{ display: "flex", justifyContent: "space-between", padding: "0.08rem 0" }}
            >
              <span>
                <code style={codeStyle}>{t.name}</code> <span style={mutedStyle}>{t.kind}</span>
              </span>
              <strong>×{t.count}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p style={emptyNoteStyle}>No events recorded.</p>
      )}
    </Card>
  );
}

function CommandsCard({ groups }: { groups: DashboardState["command_groups"] }) {
  const total = groups.reduce((n, g) => n + g.count, 0);
  return (
    <Card title={`Commands (${total})`} testid="card-commands">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {groups.map((g) => (
          <span key={g.group} style={chipStyle} data-group={g.group}>
            {g.group} {g.count}
          </span>
        ))}
      </div>
    </Card>
  );
}

export interface DashboardViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: DashboardState | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
}

/**
 * Pure presentational dashboard. Renders the one `DashboardState` as a header strip plus a
 * responsive grid of section cards; carries no SDK dependency, so it is driven purely by
 * props in tests, the story, and both wiring paths. Stateless — there is no selection to own.
 * Each optional extended section renders a card only when its field is present (even at zero);
 * an absent field (the narrower `help` payload) simply omits the card.
 */
export function DashboardView({ data, connecting, error }: DashboardViewProps) {
  if (error) {
    return (
      <div
        data-testid="dashboard-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00020)" }}
      >
        Couldn’t load the dashboard: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="dashboard-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No dashboard data." : "Connecting…"}
      </div>
    );
  }

  return (
    <div
      data-testid="dashboard-panel"
      style={{
        // fontFamily, not the `font` shorthand: the shorthand requires a size, so
        // a family-only `font:` is invalid CSS — the declaration is dropped and
        // the widget renders in the host default serif.
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--color-text-primary, #1a1a1a)",
        ...frameStyle,
      }}
    >
      <Header data={data} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
          gap: "0.75rem",
          marginTop: "0.9rem",
          alignItems: "start",
        }}
      >
        <PathsCard paths={data.paths} />
        <ConfigCard config={data.config} />
        <KanbanCard
          counts={data.kanban_counts}
          roleCounts={data.kanban_role_counts}
          statuses={data.config.statuses}
        />
        <ArtifactsCard artifacts={data.artifacts} />
        {data.adr ? <AdrCard adr={data.adr} /> : null}
        {data.security ? <SecurityCard security={data.security} /> : null}
        {data.refactor ? <RefactorCard refactor={data.refactor} /> : null}
        {data.lessons ? <LessonsCard lessons={data.lessons} /> : null}
        {data.usage ? <UsageCard usage={data.usage} /> : null}
        <CommandsCard groups={data.command_groups} />
      </div>
    </div>
  );
}

/**
 * The transport seam (mirrors task-summary/audit). `useApp` hard-wires a
 * `PostMessageTransport` to `window.parent`, which is `=== window` under happy-dom (no
 * iframe nesting), so the automated test injects an `App` + in-memory transport instead.
 * Production omits `seam` and takes the live path.
 */
export interface DashboardSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface DashboardWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: DashboardSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was injected;
 * the choice is fixed per mount (tests always inject, production never does), so this
 * wrapper calls no hooks itself and the two children each own their hook order.
 */
export function DashboardWidget({ seam }: DashboardWidgetProps) {
  return seam ? <DashboardSeamWidget seam={seam} /> : <DashboardLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function DashboardLiveWidget() {
  const [data, setData] = useState<DashboardState | null>(null);
  const { isConnected, error } = useApp({
    appInfo: { name: "marvin-dashboard", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as DashboardState);
        }
      };
    },
  });
  return (
    <DashboardView data={data} connecting={!isConnected} error={error ? error.message : null} />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function DashboardSeamWidget({ seam }: { seam: DashboardSeam }) {
  const [data, setData] = useState<DashboardState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as DashboardState);
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

  return <DashboardView data={data} connecting={!connected} error={error} />;
}
