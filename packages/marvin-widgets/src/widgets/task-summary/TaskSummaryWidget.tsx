import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  AcOutcome,
  CommitRef,
  GateOutcome,
  LessonRef,
  LinkRef,
  TaskSummary,
} from "@marvin-toolkit/mcp-shared/contracts";
import { Markdown } from "../../primitives/Markdown";
import { classifyLink, dispatchLink } from "../../lib/links";
import { MvRoot, MV_FONT_MONO, SEVERITY_TOKENS, TOKENS, type MvTheme } from "../../theme";

/**
 * The task-summary widget (ADR-0024 #3) — the "what was done" delivery digest over
 * the `TaskSummary` the existing `summary` tool already returns. Unlike task-list /
 * task-detail / audit it is NOT a `<ListDetail>` master-detail: a `TaskSummary` is a
 * single object with five heterogeneous collections, so it renders as a panel of
 * sections (header · acceptance · gates · commits · lessons · links).
 *
 * Split into a pure {@link TaskSummaryView} (props-only, no SDK) and the App wiring
 * below — the same shape as the sibling widgets — so the render is unit-testable
 * without a transport and one view serves production (`useApp`), tests and the story.
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the view wraps
 * itself in `<MvRoot>` (so the production AND seam paths both get the token scope),
 * paints its own panel canvas, and colors exclusively through `TOKENS` /
 * `SEVERITY_TOKENS` references — no host palette variables, no literal hex.
 *
 * `TaskSummary` is fully structured (no `body_markdown`), so `<Markdown>` renders only
 * the inline free-text AC `statement`; the machine-generated commit `subject` and gate
 * `detail` are escaped plain-text nodes (identical no-injection guarantee, but no
 * block-level `<p>` to break their inline row).
 */

type Outcome = AcOutcome["outcome"]; // "pass" | "fail" | "unknown"
type GateStatus = GateOutcome["status"]; // "pass" | "fail" | "skip"

// ── the family recipes (translated 1:1 from the approved mockup) ─────────────

/** The widget canvas — MvRoot carries the tokens, the panel paints the frame. */
const frameStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: 14,
};

/** Microlabel — 10.5px/500 uppercase, .06em tracking, meta-grade text. */
const microlabelStyle: CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

/** Mono code chip — paths, shas, oracle refs (code-like values only). */
const codeChipStyle: CSSProperties = {
  fontFamily: MV_FONT_MONO,
  fontSize: "11px",
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

const metaStyle: CSSProperties = { fontSize: "11.5px", color: TOKENS.t3 };
const emptyNoteStyle: CSSProperties = { margin: 0, fontSize: "12.5px", color: TOKENS.t3 };

// Ghost-button hover needs a pseudo-class, so the widget injects one tiny
// id-keyed <style> element (the same idempotent lifecycle as MvRoot's sheet).
const TS_STYLE_ID = "mv-tasksummary-styles";
const TS_CSS = `
.mvts-gbtn{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;color:${TOKENS.t2};background:transparent;border:0.5px solid ${TOKENS.bd};border-radius:4px;padding:3px 10px;letter-spacing:inherit}
.mvts-gbtn:hover{background:${TOKENS.srf2};color:${TOKENS.t1}}
`;

function ensureWidgetStyles(): void {
  if (typeof document === "undefined" || document.getElementById(TS_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TS_STYLE_ID;
  style.textContent = TS_CSS;
  document.head.appendChild(style);
}

/** Status/severity pill — lowercase 11.5px/500 tag with a 5px currentColor dot.
 * Neutral tags (the header lifecycle status) drop the dot: dots mark outcomes. */
function Pill({
  tone,
  label,
  dot = true,
}: {
  tone: { text: string; bg: string };
  label: string;
  dot?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 9px",
        borderRadius: 4,
        fontSize: "11.5px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        textTransform: "lowercase",
        background: tone.bg,
        color: tone.text,
      }}
    >
      {dot ? (
        <span
          aria-hidden="true"
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "currentColor",
            flex: "none",
          }}
        />
      ) : null}
      {label}
    </span>
  );
}

const NEUTRAL_TONE = { text: TOKENS.t2, bg: TOKENS.srf2 };

// AC outcome → pill tone. The conservative model requires "unknown" to read as
// its own neutral state (the pending palette), never as a failure.
const OUTCOME_TONE: Record<Outcome, { text: string; bg: string }> = {
  pass: SEVERITY_TOKENS.pass,
  fail: SEVERITY_TOKENS.fail,
  unknown: SEVERITY_TOKENS.pending,
};

