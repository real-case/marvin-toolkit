import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import {
  MvRoot,
  TOKENS,
  SEVERITY_TOKENS,
  MV_FONT_MONO,
  type MvTheme,
  type MvSeverityToken,
} from "../../theme";

/**
 * The dashboard widget (ADR-0024 #8) — the marvin whole-toolbox status **panel**
 * over the `DashboardState` the existing read-only `dashboard` tool already returns.
 * Like task-summary / audit it is not a `<ListDetail>`: a `DashboardState` is a single
 * object of heterogeneous sections, so it renders as a header strip plus a responsive
 * grid of section cards (paths · config · board · artifacts · adr · security · refactor
 * · lessons · usage · commands).
 *
 * Split into a pure {@link DashboardView} (props-only, no SDK) and the App wiring below —
 * the same shape as the sibling widgets — so the render is unit-testable without a
 * transport, and one view serves production (`useApp`), the tests, and the story.
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the view wraps its
 * root in `<MvRoot>` — production, seam, tests, and stories all render the same themed
 * tree — and every color is a `.mvroot` token reference (TOKENS / SEVERITY_TOKENS);
 * the widget declares no palette and no font of its own (mono only on code-like values
 * via MV_FONT_MONO). The outer panel paints the canvas recipe itself: `var(--bg)`,
 * 0.5px `var(--bd)` border, radius 4, padding 14.
 *
 * `DashboardState` is fully structured (no `body_markdown`), so there is no `<Markdown>`
 * and no `LinkRef` — every value is a count, a status word, or a path rendered as an
 * escaped plain-text / mono-chip node. The extended sections (adr / security / refactor /
 * lessons / usage) are OPTIONAL on the contract: the `dashboard` tool emits them
 * present-but-zeroed on a fresh project, while the narrower `help` payload omits them —
 * so a card renders when its field is present (even at zero) and is omitted when the
 * field is absent. Nullable ages / windows are never dereferenced.
 */

// ── tones ─────────────────────────────────────────────────────────────────────────────
// A pill/tag tone is either a SEVERITY_TOKENS key or the neutral tag (second surface +
// secondary text, no dot). The board role roll-up (ADR-0026) borrows the severity ramp
// semantically: wip reads informational (blue), review cautionary (amber), done green,
// blocked red; todo stays neutral.
type Tone = MvSeverityToken | "neutral";

const ROLE_ORDER = ["todo", "wip", "review", "done", "blocked"] as const;
const ROLE_TONE: Record<(typeof ROLE_ORDER)[number], Tone> = {
  todo: "neutral",
  wip: "low",
  review: "medium",
  done: "pass",
  blocked: "fail",
};

/** Microlabel (mockup `.lab`): 10.5px/500 uppercase, .06em tracking, meta text. */
const microlabelStyle: CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

/** The widget canvas — bg ground, 0.5px hairline, radius 4, 14px inset (design frame). */
const frameStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: 14,
};

/** Quiet placeholder text for empty states ("not configured", zero-state notes). */
const emptyNoteStyle: CSSProperties = { color: TOKENS.t3, fontSize: "12.5px" };

/** Aligned numerals (mockup `.num`). */
const numStyle: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
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

// ── small building blocks (the shared component recipes) ─────────────────────────────

/**
 * Status pill / neutral tag. A severity tone renders the tinted pill with the 5px
 * currentColor dot; the neutral tone renders the dot-less tag on the second surface.
 * Labels are lowercase data words already — no transform applied.
 */
function Pill({
  tone = "neutral",
  testid,
  dataAttrs,
  children,
}: {
  tone?: Tone;
  testid?: string;
  /** Extra `data-*` attributes (e.g. `data-adr-status`) spread onto the tag. */
  dataAttrs?: Record<string, string>;
  children: ReactNode;
}) {
  const colors = tone === "neutral" ? { text: TOKENS.t2, bg: TOKENS.srf2 } : SEVERITY_TOKENS[tone];
  return (
    <span
      data-testid={testid}
      {...dataAttrs}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 9px",
        borderRadius: 4,
        fontSize: "11.5px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        background: colors.bg,
        color: colors.text,
      }}
    >
      {tone !== "neutral" ? (
        <span
          aria-hidden="true"
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "currentColor",
            flex: "none",
          }}
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * Mono code chip (mockup `.cc`) for paths, branches, templates, command names.
 * `wrap` swaps the nowrap default for break-all so monorepo-deep paths fold inside
 * their card instead of blowing the grid column open.
 */
