import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { HelpState } from "@marvin-toolkit/mcp-shared/contracts";
import { MV_FONT_MONO, MvRoot, SEVERITY_TOKENS, TOKENS, type MvTheme } from "../../theme";

/**
 * The help widget (ADR-0024) — marvin's welcome **panel** over the `HelpState`
 * the `help` tool returns: a gradient wordmark, the per-project summary cards
 * (project · git · board · artifacts), the configured MCP servers as status
 * pills, the command-group table of contents, and the full per-command
 * reference. Like the dashboard/task-summary widgets it is a single-object
 * panel, not a `<ListDetail>`.
 *
 * Split into a pure {@link HelpView} (props-only, no SDK) and the App wiring
 * below — the same shape as the sibling widgets — so the render is unit-testable
 * without a transport and one view serves production (`useApp`), the tests, and
 * the story.
 *
 * Theming (docs/design/reports-widget.md): the view renders under its own
 * `<MvRoot>` — both wiring paths get the token scope for free — and paints the
 * family canvas itself (`--bg` ground, 0.5px `--bd` frame, radius 4). Every
 * color is a `var(--…)` token reference, so the panel follows the OS scheme
 * (or a host/story-forced `data-theme`). The one sanctioned exception is the
 * brand wordmark gradient below. The terminal door (the `help` tool's
 * markdown) is the fallback a text-only host renders instead.
 */

// ── the sanctioned brand flourish ────────────────────────────────────────────
// The MARVIN wordmark keeps its literal violet gradient stops — the one place
// in the restyled family allowed to carry hex outside the theme module: the
// gradient is clipped through the glyphs (no text-grade token can express it)
// and the brand mark must read identically on both themes. Everything else on
// the panel resolves from `.mvroot` tokens.
const WORDMARK_VIOLET_FROM = "#a78bfa";
const WORDMARK_VIOLET_TO = "#7c3aed";
const WORDMARK_GRADIENT = `linear-gradient(100deg, ${WORDMARK_VIOLET_FROM}, ${WORDMARK_VIOLET_TO})`;

// ── family recipes (inline over tokens) ──────────────────────────────────────

// The widget canvas: the whole panel as one framed card on the host surface.
// Shared by the overview, the group-detail view, and the connection states, so
// every screen of the widget sits inside the same frame.
const panelStyle: CSSProperties = {
  maxWidth: "760px",
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  padding: "14px",
};

const wordmarkStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(38px, 8vw, 64px)",
  fontWeight: 800,
  letterSpacing: "-0.04em",
  lineHeight: 0.95,
  width: "max-content",
  maxWidth: "100%",
  backgroundImage: WORDMARK_GRADIENT,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextFillColor: "transparent",
};

/** Microlabel — section headings, card labels, the "Direct / In prose" gutter. */
const microlabelStyle: CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

/** Status/neutral pill base — lowercase 11.5px/500 tag, radius 4. */
const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "1px 9px",
  borderRadius: "4px",
  fontSize: "11.5px",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

/** The 5px currentColor dot inside a status pill. */
const pillDotStyle: CSSProperties = {
  width: "5px",
  height: "5px",
  borderRadius: "50%",
  background: "currentColor",
  flex: "none",
};

/** Mono code chip — command names, direct calls: 11px mono on the second surface. */
const codeChipStyle: CSSProperties = {
  fontFamily: MV_FONT_MONO,
  fontSize: "11px",
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

/** Card — summary cells: first surface, hairline border, radius 4. */
const cardStyle: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: "4px",
  padding: "12px 14px",
  minWidth: 0,
};

const sectionStyle: CSSProperties = { margin: "0 0 18px" };
const t2Style: CSSProperties = { color: TOKENS.t2 };
const t3Style: CSSProperties = { color: TOKENS.t3 };

// A shared key→value axis so the reference sections — the command-groups list,
// the per-command reference, and the section headers' "Read more" — line their
// right column up on the same vertical. 9rem clears the widest key (the longest
// command chip), so no key overflows into the value.
const KEY_COL = "9rem";
const KEY_GAP = "1rem";

/**
 * A titled section: a microlabel heading over its content. When an `action` is
 * given (the per-group reference sections' "Read more" link), the header becomes
 * a two-column grid matching the reference body grid, so the action sits above
 * the right (description) column instead of beside the title.
 */
