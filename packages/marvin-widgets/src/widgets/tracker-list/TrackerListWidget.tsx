import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  LinkRef,
  StatusRole,
  TaskCard,
  TaskStatusRef,
  TrackerListPayload,
} from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";
import { MvRoot, TOKENS, MV_FONT_MONO, type MvTheme } from "../../theme";

/**
 * The tracker-list widget (ADR-0024 widget #6) — the board tasks that carry an
 * external `tracker_id`, each linking out to its tracker item. It is the FIRST
 * consumer of the external-link (`app.openLink`) path in the 3-type link model:
 * a task's tracker link is a `LinkRef{kind:"tracker", url}` dispatched through the
 * host. Split into a pure {@link TrackerListView} (props-only, no SDK) and the App
 * wiring below, so the render is unit-testable without a transport and the same view
 * serves production (`useApp`) and the mock-host seam paths — consistent with
 * task-list/task-detail so the family reads as one system.
 *
 * Payload is `TrackerListPayload` ({ tasks }) — a thin wrapper over `TaskCard[]`,
 * deliberately without board counts: a tracker view is a filtered subset, so the
 * header is just the tracked-task count.
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the view wraps
 * itself in `<MvRoot>` — both wiring paths get the token scope for free — and every
 * color is a `TOKENS` reference resolved by `.mvroot`; the widget declares no
 * palette of its own. Typography is the inherited 13px system sans; mono is
 * reserved for code-like values (ids, branches, commands) via {@link MV_FONT_MONO}.
 */

// ── family recipes (docs/design/reports-widget.md, mockup 1:1) ───────────────

/** The widget canvas: bg ground, hairline border, radius 4, 14px padding. */
const panelStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: 14,
};

/** Card surface — the split view's frame on the canvas. */
const cardStyle: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  overflow: "hidden",
};

/** The widget title (mockup zone A): 16px/500, tight tracking. */
const widgetTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 500,
  letterSpacing: "-0.015em",
};

/** Status/severity pill base — lowercase label, 5px currentColor dot before it. */
const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "1px 9px",
  borderRadius: 4,
  fontSize: "11.5px",
  fontWeight: 500,
  whiteSpace: "nowrap",
  textTransform: "lowercase",
};

const pillDotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "currentColor",
  flex: "none",
};

/** Mono code chip — paths, ids, commands. */
const chipStyle: CSSProperties = {
  fontFamily: MV_FONT_MONO,
  fontSize: "11px",
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: "1px 6px",
  whiteSpace: "nowrap",
  color: TOKENS.t2,
};

/** Microlabel — the detail grid's field names. */
const microlabelStyle: CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

/**
 * Lifecycle role → pill tone (text-grade color + matching tint). Statuses are
 * project data (ADR-0026) — the open `key` is the label, the closed `role`
 * picks the tone, so any configured vocabulary renders sensibly.
 */
const STATUS_ROLE_TONES: Record<StatusRole, { text: string; bg: string }> = {
  todo: { text: TOKENS.t2, bg: TOKENS.srf2 },
  wip: { text: TOKENS.blu, bg: TOKENS.blubg },
  review: { text: TOKENS.amb, bg: TOKENS.ambbg },
  done: { text: TOKENS.grn, bg: TOKENS.grnbg },
  blocked: { text: TOKENS.red, bg: TOKENS.redbg },
};

/** Status pill: the configured key, toned by its lifecycle role. */
function StatusPill({ status }: { status: TaskStatusRef }) {
  const tone = STATUS_ROLE_TONES[status.role];
  return (
    <span style={{ ...pillStyle, background: tone.bg, color: tone.text }}>
      <span style={pillDotStyle} />
      {status.key}
    </span>
  );
}

/** The detail pane's task title. */
const detailTitleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: "14.5px",
  fontWeight: 500,
  letterSpacing: "-0.01em",
};

/**
 * Ghost button (family recipe) — transparent ground, hairline border, quiet t2
 * label that lifts to srf2/t1 on hover. External destinations keep the ↗ marker
 * in front of the label; the hover state is widget-local React state, not a
 * stylesheet rule, matching the theme's "states are widget-inline" contract.
 */
