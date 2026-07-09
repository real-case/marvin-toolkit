import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { HelpState } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * The help widget (ADR-0024) — marvin's welcome **panel** over the `HelpState`
 * the `help` tool returns: a gradient wordmark, the per-project summary
 * (project · git · kanban · artifacts), the configured MCP servers lit/dim by
 * enabled state, the command-group table of contents, and the full per-command
 * reference. Like the dashboard/task-summary widgets it is a single-object panel,
 * not a `<ListDetail>`.
 *
 * Split into a pure {@link HelpView} (props-only, no SDK) and the App wiring
 * below — the same shape as the sibling widgets — so the render is unit-testable
 * without a transport and one view serves production (`useApp`), the tests, and
 * the story.
 *
 * Theming: surface and text come from the host theme variables (with literal
 * fallbacks) so the panel blends into a light OR dark host, exactly like the
 * sibling widgets. The one brand constant is marvin's violet — the wordmark
 * gradient and the accent on command names / lit server dots — chosen to read on
 * both grounds. The terminal door (the `help` tool's markdown) is the fallback
 * a text-only host renders instead.
 */

// ── brand + host-theme palette ───────────────────────────────────────────────
const ACCENT = "#8b5cf6"; // marvin violet — legible on light and dark grounds
const GRADIENT = "linear-gradient(100deg, #a78bfa, #7c3aed)";
const textPrimary = "var(--color-text-primary, #1a1a1a)";
const textMuted = "var(--color-text-secondary, #6b6b78)";
const borderColor = "var(--color-border-primary, #e2e2e2)";
const mono = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)";

const panelStyle: CSSProperties = {
  fontFamily: mono,
  color: textPrimary,
  fontSize: "13px",
  lineHeight: 1.5,
  maxWidth: "760px",
};

const wordmarkStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(38px, 8vw, 64px)",
  fontWeight: 800,
  letterSpacing: "-0.04em",
  lineHeight: 0.95,
  width: "max-content",
  maxWidth: "100%",
  backgroundImage: GRADIENT,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextFillColor: "transparent",
};

const eyebrowStyle: CSSProperties = {
  margin: "0 0 0.6rem",
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: textMuted,
};

const sectionStyle: CSSProperties = { margin: "0 0 1.4rem" };
const accentStyle: CSSProperties = { color: ACCENT };
const mutedStyle: CSSProperties = { color: textMuted };

/** A titled section: an uppercase eyebrow over its content. */
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
    <section data-testid={testid} style={sectionStyle}>
      <p style={eyebrowStyle}>{title}</p>
      {children}
    </section>
  );
}

/** A `key → value` summary row: a fixed accent key column and a value. */
function SummaryRow({
  label,
  testid,
  children,
}: {
  label: string;
  testid?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testid} style={{ display: "flex", gap: "1.1rem", padding: "0.15rem 0" }}>
      <span style={{ ...accentStyle, flex: "0 0 5.5rem" }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** A `label count` stat with the count emphasised only when non-zero. */
function Stat({ label, count }: { label: string; count: number }) {
  return (
    <span>
      <span style={mutedStyle}>{label}</span>{" "}
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: count > 0 ? textPrimary : textMuted,
          fontWeight: count > 0 ? 600 : 400,
        }}
      >
        {count}
      </span>
    </span>
  );
}

/** A `·`-separated run of stats. */
function StatRow({ children }: { children: ReactNode[] }) {
  return (
    <span>
      {children.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span style={{ ...mutedStyle, margin: "0 0.45rem" }}>·</span> : null}
          {c}
        </span>
      ))}
    </span>
  );
}

/** The 👤 human-run marker (the `disable-model-invocation` lifecycle commands). */
function HumanMark() {
  return (
    <svg
      data-testid="human-mark"
      viewBox="0 0 16 16"
      width="11"
      height="11"
      aria-label="human-run only"
      style={{ flex: "0 0 auto", fill: textMuted, opacity: 0.8 }}
    >
      <circle cx="8" cy="5" r="3" />
      <path d="M8 9c-3.4 0-6 2.3-6 5.2V15h12v-.8C14 11.3 11.4 9 8 9z" />
    </svg>
  );
}

export interface HelpViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: HelpState | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
}

/**
 * Pure presentational help panel. Renders the one `HelpState` top-to-bottom;
 * carries no SDK dependency, so it is driven purely by props in tests, the story,
 * and both wiring paths. Stateless — there is no selection to own.
 */