function Section({
  title,
  testid,
  action,
  children,
}: {
  title: string;
  testid: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-testid={testid} style={sectionStyle}>
      {action ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${KEY_COL} 1fr`,
            alignItems: "center",
            columnGap: KEY_GAP,
            margin: "0 0 8px",
          }}
        >
          <p style={{ ...microlabelStyle, margin: 0 }}>{title}</p>
          <span style={{ justifySelf: "start" }}>{action}</span>
        </div>
      ) : (
        <p style={{ ...microlabelStyle, margin: "0 0 8px" }}>{title}</p>
      )}
      {children}
    </section>
  );
}

/**
 * The "Read more" affordance to the right of a group heading. A plain accent
 * text link, NOT a `<button>` — a button inherits UA chrome that fights the
 * text-link look. Rendered as a `role="link"` span with keyboard support;
 * underlines on hover/focus (own local state — pseudo-classes cannot live
 * inline, and the widget carries no stylesheet of its own).
 */
function MoreLink({ group, onOpen }: { group: string; onOpen: () => void }) {
  const [active, setActive] = useState(false);
  return (
    <span
      role="link"
      tabIndex={0}
      data-testid="help-more"
      data-group={group}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        cursor: "pointer",
        color: TOKENS.ac,
        fontSize: "12px",
        textDecoration: active ? "underline" : "none",
      }}
    >
      Read more
    </span>
  );
}

/** One summary card: a microlabel over the cell content (card recipe). */
function SummaryCard({
  label,
  testid,
  children,
}: {
  label: string;
  testid?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testid} style={cardStyle}>
      <div style={microlabelStyle}>{label}</div>
      <div style={{ marginTop: "4px" }}>{children}</div>
    </div>
  );
}

/** A `label count` stat with the count emphasised only when non-zero. */
function Stat({ label, count }: { label: string; count: number }) {
  return (
    <span style={{ whiteSpace: "nowrap", fontSize: "12px" }}>
      <span style={t3Style}>{label}</span>{" "}
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: count > 0 ? TOKENS.t1 : TOKENS.t3,
          fontWeight: count > 0 ? 500 : 400,
        }}
      >
        {count}
      </span>
    </span>
  );
}

/** A wrapping run of stats inside a summary card. */
function StatRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>{children}</div>;
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
      style={{ flex: "0 0 auto", fill: TOKENS.t3 }}
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
  /**
   * Force the MvRoot theme. Story-only: pinned light/dark variants set it;
   * production omits it so the host/OS scheme applies.
   */
  theme?: MvTheme;
}

/**
 * Pure presentational help panel. Renders the one `HelpState` top-to-bottom
 * under its own `<MvRoot>`; carries no SDK dependency, so it is driven purely
 * by props in tests, the story, and both wiring paths.
 */
export function HelpView({ data, connecting, error, theme }: HelpViewProps) {
  // Which group's "Read more" detail is open (null = the overview). Declared
  // above the error / no-data guards so hook order stays stable (rules of hooks)
  // now that HelpView owns selection state instead of being purely stateless.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  if (error) {
    return (
      <MvRoot theme={theme}>
        <div data-testid="help-error" style={{ ...panelStyle, color: TOKENS.red }}>
          Couldn’t load the dashboard: {error}
        </div>
      </MvRoot>
    );
  }
  if (!data) {
    return (
      <MvRoot theme={theme}>
        <div data-testid="help-connecting" style={{ ...panelStyle, color: TOKENS.t3 }}>
          {connecting === false ? "No help data." : "Connecting…"}
        </div>
      </MvRoot>
    );
  }

  // "Read more" is open: swap the whole panel for that group's detail view. The
  // overview markup below is untouched — this is a pure client-side state swap
  // over data the widget already holds (no extra tool round-trip).
  const active = openGroup ? data.groups.find((g) => g.group === openGroup) : undefined;
  if (active) {
    return (
      <MvRoot theme={theme}>
        <GroupDetail data={data} group={active} onBack={() => setOpenGroup(null)} />
      </MvRoot>
    );
  }

  return (
    <MvRoot theme={theme}>
      <div data-testid="help-panel" style={panelStyle}>
        {/* Banner */}
        <h1 data-testid="help-wordmark" style={wordmarkStyle}>
          &gt;_MARVIN
        </h1>
        <p style={{ margin: "10px 0 2px" }}>{data.slogan}</p>
        <p data-testid="help-version" style={{ ...t3Style, margin: 0, fontSize: "12px" }}>
          v{data.version}
        </p>
        <hr style={{ border: 0, borderTop: `0.5px solid ${TOKENS.bd}`, margin: "12px 0 16px" }} />

        {/* Summary cards (stat-cell recipe: microlabel + value) */}
        <section data-testid="help-summary" style={sectionStyle}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "8px",
            }}
          >
            <SummaryCard label="Project" testid="help-project">
              <div
                style={{
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {data.project}
              </div>
            </SummaryCard>
            <SummaryCard label="Git" testid="help-git">
              {data.git.branch ? (
                <>
                  <div
                    style={{
                      fontFamily: MV_FONT_MONO,
                      fontSize: "12px",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {data.git.branch}
                  </div>
                  <div style={{ ...t3Style, fontSize: "11.5px", marginTop: "2px" }}>
                    base {data.git.base_branch}
                  </div>
                </>
              ) : (
                <span style={{ ...t3Style, fontSize: "12px" }}>not in a git repo</span>
              )}
            </SummaryCard>
            <SummaryCard label="Board" testid="help-board">
              {data.statuses.length > 0 ? (
                <StatRow>
                  {data.statuses.map((s) => (
                    <Stat key={s.key} label={s.key} count={s.count} />
                  ))}
                </StatRow>
              ) : (
                <span style={{ ...t3Style, fontSize: "12px" }}>no statuses configured</span>
              )}
            </SummaryCard>
            <SummaryCard label="Artifacts" testid="help-artifacts">
              <StatRow>
                <Stat label="specs" count={data.artifacts.specs} />
                <Stat label="handoffs" count={data.artifacts.handoffs} />
                <Stat label="audits" count={data.artifacts.audits} />
                <Stat label="lessons" count={data.artifacts.lessons} />
              </StatRow>
            </SummaryCard>
          </div>
        </section>

        {/* MCP servers — enabled = pass dot-pill, disabled = neutral tag */}
        <Section title="MCP servers" testid="help-servers">
          {data.servers.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {data.servers.map((s) => (
                <span
                  key={s.name}
                  data-testid="help-server"
                  data-server={s.name}
                  data-enabled={s.enabled}
                  style={{
                    ...pillStyle,
                    background: s.enabled ? SEVERITY_TOKENS.pass.bg : TOKENS.srf2,
                    color: s.enabled ? SEVERITY_TOKENS.pass.text : TOKENS.t2,
                  }}
                >
                  {s.enabled ? <span aria-hidden="true" style={pillDotStyle} /> : null}
                  {s.name}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ ...t3Style, margin: 0, fontSize: "12.5px" }}>
              none configured for this project
            </p>
          )}
        </Section>

        {/* Command groups */}
        <Section title="Command groups" testid="help-groups">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${KEY_COL} 1fr`,
              rowGap: "6px",
              columnGap: KEY_GAP,
              alignItems: "start",
            }}
          >
            {data.groups.map((g) => (
              <GroupRow key={g.group} name={g.group} desc={g.blurb} />
            ))}
          </div>
        </Section>

        {/* Per-group command reference */}
        {data.groups.map((g) => {
          const cmds = data.commands.filter((c) => c.group === g.group);
          if (cmds.length === 0) return null;
          return (
            <Section
              key={g.group}
              title={g.group}
              testid={`help-ref-${g.group}`}
              action={<MoreLink group={g.group} onOpen={() => setOpenGroup(g.group)} />}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `${KEY_COL} 1fr`,
                  rowGap: "6px",
                  columnGap: KEY_GAP,
                  alignItems: "start",
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
    </MvRoot>
  );
}

/** One TOC row: the group key as a neutral tag, its blurb in secondary text. */
function GroupRow({ name, desc }: { name: string; desc: string }) {
  return (
    <>
      <span style={{ justifySelf: "start", minWidth: 0 }}>
        <span style={{ ...pillStyle, background: TOKENS.srf2, color: TOKENS.t2 }}>{name}</span>
      </span>
      <span style={{ ...t2Style, fontSize: "12.5px" }}>{desc}</span>
    </>
  );
}

/** One `name — description` reference row; the name is a mono code chip. */
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
          display: "flex",
          alignItems: "center",
          gap: "6px",
          minWidth: 0,
        }}
      >
        <code style={codeChipStyle}>{name}</code>
        {human ? <HumanMark /> : null}
      </span>
      <span style={{ ...t2Style, fontSize: "12.5px" }}>{desc}</span>
    </>
  );
}

