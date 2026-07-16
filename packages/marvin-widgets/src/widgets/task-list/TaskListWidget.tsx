import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { LinkRef, TaskCard, TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";
import {
  MvRoot,
  MV_FONT_MONO,
  SEVERITY_TOKENS,
  TOKENS,
  type MvSeverityToken,
  type MvTheme,
} from "../../theme";

/**
 * The task-list widget (ADR-0024) — the first end-to-end `ui://` widget. It is
 * split into a pure {@link TaskListView} (props-only, no SDK) and the App wiring
 * below, so the rendering is unit-testable without a transport and the same view
 * serves both the production (`useApp`) and the AC3 mock-host seam paths.
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the view
 * renders under its own `<MvRoot>` scope (so both wiring paths get the tokens),
 * paints the widget canvas itself, and colors everything through `var(--…)`
 * token references — no literal palette in this file.
 */

type StatusRole = TaskCard["status"]["role"];

const ROLE_ORDER: StatusRole[] = ["todo", "wip", "review", "done", "blocked"];

/**
 * Lifecycle role → severity-token tone for the status dot-pill. The vocabulary
 * is shared with the task-detail widget so a status reads identically across
 * the family: todo is the neutral tag (no dot), wip is informational blue,
 * review is amber (waiting on someone), done is pass green, blocked is fail red.
 */
const ROLE_TONE: Record<StatusRole, MvSeverityToken | null> = {
  todo: null,
  wip: "low",
  review: "medium",
  done: "pass",
  blocked: "fail",
};

// ── widget-local stylesheet ──────────────────────────────────────────────────
// Hover states cannot live inline, so the widget injects one id-keyed <style>
// element at render time — the same idempotent lifecycle as MvRoot's token
// sheet and ListDetail's row rules.

/** id of the injected `<style>` element — the once-per-document key. */
const TASK_LIST_STYLE_ID = "mv-task-list-styles";

/** Ghost link buttons (the mockup's `.gbtn` recipe) — quiet until hovered. */
const TASK_LIST_CSS = `
.mvtl-gbtn{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;letter-spacing:inherit;color:${TOKENS.t2};background:transparent;border:0.5px solid ${TOKENS.bd};border-radius:4px;padding:3px 10px}
.mvtl-gbtn:hover{background:${TOKENS.srf2};color:${TOKENS.t1}}
`;

function ensureTaskListStyles(): void {
  if (typeof document === "undefined" || document.getElementById(TASK_LIST_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TASK_LIST_STYLE_ID;
  style.textContent = TASK_LIST_CSS;
  document.head.appendChild(style);
}

// ── shared style recipes (docs/design/reports-widget.md) ────────────────────

/** The widget canvas — the outer panel every state renders on. */
const panelStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: 14,
};

/** Aligned digits everywhere numbers sit next to each other. */
const numStyle: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

/** The dot-pill / neutral-tag base (tone colors are applied per use). */
const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "1px 9px",
  borderRadius: 4,
  fontSize: 11.5,
  fontWeight: 500,
  whiteSpace: "nowrap",
  textTransform: "lowercase",
};

/** The pill's 5px currentColor dot. */
const dotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "currentColor",
  flex: "none",
};

/** Microlabel — section/field labels (10.5px caps on meta gray). */
const microlabelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

/** Mono code chip for code-like values (branch names). */
const codeChipStyle: CSSProperties = {
  fontFamily: MV_FONT_MONO,
  fontSize: 11,
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: "1px 6px",
  display: "inline-block",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "bottom",
};

/** The segmented control's track (the status filter lives on it). */
const segTrackStyle: CSSProperties = {
  display: "inline-flex",
  background: TOKENS.srf2,
  borderRadius: 4,
  padding: 2,
  gap: 2,
};

/** The list card the master-detail shell sits in. */
const cardStyle: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  overflow: "hidden",
};

/** The detail pane's task title. */
const detailTitleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: 14.5,
  fontWeight: 500,
  letterSpacing: "-0.01em",
};

const ddStyle: CSSProperties = { margin: 0 };

/**
 * A task's status as the family dot-pill: tinted background, text-grade tone,
 * lowercase configured key, 5px dot. `todo` stays the neutral tag (second
 * surface, secondary text, no dot). `data-tone` pins the role→tone mapping for
 * tests without asserting resolved colors.
 */
function StatusPill({ status }: { status: TaskCard["status"] }) {
  const tone = ROLE_TONE[status.role];
  const palette = tone ? SEVERITY_TOKENS[tone] : { text: TOKENS.t2, bg: TOKENS.srf2 };
  return (
    <span
      data-testid="status-pill"
      data-role={status.role}
      data-tone={tone ?? "neutral"}
      style={{ ...pillStyle, background: palette.bg, color: palette.text, flex: "none" }}
    >
      {tone ? <span style={dotStyle} aria-hidden="true" /> : null}
      {status.key}
    </span>
  );
}

/**
 * One role in the header's status filter, as a segment on the segmented track.
 * Multi-select stays: each segment is an independent toggle whose on state is
 * the raised surface (`srf` + primary text, no shadow); `aria-pressed` carries
 * the on/off state the fill shows sighted users.
 */
