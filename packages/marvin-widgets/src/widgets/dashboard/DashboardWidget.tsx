import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { DashboardAuditArea, DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { MvRoot, TOKENS, SEVERITY_TOKENS, MV_FONT_MONO, type MvTheme } from "../../theme";
import {
  runChatAction,
  selectNodeText,
  type ChatActionResult,
  type ChatActionHost,
} from "../../lib/actions";
import { useHostTheme } from "../../lib/host-theme";
import {
  ROLE_TONE,
  auditAreaState,
  boardSegments,
  boardTotal,
  commandFor,
  formatAge,
  nonZeroEntries,
  usageWindowLabel,
  type AffordanceId,
  type BoardRole,
  type Tone,
} from "./helpers";

/**
 * The dashboard widget (ADR-0024 #8), rebuilt on the `DashboardState` v2 payload
 * and the approved mockup at `docs/design/mockups/dashboard.html`.
 *
 * Three zones inside a nav shell, replacing the flat card grid of the v1 view:
 *
 *  - **Project** — repo identity, the board distribution bar, artifact counts,
 *    and the configured MCP servers.
 *  - **Work in progress** — the current-work digest (active board cards and
 *    pipeline specs), recent handoffs, and audit findings by severity per area.
 *  - **Toolbox state** — paths, config, the ADR corpus, lessons, usage, commands.
 *
 * The v1 `SecurityCard` / `RefactorCard` are gone with the contract fields that
 * fed them: `DashboardAudits` supersedes both with findings and freshness, and
 * `artifacts.audits` still carries the security document count.
 *
 * Split into a pure {@link DashboardView} (props-only, no SDK) and the App
 * wiring below — the family shape — so the render is unit-testable without a
 * transport and one view serves production, the tests and the stories.
 *
 * **Colour** resolves from `.mvroot` tokens throughout. The single exception is
 * the wordmark gradient, which carries literal violet stops for the same reason
 * `HelpWidget` does: the gradient is clipped through the glyphs, so no
 * text-grade token can express it, and the brand mark must read identically on
 * both themes.
 *
 * **Layout** that inline styles cannot express — the four responsive
 * breakpoints and the row hover states — lives in one id-keyed `<style>`
 * element, the `ListDetail` technique. The Storybook runner pins the viewport at
 * 1000×800, so no image baseline can exercise a breakpoint; the unit test
 * asserts on the sheet's text instead.
 *
 * **Actions.** Every control that issues a marvin command routes through
 * `onAction`, which the wiring layers bind to {@link runChatAction}. The view
 * owns the "manual" outcome because it owns the element to select: when the
 * handler reports that neither the send nor the clipboard landed, the shared
 * recovery line reveals the command pre-selected for a ⌘C.
 */

// ── the sanctioned brand flourish ────────────────────────────────────────────
// Mirrors HelpWidget.tsx — the one place in the restyled family allowed to carry
// hex outside the theme module. The constants there are module-local and not
// exported, and `src/theme/` is deliberately outside this task's file allowlist,
// so the pair is redeclared rather than lifted.
const WORDMARK_VIOLET_FROM = "#a78bfa";
const WORDMARK_VIOLET_TO = "#7c3aed";
const WORDMARK_GRADIENT = `linear-gradient(100deg, ${WORDMARK_VIOLET_FROM}, ${WORDMARK_VIOLET_TO})`;

// ── injected stylesheet ──────────────────────────────────────────────────────

/** id of the injected `<style>` element — the once-per-document key. */
export const DASHBOARD_STYLE_ID = "mv-dashboard-styles";

/**
 * All four of the mockup's breakpoints, plus the hover states. Every rule here
 * is one an inline style cannot carry (a media query or a pseudo-class); the
 * rest of the widget stays inline over tokens.
 */
const DASHBOARD_CSS = `
.mvdash-shell{display:flex;min-height:0}
.mvdash-side{width:196px;flex:none;background:${TOKENS.srf};border-right:0.5px solid ${TOKENS.bd};padding:16px 13px;display:flex;flex-direction:column}
.mvdash-main{flex:1;min-width:0;padding:18px 22px 22px}
.mvdash-nav:hover{background:${TOKENS.srf2};color:${TOKENS.t1}}
.mvdash-act:hover{border-color:${TOKENS.ac}}
.mvdash-open:hover{text-decoration:underline}
.mvdash-row.mvdash-hoverable:hover{background:${TOKENS.srf2}}
.mvdash-row+.mvdash-row{border-top:0.5px solid ${TOKENS.bd}}
@media (prefers-reduced-motion:no-preference){
.mvdash-reveal{opacity:0;animation:mvDashUp .55s var(--mvd,0s) forwards cubic-bezier(.2,.7,.2,1)}
.mvdash-bar{animation:mvDashWipe .8s .2s both cubic-bezier(.2,.7,.2,1)}
}
@keyframes mvDashUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes mvDashWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.mvdash-grid-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.mvdash-grid-2{display:grid;grid-template-columns:1fr 1.6fr;gap:12px}
.mvdash-grid-tb{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.mvdash-tasks{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px 22px}
@media (max-width:860px){.mvdash-grid-tb{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:720px){
.mvdash-shell{flex-direction:column}
.mvdash-side{width:auto;flex-direction:row;align-items:center;border-right:0;border-bottom:0.5px solid ${TOKENS.bd};padding:10px 14px}
.mvdash-navlist{flex-direction:row;flex-wrap:wrap;flex:1;gap:4px}
.mvdash-nav{width:auto}
.mvdash-sidefoot{display:none}
.mvdash-main{padding:16px}
}
@media (max-width:680px){.mvdash-grid-sum{grid-template-columns:1fr}}
@media (max-width:600px){
.mvdash-grid-2{grid-template-columns:1fr}
.mvdash-grid-tb{grid-template-columns:1fr}
}
`;

/**
 * Put the widget's stylesheet into the document exactly once — keyed by the
 * element id, so repeat renders are no-ops after the first. Runs at render time,
 * like `MvRoot` and `ListDetail`.
 */
export function ensureDashboardStyles(): void {
  if (typeof document === "undefined" || document.getElementById(DASHBOARD_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = DASHBOARD_STYLE_ID;
  style.textContent = DASHBOARD_CSS;
  document.head.appendChild(style);
}

// ── shared style recipes ─────────────────────────────────────────────────────

/** Microlabel (mockup `.lab`): 10.5px/500 uppercase, meta text. */
const microlabelStyle: CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

const zoneLabelStyle: CSSProperties = {
  ...microlabelStyle,
  letterSpacing: "0.07em",
  margin: "0 0 12px",
};

/** The widget canvas — bg ground, hairline, radius 4, no padding (the shell insets). */
const frameStyle: CSSProperties = {
  background: TOKENS.bg,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  overflow: "hidden",
};

/** The connection/error states keep the v1 padded frame. */
const noticeFrameStyle: CSSProperties = { ...frameStyle, padding: 14 };

const emptyNoteStyle: CSSProperties = { color: TOKENS.t3, fontSize: "12.5px" };

const numStyle: CSSProperties = { fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" };

const dividerStyle: CSSProperties = { borderTop: `0.5px solid ${TOKENS.bd}`, margin: "20px 0" };

const kpiStyle: CSSProperties = {
  fontSize: 27,
  fontWeight: 500,
  lineHeight: 1,
  letterSpacing: "-0.03em",
  ...numStyle,
};

const kpiSmallStyle: CSSProperties = {
  fontSize: 19,
  fontWeight: 500,
  lineHeight: 1,
  letterSpacing: "-0.02em",
  ...numStyle,
};

const barStyle: CSSProperties = {
  display: "flex",
  gap: 2,
  height: 9,
  borderRadius: 4,
  overflow: "hidden",
  background: TOKENS.srf2,
};

const legendStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "5px 13px",
  marginTop: 9,
  fontSize: "11.5px",
  color: TOKENS.t2,
};

// ── small building blocks ────────────────────────────────────────────────────

function Pill({
  tone = "neutral",
  testid,
  dataAttrs,
  children,
}: {
  tone?: Tone;
  testid?: string;
  dataAttrs?: Record<string, string>;
  children: ReactNode;
}) {
  const colors = tone === "neutral" ? { text: TOKENS.t2, bg: TOKENS.srf2 } : SEVERITY_TOKENS[tone];
  return (
    <span
      data-testid={testid}
      {...dataAttrs}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 9px",
        borderRadius: 4,
        fontSize: "11.5px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        background: colors.bg,
        color: colors.text,
      }}
    >
      {tone !== "neutral" ? (
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
      {children}
    </span>
  );
}

function MonoChip({ children, wrap }: { children: ReactNode; wrap?: boolean }) {
  return (
    <code
      style={{
        fontFamily: MV_FONT_MONO,
        fontSize: 11,
        background: TOKENS.srf2,
        border: `0.5px solid ${TOKENS.bd}`,
        borderRadius: 4,
        padding: "1px 6px",
        ...(wrap
          ? { display: "inline-block", whiteSpace: "normal", wordBreak: "break-all" }
          : { whiteSpace: "nowrap" }),
      }}
    >
      {children}
    </code>
  );
}

function Card({
  title,
  testid,
  action,
  children,
}: {
  title?: string;
  testid: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testid}
      style={{
        background: TOKENS.srf,
        border: `0.5px solid ${TOKENS.bd}`,
        borderRadius: 4,
        padding: "14px 16px",
        minWidth: 0,
      }}
    >
      {title || action ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
          {title ? <h3 style={{ margin: 0, ...microlabelStyle }}>{title}</h3> : null}
          <span style={{ flex: 1 }} />
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function DefRow({
  label,
  children,
  testid,
}: {
  label: string;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      style={{ display: "flex", gap: 8, padding: "3px 0", alignItems: "baseline" }}
    >
      <span style={{ fontSize: 12, color: TOKENS.t3, flex: "0 0 auto" }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function TagRow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6, ...style }}>{children}</div>;
}

function StatCell({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
  return (
    <div data-testid={testid}>
      <div style={kpiSmallStyle}>{value}</div>
      <div style={{ ...microlabelStyle, marginTop: 3 }}>{label}</div>
    </div>
  );
}

/** A proportional segment bar plus its legend — board distribution and severity. */
function SegmentBar({
  segments,
  testid,
}: {
  segments: Array<{ key: string; count: number; flex: number; fill: string }>;
  testid: string;
}) {
  return (
    <>
      <div
        data-testid={testid}
        className="mvdash-bar"
        style={{ ...barStyle, marginTop: 10 }}
        aria-hidden="true"
      >
        {segments.map((s) => (
          <i
            key={s.key}
            style={{ display: "block", minWidth: 2, flex: s.flex, background: s.fill }}
          />
        ))}
      </div>
      <div style={legendStyle}>
        {segments.map((s) => (
          <span
            key={s.key}
            data-testid={`${testid}-legend`}
            data-key={s.key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <i style={{ width: 7, height: 7, borderRadius: 2, flex: "none", background: s.fill }} />
            {s.key} {s.count}
          </span>
        ))}
      </div>
    </>
  );
}

// ── action controls ──────────────────────────────────────────────────────────

/** What every action control needs: which affordance it is, and its row argument. */
interface ActionProps {
  affordance: AffordanceId;
  arg?: string;
  onAction: (command: string) => void;
}

/** The filled `↗` button (mockup `.act`) — a card-level action. */
function ActionButton({
  affordance,
  arg,
  onAction,
  children,
}: ActionProps & { children: ReactNode }) {
  return (
    <button
      type="button"
      className="mvdash-act"
      data-testid="dash-action"
      data-affordance={affordance}
      onClick={() => onAction(commandFor(affordance, arg))}
      style={{
        // `font: "inherit"` FIRST — it is a shorthand and resets size and
        // weight to the `.mvroot` base (13px/400), so the overrides below it
        // are what actually take effect. Reversing these two lines silently
        // renders the button one size up and one weight down.
        font: "inherit",
        fontSize: "11.5px",
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 11px",
        borderRadius: 4,
        border: "0.5px solid transparent",
        background: TOKENS.acbg,
        color: TOKENS.act,
        cursor: "pointer",
      }}
    >
      {children} <span style={{ fontSize: 11 }}>↗</span>
    </button>
  );
}

/**
 * The quiet `→` link (mockup `.open` / `.more`) — a row or footer action.
 *
 * `label` is required rather than optional: eight of these render per panel and
 * every one of them reads "open →", so without an explicit accessible name a
 * screen reader hears the same control eight times. The row title is a sibling
 * node, so it does not contribute to the accessible name.
 */
function ActionLink({
  affordance,
  arg,
  onAction,
  label,
  children,
  style,
}: ActionProps & { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <button
      type="button"
      className="mvdash-open"
      data-testid="dash-action"
      data-affordance={affordance}
      aria-label={label}
      onClick={() => onAction(commandFor(affordance, arg))}
      style={{
        // `font: "inherit"` first — it is a shorthand and resets size/family/
        // weight, so any specific override has to follow it, not precede it.
        font: "inherit",
        fontSize: 11,
        color: TOKENS.ac,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flex: "none",
        background: "transparent",
        border: 0,
        padding: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** A list row: content, then a trailing open-link. */
function Row({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <div
      className="mvdash-row mvdash-hoverable"
      data-testid={testid}
      // The separator is `.mvdash-row + .mvdash-row` in the sheet, not a border
      // here: the mockup rules BETWEEN rows (`dashboard.html:149`), so putting
      // it on every row would give each list a leading hairline under its label.
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 8px",
        margin: "0 -8px",
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  );
}

/** Ellipsised row title. */
function RowTitle({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "12.5px",
        color: TOKENS.t1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {children}
    </span>
  );
}

// ── zones ────────────────────────────────────────────────────────────────────

const NAV_ITEMS: Array<{ affordance: AffordanceId; label: string; active?: boolean }> = [
  { affordance: "nav-dashboard", label: "Dashboard", active: true },
  { affordance: "nav-tasks", label: "Tasks" },
  { affordance: "nav-reports", label: "Reports" },
  { affordance: "nav-settings", label: "Settings" },
];

function Sidebar({ data, onAction }: { data: DashboardState; onAction: (c: string) => void }) {
  const project = data.paths.project.split("/").filter(Boolean).pop() ?? data.paths.project;
  return (
    <aside className="mvdash-side" data-testid="dashboard-sidebar">
      <div
        style={{
          fontFamily: MV_FONT_MONO,
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "2px 4px 16px",
          width: "max-content",
          backgroundImage: WORDMARK_GRADIENT,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
          WebkitTextFillColor: "transparent",
        }}
      >
        &gt;_marvin
      </div>
      <nav
        className="mvdash-navlist"
        aria-label="Marvin views"
        style={{ display: "flex", flexDirection: "column", gap: 3 }}
      >
        {NAV_ITEMS.map((item) => (
          <button
            key={item.affordance}
            type="button"
            className="mvdash-nav"
            data-testid="dash-action"
            data-affordance={item.affordance}
            aria-current={item.active ? "page" : undefined}
            onClick={() => onAction(commandFor(item.affordance))}
            style={{
              font: "inherit",
              fontSize: "12.5px",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              textAlign: "left",
              border: 0,
              borderRadius: 4,
              padding: "8px 11px",
              cursor: "pointer",
              ...(item.active
                ? {
                    background: TOKENS.acbg,
                    color: TOKENS.act,
                    boxShadow: `inset 2px 0 0 ${TOKENS.ac}`,
                  }
                : { background: "transparent", color: TOKENS.t2 }),
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div
        className="mvdash-sidefoot"
        style={{
          marginTop: "auto",
          paddingTop: 12,
          borderTop: `0.5px solid ${TOKENS.bd}`,
          fontSize: 11,
          color: TOKENS.t3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {project} · v{data.version}
      </div>
    </aside>
  );
}

function IdentityStrip({ data }: { data: DashboardState }) {
  const project = data.paths.project.split("/").filter(Boolean).pop() ?? data.paths.project;
  return (
    <header
      data-testid="dashboard-header"
      className="mvdash-reveal"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "7px 8px" }}
    >
      <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.015em", marginRight: 2 }}>
        {project}
      </span>
      <Pill testid="dashboard-version">v{data.version}</Pill>
      <Pill tone={data.git.has_git ? "pass" : "neutral"}>git</Pill>
      <Pill tone={data.git.has_gh ? "pass" : "neutral"}>gh</Pill>
      <span data-testid="dashboard-branch" style={{ minWidth: 0 }}>
        {data.git.branch ? (
          <MonoChip wrap>{data.git.branch}</MonoChip>
        ) : (
          <span style={emptyNoteStyle}>(not in a git repo)</span>
        )}
      </span>
      <span style={microlabelStyle}>base {data.config.base_branch}</span>
    </header>
  );
}

function ProjectZone({ data }: { data: DashboardState }) {
  const project = data.paths.project.split("/").filter(Boolean).pop() ?? data.paths.project;
  const segments = boardSegments(data.board_counts, data.config.statuses);
  const total = boardTotal(data.board_counts);
  return (
    <section
      data-testid="zone-project"
      className="mvdash-reveal"
      style={{ "--mvd": ".05s" } as CSSProperties}
    >
      <p style={zoneLabelStyle}>Project</p>
      <div className="mvdash-grid-sum">
        <Card testid="card-repo">
          <div style={{ ...microlabelStyle, marginBottom: 6 }}>Repo</div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              margin: "0 0 10px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project}
          </div>
          <DefRow label="branch">
            {data.git.branch ? (
              <MonoChip wrap>{data.git.branch}</MonoChip>
            ) : (
              <span style={emptyNoteStyle}>(not in a git repo)</span>
            )}
          </DefRow>
          <DefRow label="base">
            <MonoChip wrap>{data.config.base_branch}</MonoChip>
          </DefRow>
          <DefRow label="git">
            <TagRow>
              <Pill tone={data.git.has_git ? "pass" : "neutral"}>git</Pill>
              <Pill tone={data.git.has_gh ? "pass" : "neutral"}>gh</Pill>
            </TagRow>
          </DefRow>
        </Card>

        <Card testid="card-board">
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            <span style={kpiStyle} data-testid="board-total">
              {total}
            </span>
            <span style={microlabelStyle}>board</span>
          </div>
          {segments.length > 0 ? (
            <SegmentBar
              testid="board-bar"
              segments={segments.map((s) => ({
                key: s.key,
                count: s.count,
                flex: s.flex,
                fill: s.fill,
              }))}
            />
          ) : (
            <p style={{ ...emptyNoteStyle, margin: "10px 0 0" }}>No cards on the board yet.</p>
          )}
        </Card>

        <Card testid="card-artifacts">
          <div style={{ ...microlabelStyle, marginBottom: 8 }}>Artifacts</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
            <StatCell label="specs" value={data.artifacts.specs} testid="artifacts-specs" />
            <StatCell
              label="handoffs"
              value={data.artifacts.handoffs}
              testid="artifacts-handoffs"
            />
            <StatCell label="audits" value={data.artifacts.audits} testid="artifacts-audits" />
            <StatCell label="lessons" value={data.artifacts.lessons} testid="artifacts-lessons" />
          </div>
          {data.artifacts.verification ? (
            <div style={{ marginTop: 10 }}>
              <DefRow label="verification" testid="artifacts-verification">
                <span style={{ fontSize: "12.5px", color: TOKENS.t2 }}>
                  {data.artifacts.verification.exists
                    ? formatAge(data.artifacts.verification.age_days)
                    : "none"}
                </span>
              </DefRow>
            </div>
          ) : null}
        </Card>
      </div>

      {data.servers ? (
        <div style={{ marginTop: 12 }}>
          <Card
            testid="card-servers"
            title="MCP servers"
            action={
              <span style={{ ...microlabelStyle, textTransform: "none", letterSpacing: 0 }}>
                ● enabled&nbsp;&nbsp;○ disabled
              </span>
            }
          >
            {data.servers.length > 0 ? (
              <TagRow>
                {data.servers.map((s) => (
                  <Pill
                    key={s.name}
                    tone={s.enabled ? "pass" : "neutral"}
                    dataAttrs={{ "data-server": s.name, "data-enabled": String(s.enabled) }}
                  >
                    {s.name}
                  </Pill>
                ))}
              </TagRow>
            ) : (
              <p style={{ ...emptyNoteStyle, margin: 0 }}>No MCP servers configured.</p>
            )}
          </Card>
        </div>
      ) : null}
    </section>
  );
}

function AuditArea({
  label,
  area,
  onAction,
}: {
  label: string;
  area: DashboardAuditArea | null;
  onAction: (command: string) => void;
}) {
  const state = auditAreaState(area);
  return (
    <div
      data-testid="audit-area"
      data-area={label.toLowerCase()}
      data-state={state.kind}
      style={{ padding: "10px 0", borderTop: `0.5px solid ${TOKENS.bd}` }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "7px 9px",
          marginBottom: state.kind === "findings" ? 9 : 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: TOKENS.t1 }}>{label}</span>
        {state.kind === "never-scanned" ? (
          <span data-testid="audit-note" style={emptyNoteStyle}>
            never scanned
          </span>
        ) : state.kind === "clean" ? (
          <>
            <Pill tone="pass" testid="audit-note">
              no findings
            </Pill>
            <span
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 9 }}
            >
              <span style={{ fontSize: 11, color: TOKENS.t3, ...numStyle }}>
                {formatAge(state.area.scanned_age_days)}
              </span>
              <ActionLink
                affordance="audit-open-report"
                onAction={onAction}
                label={`Open the newest ${label.toLowerCase()} report`}
              >
                open report →
              </ActionLink>
            </span>
          </>
        ) : (
          <>
            <span style={kpiSmallStyle} data-testid="audit-total">
              {state.area.total}
            </span>
            <span style={{ ...microlabelStyle, letterSpacing: "0.04em" }}>findings</span>
            <span
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 9 }}
            >
              <span style={{ fontSize: 11, color: TOKENS.t3, ...numStyle }}>
                {formatAge(state.area.scanned_age_days)}
              </span>
              <ActionLink
                affordance="audit-open-report"
                onAction={onAction}
                label={`Open the newest ${label.toLowerCase()} report`}
              >
                open report →
              </ActionLink>
            </span>
          </>
        )}
      </div>
      {state.kind === "findings" ? (
        <SegmentBar
          testid="audit-bar"
          segments={state.segments.map((s) => ({
            key: s.severity,
            count: s.count,
            flex: s.flex,
            fill: s.fill,
          }))}
        />
      ) : null}
    </div>
  );
}

function WorkZone({ data, onAction }: { data: DashboardState; onAction: (c: string) => void }) {
  const current = data.current_tasks;
  const handoffs = data.handoffs;
  const audits = data.audits;
  if (!current && !handoffs && !audits) return null;

  return (
    <section
      data-testid="zone-work"
      className="mvdash-reveal"
      style={{ "--mvd": ".1s" } as CSSProperties}
    >
      <p style={zoneLabelStyle}>Work in progress · needs attention</p>

      {current ? (
        <Card
          testid="card-current-tasks"
          title="Current tasks"
          action={
            <ActionButton affordance="new-task" onAction={onAction}>
              + New task
            </ActionButton>
          }
        >
          <div className="mvdash-tasks">
            <div>
              <p style={{ ...microlabelStyle, margin: "0 0 4px" }}>Board · track</p>
              {current.board.length > 0 ? (
                current.board.map((card) => (
                  <Row key={card.id} testid="current-board-row">
                    {/*
                      ROLE_TONE, not an inline conditional: `boardDigest` filters
                      to wip|review today, so a hand-rolled ternary is correct
                      only by accident and would render any future role as `low`.
                    */}
                    <Pill tone={ROLE_TONE[card.status.role as BoardRole] ?? "neutral"}>
                      {card.status.key}
                    </Pill>
                    <RowTitle>{card.title}</RowTitle>
                    <span style={{ flex: 1 }} />
                    <ActionLink
                      affordance="row-board"
                      arg={card.id}
                      onAction={onAction}
                      label={`Open board card ${card.id}: ${card.title}`}
                    >
                      open →
                    </ActionLink>
                  </Row>
                ))
              ) : (
                <p style={{ ...emptyNoteStyle, margin: "6px 0 0" }}>Nothing in progress.</p>
              )}
              <ActionLink
                affordance="nav-tasks"
                onAction={onAction}
                label="Open the full task board"
                style={{ paddingTop: 7, display: "inline-block" }}
              >
                open board →
              </ActionLink>
            </div>

            <div>
              <p style={{ ...microlabelStyle, margin: "0 0 4px" }}>Specs · task</p>
              {current.specs.length > 0 ? (
                current.specs.map((spec) => (
                  <Row key={spec.slug} testid="current-spec-row">
                    <Pill>spec</Pill>
                    <RowTitle>
                      {spec.id ? `${spec.id} · ` : ""}
                      {spec.slug}
                    </RowTitle>
                    <span style={{ flex: 1 }} />
                    <ActionLink
                      affordance="row-spec"
                      arg={spec.slug}
                      onAction={onAction}
                      label={`Summarise spec ${spec.slug}`}
                    >
                      open →
                    </ActionLink>
                  </Row>
                ))
              ) : (
                <p style={{ ...emptyNoteStyle, margin: "6px 0 0" }}>No specs in flight.</p>
              )}
              <ActionLink
                affordance="nav-reports"
                onAction={onAction}
                label="Open all specs and reports"
                style={{ paddingTop: 7, display: "inline-block" }}
              >
                open specs →
              </ActionLink>
            </div>
          </div>
        </Card>
      ) : null}

      {handoffs || audits ? (
        <div className="mvdash-grid-2" style={{ marginTop: 12 }}>
          {handoffs ? (
            <Card
              testid="card-handoffs"
              title="Handoffs"
              action={
                <ActionButton affordance="new-handoff" onAction={onAction}>
                  + New
                </ActionButton>
              }
            >
              {handoffs.length > 0 ? (
                handoffs.map((h) => (
                  <Row key={h.slug} testid="handoff-row">
                    <RowTitle>{h.objective}</RowTitle>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: TOKENS.t3, flex: "none", ...numStyle }}>
                      {h.age_days === null ? "—" : `${h.age_days}d`}
                    </span>
                    <ActionLink
                      affordance="row-handoff"
                      onAction={onAction}
                      label={`Open handoff ${h.slug}: ${h.objective}`}
                    >
                      open →
                    </ActionLink>
                  </Row>
                ))
              ) : (
                <p style={{ ...emptyNoteStyle, margin: "6px 0 0" }}>No handoffs captured yet.</p>
              )}
            </Card>
          ) : null}

          {audits ? (
            <Card
              testid="card-audits"
              title="Audits"
              action={
                <ActionButton affordance="run-audit" onAction={onAction}>
                  ▶ Run audit
                </ActionButton>
              }
            >
              <AuditArea label="Security" area={audits.security} onAction={onAction} />
              <AuditArea label="Refactor" area={audits.refactor} onAction={onAction} />
            </Card>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ToolboxZone({ data }: { data: DashboardState }) {
  const gateEntries = data.config.gates
    ? Object.entries(data.config.gates).filter(
        ([, cmd]) => typeof cmd === "string" && cmd.length > 0,
      )
    : [];
  const adrPresent = data.adr ? nonZeroEntries(data.adr.counts) : [];
  const lessonTypes = data.lessons ? nonZeroEntries(data.lessons.by_type) : [];
  const commandTotal = data.command_groups.reduce((n, g) => n + g.count, 0);

  return (
    <section
      data-testid="zone-toolbox"
      className="mvdash-reveal"
      style={{ "--mvd": ".15s" } as CSSProperties}
    >
      <p style={zoneLabelStyle}>Toolbox state</p>
      <div className="mvdash-grid-tb">
        <Card testid="card-paths" title="Paths">
          <DefRow label="project">
            <MonoChip wrap>{data.paths.project}</MonoChip>
          </DefRow>
          <DefRow label="tasks">
            <MonoChip wrap>{data.paths.tasks_dir}</MonoChip>
          </DefRow>
          <DefRow label="config">
            <MonoChip wrap>{data.paths.config_path}</MonoChip>
          </DefRow>
        </Card>

        <Card testid="card-config" title="Config">
          <DefRow label="base">
            <MonoChip wrap>{data.config.base_branch}</MonoChip>
          </DefRow>
          <DefRow label="tracker" testid="config-tracker">
            {data.config.tracker_url_template ? (
              <MonoChip wrap>{data.config.tracker_url_template}</MonoChip>
            ) : (
              <span style={emptyNoteStyle}>not configured</span>
            )}
          </DefRow>
          <DefRow label="gates" testid="config-gates">
            {gateEntries.length > 0 ? (
              <TagRow>
                {gateEntries.map(([name]) => (
                  <Pill key={name}>{name}</Pill>
                ))}
              </TagRow>
            ) : (
              <span style={emptyNoteStyle}>defaults</span>
            )}
          </DefRow>
          <div data-testid="config-statuses" style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: TOKENS.t3 }}>statuses</div>
            <TagRow style={{ marginTop: 4 }}>
              {data.config.statuses.map((s) => (
                <Pill key={s.key} dataAttrs={{ "data-role": s.role }}>
                  {s.key}
                  {s.key === s.role ? "" : ` · ${s.role}`}
                </Pill>
              ))}
            </TagRow>
          </div>
        </Card>

        {data.adr ? (
          <Card testid="card-adr" title={`Decisions · ADR (${data.adr.total})`}>
            <DefRow label="corpus">
              <MonoChip wrap>{data.adr.dir}</MonoChip>
            </DefRow>
            {adrPresent.length > 0 ? (
              <TagRow style={{ marginTop: 6 }}>
                {adrPresent.map(([status, n]) => (
                  <Pill key={status} dataAttrs={{ "data-adr-status": status }}>
                    {`${status} ${n}`}
                  </Pill>
                ))}
              </TagRow>
            ) : (
              <p style={{ ...emptyNoteStyle, margin: "6px 0 0" }}>No records yet.</p>
            )}
            {data.adr.malformed > 0 ? (
              <p data-testid="adr-malformed" style={{ margin: "9px 0 0" }}>
                <Pill tone="stale">{`${data.adr.malformed} malformed`}</Pill>
              </p>
            ) : null}
          </Card>
        ) : null}

        {data.lessons ? (
          <Card testid="card-lessons" title={`Lessons (${data.lessons.total})`}>
            {lessonTypes.length > 0 ? (
              <TagRow>
                {lessonTypes.map(([type, n]) => (
                  <Pill key={type} dataAttrs={{ "data-lesson-type": type }}>
                    {`${type} ${n}`}
                  </Pill>
                ))}
              </TagRow>
            ) : (
              <p style={{ ...emptyNoteStyle, margin: 0 }}>No lessons captured yet.</p>
            )}
          </Card>
        ) : null}

        {data.usage ? (
          <Card testid="card-usage" title="Usage">
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={kpiStyle}>{data.usage.events}</span>
              <span style={microlabelStyle}>events</span>
            </div>
            <div
              data-testid="usage-window"
              style={{ fontSize: "11.5px", color: TOKENS.t3, margin: "6px 0", ...numStyle }}
            >
              {usageWindowLabel(data.usage.window)}
            </div>
            {data.usage.top.length > 0 ? (
              data.usage.top.map((t) => (
                <div
                  key={`${t.kind}:${t.name}`}
                  data-testid="usage-top"
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0" }}
                >
                  <MonoChip>{t.name}</MonoChip>
                  <span style={{ fontSize: 11, color: TOKENS.t3 }}>{t.kind}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontWeight: 500, ...numStyle }}>×{t.count}</span>
                </div>
              ))
            ) : (
              <p style={{ ...emptyNoteStyle, margin: "4px 0 0" }}>No events recorded.</p>
            )}
          </Card>
        ) : null}

        <Card testid="card-commands" title={`Commands (${commandTotal})`}>
          <TagRow>
            {data.command_groups.map((g) => (
              <Pill key={g.group} dataAttrs={{ "data-group": g.group }}>
                {`${g.group} ${g.count}`}
              </Pill>
            ))}
          </TagRow>
        </Card>
      </div>
    </section>
  );
}

// ── the view ─────────────────────────────────────────────────────────────────

export interface DashboardViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: DashboardState | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /**
   * Run a marvin command. Wiring layers bind this to `runChatAction`, which
   * returns which rung of the ladder the command reached; the view needs that
   * back because IT owns the element to select on the "manual" rung. A plain
   * void handler (a story, a pure-render test) is also accepted.
   */
  onAction?: (command: string) => Promise<ChatActionResult> | void;
  /**
   * Pin the theme of the view's own `<MvRoot>`. In production this carries the
   * host's advertised theme, resolved by `useHostTheme`; stories pass it
   * directly. Undefined leaves `data-theme` unset, so the OS scheme governs.
   */
  theme?: MvTheme;
}

/**
 * Pure presentational dashboard. Renders one `DashboardState` as a nav shell
 * plus three zones; carries no SDK dependency, so it is driven purely by props
 * in tests, stories and both wiring paths.
 *
 * Optional contract sections render only when present: an absent field (the
 * narrower `help` payload) omits its card, while a present-but-zero field
 * renders its zero state. The distinction is deliberate and load-bearing.
 */
export function DashboardView({ data, connecting, error, onAction, theme }: DashboardViewProps) {
  ensureDashboardStyles();

  // The shared outcome line. ONE line rather than per-control state — the
  // affordances are icon-and-label buttons that never display their command,
  // unlike the reports copy chip this generalises from. "manual" reveals the
  // command for a select-on-click ⌘C; "copied" acknowledges the clipboard,
  // without which a host that refuses `sendMessage` produces a button that
  // visibly does nothing while silently overwriting the clipboard.
  const [outcome, setOutcome] = useState<{ result: ChatActionResult; command: string } | null>(
    null,
  );
  const manualRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (outcome?.result === "manual") selectNodeText(manualRef.current);
  }, [outcome]);

  // Overlapping clicks resolve out of order — on a host that refuses
  // sendMessage every click walks the whole ladder, so the window is real. Only
  // the newest click may write the outcome, or a slow "manual" landing after a
  // fast "sent" reveals a stale command and hijacks the selection.
  const clickGeneration = useRef(0);
  const handleAction = (command: string) => {
    const generation = ++clickGeneration.current;
    setOutcome(null);
    const result = onAction?.(command);
    if (result && typeof result.then === "function") {
      void result.then(
        (settled) => {
          if (generation !== clickGeneration.current) return;
          setOutcome(settled ? { result: settled, command } : null);
        },
        () => {
          if (generation === clickGeneration.current) setOutcome(null);
        },
      );
    }
  };

  let body: ReactNode;
  if (error) {
    body = (
      <div
        data-testid="dashboard-error"
        style={{ ...noticeFrameStyle, color: TOKENS.red, fontSize: "12.5px" }}
      >
        Couldn’t load the dashboard: {error}
      </div>
    );
  } else if (!data) {
    body = (
      <div
        data-testid="dashboard-connecting"
        style={{ ...noticeFrameStyle, color: TOKENS.t3, fontSize: "12.5px" }}
      >
        {connecting === false ? "No dashboard data." : "Connecting…"}
      </div>
    );
  } else {
    body = (
      <div data-testid="dashboard-panel" style={frameStyle}>
        <div className="mvdash-shell">
          <Sidebar data={data} onAction={handleAction} />
          <div className="mvdash-main">
            <IdentityStrip data={data} />
            <div style={dividerStyle} />
            <ProjectZone data={data} />
            <div style={dividerStyle} />
            <WorkZone data={data} onAction={handleAction} />
            <div style={dividerStyle} />
            <ToolboxZone data={data} />
            {/*
              `role="status"` + aria-live: the line can sit well below the
              control that produced it (the panel measures ~1477px at the site
              shell width), so a silent DOM insertion is invisible to a screen
              reader and easy to miss on screen. "sent" gets no line — the
              conversation itself is the feedback.
            */}
            {outcome && outcome.result !== "sent" ? (
              <p
                data-testid={outcome.result === "manual" ? "dashboard-manual" : "dashboard-copied"}
                data-outcome={outcome.result}
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: `0.5px solid ${TOKENS.bd}`,
                  fontSize: "11.5px",
                  color: TOKENS.t2,
                }}
              >
                {outcome.result === "manual"
                  ? "Couldn’t send or copy. Run it yourself: "
                  : "Copied to the clipboard: "}
                <code
                  ref={(el) => {
                    manualRef.current = el;
                  }}
                  style={{
                    fontFamily: MV_FONT_MONO,
                    fontSize: 11,
                    background: TOKENS.srf2,
                    border: `0.5px solid ${TOKENS.bd}`,
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  {outcome.command}
                </code>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return <MvRoot theme={theme}>{body}</MvRoot>;
}

// ── wiring ───────────────────────────────────────────────────────────────────

export interface DashboardSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface DashboardWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: DashboardSeam;
}

export function DashboardWidget({ seam }: DashboardWidgetProps) {
  return seam ? <DashboardSeamWidget seam={seam} /> : <DashboardLiveWidget />;
}

/**
 * The action binding, shared by both wiring paths.
 *
 * ONE expression rather than one per path, deliberately: `useApp()` cannot be
 * driven under happy-dom, so only the seam path is reachable from a test. Two
 * separate literals would mean the covered path and the SHIPPED path were
 * different code, and deleting the production one would leave the suite green.
 * Sharing it makes the seam test's coverage transfer to production.
 */
function chatActionHandler(getApp: () => App | null) {
  return (command: string) => runChatAction(getApp() as ChatActionHost | null, command);
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport. */
function DashboardLiveWidget() {
  const [data, setData] = useState<DashboardState | null>(null);
  const appRef = useRef<App | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-dashboard", version: "0.8.1" },
    capabilities: {},
    onAppCreated: (created) => {
      appRef.current = created;
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as DashboardState);
        }
      };
    },
  });
  const theme = useHostTheme(app, isConnected);
  return (
    <DashboardView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onAction={chatActionHandler(() => appRef.current)}
      theme={theme}
    />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function DashboardSeamWidget({ seam }: { seam: DashboardSeam }) {
  const [data, setData] = useState<DashboardState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as DashboardState);
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
    <DashboardView
      data={data}
      connecting={!connected}
      error={error}
      onAction={chatActionHandler(() => seam.app)}
      theme={theme}
    />
  );
}
