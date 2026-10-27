import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  AutopilotEvent,
  AutopilotRailStep,
  AutopilotReport,
  AutopilotReportPayload,
  AutopilotState,
} from "@marvin-toolkit/mcp-shared/contracts";
import {
  autopilotContext,
  autopilotLabels,
  autopilotModel,
  autopilotTime,
  autopilotUsd,
  type AutopilotLabels,
} from "@marvin-toolkit/mcp-shared/autopilot-labels";
import { blobBase64, copyElementAsImage } from "../../lib/copy-image";
import { useHostTheme } from "../../lib/host-theme";
import { MvRoot, MV_FONT_MONO, TOKENS, type MvTheme } from "../../theme";

/**
 * The autopilot-status widget (ADR-0051) — one periodic report of an autopilot run as a card. The
 * header names the run and the session it reports to (never the task text: that is the whole
 * prompt the run started from), with the status pill and a button that copies the card as an
 * image. Below it: the seven-stage rail across the card's full width, four figures (elapsed,
 * cost, iteration, rejections), a callout when the run needs an answer or has stopped, the
 * events of this interval, which unfold to the whole run's history, and a footer naming the
 * working session's model, effort and context use. The labels come from
 * `autopilotLabels(report.lang)`, the same table the tool's Markdown fallback uses, so the card
 * reads in the session's language.
 *
 * Split like its siblings into a pure {@link AutopilotStatusView} and the App wiring, and colored
 * only through `TOKENS`.
 */

const frameStyle: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 12,
  padding: "18px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const monoMeta: CSSProperties = { fontFamily: MV_FONT_MONO, fontSize: "11px", color: TOKENS.t3 };