function GhostButton({
  link,
  onOpenLink,
  testId,
}: {
  link: LinkRef;
  onOpenLink?: (link: LinkRef) => void;
  testId?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      data-testid={testId}
      type="button"
      onClick={() => onOpenLink?.(link)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        font: "inherit",
        fontSize: "12px",
        letterSpacing: "inherit",
        color: hover ? TOKENS.t1 : TOKENS.t2,
        background: hover ? TOKENS.srf2 : "transparent",
        border: `0.5px solid ${TOKENS.bd}`,
        borderRadius: 4,
        padding: "3px 10px",
        cursor: onOpenLink ? "pointer" : "default",
      }}
    >
      {classifyLink(link).type === "external" ? "↗ " : ""}
      {link.label}
    </button>
  );
}

/**
 * The detail pane's task title. When the task has a canonical record — its
 * tracker item, else its PR — the title *is* the link to it, in the family
 * accent; with no destination it stays plain text.
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

/** The tracker link a card carries, or null when its tracker_url is unconfigured. */
function trackerLinkRef(card: TaskCard): LinkRef | null {
  if (!card.tracker_url) return null;
  return { kind: "tracker", label: card.tracker_id ?? "Tracker", url: card.tracker_url };
}

/** The PR link a card carries, or null. */
function prLinkRef(card: TaskCard): LinkRef | null {
  if (!card.pr) return null;
  return { kind: "pr", label: card.pr.number ? `PR #${card.pr.number}` : "PR", url: card.pr.url };
}

/** One microlabel + value pair in the detail fields grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt style={microlabelStyle}>{label}</dt>
      <dd style={{ margin: 0, fontSize: "12.5px" }}>{children}</dd>
    </>
  );
}

/**
 * The detail pane: the card fields grid, then the tracker link-out — an external
 * ghost button when `tracker_url` is set (AC2), or the id-as-chip plus a configure
 * hint when it is `null` (AC6, the tracker_url_template is unset) — and the PR link.
 */
function TrackerCardDetail({
  card,
  onOpenLink,
}: {
  card: TaskCard;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const tracker = trackerLinkRef(card);
  const pr = prLinkRef(card);
  return (
    <div>
      {/* The tracker item is this task's canonical record; the PR is the fallback. */}
      <DetailTitle title={card.title} link={tracker ?? pr} onOpenLink={onOpenLink} />
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "6px 16px",
          alignItems: "baseline",
          margin: 0,
        }}
      >
        <Field label="Id">
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{card.id}</span>
        </Field>
        <Field label="Type">{card.type}</Field>
        <Field label="Status">
          <StatusPill status={card.status} />{" "}
          <span style={{ color: TOKENS.t3 }}>({card.status.role})</span>
        </Field>
        <Field label="Branch">
          <span style={chipStyle}>{card.branch}</span>
        </Field>
        {card.spec_slug ? (
          <Field label="Spec">
            <span style={chipStyle}>{card.spec_slug}</span>
          </Field>
        ) : null}
        <Field label="Updated">{formatDate(card.updated)}</Field>
      </dl>
      <div
        data-testid="tracker-section"
        style={{
          marginTop: 12,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {tracker ? (
          <GhostButton testId="tracker-link" link={tracker} onOpenLink={onOpenLink} />
        ) : (
          <div>
            <span data-testid="tracker-id" style={chipStyle}>
              {card.tracker_id}
            </span>
            <div
              data-testid="tracker-hint"
              style={{ color: TOKENS.t3, fontSize: "12px", marginTop: 6 }}
            >
              No tracker URL — set <span style={chipStyle}>tracker_url_template</span> via{" "}
              <span style={chipStyle}>/marvin:track-config</span> to link out.
            </div>
          </div>
        )}
        {pr ? <GhostButton link={pr} onOpenLink={onOpenLink} /> : null}
      </div>
    </div>
  );
}

export interface TrackerListViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: TrackerListPayload | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /** Open a link through the host. Omitted in pure-render contexts (tests/story). */
  onOpenLink?: (link: LinkRef) => void;
  /**
   * Pin the theme (forwarded to the view's own `MvRoot`). Story-only: pinned
   * dark/light variants set it; production omits it so the host/OS scheme applies.
   */
  theme?: MvTheme;
}

