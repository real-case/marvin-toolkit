import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  HandoffDetail,
  HandoffDetailPayload,
  LinkRef,
} from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { Markdown } from "../../primitives/Markdown";
import { classifyLink, dispatchLink } from "../../lib/links";
import { formatDate } from "../../lib/format";

/**
 * The handoffs widget (ADR-0024 widget #5) — a master-detail *browser* over the
 * session-continuation handoff docs: a multi-row `<ListDetail>` master (newest
 * first, the real multi-row shape task-list has but task-detail does not) and, for
 * the selected handoff, a detail pane with its fields, a PR link, the paste-ready
 * `continue_prompt` (offered as a one-click copy-to-chat action), and its body via
 * the `<Markdown>` primitive. Split into a pure {@link HandoffsView} (props-only,
 * no SDK) and the App wiring below, so the render is unit-testable without a
 * transport and the same view serves production (`useApp`) and the mock-host seam.
 *
 * Payload is `HandoffDetailPayload` (`{ handoffs: HandoffDetail[] }`) — the `handoff`
 * tool's enriched `list` result, carrying every card plus `body_markdown` and
 * `continue_prompt` so the whole set browses with no per-handoff fetch.
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

const continueButtonStyle: CSSProperties = {
  font: "inherit",
  fontWeight: 600,
  border: "1px solid var(--color-border-info, #0b57d0)",
  borderRadius: "var(--border-radius-sm, 4px)",
  background: "var(--color-background-info, #eef4ff)",
  color: "var(--color-text-info, #0b57d0)",
  padding: "0.35rem 0.6rem",
};

const promptStyle: CSSProperties = {
  margin: "0.35rem 0 0.5rem",
  padding: "0.6rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "0.82em",
  background: "var(--color-background-secondary, #f4f4f5)",
  borderRadius: "var(--border-radius-sm, 4px)",
  border: "1px solid var(--color-border-primary, #e2e2e2)",
};

/**
 * The single link a handoff card can carry: its PR. Handoff cards have no tracker
 * field and `pr_url` is a nullable string (not task-detail's `pr` object), so this
 * is deliberately handoff-specific rather than a reuse of task-detail's `cardLinks`.
 */
function prLink(prUrl: string | null): LinkRef | null {
  if (!prUrl) return null;
  const match = prUrl.match(/\/pull\/(\d+)/);
  return { kind: "pr", label: match ? `PR #${match[1]}` : "PR", url: prUrl };
}

/**
 * The detail pane: the handoff's fields, its PR link, the continue-to-chat block,
 * then its markdown body through `<Markdown>`.
 */
function HandoffDetailPane({
  handoff,
  onOpenLink,
  onContinue,
}: {
  handoff: HandoffDetail;
  onOpenLink?: (link: LinkRef) => void;
  onContinue?: (prompt: string) => void;
}) {
  const link = prLink(handoff.pr_url);
  return (
    <div>
      <h2 data-testid="detail-title" style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
        {handoff.objective}
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
        <dd style={{ margin: 0 }}>{handoff.id}</dd>
        <dt style={{ opacity: 0.6 }}>Branch</dt>
        <dd style={{ margin: 0 }}>
          <code>{handoff.branch}</code>
        </dd>
        {handoff.base ? (
          <>
            <dt style={{ opacity: 0.6 }}>Base</dt>
            <dd style={{ margin: 0 }}>
              <code>{handoff.base}</code>
            </dd>
          </>
        ) : null}
        {handoff.spec_slug ? (
          <>
            <dt style={{ opacity: 0.6 }}>Spec</dt>
            <dd style={{ margin: 0 }}>{handoff.spec_slug}</dd>
          </>
        ) : null}
        <dt style={{ opacity: 0.6 }}>Created</dt>
        <dd style={{ margin: 0 }}>{formatDate(handoff.created)}</dd>
      </dl>
      {link ? (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(() => {
            const action = classifyLink(link);
            return (
              <button
                type="button"
                onClick={() => onOpenLink?.(link)}
                style={{ ...linkButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
              >
                {action.type === "external" ? "↗ " : ""}
                {link.label}
              </button>
            );
          })()}
        </div>
      ) : null}
      <div
        style={{
          marginTop: "1rem",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--color-border-primary, #e2e2e2)",
        }}
      >
        <div style={{ fontSize: "0.8em", fontWeight: 600, opacity: 0.7 }}>Continue prompt</div>
        {/* Selectable text so the prompt is always available even on a host that
            rejects the chat action; the button is the one-click copy-to-chat. */}
        <pre data-testid="continue-prompt" style={promptStyle}>
          {handoff.continue_prompt}
        </pre>
        <button
          type="button"
          data-testid="continue-button"
          onClick={() => onContinue?.(handoff.continue_prompt)}
          style={{ ...continueButtonStyle, cursor: onContinue ? "pointer" : "default" }}
        >
          ▸ Continue in a new session
        </button>
      </div>
      <div
        data-testid="detail-body"
        style={{
          marginTop: "1rem",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--color-border-primary, #e2e2e2)",
        }}
      >
        <Markdown source={handoff.body_markdown} />
      </div>
    </div>
  );
}

export interface HandoffsViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: HandoffDetailPayload | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /** Open a link through the host. Omitted in pure-render contexts (tests/story). */
  onOpenLink?: (link: LinkRef) => void;
  /** Send a handoff's continue prompt to chat. Omitted in pure-render contexts. */
  onContinue?: (prompt: string) => void;
}