function MonoChip({ children, wrap }: { children: ReactNode; wrap?: boolean }) {
  return (
    <code
      style={{
        fontFamily: MV_FONT_MONO,
        fontSize: 11,
        background: TOKENS.srf2,
        border: `0.5px solid ${TOKENS.bd}`,
        borderRadius: 4,
        padding: "1px 6px",
        ...(wrap
          ? { display: "inline-block", whiteSpace: "normal", wordBreak: "break-all" }
          : { whiteSpace: "nowrap" }),
      }}
    >
      {children}
    </code>
  );
}

/** A titled surface card — the unit of the dashboard grid (mockup `.card` + `.lab`). */
function Card({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  return (
    <section
      data-testid={testid}
      style={{
        background: TOKENS.srf,
        border: `0.5px solid ${TOKENS.bd}`,
        borderRadius: 4,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <h3 style={{ margin: "0 0 8px", ...microlabelStyle }}>{title}</h3>
      {children}
    </section>
  );
}

/** Stat cell: microlabel over a 21px/500 tabular-nums value (mockup KPI recipe). */
function StatCell({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} style={{ minWidth: "3.2rem" }}>
      <div style={microlabelStyle}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.2, marginTop: 2, ...numStyle }}>
        {value}
      </div>
    </div>
  );
}

/** A horizontal wrap of stat cells. */
function StatRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>{children}</div>;
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
    <div
      data-testid={testid}
      style={{ display: "flex", gap: 8, padding: "2px 0", alignItems: "baseline" }}
    >
      <span style={{ fontSize: 12, color: TOKENS.t3, flex: "0 0 auto" }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** Flex-wrapped tag/pill cluster. */
function TagRow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6, ...style }}>{children}</div>;
}

// ── section cards ─────────────────────────────────────────────────────────────────────

/** Header strip: title, version, git/gh availability, current branch. */
function Header({ data }: { data: DashboardState }) {
  return (
    <header
      data-testid="dashboard-header"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 10px" }}
    >
      <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.015em" }}>
        Toolbox dashboard
      </span>
      <Pill testid="dashboard-version">v{data.version}</Pill>
      <Pill tone={data.git.has_git ? "pass" : "neutral"}>
        {`git ${data.git.has_git ? "✓" : "✗"}`}
      </Pill>
      <Pill tone={data.git.has_gh ? "pass" : "neutral"}>{`gh ${data.git.has_gh ? "✓" : "✗"}`}</Pill>
      <span data-testid="dashboard-branch" style={{ minWidth: 0 }}>
        {data.git.branch ? (
          <MonoChip wrap>{data.git.branch}</MonoChip>
        ) : (
          <span style={emptyNoteStyle}>(not in a git repo)</span>
        )}
      </span>
    </header>
  );
}

function PathsCard({ paths }: { paths: DashboardState["paths"] }) {
  return (
    <Card title="Paths" testid="card-paths">
      <DefRow label="project">
        <MonoChip wrap>{paths.project}</MonoChip>
      </DefRow>
      <DefRow label="tasks">
        <MonoChip wrap>{paths.tasks_dir}</MonoChip>
      </DefRow>
      <DefRow label="config">
        <MonoChip wrap>{paths.config_path}</MonoChip>
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
        <MonoChip wrap>{config.base_branch}</MonoChip>
      </DefRow>
      <DefRow label="tracker" testid="config-tracker">
        {config.tracker_url_template ? (
          <MonoChip wrap>{config.tracker_url_template}</MonoChip>
        ) : (
          <span style={emptyNoteStyle}>not configured</span>
        )}
      </DefRow>
      <DefRow label="gates" testid="config-gates">
        {gateEntries.length > 0 ? (
          <TagRow>
            {gateEntries.map(([name]) => (
              <Pill key={name}>{name}</Pill>
            ))}
          </TagRow>
        ) : (
          <span style={emptyNoteStyle}>defaults</span>
        )}
      </DefRow>
      <div data-testid="config-statuses" style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: TOKENS.t3 }}>statuses</div>
        <TagRow style={{ marginTop: 4 }}>
          {config.statuses.map((s) => (
            <Pill key={s.key} dataAttrs={{ "data-role": s.role }}>
              {s.key}
              {s.key === s.role ? "" : ` · ${s.role}`}
            </Pill>
          ))}
        </TagRow>
      </div>
    </Card>
  );
}