/**
 * Human-readable label per command-group key, used to build the group-detail
 * heading (e.g. `core` → "Core commands"). Keyed by the registry group key; an
 * unknown key falls back to its capitalised form so a newly added group never
 * renders a blank heading. Widget-only presentation — the terminal door renders
 * the flat reference and needs no group heading.
 */
const GROUP_LABELS: Record<string, string> = {
  core: "Core",
  adr: "ADR",
  pr: "PR",
  task: "Task",
  sec: "Security",
  refactor: "Refactor",
  track: "Track",
};

/** The detail-header heading for a group key — "<Label> commands". */
export function groupTitle(key: string): string {
  const label = GROUP_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
  return `${label} commands`;
}

// "Two ways to call" gutter labels ("Direct" / "In prose") share the microlabel
// recipe; the small padding keeps them on the chip's first text line.
const twoWayLabelStyle: CSSProperties = { ...microlabelStyle, paddingTop: "3px" };

/**
 * The focused "Read more" detail view for one command group — the client-side
 * drill-down rendered from the HelpState the widget already holds (no extra tool
 * round-trip). Shows a back control, the widget-title heading (e.g. "Core
 * commands"), and each command as `/marvin:<name>` with its richer description
 * and an optional direct-call example; a 👤 legend appears when the group has
 * any human-run command. Rendered inside the caller's MvRoot.
 */
