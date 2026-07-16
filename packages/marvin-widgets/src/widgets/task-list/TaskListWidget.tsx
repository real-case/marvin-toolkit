import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { LinkRef, TaskCard, TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";

/**
 * The task-list widget (ADR-0024) — the first end-to-end `ui://` widget. It is
 * split into a pure {@link TaskListView} (props-only, no SDK) and the App wiring
 * below, so the rendering is unit-testable without a transport and the same view
 * serves both the production (`useApp`) and the AC3 mock-host seam paths.
 */

type StatusRole = TaskCard["status"]["role"];

const ROLE_ORDER: StatusRole[] = ["todo", "wip", "review", "done", "blocked"];

/** Marvin's violet — the family accent, matching help and the `<ListDetail>` shell. */
const ACCENT = "#8b5cf6";
const ACCENT_TINT = "rgba(139, 92, 246, 0.12)";

/** The detail pane's task title. */
const detailTitleStyle: CSSProperties = { margin: "0 0 0.5rem", fontSize: "1rem" };

/**
 * One role in the header's breakdown, as a filter toggle. Reads as the plain
 * count text it replaced until it is switched on, so the header stays a summary
 * rather than turning into a toolbar; `aria-pressed` carries the on/off state
 * that the violet fill shows sighted users.
 */
function RoleFilterChip({
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
        fontSize: "0.9em",
        cursor: "pointer",
        borderRadius: "var(--border-radius-sm, 4px)",
        border: active ? `1px solid ${ACCENT}` : "1px solid transparent",
        background: active ? ACCENT_TINT : "transparent",
        color: active ? ACCENT : "var(--color-text-primary, #1a1a1a)",
        opacity: active ? 1 : 0.7,
        padding: "0.1rem 0.4rem",
      }}
    >
      {role} {count}
    </button>
  );
}

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
        <dd data-testid="detail-updated" style={{ margin: 0 }}>
          {formatDate(card.updated)}
        </dd>
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
                  color: ACCENT,
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
  // The roles the list is narrowed to; empty means no filter, not "hide
  // everything". Declared above the guards so hook order stays stable.
  const [roles, setRoles] = useState<StatusRole[]>([]);
  const toggleRole = (role: StatusRole) =>
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );

  if (error) {
    return (
      <div
        data-testid="task-list-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00020)" }}
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

  // Only roles the board actually uses get a chip — an empty role is not a
  // filter anyone can want, and it would strand a chip that yields nothing.
  const present = ROLE_ORDER.filter((role) => (data.role_counts[role] ?? 0) > 0);
  const visible =
    roles.length === 0 ? data.tasks : data.tasks.filter((task) => roles.includes(task.status.role));

  return (
    <div
      style={{
        // The `font` shorthand is invalid without a size (the whole declaration
        // would be dropped and the host serif leaks in), so fontFamily it must be.
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
        fontSize: "13px",
        color: "var(--color-text-primary, #1a1a1a)",
        ...frameStyle,
      }}
    >
      <header
        data-testid="board-counts"
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
          {visible.length === data.tasks.length
            ? `${data.tasks.length} ${data.tasks.length === 1 ? "task" : "tasks"}`
            : `${visible.length} of ${data.tasks.length} tasks`}
        </strong>
        <span
          role="group"
          aria-label="filter by status"
          style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}
        >
          {present.map((role) => (
            <RoleFilterChip
              key={role}
              role={role}
              count={data.role_counts[role] ?? 0}
              active={roles.includes(role)}
              onClick={() => toggleRole(role)}
            />
          ))}
        </span>
      </header>
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
          roles.length === 0 ? "No tasks on the board." : "No tasks match the selected statuses."
        }
        renderRow={(card) => (
          <span style={{ display: "block" }}>
            <span style={metaRowStyle}>
              <span style={badgeStyle}>{card.status.key}</span>
              <span style={badgeStyle}>{card.type}</span>
            </span>
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