const microlabelStyle: CSSProperties = {
  fontSize: "11px",
  color: TOKENS.t3,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const PILL: Record<AutopilotState, { bg: string; fg: string }> = {
  running: { bg: TOKENS.acbg, fg: TOKENS.act },
  waiting: { bg: TOKENS.ambbg, fg: TOKENS.amb },
  ready: { bg: TOKENS.grnbg, fg: TOKENS.grn },
  halted: { bg: TOKENS.redbg, fg: TOKENS.red },
};

const DOT: Record<AutopilotRailStep["state"], { fill: string; ring: string | null }> = {
  done: { fill: TOKENS.grn, ring: null },
  current: { fill: TOKENS.ac, ring: TOKENS.acbg },
  waiting: { fill: TOKENS.amb, ring: TOKENS.ambbg },
  failed: { fill: TOKENS.red, ring: TOKENS.redbg },
  pending: { fill: TOKENS.bd2, ring: null },
};

/** Context use at or above this share is drawn amber. */
const CONTEXT_WARN = 80;

/**
 * The rail spans the card's full width: the grid is widened by one sixth and pulled left by a
 * twelfth, so the first and last column centers, where the dots sit, land on the card's edges.
 * The first label starts under its dot and the last ends under its dot, so neither leaves the card.
 */
function Rail({ steps, l }: { steps: AutopilotRailStep[]; l: AutopilotLabels }) {
  const n = steps.length;
  return (
    <div
      data-testid="autopilot-rail"
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
        width: `calc(100% + 100% / ${n - 1})`,
        marginLeft: `calc(-100% / ${2 * (n - 1)})`,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 5,
          left: `calc(100% / ${2 * n})`,
          right: `calc(100% / ${2 * n})`,
          height: 2,
          background: TOKENS.bd,
        }}
      />
      {steps.map((s, i) => {
        const dot = DOT[s.state];
        const strong = s.state !== "done" && s.state !== "pending";
        const edge =
          i === 0
            ? "translateX(calc(50% - 6px))"
            : i === n - 1
              ? "translateX(calc(-50% + 6px))"
              : undefined;
        return (
          <div
            key={s.key}
            data-testid="rail-step"
            data-state={s.state}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 12,
                height: 12,
                boxSizing: "border-box",
                borderRadius: "50%",
                background: dot.fill,
                border: `2px solid ${TOKENS.srf}`,
                boxShadow: dot.ring ? `0 0 0 4px ${dot.ring}` : "none",
              }}
            />
            <span
              style={{
                fontSize: "11px",
                textAlign: "center",
                color: strong ? TOKENS.t1 : s.state === "done" ? TOKENS.t2 : TOKENS.t3,
                fontWeight: strong ? 600 : 400,
                ...(edge
                  ? { whiteSpace: "nowrap", transform: edge }
                  : { overflowWrap: "anywhere" }),
              }}
            >
              {l.rail[s.key]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      data-testid="autopilot-figure"
      style={{
        background: TOKENS.srf2,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: "11px", color: TOKENS.t3 }}>{label}</span>
      <span style={{ fontSize: "17px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      <span style={{ fontSize: "11px", color: TOKENS.t2 }}>{sub}</span>
    </div>
  );
}

function figures(r: AutopilotReport, l: AutopilotLabels) {
  const cost = r.costUsd === null ? "—" : `${autopilotUsd(r.costUsd)}${r.costComplete ? "" : "+"}`;
  const costSub =
    r.costDeltaUsd !== null
      ? l.costDelta(autopilotUsd(r.costDeltaUsd))
      : r.costComplete
        ? ""
        : l.costPartial;
  return [
    { label: l.elapsed, value: l.duration(r.elapsedMs), sub: l.since(autopilotTime(r.startedAt)) },
    { label: l.cost, value: cost, sub: costSub },
    { label: l.iteration, value: String(r.iteration), sub: l.rung(r.rung) },
    {
      label: l.rejections,
      value: String(r.rejections.total),
      sub:
        r.rejections.last === null
          ? l.noRejections
          : l.lastRejection(l.sources[r.rejections.last.source], r.rejections.last.blocking),
    },
  ];
}

function EventRow({ e }: { e: AutopilotEvent }) {
  return (
    <div data-testid="autopilot-event" style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span style={{ ...monoMeta, width: 38, flexShrink: 0 }}>{autopilotTime(e.at)}</span>
      <span style={{ color: TOKENS.t2, minWidth: 0, overflowWrap: "anywhere" }}>{e.text}</span>
    </div>
  );
}

function Omitted({ count }: { count: number }) {
  return count > 0 ? <span style={{ ...monoMeta, paddingLeft: 48 }}>… +{count}</span> : null;
}

function Events({
  r,
  earlier,
  earlierOmitted,
  l,
}: {
  r: AutopilotReport;
  earlier: AutopilotEvent[];
  earlierOmitted: number;
  l: AutopilotLabels;
}) {
  const [open, setOpen] = useState(false);
  const earlierCount = earlier.length + earlierOmitted;
  const unfolded = open && earlierCount > 0;
  return (
    <div
      data-testid="autopilot-events"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <span style={microlabelStyle}>{unfolded ? l.historyTitle : l.eventsTitle}</span>
        {earlierCount > 0 ? (
          <button
            type="button"
            data-testid="autopilot-history-toggle"
            aria-expanded={unfolded}
            onClick={() => setOpen((v) => !v)}
            style={{
              padding: "2px 0",
              border: 0,
              background: "none",
              font: "inherit",
              fontSize: "11px",
              color: TOKENS.act,
              cursor: "pointer",
            }}
          >
            {unfolded ? l.historyHide : l.historyShow(earlierCount)}
          </button>
        ) : null}
      </div>
      {unfolded ? (
        <>
          <Omitted count={earlierOmitted} />
          {earlier.map((e, i) => (
            <EventRow key={`earlier-${e.at}-${i}`} e={e} />
          ))}
          <div
            data-testid="autopilot-history-divider"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "2px 0",
              fontSize: "11px",
              color: TOKENS.t3,
            }}
          >
            <span aria-hidden="true" style={{ flex: 1, height: 0.5, background: TOKENS.bd }} />
            {l.historyDivider}
            <span aria-hidden="true" style={{ flex: 1, height: 0.5, background: TOKENS.bd }} />
          </div>
        </>
      ) : null}
      {r.events.length === 0 ? (
        <>
          <span style={{ color: TOKENS.t3 }}>{l.noEvents}</span>
          {r.active.length > 0 ? (
            <span data-testid="autopilot-active" style={{ color: TOKENS.t2 }}>
              {l.working}:{" "}
              {r.active.map((a) => `${a.role} (${a.name}), ${l.duration(a.runningMs)}`).join("; ")}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <Omitted count={r.omittedEvents} />
          {r.events.map((e, i) => (
            <EventRow key={`${e.at}-${i}`} e={e} />
          ))}
        </>
      )}
    </div>
  );
}

function SessionFooter({ r, l }: { r: AutopilotReport; l: AutopilotLabels }) {
  const s = r.session;
  if (s === null) return null;
  const context =
    s.contextTokens === null ? null : autopilotContext(s.contextTokens, s.contextWindow);
  const strong: CSSProperties = { color: TOKENS.t2, fontWeight: 600 };
  return (
    <footer
      data-testid="autopilot-footer"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px 16px",
        paddingTop: 12,
        borderTop: `0.5px solid ${TOKENS.bd}`,
        fontSize: "11px",
        color: TOKENS.t3,
      }}
    >
      <span style={strong}>{l.roles[s.role] ?? s.role}</span>
      <span style={strong}>{autopilotModel(s.model)}</span>
      <span>
        {l.effort} <span style={strong}>{s.effort}</span>
      </span>
      {context ? (
        <span
          data-testid="autopilot-context"
          style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}
        >
          {l.context}
          {context.percent !== null ? (
            <span
              aria-hidden="true"
              style={{
                display: "block",
                width: 72,
                height: 4,
                borderRadius: 2,
                background: TOKENS.srf2,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${context.percent}%`,
                  height: "100%",
                  background: context.percent >= CONTEXT_WARN ? TOKENS.amb : TOKENS.ac,
                }}
              />
            </span>
          ) : null}
          <span style={{ fontFamily: MV_FONT_MONO, color: TOKENS.t2 }}>{context.text}</span>
        </span>
      ) : null}
    </footer>
  );
}

/** Saves a PNG through the host: what the copy button falls back to when the clipboard refuses. */
export type SaveImage = (png: Blob, fileName: string) => Promise<boolean>;

function CopyButton({
  target,
  l,
  save,
  fileName,
}: {
  target: { current: HTMLElement | null };
  l: AutopilotLabels;
  save?: SaveImage;
  fileName: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "saved" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  const label =
    state === "copied"
      ? l.copied
      : state === "saved"
        ? l.saved
        : state === "failed"
          ? l.copyFailed
          : l.copyImage;
  return (
    <button
      type="button"
      data-testid="autopilot-copy"
      data-copy-exclude=""
      data-state={state}
      aria-label={label}
      title={label}
      onClick={() => {
        const node = target.current;
        if (!node) return;
        copyElementAsImage(node, save && ((png) => save(png, fileName))).then(
          (done) => setState(done),
          () => setState("failed"),
        );
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        padding: 0,
        border: `0.5px solid ${TOKENS.bd}`,
        borderRadius: 6,
        background: TOKENS.srf,
        color: state === "failed" ? TOKENS.red : state === "idle" ? TOKENS.t2 : TOKENS.grn,
        cursor: "pointer",
      }}
    >
      <svg
        aria-hidden="true"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {state === "copied" || state === "saved" ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : (
          <>
            <rect x="8" y="8" width="13" height="13" rx="2" />
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
            <circle cx="12.5" cy="12.5" r="1.3" />
            <path d="M21 17l-3.5-3.5L11 20" />
          </>
        )}
      </svg>
    </button>
  );
}

export interface AutopilotStatusViewProps {
  data: AutopilotReportPayload | null;
  connecting?: boolean;
  error?: string | null;
  /** Story/test pin; production follows the host's theme. */
  theme?: MvTheme;
  /** The host's file download, when it offers one: used when the clipboard is refused. */
  saveImage?: SaveImage;
}

export function AutopilotStatusView({
  data,
  connecting,
  error,
  theme,
  saveImage,
}: AutopilotStatusViewProps) {
  const card = useRef<HTMLElement | null>(null);
  if (error) {
    return (
      <MvRoot theme={theme}>
        <div data-testid="autopilot-error" style={{ ...frameStyle, color: TOKENS.red }}>
          Couldn’t load the autopilot report: {error}
        </div>
      </MvRoot>
    );
  }
  if (!data) {
    return (
      <MvRoot theme={theme}>
        <div data-testid="autopilot-connecting" style={{ ...frameStyle, color: TOKENS.t2 }}>
          {connecting === false ? "No autopilot report." : "Connecting…"}
        </div>
      </MvRoot>
    );
  }

  const r = data.report;
  const l = autopilotLabels(r.lang);
  const pill = PILL[r.state];
  const callout = r.callout;
  const calloutTone = callout?.kind === "halt" ? PILL.halted : PILL.waiting;

  return (
    <MvRoot theme={theme}>
      <section ref={card} data-testid="autopilot-card" data-state={r.state} style={frameStyle}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
            <span style={monoMeta}>
              marvin · {r.runId} · {l.report(r.n)}
            </span>
            {r.sessionName ? (
              <h2
                data-testid="autopilot-session"
                title={r.sessionName}
                style={{
                  margin: 0,
                  fontSize: "15px",
                  fontWeight: 600,
                  lineHeight: 1.35,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                  overflowWrap: "anywhere",
                }}
              >
                {r.sessionName}
              </h2>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span
              data-testid="autopilot-pill"
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: 999,
                background: pill.bg,
                color: pill.fg,
              }}
            >
              {l.state[r.state]}
            </span>
            <CopyButton
              target={card}
              l={l}
              save={saveImage}
              fileName={`marvin-${r.runId}-${r.n}.png`}
            />
          </div>
        </header>

        <Rail steps={r.rail} l={l} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 8,
          }}
        >
          {figures(r, l).map((f) => (
            <Figure key={f.label} {...f} />
          ))}
        </div>

        {callout ? (
          <div
            data-testid="autopilot-callout"
            data-kind={callout.kind}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "10px 12px",
              borderRadius: 8,
              background: calloutTone.bg,
              color: calloutTone.fg,
            }}
          >
            <strong style={{ fontWeight: 600 }}>{l.calloutTitle[callout.kind]}</strong>
            <span>{callout.text}</span>
          </div>
        ) : null}

        <Events
          r={r}
          earlier={data.earlier ?? []}
          earlierOmitted={data.earlierOmitted ?? 0}
          l={l}
        />

        <SessionFooter r={r} l={l} />
      </section>
    </MvRoot>
  );
}

/** The transport seam, as in the sibling widgets: tests inject an App and transport. */
export interface AutopilotStatusSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface AutopilotStatusWidgetProps {
  seam?: AutopilotStatusSeam;
}

/** The host's `ui/download-file` as a {@link SaveImage}, or undefined when the host lacks it. */
function hostSave(app: App | null, connected: boolean): SaveImage | undefined {
  if (!app || !connected || !app.getHostCapabilities()?.downloadFile) return undefined;
  return async (png, fileName) => {
    const result = await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri: `file:///${fileName}`,
            mimeType: "image/png",
            blob: await blobBase64(png),
          },
        },
      ],
    });
    return result.isError !== true;
  };
}

export function AutopilotStatusWidget({ seam }: AutopilotStatusWidgetProps) {
  return seam ? <AutopilotStatusSeamWidget seam={seam} /> : <AutopilotStatusLiveWidget />;
}

function AutopilotStatusLiveWidget() {
  const [data, setData] = useState<AutopilotReportPayload | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-autopilot-status", version: "0.34.0" },
    capabilities: {},
    onAppCreated: (created) => {
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as AutopilotReportPayload);
        }
      };
    },
  });
  const theme = useHostTheme(app, isConnected);
  return (
    <AutopilotStatusView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      theme={theme}
      saveImage={hostSave(app, isConnected)}
    />
  );
}

function AutopilotStatusSeamWidget({ seam }: { seam: AutopilotStatusSeam }) {
  const [data, setData] = useState<AutopilotReportPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as AutopilotReportPayload);
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

  const theme = useHostTheme(seam.app, connected);
  return (
    <AutopilotStatusView
      data={data}
      connecting={!connected}
      error={error}
      theme={theme}
      saveImage={hostSave(seam.app, connected)}
    />
  );
}
