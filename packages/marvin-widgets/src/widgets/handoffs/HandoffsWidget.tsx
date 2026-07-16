import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
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
import { MvRoot, TOKENS, MV_FONT_MONO, type MvTheme } from "../../theme";

/**
 * The handoffs widget (ADR-0024 widget #5) — a master-detail *browser* over the
 * session-continuation handoff docs: a multi-row `<ListDetail>` master (newest
 * first, two-line rows: title + meta) and, for the selected handoff, a detail pane
 * with its fields, a PR ghost-link, the paste-ready `continue_prompt` (a mono block
 * with a copy affordance plus the filled continue-to-chat CTA), and its body via
 * the `<Markdown>` primitive. Split into a pure {@link HandoffsView} (props-only,
 * no SDK) and the App wiring below, so the render is unit-testable without a
 * transport and the same view serves production (`useApp`) and the mock-host seam.
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the view wraps
 * itself in `<MvRoot>` — both wiring paths render the same themed tree — and every
 * color is a `.mvroot` token reference; the widget declares no palette of its own.
 *
 * Payload is `HandoffDetailPayload` (`{ handoffs: HandoffDetail[] }`) — the `handoff`
 * tool's enriched `list` result, carrying every card plus `body_markdown` and
 * `continue_prompt` so the whole set browses with no per-handoff fetch.
 */

// ── family recipes (docs/design/reports-widget.md), widget-inline ────────────

/** The widget canvas — the bordered panel every state renders inside. */
const panelStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: 14,
};

/** Widget title: 16px/500, tight tracking. */
const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  letterSpacing: "-0.015em",
};

/** Neutral tag — second-surface ground, secondary text, no dot. */
const neutralPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 9px",
  borderRadius: 4,
  fontSize: 11.5,
  fontWeight: 500,
  whiteSpace: "nowrap",
  background: TOKENS.srf2,
  color: TOKENS.t2,
  fontVariantNumeric: "tabular-nums",
};

/** Microlabel — the 10.5px uppercase meta heading. */
const microlabelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: ".06em",
  color: TOKENS.t3,
};

/** Mono code chip for code-like values (branch, base, spec slug). */
const codeChipStyle: CSSProperties = {
  fontFamily: MV_FONT_MONO,
  fontSize: 11,
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: "1px 6px",
  whiteSpace: "nowrap",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "inline-block",
  verticalAlign: "bottom",
};

/**
 * Ghost button — the quiet bordered action (the PR link). `font: inherit` first so
 * the later size/spacing keys override the UA button font; hover lives in the
 * widget-local stylesheet (`.mvho-ghost`).
 */
const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  font: "inherit",
  fontSize: 12,
  color: TOKENS.t2,
  background: "transparent",
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: "3px 10px",
  cursor: "pointer",
  letterSpacing: "inherit",
};

/** Filled CTA — the widget's one primary action (continue in a new session). */
const ctaButtonStyle: CSSProperties = {
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  background: TOKENS.acfill,
  color: TOKENS.acfillt,
  border: "none",
  borderRadius: 4,
  padding: "5px 12px",
  cursor: "pointer",
  letterSpacing: "inherit",
};

/** Violet-tinted chip — the copy affordance beside the CTA. */
const copyChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  color: TOKENS.act,
  background: TOKENS.acbg,
  border: "0.5px solid transparent",
  borderRadius: 4,
  padding: "3px 10px",
  cursor: "pointer",
  letterSpacing: "inherit",
};

/** The continue prompt — a mono block on the second surface step. */
const promptStyle: CSSProperties = {
  margin: "6px 0 8px",
  padding: "8px 10px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: MV_FONT_MONO,
  fontSize: 11.5,
  lineHeight: 1.55,
  color: TOKENS.t2,
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
};

/** A detail section separated by a top hairline (continue block, body). */
const sectionStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: `0.5px solid ${TOKENS.bd}`,
};

/** The master-detail card the `<ListDetail>` shell sits in. */
const cardStyle: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  overflow: "hidden",
};