export function HelpView({ data, connecting, error }: HelpViewProps) {
  if (error) {
    return (
      <div
        data-testid="help-error"
        style={{ padding: "1rem", color: "var(--color-text-danger, #b00)" }}
      >
        Couldn’t load the dashboard: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div data-testid="help-connecting" style={{ padding: "1rem", opacity: 0.7 }}>
        {connecting === false ? "No help data." : "Connecting…"}
      </div>
    );
  }

  return (
    <div data-testid="help-panel" style={panelStyle}>
      {/* Banner */}
      <h1 data-testid="help-wordmark" style={wordmarkStyle}>
        &gt;_MARVIN
      </h1>
      <p style={{ margin: "0.9rem 0 0.2rem", color: textPrimary }}>{data.slogan}</p>
      <p data-testid="help-version" style={{ ...mutedStyle, margin: 0 }}>
        v{data.version}
      </p>
      <hr style={{ border: 0, borderTop: `1px solid ${borderColor}`, margin: "1.1rem 0 1.3rem" }} />

      {/* Summary */}
      <Section title="Summary" testid="help-summary">
        <SummaryRow label="project" testid="help-project">
          {data.project}
        </SummaryRow>
        <SummaryRow label="git" testid="help-git">
          {data.git.branch ? (
            <span>
              {data.git.branch}
              <span style={mutedStyle}> · base </span>
              {data.git.base_branch}
            </span>
          ) : (
            <span style={mutedStyle}>not in a git repo</span>
          )}
        </SummaryRow>
        <SummaryRow label="kanban" testid="help-kanban">
          {data.statuses.length > 0 ? (
            <StatRow>
              {data.statuses.map((s) => (
                <Stat key={s.key} label={s.key} count={s.count} />
              ))}
            </StatRow>
          ) : (
            <span style={mutedStyle}>no statuses configured</span>
          )}
        </SummaryRow>
        <SummaryRow label="artifacts" testid="help-artifacts">
          <StatRow>
            <Stat label="specs" count={data.artifacts.specs} />
            <Stat label="handoffs" count={data.artifacts.handoffs} />
            <Stat label="audits" count={data.artifacts.audits} />
            <Stat label="lessons" count={data.artifacts.lessons} />
          </StatRow>
        </SummaryRow>
      </Section>

      {/* MCP servers */}
      <Section title="MCP servers" testid="help-servers">
        {data.servers.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: "0.4rem 1rem",
            }}
          >
            {data.servers.map((s) => (
              <span
                key={s.name}
                data-testid="help-server"
                data-server={s.name}
                data-enabled={s.enabled}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  minWidth: 0,
                  opacity: s.enabled ? 1 : 0.5,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    flex: "0 0 auto",
                    background: s.enabled ? ACCENT : textMuted,
                  }}
                />
                <span
                  style={{
                    color: s.enabled ? textPrimary : textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p style={{ ...mutedStyle, fontStyle: "italic", margin: 0 }}>
            none configured for this project
          </p>
        )}
      </Section>

      {/* Command groups */}
      <Section title="Command groups" testid="help-groups">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            rowGap: "0.3rem",
            columnGap: "1rem",
          }}
        >
          {data.groups.map((g) => (
            <ReferenceRow key={g.group} name={g.group} desc={g.blurb} />
          ))}
        </div>
      </Section>

      {/* Per-group command reference */}
      {data.groups.map((g) => {
        const cmds = data.commands.filter((c) => c.group === g.group);
        if (cmds.length === 0) return null;
        return (
          <Section key={g.group} title={g.group} testid={`help-ref-${g.group}`}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(9rem, max-content) 1fr",
                rowGap: "0.3rem",
                columnGap: "1rem",
              }}
            >
              {cmds.map((c) => (
                <ReferenceRow
                  key={c.name}
                  name={c.name}
                  desc={c.blurb}
                  human={c.human}
                  testid="help-command"
                />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

/** One `name — description` reference row; the name is the accent column. */
function ReferenceRow({
  name,
  desc,
  human,
  testid,
}: {
  name: string;
  desc: string;
  human?: boolean;
  testid?: string;
}) {
  return (
    <>
      <span
        data-testid={testid}
        data-command={testid ? name : undefined}
        style={{
          ...accentStyle,
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          minWidth: 0,
        }}
      >
        {name}
        {human ? <HumanMark /> : null}
      </span>
      <span style={mutedStyle}>{desc}</span>
    </>
  );
}

/**
 * The transport seam (mirrors dashboard/task-summary). `useApp` hard-wires a
 * `PostMessageTransport` to `window.parent`, which is `=== window` under happy-dom
 * (no iframe nesting), so the automated test injects an `App` + in-memory
 * transport instead. Production omits `seam` and takes the live path.
 */
export interface HelpSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface HelpWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: HelpSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount (tests always inject, production never
 * does), so this wrapper calls no hooks itself and each child owns its hook order.
 */
export function HelpWidget({ seam }: HelpWidgetProps) {
  return seam ? <HelpSeamWidget seam={seam} /> : <HelpLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function HelpLiveWidget() {
  const [data, setData] = useState<HelpState | null>(null);
  const { isConnected, error } = useApp({
    appInfo: { name: "marvin-help", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (created) => {
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as HelpState);
        }
      };
    },
  });
  return <HelpView data={data} connecting={!isConnected} error={error ? error.message : null} />;
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function HelpSeamWidget({ seam }: { seam: HelpSeam }) {
  const [data, setData] = useState<HelpState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as HelpState);
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

  return <HelpView data={data} connecting={!connected} error={error} />;
}