/** 12px stroke glyph for the gate icon squares (paths from the approved mockup). */
function Glyph({ path }: { path: string }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

// Gate status → tinted 20×20 icon square (the checks recipe). `skip` shares the
// neutral surface with a dash glyph — deliberately not run, neither green nor red.
const GATE_SQUARE: Record<GateStatus, { bg: string; color: string; path: string }> = {
  pass: { bg: TOKENS.grnbg, color: TOKENS.grn, path: "M20 6L9 17l-5-5" },
  fail: { bg: TOKENS.redbg, color: TOKENS.red, path: "M18 6L6 18M6 6l12 12" },
  skip: { bg: TOKENS.srf2, color: TOKENS.t3, path: "M5 12h14" },
};

/** A titled panel section: microlabel heading over a 0.5px top hairline. */
function Section({
  title,
  testid,
  children,
}: {
  title: string;
  testid: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testid}
      style={{ marginTop: 14, paddingTop: 10, borderTop: `0.5px solid ${TOKENS.bd}` }}
    >
      <h3 style={{ ...microlabelStyle, margin: "0 0 6px" }}>{title}</h3>
      {children}
    </section>
  );
}

/** One acceptance criterion: an id · outcome dot-pill header row, then the statement
 * (Markdown) and the oracle reference stacked full-width beneath it. */
