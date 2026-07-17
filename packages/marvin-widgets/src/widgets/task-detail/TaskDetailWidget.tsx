import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  LinkRef,
  StatusRole,
  TaskCard,
  TaskDetail,
} from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { Markdown } from "../../primitives/Markdown";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";
import { MvRoot, MV_FONT_MONO, SEVERITY_TOKENS, TOKENS, type MvTheme } from "../../theme";

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
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the view
 * wraps itself in `<MvRoot>` — production AND seam paths render the same view,
 * so both get the token scope — and every color is a theme token reference.
 * The outer panel is the canvas recipe (bg / 0.5px bd / radius 4 / 14px pad);
 * status renders as a lowercase dot-pill, ids and the branch as mono code chips,
 * and the tracker/PR links as ghost buttons.
 */

/**
 * Status-role → pill tone, over the theme's `SEVERITY_TOKENS` pairs. The keys
 * are borrowed for their color families, not their scanner meaning:
 *   - `todo`    → `pending` — neutral gray: queued, nothing burning yet
 *   - `wip`     → `low`     — blue family: work in motion
 *   - `review`  → `medium`  — amber family: parked with a reviewer, awaiting attention
 *   - `done`    → `pass`    — green: complete
 *   - `blocked` → `fail`    — red: stuck, needs unblocking
 * (Family-wide mapping — task-list, tracker-list, and dashboard use the same.)
 */
const ROLE_TONES: Record<StatusRole, { text: string; bg: string }> = {
  todo: SEVERITY_TOKENS.pending,
  wip: SEVERITY_TOKENS.low,
  review: SEVERITY_TOKENS.medium,
  done: SEVERITY_TOKENS.pass,
  blocked: SEVERITY_TOKENS.fail,
};

/**
 * Tone for a role, total over arbitrary input: `structuredContent` reaches the
 * view as a cast (not a zod parse), so an off-contract role degrades to the
 * neutral tone instead of crashing on `undefined.bg`.
 */
function roleTone(role: StatusRole): { text: string; bg: string } {
  return ROLE_TONES[role] ?? SEVERITY_TOKENS.pending;
}

// ── widget-local stylesheet ──────────────────────────────────────────────────
// Hover states live on pseudo-classes, which cannot be inline styles, so the
// widget injects one id-keyed <style> element at render time — the same
// idempotent lifecycle as MvRoot's token sheet and ListDetail's row styles.

/** id of the injected `<style>` element — the once-per-document key. */
const TASK_DETAIL_STYLE_ID = "mv-taskdetail-styles";

// Ghost button recipe: transparent ground, hairline border, quiet text that
// steps up (srf2 ground, t1 text) on hover.
const TASK_DETAIL_CSS = `
.mvtd-gbtn{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;color:${TOKENS.t2};background:transparent;border:0.5px solid ${TOKENS.bd};border-radius:4px;padding:3px 10px;letter-spacing:inherit}
.mvtd-gbtn:hover{background:${TOKENS.srf2};color:${TOKENS.t1}}
`;

/** Put the widget stylesheet into the document exactly once (id-keyed). */
function ensureTaskDetailStyles(): void {
  if (typeof document === "undefined" || document.getElementById(TASK_DETAIL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TASK_DETAIL_STYLE_ID;
  style.textContent = TASK_DETAIL_CSS;
  document.head.appendChild(style);
}

// ── themed style constants ───────────────────────────────────────────────────

/** The widget canvas — MvRoot deliberately does not paint it; the panel does. */
const panelStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  padding: "14px",
};

/** The surface card wrapping the master-detail split (mockup zone D). */
const cardStyle: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  overflow: "hidden",
};

/** The detail pane's task title — the widget's principal heading. */
const detailTitleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: "16px",
  fontWeight: 500,
  letterSpacing: "-0.015em",
};

/** Section microlabel (the field grid's `<dt>` labels). */
const microlabelStyle: CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

/** The field grid — the card fields as label + value meta rows. */
const fieldGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "6px 14px",
  alignItems: "center",
  margin: 0,
};

/** One field value cell; `minWidth: 0` lets long mono chips wrap, not overflow. */
const fieldValueStyle: CSSProperties = {
  margin: 0,
  minWidth: 0,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "6px",
};

/** Quiet meta text (the status role note, the updated date). */
const metaTextStyle: CSSProperties = {
  fontSize: "11.5px",
  color: TOKENS.t3,
};

// ── shared recipe atoms ──────────────────────────────────────────────────────

/** Status/severity pill: lowercase label behind a 5px `currentColor` dot. */
function Pill({ tone, children }: { tone: { text: string; bg: string }; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "1px 9px",
        borderRadius: "4px",
        fontSize: "11.5px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        textTransform: "lowercase",
        background: tone.bg,
        color: tone.text,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "5px",
          height: "5px",
          borderRadius: "50%",
          background: "currentColor",
          flex: "none",
        }}
      />
      {children}
    </span>
  );
}

/** Neutral tag — the dot-less pill on the second surface step (task type). */
function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 9px",
        borderRadius: "4px",
        fontSize: "11.5px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        textTransform: "lowercase",
        background: TOKENS.srf2,
        color: TOKENS.t2,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Mono code chip for code-like values (id, branch, spec slug) — the one place
 * the mono stack appears; body text stays on the inherited sans. `wrap` lets a
 * long branch break inside the chip instead of overflowing the pane.
 */