function RoleFilterSegment({
  role,
  count,
  active,
  onClick,
}: {
  role: StatusRole;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid="role-filter"
      data-role={role}
      onClick={onClick}
      style={{
        font: "inherit",
        fontSize: 12.5,
        letterSpacing: "inherit",
        border: "none",
        borderRadius: 4,
        padding: "4px 11px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        background: active ? TOKENS.srf : "transparent",
        color: active ? TOKENS.t1 : TOKENS.t2,
      }}
    >
      {role} <span style={{ ...numStyle, fontSize: 11, color: TOKENS.t3 }}>{count}</span>
    </button>
  );
}

/** Build the display links (ADR-0024 link model) a card carries: tracker + PR. */
function cardLinks(card: TaskCard): LinkRef[] {
  const links: LinkRef[] = [];
  if (card.tracker_url) {
    links.push({ kind: "tracker", label: card.tracker_id ?? "Tracker", url: card.tracker_url });
  }
  if (card.pr) {
    links.push({
      kind: "pr",
      label: card.pr.number ? `PR #${card.pr.number}` : "PR",
      url: card.pr.url,
    });
  }
  return links;
}

/**
 * The detail pane's task title. When the task has a canonical record — its
 * tracker item, else its PR — the title *is* the link to it, in the accent the
 * family reserves for links; with no destination it stays plain text.
 *
 * Like the link buttons, the link renders whenever a destination exists and only
 * the cursor and the dispatch depend on a host being wired — the tests and
 * stories render with no `onOpenLink`, and must still show the styled title.
 *
 * Keyboard support and the hover underline mirror the help widget's link spans:
 * a `role="link"` span, not a `<button>`, which would drag host chrome in.
 */
function DetailTitle({
  title,
  link,
  onOpenLink,
}: {
  title: string;
  link: LinkRef | null;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const [active, setActive] = useState(false);
  if (!link) {
    return (
      <h2 data-testid="detail-title" style={detailTitleStyle}>
        {title}
      </h2>
    );
  }
  return (
    <h2 data-testid="detail-title" style={detailTitleStyle}>
      <span
        role="link"
        tabIndex={0}
        data-testid="detail-title-link"
        onClick={() => onOpenLink?.(link)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenLink?.(link);
          }
        }}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        style={{
          color: TOKENS.ac,
          cursor: onOpenLink ? "pointer" : "default",
          textDecoration: active ? "underline" : "none",
        }}
      >
        {title}
      </span>
    </h2>
  );
}