function BoardCard({
  counts,
  roleCounts,
  statuses,
}: {
  counts: DashboardState["board_counts"];
  roleCounts: DashboardState["board_role_counts"];
  statuses: DashboardState["config"]["statuses"];
}) {
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  return (
    <Card title={`Board (${total})`} testid="card-board">
      <div data-testid="board-roles" style={{ marginBottom: 8 }}>
        <TagRow>
          {ROLE_ORDER.map((role) => (
            <Pill key={role} tone={ROLE_TONE[role]}>
              {`${role} ${roleCounts[role] ?? 0}`}
            </Pill>
          ))}
        </TagRow>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {statuses.map((s) => (
          <li
            key={s.key}
            data-testid="board-status"
            data-status={s.key}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 0",
              alignItems: "baseline",
            }}
          >
            <span style={{ minWidth: 0 }}>
              {s.key}
              {s.key === s.role ? (
                ""
              ) : (
                <span style={{ fontSize: 12, color: TOKENS.t3 }}> ({s.role})</span>
              )}
            </span>
            <span style={{ fontWeight: 500, ...numStyle }}>{counts[s.key] ?? 0}</span>
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
      <StatRow>
        <StatCell label="specs" value={artifacts.specs} testid="artifacts-specs" />
        <StatCell label="handoffs" value={artifacts.handoffs} />
        <StatCell label="audits" value={artifacts.audits} />
        <StatCell label="lessons" value={artifacts.lessons} />
      </StatRow>
      <div style={{ marginTop: 8 }}>
        <DefRow label="verification" testid="artifacts-verification">
          <span style={{ fontSize: "12.5px", color: TOKENS.t2 }}>{verificationLabel}</span>
        </DefRow>
      </div>
    </Card>
  );
}

function AdrCard({ adr }: { adr: NonNullable<DashboardState["adr"]> }) {
  const present = nonZeroEntries(adr.counts);
  return (
    <Card title={`Decisions · ADR (${adr.total})`} testid="card-adr">
      <DefRow label="corpus">
        <MonoChip wrap>{adr.dir}</MonoChip>
      </DefRow>
      {present.length > 0 ? (
        <TagRow style={{ marginTop: 4 }}>
          {present.map(([status, n]) => (
            <Pill key={status} dataAttrs={{ "data-adr-status": status }}>
              {`${status} ${n}`}
            </Pill>
          ))}
        </TagRow>
      ) : (
        <p style={{ ...emptyNoteStyle, margin: "4px 0 0" }}>No records yet.</p>
      )}
      {adr.malformed > 0 ? (
        <p data-testid="adr-malformed" style={{ margin: "8px 0 0" }}>
          <Pill tone="stale">{`${adr.malformed} malformed`}</Pill>
        </p>
      ) : null}
    </Card>
  );
}

function SecurityCard({ security }: { security: NonNullable<DashboardState["security"]> }) {
  return (
    <Card title="Security" testid="card-security">
      <StatRow>
        <StatCell label="reports" value={security.reports} testid="security-reports" />
        <StatCell
          label="newest"
          value={formatAge(security.newest_age_days)}
          testid="security-newest"
        />
      </StatRow>
    </Card>
  );
}

function RefactorCard({ refactor }: { refactor: NonNullable<DashboardState["refactor"]> }) {
  return (
    <Card title="Refactor" testid="card-refactor">
      <StatRow>
        <StatCell label="audits" value={refactor.audits} testid="refactor-audits" />
        <StatCell label="smells" value={refactor.smells} testid="refactor-smells" />
        <StatCell label="plans" value={refactor.plans} testid="refactor-plans" />
      </StatRow>
    </Card>
  );
}

function LessonsCard({ lessons }: { lessons: NonNullable<DashboardState["lessons"]> }) {
  const byType = nonZeroEntries(lessons.by_type);
  return (
    <Card title={`Lessons (${lessons.total})`} testid="card-lessons">
      {byType.length > 0 ? (
        <TagRow>
          {byType.map(([type, n]) => (
            <Pill key={type} dataAttrs={{ "data-lesson-type": type }}>
              {`${type} ${n}`}
            </Pill>
          ))}
        </TagRow>
      ) : (
        <p style={{ ...emptyNoteStyle, margin: 0 }}>No lessons captured yet.</p>
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
        <span style={{ fontSize: "12.5px", color: TOKENS.t2, ...numStyle }}>{windowLabel}</span>
      </DefRow>
      {usage.top.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
          {usage.top.map((t) => (
            <li
              key={`${t.kind}:${t.name}`}
              data-testid="usage-top"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "2px 0",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  minWidth: 0,
                  flexWrap: "wrap",
                }}
              >
                <MonoChip>{t.name}</MonoChip>
                <span style={{ fontSize: 12, color: TOKENS.t3 }}>{t.kind}</span>
              </span>
              <span style={{ fontWeight: 500, ...numStyle }}>×{t.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ ...emptyNoteStyle, margin: "4px 0 0" }}>No events recorded.</p>
      )}
    </Card>
  );
}

function CommandsCard({ groups }: { groups: DashboardState["command_groups"] }) {
  const total = groups.reduce((n, g) => n + g.count, 0);
  return (
    <Card title={`Commands (${total})`} testid="card-commands">
      <TagRow>
        {groups.map((g) => (
          <Pill key={g.group} dataAttrs={{ "data-group": g.group }}>
            {`${g.group} ${g.count}`}
          </Pill>
        ))}
      </TagRow>
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
  /**
   * Pin the theme of the view's own `<MvRoot>`. Stories only (pinned dark/light
   * variants for deterministic screenshots) — production omits it, so the widget
   * follows the host/OS `prefers-color-scheme`.
   */
  theme?: MvTheme;
}

/**
 * Pure presentational dashboard. Renders the one `DashboardState` as a header strip plus a
 * responsive grid of section cards; carries no SDK dependency, so it is driven purely by
 * props in tests, the story, and both wiring paths. Stateless — there is no selection to own.
 * Every branch (panel, connecting, error) renders inside the view's own `<MvRoot>`, so the
 * production and seam paths get the theme scope from the same place.
 * Each optional extended section renders a card only when its field is present (even at zero);
 * an absent field (the narrower `help` payload) simply omits the card.
 */
export function DashboardView({ data, connecting, error, theme }: DashboardViewProps) {
  let body: ReactNode;
  if (error) {
    body = (
      <div
        data-testid="dashboard-error"
        style={{ ...frameStyle, color: TOKENS.red, fontSize: "12.5px" }}
      >
        Couldn’t load the dashboard: {error}
      </div>
    );
  } else if (!data) {
    body = (
      <div
        data-testid="dashboard-connecting"
        style={{ ...frameStyle, color: TOKENS.t3, fontSize: "12.5px" }}
      >
        {connecting === false ? "No dashboard data." : "Connecting…"}
      </div>
    );
  } else {
    body = (
      <div data-testid="dashboard-panel" style={frameStyle}>
        <Header data={data} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
            gap: 10,
            marginTop: 12,
            alignItems: "start",
          }}
        >
          <PathsCard paths={data.paths} />
          <ConfigCard config={data.config} />
          <BoardCard
            counts={data.board_counts}
            roleCounts={data.board_role_counts}
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

  return <MvRoot theme={theme}>{body}</MvRoot>;
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
    appInfo: { name: "marvin-dashboard", version: "0.8.1" },
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