/** Field grid under the detail title: microlabel column + value column. */
const fieldsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "5px 14px",
  alignItems: "baseline",
  margin: "10px 0 0",
};

const fieldValueStyle: CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  minWidth: 0,
};

/** Master-row line 1 — the handoff objective (500, ellipsized). */
const rowTitleStyle: CSSProperties = {
  fontWeight: 500,
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Master-row line 2 — id · branch · date in meta grey. */
const rowMetaStyle: CSSProperties = {
  display: "block",
  marginTop: 2,
  fontSize: 11.5,
  color: TOKENS.t3,
  fontVariantNumeric: "tabular-nums",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// ── widget-local stylesheet — hover states (pseudo-classes cannot be inline) ─

/** id of the injected `<style>` element — the once-per-document key. */
const HANDOFFS_STYLE_ID = "mv-handoffs-styles";

const HANDOFFS_CSS = `
.mvho-ghost:hover{background:${TOKENS.srf2};color:${TOKENS.t1}}
`;

/** Put the hover rules into the document exactly once (same lifecycle as MvRoot). */
function ensureHandoffsStyles(): void {
  if (typeof document === "undefined" || document.getElementById(HANDOFFS_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HANDOFFS_STYLE_ID;
  style.textContent = HANDOFFS_CSS;
  document.head.appendChild(style);
}

/**
 * The themed canvas every view state renders inside: the `MvRoot` token scope
 * (inside the view itself, so the production and seam paths get identical trees)
 * plus the bordered widget panel.
 */
function Shell({ theme, children }: { theme?: MvTheme; children?: ReactNode }) {
  ensureHandoffsStyles();
  return (
    <MvRoot theme={theme}>
      <div style={panelStyle}>{children}</div>
    </MvRoot>
  );
}

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

/** The 12px copy glyph on the prompt chip (stroke = currentColor, decorative). */
function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Select-on-click fallback for the copy affordance: when no clipboard is
 * available (or the write is refused), select the prompt block's text so a
 * manual ⌘C still lands in one gesture. Best-effort — never throws.
 */
function selectNodeText(el: HTMLElement | null): void {
  if (!el || typeof window === "undefined") return;
  const selection = window.getSelection?.();
  if (!selection) return;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    // selection is best-effort — the prompt text stays hand-selectable
  }
}

/**
 * The detail pane: the handoff's title row (objective + PR ghost-link), its field
 * grid, the continue-prompt block with the filled CTA and the copy chip, then its
 * markdown body through `<Markdown>`.
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
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  // Copy is widget-local (no host call): clipboard when the host grants it,
  // select-on-click otherwise, mirroring the reports family's copy-only chips.
  const onCopy = () => {
    void (async () => {
      let ok = false;
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === "function") {
        try {
          await clipboard.writeText(handoff.continue_prompt);
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (ok) {
        setCopied(true);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(false), 2000);
      } else {
        selectNodeText(preRef.current);
      }
    })();
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2
          data-testid="detail-title"
          style={{
            margin: 0,
            fontSize: 14.5,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            flex: 1,
            minWidth: "12rem",
          }}
        >
          {handoff.objective}
        </h2>
        {link ? (
          <button
            type="button"
            className="mvho-ghost"
            onClick={() => onOpenLink?.(link)}
            style={{ ...ghostButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
          >
            {classifyLink(link).type === "external" ? "↗ " : ""}
            {link.label}
          </button>
        ) : null}
      </div>
      <dl style={fieldsStyle}>
        <dt style={microlabelStyle}>Id</dt>
        <dd style={{ ...fieldValueStyle, fontVariantNumeric: "tabular-nums" }}>{handoff.id}</dd>
        <dt style={microlabelStyle}>Branch</dt>
        <dd style={fieldValueStyle}>
          <span style={codeChipStyle}>{handoff.branch}</span>
        </dd>
        {handoff.base ? (
          <>
            <dt style={microlabelStyle}>Base</dt>
            <dd style={fieldValueStyle}>
              <span style={codeChipStyle}>{handoff.base}</span>
            </dd>
          </>
        ) : null}
        {handoff.spec_slug ? (
          <>
            <dt style={microlabelStyle}>Spec</dt>
            <dd style={fieldValueStyle}>
              <span style={codeChipStyle}>{handoff.spec_slug}</span>
            </dd>
          </>
        ) : null}
        <dt style={microlabelStyle}>Created</dt>
        <dd style={{ ...fieldValueStyle, fontVariantNumeric: "tabular-nums" }}>
          {formatDate(handoff.created)}
        </dd>
      </dl>
      <div style={sectionStyle}>
        <div style={microlabelStyle}>Continue prompt</div>
        {/* Selectable text so the prompt is always available even on a host that
            rejects the chat action; the CTA is the one-click copy-to-chat. */}
        <pre data-testid="continue-prompt" ref={preRef} style={promptStyle}>
          {handoff.continue_prompt}
        </pre>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="continue-button"
            onClick={() => onContinue?.(handoff.continue_prompt)}
            style={{ ...ctaButtonStyle, cursor: onContinue ? "pointer" : "default" }}
          >
            Continue in a new session
          </button>
          <button type="button" data-testid="copy-prompt" onClick={onCopy} style={copyChipStyle}>
            <CopyIcon />
            {copied ? "Copied" : "Copy prompt"}
          </button>
        </div>
      </div>
      <div data-testid="detail-body" style={sectionStyle}>
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
  /**
   * Pin the mvroot theme (Storybook-only). Production omits it, so the widget
   * follows the host/OS `prefers-color-scheme`.
   */
  theme?: MvTheme;
}

/**
 * Pure presentational handoffs browser. Renders the widget header plus a
 * master-detail list of handoffs inside its own `<MvRoot>` scope; carries no SDK
 * dependency, so it is driven purely by props in tests, the story, and both
 * wiring paths.
 */
export function HandoffsView({
  data,
  connecting,
  error,
  onOpenLink,
  onContinue,
  theme,
}: HandoffsViewProps) {
  if (error) {
    return (
      <Shell theme={theme}>
        <div data-testid="handoffs-error" style={{ color: TOKENS.red, fontSize: 12.5 }}>
          Couldn’t load handoffs: {error}
        </div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell theme={theme}>
        <div data-testid="handoffs-connecting" style={{ color: TOKENS.t3, fontSize: 12.5 }}>
          {connecting === false ? "No data." : "Connecting…"}
        </div>
      </Shell>
    );
  }

  return (
    <Shell theme={theme}>
      <header data-testid="handoffs-count" style={{ margin: "2px 2px 12px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={titleStyle}>Handoffs</span>
          <span style={neutralPillStyle}>{data.handoffs.length}</span>
        </div>
        <div style={{ fontSize: 12, color: TOKENS.t3 }}>
          .marvin/handoff/ · session continuation docs
        </div>
      </header>
      <div style={cardStyle}>
        <ListDetail
          items={data.handoffs}
          ariaLabel="handoffs"
          getKey={(handoff) => handoff.id}
          emptyLabel="No handoffs yet — run /marvin:handoff to capture the current work."
          renderRow={(handoff) => {
            const link = prLink(handoff.pr_url);
            return (
              <span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={rowTitleStyle}>{handoff.objective}</span>
                  {link ? <span style={neutralPillStyle}>{link.label}</span> : null}
                </span>
                <span style={rowMetaStyle}>
                  {handoff.id} · {handoff.branch} · {formatDate(handoff.created)}
                </span>
              </span>
            );
          }}
          renderDetail={(handoff) => (
            <HandoffDetailPane
              key={handoff.id}
              handoff={handoff}
              onOpenLink={onOpenLink}
              onContinue={onContinue}
            />
          )}
        />
      </div>
    </Shell>
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
    appInfo: { name: "marvin-handoffs", version: "0.8.0" },
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