function CardDetail({
  card,
  onOpenLink,
}: {
  card: TaskCard;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const links = cardLinks(card);
  return (
    <div>
      {/* cardLinks pushes tracker before pr, so [0] is the canonical record. */}
      <DetailTitle title={card.title} link={links[0] ?? null} onOpenLink={onOpenLink} />
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 14px",
          alignItems: "baseline",
          margin: 0,
        }}
      >
        <dt style={microlabelStyle}>ID</dt>
        <dd style={{ ...ddStyle, ...numStyle }}>{card.id}</dd>
        <dt style={microlabelStyle}>Type</dt>
        <dd style={ddStyle}>{card.type}</dd>
        <dt style={microlabelStyle}>Status</dt>
        <dd style={ddStyle}>
          <StatusPill status={card.status} />{" "}
          <span style={{ fontSize: 12, color: TOKENS.t3 }}>({card.status.role})</span>
        </dd>
        <dt style={microlabelStyle}>Branch</dt>
        <dd style={ddStyle}>
          <code style={codeChipStyle}>{card.branch}</code>
        </dd>
        {card.spec_slug ? (
          <>
            <dt style={microlabelStyle}>Spec</dt>
            <dd style={ddStyle}>{card.spec_slug}</dd>
          </>
        ) : null}
        <dt style={microlabelStyle}>Updated</dt>
        <dd data-testid="detail-updated" style={{ ...ddStyle, ...numStyle }}>
          {formatDate(card.updated)}
        </dd>
      </dl>
      {links.length > 0 ? (
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {links.map((link) => {
            const action = classifyLink(link);
            return (
              <button
                key={`${link.kind}:${link.url ?? link.ref ?? link.label}`}
                type="button"
                className="mvtl-gbtn"
                onClick={() => onOpenLink?.(link)}
                style={{ cursor: onOpenLink ? "pointer" : "default" }}
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

export interface TaskListViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: TaskListPayload | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /** Open a link through the host. Omitted in pure-render contexts (tests/story). */
  onOpenLink?: (link: LinkRef) => void;
  /**
   * Pin the widget theme (forwarded to `MvRoot`). Stories only — production
   * omits it so the host/OS `prefers-color-scheme` applies.
   */
  theme?: MvTheme;
}

/**
 * Pure presentational task-list. Renders the board header (title, count pill,
 * filter summary, status filter) plus a master-detail card of tasks; carries no
 * SDK dependency, so it is driven purely by props in tests, the story, and both
 * wiring paths. Every state — error, connecting, data — renders inside the same
 * `<MvRoot>` scope and canvas panel.
 */
export function TaskListView({ data, connecting, error, onOpenLink, theme }: TaskListViewProps) {
  ensureTaskListStyles();
  // The roles the list is narrowed to; empty means no filter, not "hide
  // everything". Declared above the guards so hook order stays stable.
  const [roles, setRoles] = useState<StatusRole[]>([]);
  const toggleRole = (role: StatusRole) =>
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );

  if (error) {
    return (
      <MvRoot theme={theme}>
        <div style={panelStyle}>
          <div data-testid="task-list-error" style={{ color: TOKENS.red, fontSize: 12.5 }}>
            Couldn’t load tasks: {error}
          </div>
        </div>
      </MvRoot>
    );
  }
  if (!data) {
    return (
      <MvRoot theme={theme}>
        <div style={panelStyle}>
          <div data-testid="task-list-connecting" style={{ color: TOKENS.t3, fontSize: 12.5 }}>
            {connecting === false ? "No data." : "Connecting…"}
          </div>
        </div>
      </MvRoot>
    );
  }

  // Only roles the board actually uses get a segment — an empty role is not a
  // filter anyone can want, and it would strand a toggle that yields nothing.
  const present = ROLE_ORDER.filter((role) => (data.role_counts[role] ?? 0) > 0);
  const visible =
    roles.length === 0 ? data.tasks : data.tasks.filter((task) => roles.includes(task.status.role));

  return (
    <MvRoot theme={theme}>
      <div style={panelStyle}>
        <header
          data-testid="board-counts"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div style={{ flex: "1 1 auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.015em" }}>
                Tasks
              </span>
              <span
                style={{ ...pillStyle, ...numStyle, background: TOKENS.srf2, color: TOKENS.t2 }}
              >
                {data.tasks.length}
              </span>
            </div>
            <div style={{ ...numStyle, fontSize: 12, color: TOKENS.t3 }}>
              {visible.length === data.tasks.length
                ? `${data.tasks.length} ${data.tasks.length === 1 ? "task" : "tasks"} on the board`
                : `${visible.length} of ${data.tasks.length} tasks`}
            </div>
          </div>
          {present.length > 0 ? (
            <span role="group" aria-label="filter by status" style={segTrackStyle}>
              {present.map((role) => (
                <RoleFilterSegment
                  key={role}
                  role={role}
                  count={data.role_counts[role] ?? 0}
                  active={roles.includes(role)}
                  onClick={() => toggleRole(role)}
                />
              ))}
            </span>
          ) : null}
        </header>
        <div style={cardStyle}>
          <ListDetail
            // Remount when the filter changes so selection resets to the top row:
            // ListDetail holds the selected INDEX, which would otherwise survive into
            // a different list and point at an unrelated task. Sorted so toggling
            // todo→wip and wip→todo are the same filter, not two remounts.
            key={roles.length === 0 ? "all" : [...roles].sort().join(",")}
            items={visible}
            ariaLabel="tasks"
            getKey={(card) => card.id}
            emptyLabel={
              roles.length === 0
                ? "No tasks on the board."
                : "No tasks match the selected statuses."
            }
            renderRow={(card) => (
              <span style={{ display: "block", minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {card.title}
                  </span>
                  <StatusPill status={card.status} />
                </span>
                <span
                  style={{
                    ...numStyle,
                    display: "block",
                    marginTop: 2,
                    fontSize: 11.5,
                    color: TOKENS.t3,
                  }}
                >
                  {card.type} · {card.id}
                </span>
              </span>
            )}
            renderDetail={(card) => <CardDetail card={card} onOpenLink={onOpenLink} />}
          />
        </div>
      </div>
    </MvRoot>
  );
}

/**
 * The transport seam (AC3). `useApp` hard-wires a `PostMessageTransport` to
 * `window.parent`, which is `=== window` under happy-dom (no iframe nesting), so
 * the automated test injects an `App` + in-memory transport instead. Production
 * omits `seam` and takes the live path.
 */
export interface TaskListSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface TaskListWidgetProps {
  /** Test-only injected App + transport (AC3). Omit for the production path. */
  seam?: TaskListSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount (tests always inject, production never
 * does), so this wrapper calls no hooks itself and the two children each own their
 * hook order.
 */
export function TaskListWidget({ seam }: TaskListWidgetProps) {
  return seam ? <TaskListSeamWidget seam={seam} /> : <TaskListLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function TaskListLiveWidget() {
  const [data, setData] = useState<TaskListPayload | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-task-list", version: "0.8.1" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as TaskListPayload);
        }
      };
    },
  });
  const onOpenLink = (link: LinkRef) => {
    if (app) void dispatchLink(app, link).catch(() => {});
  };
  return (
    <TaskListView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onOpenLink={onOpenLink}
    />
  );
}

/** AC3 wiring — drive an injected App over the mock-host's in-memory transport. */
function TaskListSeamWidget({ seam }: { seam: TaskListSeam }) {
  const [data, setData] = useState<TaskListPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as TaskListPayload);
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

  return <TaskListView data={data} connecting={!connected} error={error} onOpenLink={onOpenLink} />;
}
