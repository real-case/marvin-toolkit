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
 * `TaskSummary` is fully structured (no `body_markdown`), so `<Markdown>` renders only
 * the inline free-text AC `statement`; the machine-generated commit `subject` and gate
 * `detail` are escaped plain-text nodes (identical no-injection guarantee, but no
 * block-level `<p>` to break their inline row).
 */

type Outcome = AcOutcome["outcome"]; // "pass" | "fail" | "unknown"
type GateStatus = GateOutcome["status"]; // "pass" | "fail" | "skip"

// Badge palettes: host CSS variables where the contract defines one, with a literal
// fallback so the chip reads in either host theme (the pattern the audit widget uses).
// `unknown` (AC) and `skip` (gate) share the neutral secondary palette — the
// conservative model requires "unknown" to read as neutral, never as a failure.
const NEUTRAL: CSSProperties = {
  background: "var(--color-background-secondary, #f0f0f0)",
  color: "var(--color-text-secondary, #555)",
};
const OUTCOME_COLOR: Record<Outcome, CSSProperties> = {
  pass: {
    background: "var(--color-background-success, #e6f4ea)",
    color: "var(--color-text-success, #137333)",
  },
  fail: {
    background: "var(--color-background-danger, #fdecea)",
    color: "var(--color-text-danger, #b00020)",
  },
  unknown: NEUTRAL,
};
const GATE_COLOR: Record<GateStatus, CSSProperties> = {
  pass: OUTCOME_COLOR.pass,
  fail: OUTCOME_COLOR.fail,
  skip: NEUTRAL,
};

function badgeStyle(colors: CSSProperties): CSSProperties {
  return {
    display: "inline-block",
    padding: "0.05rem 0.4rem",
    borderRadius: "var(--border-radius-sm, 4px)",
    fontSize: "0.75em",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    ...colors,
  };
}

/** The widget frame — the whole widget as one rounded card on the host canvas. */
const frameStyle: CSSProperties = {
  border: "1px solid var(--color-border-primary, #e2e2e2)",
  borderRadius: "var(--border-radius-md, 8px)",
  // 0.75rem matches the dashboard and audit frames, so the whole widget family
  // keeps content off its border by the same inset. The full-width section
  // dividers inset with it rather than butting the frame edge.
  padding: "0.75rem",
};

const linkButtonStyle: CSSProperties = {
  font: "inherit",
  border: "1px solid var(--color-border-primary, #d0d0d0)",
  borderRadius: "var(--border-radius-sm, 4px)",
  background: "transparent",
  color: "var(--color-text-info, #0b57d0)",
  padding: "0.2rem 0.5rem",
};

const sectionHeadingStyle: CSSProperties = {
  margin: "0 0 0.35rem",
  fontSize: "0.8rem",
  opacity: 0.6,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const mutedStyle: CSSProperties = { opacity: 0.6, fontSize: "0.85em" };
const emptyNoteStyle: CSSProperties = { ...mutedStyle, fontStyle: "italic" };

/** A titled panel section with a consistent heading + top divider. */
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
      style={{
        marginTop: "0.9rem",
        paddingTop: "0.6rem",
        borderTop: "1px solid var(--color-border-primary, #e2e2e2)",
      }}
    >
      <h3 style={sectionHeadingStyle}>{title}</h3>
      {children}
    </section>
  );
}

/** One acceptance criterion: an id · outcome-badge header row, then the statement
 * (Markdown) and oracle stacked full-width beneath it — no badge gutter, so the
 * statement runs the whole panel width rather than being indented past the badge. */
