import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { LinkRef, TaskCard, TrackerListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";

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
 */

/** Marvin's violet — the family accent, matching help and the `<ListDetail>` shell. */
const ACCENT = "#8b5cf6";

/** The detail pane's task title. */
const detailTitleStyle: CSSProperties = { margin: "0 0 0.5rem", fontSize: "1rem" };

/** The status + type meta line that sits above a row's title. */
const metaRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  marginBottom: "0.15rem",
};

/** The widget frame — the whole widget as one rounded card on the host canvas. */
const frameStyle: CSSProperties = {
  border: "1px solid var(--color-border-primary, #e2e2e2)",
  borderRadius: "var(--border-radius-md, 8px)",
};

const badgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.05rem 0.4rem",
  borderRadius: "var(--border-radius-sm, 4px)",
  fontSize: "0.75em",
  fontWeight: 600,
  background: "var(--color-background-secondary, #f0f0f0)",
  color: "var(--color-text-secondary, #555)",
};

const linkButtonStyle: CSSProperties = {
  font: "inherit",
  border: "1px solid var(--color-border-primary, #d0d0d0)",
  borderRadius: "var(--border-radius-sm, 4px)",
  background: "transparent",
  color: ACCENT,
  padding: "0.2rem 0.5rem",
};

/**
 * The detail pane's task title. When the task has a canonical record — its
 * tracker item, else its PR — the title *is* the link to it, in the same violet
 * the link buttons use; with no destination it stays plain text.
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
          color: ACCENT,
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

/**
 * The detail pane: the card fields grid, then the tracker link-out — an external
 * button when `tracker_url` is set (AC2), or the id-as-text plus a configure hint
 * when it is `null` (AC6, the tracker_url_template is unset) — and the PR link.
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
          gap: "0.15rem 0.75rem",
          margin: 0,
        }}
      >
        <dt style={{ opacity: 0.6 }}>ID</dt>
        <dd style={{ margin: 0 }}>{card.id}</dd>
        <dt style={{ opacity: 0.6 }}>Type</dt>
        <dd style={{ margin: 0 }}>{card.type}</dd>
        <dt style={{ opacity: 0.6 }}>Status</dt>
        <dd style={{ margin: 0 }}>
          {card.status.key} <span style={{ opacity: 0.6 }}>({card.status.role})</span>
        </dd>
        <dt style={{ opacity: 0.6 }}>Branch</dt>
        <dd style={{ margin: 0 }}>
          <code>{card.branch}</code>
        </dd>
        {card.spec_slug ? (
          <>
            <dt style={{ opacity: 0.6 }}>Spec</dt>
            <dd style={{ margin: 0 }}>{card.spec_slug}</dd>
          </>
        ) : null}
        <dt style={{ opacity: 0.6 }}>Updated</dt>
        <dd style={{ margin: 0 }}>{formatDate(card.updated)}</dd>
      </dl>
      <div
        data-testid="tracker-section"
        style={{
          marginTop: "0.75rem",
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {tracker ? (
          <button
            data-testid="tracker-link"
            type="button"
            onClick={() => onOpenLink?.(tracker)}
            style={{ ...linkButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
          >
            {classifyLink(tracker).type === "external" ? "↗ " : ""}
            {tracker.label}
          </button>
        ) : (
          <div>
            <span data-testid="tracker-id" style={{ fontWeight: 600 }}>
              {card.tracker_id}
            </span>
            <div
              data-testid="tracker-hint"
              style={{ opacity: 0.7, fontSize: "0.85em", marginTop: "0.25rem" }}
            >
              No tracker URL — set <code>tracker_url_template</code> via{" "}
              <code>/marvin:kanban-config</code> to link out.
            </div>
          </div>
        )}
        {pr ? (
          <button
            type="button"
            onClick={() => onOpenLink?.(pr)}
            style={{ ...linkButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
          >
            {classifyLink(pr).type === "external" ? "↗ " : ""}
            {pr.label}
          </button>
        ) : null}
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
}

/**
 * Pure presentational tracker-list. Renders the tracked-count header plus a
 * master-detail list of tracked cards; carries no SDK dependency, so it is driven
 * purely by props in tests, the story, and both wiring paths.
 */
export function TrackerListView({ data, connecting, error, onOpenLink }: TrackerListViewProps) {
  if (error) {
    return (
      <div
        data-testid="tracker-list-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00020)" }}
      >
        Couldn’t load tracked tasks: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="tracker-list-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No data." : "Connecting…"}
      </div>
    );
  }
  if (data.tasks.length === 0) {
    return (
      <div data-testid="tracker-empty" style={{ padding: "1rem", opacity: 0.75 }}>
        No tasks carry a tracker id. Add one when you create a task (e.g.{" "}
        <code>tracker_id: OSI-123</code>), and set <code>tracker_url_template</code> via{" "}
        <code>/marvin:kanban-config</code> to link out.
      </div>
    );
  }

  return (
    <div
      style={{
        // fontFamily, not the `font` shorthand: the shorthand requires a size, so
        // a family-only `font:` is invalid CSS — the declaration is dropped and
        // the widget renders in the host default serif.
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
        fontSize: "13px",
        color: "var(--color-text-primary, #1a1a1a)",
        ...frameStyle,
      }}
    >
      <header
        data-testid="tracker-counts"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.75rem",
          // 0.75rem horizontal matches the list rows' own inset, so the header
          // text lines up with the row text instead of hanging left of it.
          padding: "0.75rem",
          borderBottom: "1px solid var(--color-border-primary, #e2e2e2)",
        }}
      >
        <strong>
          {data.tasks.length} tracked {data.tasks.length === 1 ? "task" : "tasks"}
        </strong>
      </header>
      <ListDetail
        items={data.tasks}
        ariaLabel="tracked tasks"
        getKey={(card) => card.id}
        emptyLabel="No tracked tasks."
        renderRow={(card) => (
          <span style={{ display: "block" }}>
            <span style={metaRowStyle}>
              <span style={badgeStyle}>{card.status.key}</span>
              <span style={badgeStyle}>{card.type}</span>
            </span>
            {card.title}
          </span>
        )}
        renderDetail={(card) => <TrackerCardDetail card={card} onOpenLink={onOpenLink} />}
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
    appInfo: { name: "marvin-tracker-list", version: "0.18.0" },
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
