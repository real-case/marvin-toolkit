import { type CSSProperties, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  AutopilotRailStep,
  AutopilotReport,
  AutopilotReportPayload,
  AutopilotState,
} from "@marvin-toolkit/mcp-shared/contracts";
import {
  autopilotLabels,
  autopilotTime,
  autopilotUsd,
  type AutopilotLabels,
} from "@marvin-toolkit/mcp-shared/autopilot-labels";
import { useHostTheme } from "../../lib/host-theme";
import { MvRoot, MV_FONT_MONO, TOKENS, type MvTheme } from "../../theme";

/**
 * The autopilot-status widget (ADR-0051) — one periodic report of an autopilot run as a card:
 * header with the status pill, the seven-stage rail, four figures (elapsed, cost, iteration,
 * rejections), a callout when the run needs an answer or has stopped, the interval's events, and
 * the footer with the next report's deadline. The approved layout is variant A of the design
 * canvas; the labels come from `autopilotLabels(report.lang)`, the same table the tool's
 * Markdown fallback uses, so the card and the text word one report alike.
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

function Rail({ steps, l }: { steps: AutopilotRailStep[]; l: AutopilotLabels }) {
  return (
    <div
      data-testid="autopilot-rail"
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 5,
          left: "7%",
          right: "7%",
          height: 2,
          background: TOKENS.bd,
        }}
      />
      {steps.map((s) => {
        const dot = DOT[s.state];
        const strong = s.state !== "done" && s.state !== "pending";
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
                overflowWrap: "anywhere",
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

export interface AutopilotStatusViewProps {
  data: AutopilotReportPayload | null;
  connecting?: boolean;
  error?: string | null;
  /** Story/test pin; production follows the host's theme. */
  theme?: MvTheme;
}

export function AutopilotStatusView({ data, connecting, error, theme }: AutopilotStatusViewProps) {
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
      <section data-testid="autopilot-card" data-state={r.state} style={frameStyle}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={monoMeta}>
              autopilot · {r.runId} · {l.report(r.n)}
            </span>
            <h2
              data-testid="autopilot-task"
              style={{ margin: 0, fontSize: "15px", fontWeight: 600, lineHeight: 1.35 }}
            >
              {r.task}
            </h2>
          </div>
          <span
            data-testid="autopilot-pill"
            style={{
              flexShrink: 0,
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

        <div
          data-testid="autopilot-events"
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          <span style={microlabelStyle}>{l.eventsTitle}</span>
          {r.events.length === 0 ? (
            <>
              <span style={{ color: TOKENS.t3 }}>{l.noEvents}</span>
              {r.active.length > 0 ? (
                <span data-testid="autopilot-active" style={{ color: TOKENS.t2 }}>
                  {l.working}:{" "}
                  {r.active
                    .map((a) => `${a.role} (${a.name}), ${l.duration(a.runningMs)}`)
                    .join("; ")}
                </span>
              ) : null}
            </>
          ) : (
            <>
              {r.omittedEvents > 0 ? (
                <span style={{ ...monoMeta, paddingLeft: 48 }}>… +{r.omittedEvents}</span>
              ) : null}
              {r.events.map((e, i) => (
                <div
                  key={`${e.at}-${i}`}
                  data-testid="autopilot-event"
                  style={{ display: "flex", gap: 10, alignItems: "baseline" }}
                >
                  <span style={{ ...monoMeta, width: 38, flexShrink: 0 }}>
                    {autopilotTime(e.at)}
                  </span>
                  <span style={{ color: TOKENS.t2, minWidth: 0, overflowWrap: "anywhere" }}>
                    {e.text}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <footer
          data-testid="autopilot-footer"
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            paddingTop: 12,
            borderTop: `0.5px solid ${TOKENS.bd}`,
            fontSize: "11px",
            color: TOKENS.t3,
          }}
        >
          <span>{r.final ? l.final : l.report(r.n)}</span>
          {r.final && r.prUrl ? (
            <span style={{ ...monoMeta, overflowWrap: "anywhere" }}>{r.prUrl}</span>
          ) : r.nextBy ? (
            <span style={monoMeta}>{l.nextBy(autopilotTime(r.nextBy))}</span>
          ) : null}
        </footer>
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
  return <AutopilotStatusView data={data} connecting={!connected} error={error} theme={theme} />;
}