/**
 * Pure presentational handoffs browser. Renders a count header plus a master-detail
 * list of handoffs; carries no SDK dependency, so it is driven purely by props in
 * tests, the story, and both wiring paths.
 */
export function HandoffsView({
  data,
  connecting,
  error,
  onOpenLink,
  onContinue,
}: HandoffsViewProps) {
  if (error) {
    return (
      <div
        data-testid="handoffs-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00020)" }}
      >
        Couldn’t load handoffs: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="handoffs-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No data." : "Connecting…"}
      </div>
    );
  }

  return (
    <div
      style={{
        // fontFamily, not the `font` shorthand: the shorthand requires a size, so
        // a family-only `font:` is invalid CSS — the declaration is dropped and
        // the widget renders in the host default serif.
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--color-text-primary, #1a1a1a)",
      }}
    >
      <header
        data-testid="handoffs-count"
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
          {data.handoffs.length} {data.handoffs.length === 1 ? "handoff" : "handoffs"}
        </strong>
      </header>
      <ListDetail
        items={data.handoffs}
        ariaLabel="handoffs"
        getKey={(handoff) => handoff.id}
        emptyLabel="No handoffs yet — run /marvin:handoff to capture the current work."
        renderRow={(handoff) => (
          <span>
            <span style={badgeStyle}>{handoff.id}</span>
            {handoff.objective}
            <span style={{ display: "block", opacity: 0.6, fontSize: "0.85em" }}>
              {handoff.branch}
            </span>
          </span>
        )}
        renderDetail={(handoff) => (
          <HandoffDetailPane handoff={handoff} onOpenLink={onOpenLink} onContinue={onContinue} />
        )}
      />
    </div>
  );
}

/**
 * The transport seam (mirrors task-detail). `useApp` hard-wires a
 * `PostMessageTransport` to `window.parent`, which is `=== window` under happy-dom
 * (no iframe nesting), so the automated test injects an `App` + in-memory transport
 * instead. Production omits `seam` and takes the live path.
 */
export interface HandoffsSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface HandoffsWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: HandoffsSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount (tests always inject, production never
 * does), so this wrapper calls no hooks itself and the two children each own their
 * hook order.
 */
export function HandoffsWidget({ seam }: HandoffsWidgetProps) {
  return seam ? <HandoffsSeamWidget seam={seam} /> : <HandoffsLiveWidget />;
}

/** Send a handoff's continue prompt to chat via the host (ADR-0024 chat action). */
function sendContinue(app: App, prompt: string): void {
  void app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] }).catch(() => {});
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function HandoffsLiveWidget() {
  const [data, setData] = useState<HandoffDetailPayload | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-handoffs", version: "0.18.0" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as HandoffDetailPayload);
        }
      };
    },
  });
  const onOpenLink = (link: LinkRef) => {
    if (app) void dispatchLink(app, link).catch(() => {});
  };
  const onContinue = (prompt: string) => {
    if (app) sendContinue(app, prompt);
  };
  return (
    <HandoffsView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onOpenLink={onOpenLink}
      onContinue={onContinue}
    />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function HandoffsSeamWidget({ seam }: { seam: HandoffsSeam }) {
  const [data, setData] = useState<HandoffDetailPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as HandoffDetailPayload);
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
  const onContinue = (prompt: string) => {
    sendContinue(seam.app, prompt);
  };

  return (
    <HandoffsView
      data={data}
      connecting={!connected}
      error={error}
      onOpenLink={onOpenLink}
      onContinue={onContinue}
    />
  );
}
