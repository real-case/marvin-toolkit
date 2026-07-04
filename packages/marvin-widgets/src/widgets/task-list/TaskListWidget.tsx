import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { LinkRef, TaskCard, TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { classifyLink, dispatchLink } from "../../lib/links";

/**
 * The task-list widget (ADR-0024) — the first end-to-end `ui://` widget. It is
 * split into a pure {@link TaskListView} (props-only, no SDK) and the App wiring
 * below, so the rendering is unit-testable without a transport and the same view
 * serves both the production (`useApp`) and the AC3 mock-host seam paths.
 */

const ROLE_ORDER: TaskCard["status"]["role"][] = ["todo", "wip", "review", "done", "blocked"];

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
      {links.length > 0 ? (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {links.map((link) => {
            const action = classifyLink(link);
            return (
              <button
                key={`${link.kind}:${link.url ?? link.ref ?? link.label}`}
                type="button"
                onClick={() => onOpenLink?.(link)}
                style={{
                  font: "inherit",
                  cursor: onOpenLink ? "pointer" : "default",
                  border: "1px solid var(--color-border-primary, #d0d0d0)",
                  borderRadius: "var(--border-radius-sm, 4px)",
                  background: "transparent",
                  color: "var(--color-text-info, #0b57d0)",
                  padding: "0.2rem 0.5rem",
                }}
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
}

/**
 * Pure presentational task-list. Renders the board-counts header plus a
 * master-detail list of cards; carries no SDK dependency, so it is driven purely
 * by props in tests, the story, and both wiring paths.
 */
export function TaskListView({ data, connecting, error, onOpenLink }: TaskListViewProps) {
  if (error) {
    return (
      <div
        data-testid="task-list-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00)" }}
      >
        Couldn’t load tasks: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="task-list-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No data." : "Connecting…"}
      </div>
    );
  }

  const roleSummary = ROLE_ORDER.filter((role) => (data.role_counts[role] ?? 0) > 0)
    .map((role) => `${role} ${data.role_counts[role]}`)
    .join(" · ");

  return (
    <div
      style={{
        font: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--color-text-primary, #1a1a1a)",
      }}
    >
      <header
        data-testid="board-counts"
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
          {data.tasks.length} {data.tasks.length === 1 ? "task" : "tasks"}
        </strong>
        <span style={{ opacity: 0.7, fontSize: "0.9em" }}>{roleSummary}</span>
      </header>
      <ListDetail
        items={data.tasks}
        ariaLabel="tasks"
        getKey={(card) => card.id}
        emptyLabel="No tasks on the board."
        renderRow={(card) => (
          <span>
            <span style={badgeStyle}>{card.status.key}</span>
            <span style={{ opacity: 0.6, marginRight: "0.4rem" }}>{card.type}</span>
            {card.title}
          </span>
        )}
        renderDetail={(card) => <CardDetail card={card} onOpenLink={onOpenLink} />}
      />
    </div>
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
    appInfo: { name: "marvin-task-list", version: "0.15.0" },
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