function CodeChip({ children, wrap }: { children: ReactNode; wrap?: boolean }) {
  return (
    <code
      style={{
        fontFamily: MV_FONT_MONO,
        fontSize: "11px",
        background: TOKENS.srf2,
        border: `0.5px solid ${TOKENS.bd}`,
        borderRadius: "4px",
        padding: "1px 6px",
        ...(wrap
          ? { whiteSpace: "normal", overflowWrap: "anywhere", minWidth: 0 }
          : { whiteSpace: "nowrap" }),
      }}
    >
      {children}
    </code>
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
 * theme's links use; with no destination it stays plain text.
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

/**
 * The detail pane: the card fields as microlabel + value meta rows (mono chips
 * for id/branch/spec, a role-toned dot-pill for status, a neutral tag for type)
 * plus tracker/PR ghost buttons, then the task's markdown body rendered through
 * `<Markdown>` — the one addition over task-list's card-only detail.
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
      {/* cardLinks pushes tracker before pr, so [0] is the canonical record. */}
      <DetailTitle title={task.title} link={links[0] ?? null} onOpenLink={onOpenLink} />
      <dl style={fieldGridStyle}>
        <dt style={microlabelStyle}>ID</dt>
        <dd style={fieldValueStyle}>
          <CodeChip>{task.id}</CodeChip>
        </dd>
        <dt style={microlabelStyle}>Type</dt>
        <dd style={fieldValueStyle}>
          <Tag>{task.type}</Tag>
        </dd>
        <dt style={microlabelStyle}>Status</dt>
        <dd style={fieldValueStyle}>
          <Pill tone={roleTone(task.status.role)}>{task.status.key}</Pill>
          <span style={metaTextStyle}>({task.status.role})</span>
        </dd>
        <dt style={microlabelStyle}>Branch</dt>
        <dd style={fieldValueStyle}>
          <CodeChip wrap>{task.branch}</CodeChip>
        </dd>
        {task.spec_slug ? (
          <>
            <dt style={microlabelStyle}>Spec</dt>
            <dd style={fieldValueStyle}>
              <CodeChip wrap>{task.spec_slug}</CodeChip>
            </dd>
          </>
        ) : null}
        <dt style={microlabelStyle}>Updated</dt>
        <dd style={fieldValueStyle}>
          <span
            style={{
              fontSize: "12.5px",
              color: TOKENS.t2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatDate(task.updated)}
          </span>
        </dd>
      </dl>
      {links.length > 0 ? (
        <div style={{ marginTop: "12px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {links.map((link) => {
            const action = classifyLink(link);
            return (
              <button
                key={`${link.kind}:${link.url ?? link.ref ?? link.label}`}
                type="button"
                className="mvtd-gbtn"
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
      <div
        data-testid="detail-body"
        style={{
          marginTop: "12px",
          paddingTop: "10px",
          borderTop: `0.5px solid ${TOKENS.bd}`,
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
  /**
   * Pin the mvroot theme (Storybook pinned variants only). Production omits it
   * so the host/OS `prefers-color-scheme` applies.
   */
  theme?: MvTheme;
}

/** The theme scope + canvas panel every view state renders inside. */
function Shell({ theme, children }: { theme?: MvTheme; children: ReactNode }) {
  return (
    <MvRoot theme={theme}>
      <div style={panelStyle}>{children}</div>
    </MvRoot>
  );
}

/**
 * Pure presentational task-detail. Renders the one task in a `<ListDetail>`
 * (single-row master + rich detail pane); carries no SDK dependency, so it is
 * driven purely by props in tests, the story, and both wiring paths. Every
 * state — loading, error, empty, data — renders inside the same `<MvRoot>`
 * scope and canvas panel, so both wiring paths get the token sheet.
 */
export function TaskDetailView({
  data,
  connecting,
  error,
  onOpenLink,
  theme,
}: TaskDetailViewProps) {
  ensureTaskDetailStyles();
  if (error) {
    return (
      <Shell theme={theme}>
        <div data-testid="task-detail-error" style={{ fontSize: "12.5px", color: TOKENS.red }}>
          Couldn’t load task: {error}
        </div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell theme={theme}>
        <div data-testid="task-detail-connecting" style={{ fontSize: "12.5px", color: TOKENS.t3 }}>
          {connecting === false ? "No task." : "Connecting…"}
        </div>
      </Shell>
    );
  }

  return (
    <Shell theme={theme}>
      <div style={cardStyle}>
        <ListDetail
          items={[data]}
          ariaLabel="task"
          getKey={(task) => task.id}
          emptyLabel="No task."
          renderRow={(task) => (
            <span style={{ display: "block" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
                  {task.title}
                </span>
                <Pill tone={roleTone(task.status.role)}>{task.status.key}</Pill>
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: "2px",
                  fontSize: "11.5px",
                  color: TOKENS.t3,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {task.type} · {task.id}
              </span>
            </span>
          )}
          renderDetail={(task) => <TaskDetailPane task={task} onOpenLink={onOpenLink} />}
        />
      </div>
    </Shell>
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
    appInfo: { name: "marvin-task-detail", version: "0.8.1" },
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