/**
 * Pure presentational tracker-list. Renders the widget canvas with the tracked-count
 * header plus a master-detail card of tracked cards; carries no SDK dependency, so
 * it is driven purely by props in tests, the stories, and both wiring paths. Every
 * state (connecting, error, empty, data) renders inside the same `MvRoot` + panel,
 * so the widget always presents the family canvas.
 */
export function TrackerListView({
  data,
  connecting,
  error,
  onOpenLink,
  theme,
}: TrackerListViewProps) {
  let body: ReactNode;
  if (error) {
    body = (
      <div data-testid="tracker-list-error" style={{ color: TOKENS.red, fontSize: "12.5px" }}>
        Couldn’t load tracked tasks: {error}
      </div>
    );
  } else if (!data) {
    body = (
      <div data-testid="tracker-list-connecting" style={{ color: TOKENS.t3, fontSize: "12.5px" }}>
        {connecting === false ? "No data." : "Connecting…"}
      </div>
    );
  } else if (data.tasks.length === 0) {
    body = (
      <div
        data-testid="tracker-empty"
        style={{ color: TOKENS.t2, fontSize: "12.5px", maxWidth: "38rem" }}
      >
        No tasks carry a tracker id. Add one when you create a task (e.g.{" "}
        <span style={chipStyle}>tracker_id: OSI-123</span>), and set{" "}
        <span style={chipStyle}>tracker_url_template</span> via{" "}
        <span style={chipStyle}>/marvin:track-config</span> to link out.
      </div>
    );
  } else {
    const n = data.tasks.length;
    body = (
      <>
        <header data-testid="tracker-counts" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={widgetTitleStyle}>Tracked tasks</span>
            <span
              style={{
                ...pillStyle,
                background: TOKENS.srf2,
                color: TOKENS.t2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {n}
            </span>
          </div>
          <div style={{ fontSize: "12px", color: TOKENS.t3, marginTop: 2 }}>
            {n} tracked {n === 1 ? "task" : "tasks"} on the board
          </div>
        </header>
        <div style={cardStyle}>
          <ListDetail
            items={data.tasks}
            ariaLabel="tracked tasks"
            getKey={(card) => card.id}
            emptyLabel="No tracked tasks."
            renderRow={(card) => (
              <span style={{ display: "block" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                    }}
                  >
                    {card.title}
                  </span>
                  <StatusPill status={card.status} />
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    marginTop: 2,
                    fontSize: "11.5px",
                    color: TOKENS.t3,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {card.tracker_id ? <span style={chipStyle}>{card.tracker_id}</span> : null}
                  <span>· {card.type}</span>
                </span>
              </span>
            )}
            renderDetail={(card) => <TrackerCardDetail card={card} onOpenLink={onOpenLink} />}
          />
        </div>
      </>
    );
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
export interface TrackerListSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface TrackerListWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: TrackerListSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount (tests always inject, production never
 * does), so this wrapper calls no hooks itself and the two children each own their
 * hook order.
 */
export function TrackerListWidget({ seam }: TrackerListWidgetProps) {
  return seam ? <TrackerListSeamWidget seam={seam} /> : <TrackerListLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function TrackerListLiveWidget() {
  const [data, setData] = useState<TrackerListPayload | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-tracker-list", version: "0.8.1" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as TrackerListPayload);
        }
      };
    },
  });
  const onOpenLink = (link: LinkRef) => {
    if (app) void dispatchLink(app, link).catch(() => {});
  };
  return (
    <TrackerListView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onOpenLink={onOpenLink}
    />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function TrackerListSeamWidget({ seam }: { seam: TrackerListSeam }) {
  const [data, setData] = useState<TrackerListPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as TrackerListPayload);
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
    <TrackerListView data={data} connecting={!connected} error={error} onOpenLink={onOpenLink} />
  );
}