function GroupDetail({
  data,
  group,
  onBack,
}: {
  data: HelpState;
  group: HelpState["groups"][number];
  onBack: () => void;
}) {
  const cmds = data.commands.filter((c) => c.group === group.group);
  const hasHuman = cmds.some((c) => c.human);
  return (
    <div data-testid="help-detail" style={panelStyle}>
      <span
        role="link"
        tabIndex={0}
        data-testid="help-back"
        onClick={onBack}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onBack();
          }
        }}
        style={{ cursor: "pointer", color: TOKENS.ac, fontSize: "12px" }}
      >
        ← All commands
      </span>

      <h2
        data-testid="help-detail-title"
        style={{
          margin: "10px 0 12px",
          fontSize: "16px",
          fontWeight: 500,
          letterSpacing: "-0.015em",
        }}
      >
        {groupTitle(group.group)}
      </h2>

      {cmds.map((c) => {
        // Two ways to call (ADR-0024): the direct call — the args `example` when a
        // command has one, else the bare `/marvin:<name>` — and its prose examples.
        const direct = c.example ?? `/marvin:${c.name}`;
        return (
          <div
            key={c.name}
            data-testid="help-detail-command"
            data-command={c.name}
            style={{ padding: "10px 0", borderTop: `0.5px solid ${TOKENS.bd}` }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontFamily: MV_FONT_MONO,
                fontSize: "12.5px",
                fontWeight: 500,
              }}
            >
              /marvin:{c.name}
              {c.human ? <HumanMark /> : null}
            </span>
            <div
              style={{
                ...t2Style,
                fontSize: "12.5px",
                lineHeight: 1.55,
                margin: "3px 0 7px",
              }}
            >
              {c.description}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(4rem, max-content) 1fr",
                columnGap: "0.9rem",
                rowGap: "5px",
                alignItems: "start",
              }}
            >
              <span style={twoWayLabelStyle}>Direct</span>
              <code
                data-testid="help-detail-direct"
                style={{ ...codeChipStyle, justifySelf: "start", whiteSpace: "normal" }}
              >
                {direct}
              </code>
              {c.phrases.length > 0 ? (
                <>
                  <span style={twoWayLabelStyle}>In prose</span>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      minWidth: 0,
                    }}
                  >
                    {c.phrases.map((p, i) => (
                      <span
                        key={i}
                        data-testid="help-detail-phrase"
                        style={{ ...t2Style, fontSize: "12.5px" }}
                      >
                        “{p}”
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      {hasHuman ? (
        <div
          style={{
            ...t3Style,
            fontSize: "11px",
            marginTop: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <HumanMark /> human-run only
        </div>
      ) : null}
    </div>
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
    appInfo: { name: "marvin-help", version: "0.8.0" },
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
