import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { LinkRef, TaskCard, TaskDetail } from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { Markdown } from "../../primitives/Markdown";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";

/**
 * The task-detail widget (ADR-0024 widget #2) — one task's full detail: the
 * TaskCard fields plus its markdown body via the `<Markdown>` primitive, inside a
 * `<ListDetail>` shell consistent with task-list (a single-row master, so the two
 * widgets read as one system). Split into a pure {@link TaskDetailView}
 * (props-only, no SDK) and the App wiring below, so the render is unit-testable
 * without a transport and the same view serves production (`useApp`) and the
 * mock-host seam paths.
 *
 * Payload is the `TaskDetail` contract directly — it already carries every card
 * field plus `body_markdown`, so no wrapper is needed (unlike task-list, whose
 * `TaskListPayload` wraps the array to carry board counts).
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
 * The detail pane: the card fields grid + tracker/PR link buttons (as in
 * task-list), then the task's markdown body rendered through `<Markdown>` — the
 * one addition over task-list's card-only detail.
 */
function TaskDetailPane({
  task,
  onOpenLink,
}: {
  task: TaskDetail;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const links = cardLinks(task);
  return (
    <div>
      <h2 data-testid="detail-title" style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
        {task.title}
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
        <dd style={{ margin: 0 }}>{task.id}</dd>
        <dt style={{ opacity: 0.6 }}>Type</dt>
        <dd style={{ margin: 0 }}>{task.type}</dd>
        <dt style={{ opacity: 0.6 }}>Status</dt>
        <dd style={{ margin: 0 }}>
          {task.status.key} <span style={{ opacity: 0.6 }}>({task.status.role})</span>
        </dd>
        <dt style={{ opacity: 0.6 }}>Branch</dt>
        <dd style={{ margin: 0 }}>
          <code>{task.branch}</code>
        </dd>
        {task.spec_slug ? (
          <>
            <dt style={{ opacity: 0.6 }}>Spec</dt>
            <dd style={{ margin: 0 }}>{task.spec_slug}</dd>
          </>
        ) : null}
        <dt style={{ opacity: 0.6 }}>Updated</dt>
        <dd style={{ margin: 0 }}>{formatDate(task.updated)}</dd>
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
                style={{ ...linkButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
              >
                {action.type === "external" ? "↗ " : ""}
                {link.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        data-testid="detail-body"
        style={{
          marginTop: "1rem",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--color-border-primary, #e2e2e2)",
        }}
      >
        <Markdown source={task.body_markdown} />
      </div>
    </div>
  );
}

export interface TaskDetailViewProps {
  /** The task to render; `null` before the first tool-result arrives. */
  data: TaskDetail | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /** Open a link through the host. Omitted in pure-render contexts (tests/story). */
  onOpenLink?: (link: LinkRef) => void;
}

/**
 * Pure presentational task-detail. Renders the one task in a `<ListDetail>`
 * (single-row master + rich detail pane); carries no SDK dependency, so it is
 * driven purely by props in tests, the story, and both wiring paths.
 */
export function TaskDetailView({ data, connecting, error, onOpenLink }: TaskDetailViewProps) {
  if (error) {
    return (
      <div
        data-testid="task-detail-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00020)" }}
      >
        Couldn’t load task: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="task-detail-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No task." : "Connecting…"}
      </div>
    );
  }

  return (
    <div
      style={{
        // fontFamily, not the `font:` shorthand — the shorthand requires a
        // size, so browsers drop the whole declaration and the widget would
        // silently render in the host's default serif.
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--color-text-primary, #1a1a1a)",
      }}
    >
      <ListDetail
        items={[data]}
        ariaLabel="task"
        getKey={(task) => task.id}
        emptyLabel="No task."
        renderRow={(task) => (
          <span>
            <span style={badgeStyle}>{task.status.key}</span>
            <span style={{ opacity: 0.6, marginRight: "0.4rem" }}>{task.type}</span>
            {task.title}
          </span>
        )}
        renderDetail={(task) => <TaskDetailPane task={task} onOpenLink={onOpenLink} />}
      />
    </div>
  );
}

/**
 * The transport seam (mirrors task-list). `useApp` hard-wires a
 * `PostMessageTransport` to `window.parent`, which is `=== window` under
 * happy-dom (no iframe nesting), so the automated test injects an `App` +
 * in-memory transport instead. Production omits `seam` and takes the live path.
 */
export interface TaskDetailSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface TaskDetailWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: TaskDetailSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount (tests always inject, production never
 * does), so this wrapper calls no hooks itself and the two children each own
 * their hook order.
 */
export function TaskDetailWidget({ seam }: TaskDetailWidgetProps) {
  return seam ? <TaskDetailSeamWidget seam={seam} /> : <TaskDetailLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function TaskDetailLiveWidget() {
  const [data, setData] = useState<TaskDetail | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-task-detail", version: "0.17.0" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as TaskDetail);
        }
      };
    },
  });
  const onOpenLink = (link: LinkRef) => {
    if (app) void dispatchLink(app, link).catch(() => {});
  };
  return (
    <TaskDetailView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onOpenLink={onOpenLink}
    />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function TaskDetailSeamWidget({ seam }: { seam: TaskDetailSeam }) {
  const [data, setData] = useState<TaskDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as TaskDetail);
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
    <TaskDetailView data={data} connecting={!connected} error={error} onOpenLink={onOpenLink} />
  );
}