function AcRow({ ac }: { ac: AcOutcome }) {
  return (
    <li data-testid="ac-row" data-outcome={ac.outcome} style={{ padding: "0.3rem 0" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
        <strong>{ac.id}</strong>
        <span style={badgeStyle(OUTCOME_COLOR[ac.outcome])}>{ac.outcome}</span>
      </div>
      <div data-testid="ac-statement">
        <Markdown source={ac.statement} />
      </div>
      {/* A blank line before the oracle sets it apart as the proof reference, not
          a continuation of the statement. */}
      <div style={{ ...mutedStyle, marginTop: "0.5rem" }}>
        {ac.oracle_kind}
        {ac.oracle_ref ? ` · ${ac.oracle_ref}` : ""}
      </div>
    </li>
  );
}

/** One verification gate: name · status badge · optional detail. Leads with the
 * gate name (bold), then the status badge — the same identity-first header treatment
 * as {@link AcRow}, so acceptance and gates read as one pattern. Gates are single-line
 * (no body), so the detail trails inline rather than dropping to its own row. */
function GateRow({ gate }: { gate: GateOutcome }) {
  return (
    <li
      data-testid="gate-row"
      data-status={gate.status}
      style={{ display: "flex", gap: "0.5rem", padding: "0.2rem 0", alignItems: "baseline" }}
    >
      <strong>{gate.name}</strong>
      <span style={badgeStyle(GATE_COLOR[gate.status])}>{gate.status}</span>
      {gate.detail ? <span style={mutedStyle}>({gate.detail})</span> : null}
    </li>
  );
}

/** One commit: monospace sha + plain (escaped) subject on a single inline row. */
function CommitRow({ commit }: { commit: CommitRef }) {
  return (
    <li
      data-testid="commit-row"
      style={{ display: "flex", gap: "0.5rem", padding: "0.15rem 0", alignItems: "baseline" }}
    >
      <code style={{ opacity: 0.8 }}>{commit.sha}</code>
      <span style={{ flex: 1, minWidth: 0 }}>{commit.subject}</span>
    </li>
  );
}

/** One captured lesson: title + muted id. */
function LessonRow({ lesson }: { lesson: LessonRef }) {
  return (
    <li data-testid="lesson-row" style={{ padding: "0.15rem 0" }}>
      {lesson.title} <span style={mutedStyle}>({lesson.id})</span>
    </li>
  );
}

/** One link button (3-type model): external links get the ↗ affordance and dispatch
 * through the host; ref-only links render without it (classifyLink → internal). */
function LinkButton({ link, onOpenLink }: { link: LinkRef; onOpenLink?: (link: LinkRef) => void }) {
  const external = classifyLink(link).type === "external";
  return (
    <button
      type="button"
      data-testid="summary-link"
      data-kind={link.kind}
      data-external={external ? "true" : "false"}
      onClick={() => onOpenLink?.(link)}
      style={{ ...linkButtonStyle, cursor: onOpenLink ? "pointer" : "default" }}
    >
      {external ? "↗ " : ""}
      {link.label}
    </button>
  );
}

/** The header roll-up: acceptance pass-count and the gate pass/fail tally. */
function rollup(summary: TaskSummary): string {
  const acPassed = summary.acceptance.filter((a) => a.outcome === "pass").length;
  const gatePass = summary.gates.filter((g) => g.status === "pass").length;
  const gateFail = summary.gates.filter((g) => g.status === "fail").length;
  const parts: string[] = [];
  if (summary.acceptance.length > 0) {
    parts.push(`${acPassed}/${summary.acceptance.length} acceptance passed`);
  }
  if (summary.gates.length > 0) {
    parts.push(
      `${gatePass} gate${gatePass === 1 ? "" : "s"} passed${gateFail ? `, ${gateFail} failed` : ""}`,
    );
  }
  return parts.join(" · ");
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
}

/**
 * Pure presentational task-summary. Renders the one `TaskSummary` as a panel of
 * sections; carries no SDK dependency, so it is driven purely by props in tests, the
 * story, and both wiring paths. Stateless — there is no list selection to own.
 */
export function TaskSummaryView({ data, connecting, error, onOpenLink }: TaskSummaryViewProps) {
  if (error) {
    return (
      <div
        data-testid="summary-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00020)" }}
      >
        Couldn’t load task summary: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="summary-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No task summary." : "Connecting…"}
      </div>
    );
  }

  return (
    <div
      data-testid="summary-panel"
      style={{
        // fontFamily, not the `font` shorthand: the shorthand requires a size, so
        // a family-only `font:` is invalid CSS — the declaration is dropped and
        // the widget renders in the host default serif.
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--color-text-primary, #1a1a1a)",
        ...frameStyle,
      }}
    >
      <header
        data-testid="summary-header"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.5rem 0.75rem" }}
      >
        <strong style={{ fontSize: "1.1rem" }}>{data.title}</strong>
        <span style={badgeStyle(NEUTRAL)}>{data.status}</span>
        <span data-testid="summary-rollup" style={mutedStyle}>
          {rollup(data)}
        </span>
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
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.gates.map((gate) => (
              <GateRow key={gate.name} gate={gate} />
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
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
    appInfo: { name: "marvin-task-summary", version: "0.21.0" },
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