function AcRow({ ac }: { ac: AcOutcome }) {
  return (
    <li data-testid="ac-row" data-outcome={ac.outcome} style={{ padding: "5px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{ac.id}</span>
        <Pill tone={OUTCOME_TONE[ac.outcome]} label={ac.outcome} />
      </div>
      <div data-testid="ac-statement">
        <Markdown source={ac.statement} />
      </div>
      {/* The proof reference: oracle kind in meta text, the ref itself mono —
          it is a test path or a command, i.e. code-like. */}
      <div
        style={{
          ...metaStyle,
          marginTop: 4,
          display: "flex",
          gap: 6,
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        <span>{ac.oracle_kind}</span>
        {ac.oracle_ref ? (
          <span
            style={{
              fontFamily: MV_FONT_MONO,
              fontSize: "11px",
              color: TOKENS.t2,
              wordBreak: "break-all",
            }}
          >
            {ac.oracle_ref}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** One verification gate row (the checks recipe): tinted icon square, the gate
 * name at 500, and the detail note right-aligned in meta text. */
function GateRow({ gate, last }: { gate: GateOutcome; last: boolean }) {
  const square = GATE_SQUARE[gate.status];
  return (
    <li
      data-testid="gate-row"
      data-status={gate.status}
      style={{
        display: "flex",
        gap: 9,
        alignItems: "center",
        padding: "7px 12px",
        borderBottom: last ? "none" : `0.5px solid ${TOKENS.bd}`,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
          background: square.bg,
          color: square.color,
        }}
      >
        <Glyph path={square.path} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{gate.name}</span>
      <span style={{ ...metaStyle, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {gate.status}
        {gate.detail ? ` · ${gate.detail}` : ""}
      </span>
    </li>
  );
}

/** One commit: the sha as a mono code chip + plain (escaped) subject inline. */
function CommitRow({ commit }: { commit: CommitRef }) {
  return (
    <li
      data-testid="commit-row"
      style={{ display: "flex", gap: 8, padding: "3px 0", alignItems: "baseline" }}
    >
      <code style={codeChipStyle}>{commit.sha}</code>
      <span style={{ flex: 1, minWidth: 0 }}>{commit.subject}</span>
    </li>
  );
}

/** One captured lesson: title + its mono slug id in meta text. */
function LessonRow({ lesson }: { lesson: LessonRef }) {
  return (
    <li
      data-testid="lesson-row"
      style={{
        display: "flex",
        gap: 8,
        padding: "3px 0",
        alignItems: "baseline",
        flexWrap: "wrap",
      }}
    >
      <span>{lesson.title}</span>
      <span style={{ fontFamily: MV_FONT_MONO, fontSize: "11px", color: TOKENS.t3 }}>
        {lesson.id}
      </span>
    </li>
  );
}

/** One link as a ghost button (3-type model): external links get the ↗ affordance
 * and dispatch through the host; ref-only links render without it. */
function LinkButton({ link, onOpenLink }: { link: LinkRef; onOpenLink?: (link: LinkRef) => void }) {
  const external = classifyLink(link).type === "external";
  return (
    <button
      type="button"
      className="mvts-gbtn"
      data-testid="summary-link"
      data-kind={link.kind}
      data-external={external ? "true" : "false"}
      onClick={() => onOpenLink?.(link)}
      style={{ cursor: onOpenLink ? "pointer" : "default" }}
    >
      {external ? <span aria-hidden="true">↗</span> : null}
      {link.label}
    </button>
  );
}

// ── the header roll-up as stat cells ─────────────────────────────────────────

interface Tally {
  acPassed: number;
  acFailed: number;
  acUnknown: number;
  acTotal: number;
  gatePassed: number;
  gateFailed: number;
  gateSkipped: number;
  gateTotal: number;
}

function tally(summary: TaskSummary): Tally {
  const count = <T,>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length;
  return {
    acPassed: count(summary.acceptance, (a) => a.outcome === "pass"),
    acFailed: count(summary.acceptance, (a) => a.outcome === "fail"),
    acUnknown: count(summary.acceptance, (a) => a.outcome === "unknown"),
    acTotal: summary.acceptance.length,
    gatePassed: count(summary.gates, (g) => g.status === "pass"),
    gateFailed: count(summary.gates, (g) => g.status === "fail"),
    gateSkipped: count(summary.gates, (g) => g.status === "skip"),
    gateTotal: summary.gates.length,
  };
}

/** One stat cell: microlabel, 21px tabular value, an 11.5px context line. */
function StatCell({
  label,
  value,
  valueColor,
  context,
}: {
  label: string;
  value: string;
  valueColor: string;
  context: string | null;
}) {
  return (
    <div>
      <div style={microlabelStyle}>{label}</div>
      <div
        style={{
          fontSize: "21px",
          fontWeight: 500,
          lineHeight: 1.25,
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
          color: valueColor,
        }}
      >
        {value}
      </div>
      {context ? (
        <div style={{ ...metaStyle, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
          {context}
        </div>
      ) : null}
    </div>
  );
}

export interface TaskSummaryViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: TaskSummary | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /** Open a link through the host. Omitted in pure-render contexts (tests/story). */
  onOpenLink?: (link: LinkRef) => void;
  /** Pin the mvroot theme. Stories only — production omits it so the host/OS
   * `prefers-color-scheme` applies. */
  theme?: MvTheme;
}

/**
 * Pure presentational task-summary. Renders the one `TaskSummary` as a panel of
 * sections inside its own `<MvRoot>` scope; carries no SDK dependency, so it is
 * driven purely by props in tests, the story, and both wiring paths. Stateless —
 * there is no list selection to own.
 */
export function TaskSummaryView({
  data,
  connecting,
  error,
  onOpenLink,
  theme,
}: TaskSummaryViewProps) {
  ensureWidgetStyles();

  if (error) {
    return (
      <MvRoot theme={theme}>
        <div data-testid="summary-error" style={{ ...frameStyle, color: TOKENS.red }}>
          Couldn’t load task summary: {error}
        </div>
      </MvRoot>
    );
  }
  if (!data) {
    return (
      <MvRoot theme={theme}>
        <div data-testid="summary-connecting" style={{ ...frameStyle, color: TOKENS.t2 }}>
          {connecting === false ? "No task summary." : "Connecting…"}
        </div>
      </MvRoot>
    );
  }

  const t = tally(data);
  const acContext = [
    t.acFailed ? `${t.acFailed} failed` : null,
    t.acUnknown ? `${t.acUnknown} unknown` : null,
  ].filter((p): p is string => p !== null);
  const gateContext = [
    t.gateFailed ? `${t.gateFailed} failed` : null,
    t.gateSkipped ? `${t.gateSkipped} skipped` : null,
  ].filter((p): p is string => p !== null);

  return (
    <MvRoot theme={theme}>
      <div data-testid="summary-panel" style={frameStyle}>
        <header
          data-testid="summary-header"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            gap: "10px 28px",
            margin: "2px 2px 0",
          }}
        >
          <div style={{ flex: "1 1 16rem", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: "16px", fontWeight: 500, letterSpacing: "-0.015em" }}>
                {data.title}
              </span>
              <Pill tone={NEUTRAL_TONE} label={data.status} dot={false} />
            </div>
          </div>
          {t.acTotal > 0 || t.gateTotal > 0 ? (
            <div data-testid="summary-rollup" style={{ display: "flex", gap: 28 }}>
              {t.acTotal > 0 ? (
                <StatCell
                  label="Acceptance"
                  value={`${t.acPassed}/${t.acTotal}`}
                  valueColor={
                    t.acFailed > 0 ? TOKENS.red : t.acPassed === t.acTotal ? TOKENS.grn : TOKENS.t1
                  }
                  context={acContext.length > 0 ? acContext.join(" · ") : "all passed"}
                />
              ) : null}
              {t.gateTotal > 0 ? (
                <StatCell
                  label="Gates"
                  value={`${t.gatePassed}/${t.gateTotal}`}
                  valueColor={
                    t.gateFailed > 0
                      ? TOKENS.red
                      : t.gatePassed === t.gateTotal
                        ? TOKENS.grn
                        : TOKENS.t1
                  }
                  context={gateContext.length > 0 ? gateContext.join(" · ") : "all green"}
                />
              ) : null}
            </div>
          ) : null}
        </header>

        <Section title={`Acceptance (${data.acceptance.length})`} testid="summary-acceptance">
          {data.acceptance.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.acceptance.map((ac) => (
                <AcRow key={ac.id} ac={ac} />
              ))}
            </ul>
          ) : (
            <p data-testid="acceptance-empty" style={emptyNoteStyle}>
              No spec-contract criteria found.
            </p>
          )}
        </Section>

        <Section title="Gates" testid="summary-gates">
          {data.gates.length > 0 ? (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                background: TOKENS.srf,
                border: `0.5px solid ${TOKENS.bd}`,
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              {data.gates.map((gate, i) => (
                <GateRow key={gate.name} gate={gate} last={i === data.gates.length - 1} />
              ))}
            </ul>
          ) : (
            <p data-testid="gates-empty" style={emptyNoteStyle}>
              No verification gates.
            </p>
          )}
        </Section>

        <Section title={`Commits (${data.commits.length})`} testid="summary-commits">
          {data.commits.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.commits.map((commit) => (
                <CommitRow key={commit.sha} commit={commit} />
              ))}
            </ul>
          ) : (
            <p data-testid="commits-empty" style={emptyNoteStyle}>
              None on this branch vs base.
            </p>
          )}
        </Section>

        {data.lessons.length > 0 ? (
          <Section title={`Lessons (${data.lessons.length})`} testid="summary-lessons">
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.lessons.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} />
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Links" testid="summary-links">
          {data.links.length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {data.links.map((link) => (
                <LinkButton
                  key={`${link.kind}:${link.url ?? link.ref ?? link.label}`}
                  link={link}
                  onOpenLink={onOpenLink}
                />
              ))}
            </div>
          ) : (
            <p data-testid="links-empty" style={emptyNoteStyle}>
              No links.
            </p>
          )}
        </Section>
      </div>
    </MvRoot>
  );
}

/**
 * The transport seam (mirrors task-list/task-detail/audit). `useApp` hard-wires a
 * `PostMessageTransport` to `window.parent`, which is `=== window` under happy-dom (no
 * iframe nesting), so the automated test injects an `App` + in-memory transport instead.
 * Production omits `seam` and takes the live path.
 */
export interface TaskSummarySeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface TaskSummaryWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: TaskSummarySeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount (tests always inject, production never does),
 * so this wrapper calls no hooks itself and the two children each own their hook order.
 */
export function TaskSummaryWidget({ seam }: TaskSummaryWidgetProps) {
  return seam ? <TaskSummarySeamWidget seam={seam} /> : <TaskSummaryLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function TaskSummaryLiveWidget() {
  const [data, setData] = useState<TaskSummary | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-task-summary", version: "0.8.1" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as TaskSummary);
        }
      };
    },
  });
  const onOpenLink = (link: LinkRef) => {
    if (app) void dispatchLink(app, link).catch(() => {});
  };
  return (
    <TaskSummaryView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onOpenLink={onOpenLink}
    />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function TaskSummarySeamWidget({ seam }: { seam: TaskSummarySeam }) {
  const [data, setData] = useState<TaskSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as TaskSummary);
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
    <TaskSummaryView data={data} connecting={!connected} error={error} onOpenLink={onOpenLink} />
  );
}
