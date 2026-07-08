import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { LinkRef, TaskCard, TrackerListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { classifyLink, dispatchLink } from "../../lib/links";

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

const badgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.05rem 0.4rem",
  borderRadius: "var(--border-radius-sm, 4px)",
  fontSize: "0.75em",
  fontWeight: 600,
  background: "var(--color-background-secondary, #f0f0f0)",
  color: "var(--color-text-secondary, #555)",
  marginRight: "0.5rem",
};

const linkButtonStyle: CSSProperties = {
  font: "inherit",
  border: "1px solid var(--color-border-primary, #d0d0d0)",
  borderRadius: "var(--border-radius-sm, 4px)",
  background: "transparent",
  color: "var(--color-text-info, #0b57d0)",
  padding: "0.2rem 0.5rem",
};

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
      <h2 data-testid="detail-title" style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
        {card.title}
      </h2>
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
        <dd style={{ margin: 0 }}>{card.updated}</dd>
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
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00)" }}
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
        font: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--color-text-primary, #1a1a1a)",
      }}
    >
      <header
        data-testid="tracker-counts"
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
          {data.tasks.length} tracked {data.tasks.length === 1 ? "task" : "tasks"}
        </strong>
      </header>
      <ListDetail
        items={data.tasks}
        ariaLabel="tracked tasks"
        getKey={(card) => card.id}
        emptyLabel="No tracked tasks."
        renderRow={(card) => (
          <span>
            <span style={badgeStyle}>{card.status.key}</span>
            <span style={{ opacity: 0.6, marginRight: "0.4rem" }}>{card.type}</span>
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
