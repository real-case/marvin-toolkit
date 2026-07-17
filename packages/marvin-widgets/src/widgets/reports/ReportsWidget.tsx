import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  ChecksBody,
  DocumentBody,
  FindingsBody,
  LinkRef,
  ReportEnvelope,
  ReportFinding,
  ReportGroup,
  ReportListPayload,
  Severity,
} from "@marvin-toolkit/mcp-shared/contracts";
import { ListDetail } from "../../primitives/ListDetail";
import { Markdown } from "../../primitives/Markdown";
import { classifyLink, dispatchLink } from "../../lib/links";
import {
  BAR_TOKENS,
  MV_FONT_MONO,
  MvRoot,
  SEVERITY_TOKENS,
  TOKENS,
  type MvTheme,
} from "../../theme";
import {
  SEVERITY_ORDER,
  type SummarySeverity,
  computeKpis,
  formatAge,
  matchesSearch,
  shortCommand,
  worstSeverity,
} from "./helpers";

/**
 * The reports widget (docs/design/reports-widget.md) — one master-detail viewer
 * over every document marvin generates under `.marvin/`. Each report arrives in
 * the same `ReportEnvelope` and renders through one of three body kinds:
 * `findings` (severity-ranked disclosure rows), `checks` (pass/fail/pending
 * rows) or `document` (rendered markdown). The KPI strip, group segments,
 * search and severity chips are all widget-local filters — no host round-trips;
 * deep-linking is data (`payload.selected` pre-selects a row).
 *
 * Split into the pure {@link ReportsView} (props-only, no SDK) plus the live
 * `useApp` wiring and the injected-seam wiring below — the audit/task-list
 * pattern, so the render is fully driven by props in tests and stories.
 */

// ── icons — exact paths from the approved mockup (24 viewBox, stroke 2) ──────

const ICON_PATHS = {
  refresh: (
    <>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chevd: <path d="M6 9l6 6 6-6" />,
  chevu: <path d="M6 15l6-6 6 6" />,
  arrowr: <path d="M5 12h14M12 5l7 7-7 7" />,
  ext: (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  ccheck: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </>
  ),
  fsearch: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <circle cx="11" cy="14" r="2.5" />
      <path d="M13 16l2.5 2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
} as const;

type IconName = keyof typeof ICON_PATHS;

function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-2px", flex: "none" }}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// ── widget-local stylesheet — only what cannot live inline (pseudo-classes) ──
// Same id-keyed once-per-document lifecycle as MvRoot / ListDetail. Base rules
// live here too (not inline) so :hover / :active / .on can actually win.

const REPORTS_STYLE_ID = "mv-reports-styles";
const REPORTS_CSS = `
.mvrep-kpi{background:${TOKENS.srf};border:0.5px solid ${TOKENS.bd};border-radius:4px;padding:12px 14px;text-align:left;font:inherit;letter-spacing:inherit;color:inherit;cursor:pointer}
.mvrep-kpi:hover{border-color:${TOKENS.bd2}}
.mvrep-kpi:active{background:${TOKENS.srf2}}
.mvrep-kpi.on{border-color:${TOKENS.ac}}
.mvrep-gbtn{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;color:${TOKENS.t2};background:transparent;border:0.5px solid ${TOKENS.bd};border-radius:4px;padding:3px 10px;cursor:pointer;letter-spacing:inherit}
.mvrep-gbtn:hover{background:${TOKENS.srf2};color:${TOKENS.t1}}
.mvrep-fhead{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;background:transparent;border:none;font:inherit;color:inherit;cursor:pointer;text-align:left;letter-spacing:inherit}
.mvrep-fhead:hover{background:${TOKENS.srf2}}
.mvrep-search::placeholder{color:${TOKENS.t3}}
.mvrep-doc h1,.mvrep-doc h2,.mvrep-doc h3,.mvrep-doc h4,.mvrep-doc h5,.mvrep-doc h6{font-size:10.5px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:${TOKENS.t3};margin:12px 0 4px}
.mvrep-doc p{margin:0 0 8px;font-size:12.5px;color:${TOKENS.t2};line-height:1.6}
.mvrep-doc ul,.mvrep-doc ol{margin:2px 0 8px;padding-left:16px;font-size:12.5px;color:${TOKENS.t2};line-height:1.7}
`;

function ensureReportsStyles(): void {
  if (typeof document === "undefined" || document.getElementById(REPORTS_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = REPORTS_STYLE_ID;
  style.textContent = REPORTS_CSS;
  document.head.appendChild(style);
}

// ── shared style fragments (the design-doc component recipes) ────────────────

const num: CSSProperties = { fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" };

const card: CSSProperties = {
  background: TOKENS.srf,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
};

const lab: CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: TOKENS.t3,
};

const ccStyle: CSSProperties = {
  fontFamily: MV_FONT_MONO,
  fontSize: 11,
  background: TOKENS.srf2,
  border: `0.5px solid ${TOKENS.bd}`,
  borderRadius: 4,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

const pillBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "1px 9px",
  borderRadius: 4,
  fontSize: 11.5,
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const ellipsis: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const kpiValue: CSSProperties = { ...num, fontSize: 21, fontWeight: 500, marginTop: 2 };
const kpiSub: CSSProperties = { fontSize: 11.5, color: TOKENS.t3, marginTop: 6 };

/** Severity/status → the theme's `{text, bg}` pair, neutral for unknown keys (`info`). */
function pillTokens(key: string): { text: string; bg: string } {
  return (
    (SEVERITY_TOKENS as Record<string, { text: string; bg: string }>)[key] ?? {
      text: TOKENS.t2,
      bg: TOKENS.srf2,
    }
  );
}

/** Tinted status pill: 5px currentColor dot + lowercase label on the tone's tint. */
function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  const t = pillTokens(tone);
  return (
    <span style={{ ...pillBase, background: t.bg, color: t.text }}>
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "currentColor",
          flex: "none",
        }}
      />
      {children}
    </span>
  );
}

/** Neutral tag — second-surface ground, secondary text, no dot. */
function NeutralPill({ children, tabular }: { children: ReactNode; tabular?: boolean }) {
  return (
    <span
      style={{ ...pillBase, ...(tabular ? num : null), background: TOKENS.srf2, color: TOKENS.t2 }}
    >
      {children}
    </span>
  );
}

/**
 * The list-row / envelope status pill, from the summary chip: worst severity for
 * findings ("clean" when none), pass/fail/`n/m` for checks, the kind tag for
 * documents.
 */
function StatusPill({ report }: { report: ReportEnvelope }) {
  const s = report.summary;
  if (s.kind === "checks") {
    if (s.failed > 0) return <Pill tone="fail">fail</Pill>;
    if (s.total > 0 && s.done === s.total) return <Pill tone="pass">pass</Pill>;
    return (
      <NeutralPill tabular>
        {s.done}/{s.total}
      </NeutralPill>
    );
  }
  if (s.kind === "document") return <NeutralPill>{s.tag}</NeutralPill>;
  const worst = worstSeverity(s.counts);
  return worst ? <Pill tone={worst}>{worst}</Pill> : <Pill tone="clean">clean</Pill>;
}

// ── copy-to-clipboard (v1 continuation commands are copy-only chips) ─────────

/**
 * Copy through the async clipboard API when the host grants it, else try the
 * classic hidden-textarea + execCommand path. Returns whether the text actually
 * reached the clipboard — a sandboxed host that blocks both yields `false`, and
 * the caller falls back to select-on-click (the brief's resolved decision #6).
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the execCommand attempt */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    try {
      area.select();
      return document.execCommand("copy") === true;
    } finally {
      area.remove();
    }
  } catch {
    return false; // clipboard unavailable in this host — nothing further to try
  }
}

/**
 * Select-on-click fallback for a copy affordance: when no clipboard write
 * landed, select the revealed command text so a manual ⌘C still works in one
 * gesture. Best-effort — never throws (mirrors HandoffsWidget).
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
    /* selection is best-effort — the revealed text stays hand-selectable */
  }
}

/**
 * Copy-chip state: "copied" only after the text verifiably reached the
 * clipboard (resets after 1.5s); "manual" when both clipboard paths were
 * denied — the chip reveals the raw command for select-on-click instead of
 * falsely claiming success. Timer cleaned on unmount.
 */
type CopyStatus = "idle" | "copied" | "manual";

function useCopied(): [CopyStatus, (text: string) => void] {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    void (async () => {
      const ok = await copyText(text);
      clearTimeout(timer.current);
      if (ok) {
        setStatus("copied");
        timer.current = setTimeout(() => setStatus("idle"), 1500);
      } else {
        setStatus("manual");
      }
    })();
  }, []);
  return [status, copy];
}

/** Selects `ref`'s contents whenever the copy status lands on "manual". */
function useManualSelect(status: CopyStatus, ref: { current: HTMLElement | null }): void {
  useEffect(() => {
    if (status === "manual") selectNodeText(ref.current);
  }, [status, ref]);
}

/**
 * A ghost button that copies `text` on click. Confirms with a "Copied" swap
 * only when the write landed; a denied clipboard reveals the raw command
 * pre-selected for a manual copy instead.
 */
function CopyAction({
  text,
  label,
  icon,
  style,
  testId,
}: {
  text: string;
  label: string;
  icon: IconName;
  style?: CSSProperties;
  testId?: string;
}) {
  const [status, copy] = useCopied();
  const manualRef = useRef<HTMLSpanElement>(null);
  useManualSelect(status, manualRef);
  return (
    <button
      type="button"
      className="mvrep-gbtn"
      style={style}
      onClick={() => copy(text)}
      data-testid={testId}
    >
      {status === "manual" ? (
        <span ref={manualRef} style={{ fontFamily: MV_FONT_MONO, userSelect: "all" }}>
          {text}
        </span>
      ) : (
        <>
          <Icon name={status === "copied" ? "check" : icon} size={12} />
          {status === "copied" ? "Copied" : label}
        </>
      )}
    </button>
  );
}

// ── KPI strip ────────────────────────────────────────────────────────────────

/** 4px severity spark bar — `BAR_TOKENS` mid-ramp fills, flex-grown by count. */
function SparkBar({ counts }: { counts: Record<SummarySeverity, number> }) {
  const segments = (Object.keys(BAR_TOKENS) as SummarySeverity[]).filter((s) => counts[s] > 0);
  if (segments.length === 0) return null;
  return (
    <div
      data-testid="kpi-spark"
      style={{
        display: "flex",
        height: 4,
        borderRadius: 2,
        overflow: "hidden",
        gap: 2,
        marginTop: 8,
      }}
    >
      {segments.map((s) => (
        <span key={s} style={{ flexGrow: counts[s], background: BAR_TOKENS[s] }} />
      ))}
    </div>
  );
}

/**
 * One stat card. States are class-driven (`.mvrep-kpi` + `.on`) so hover/press
 * pseudo-classes and the engaged accent border compose; `aria-pressed` mirrors
 * the engaged flag for assistive tech (the design-doc interaction contract).
 */
function KpiCard({
  label,
  engaged = false,
  onClick,
  testId,
  children,
}: {
  label: string;
  engaged?: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={engaged ? "mvrep-kpi on" : "mvrep-kpi"}
      aria-pressed={engaged}
      onClick={onClick}
      data-testid={testId}
    >
      <div style={lab}>{label}</div>
      {children}
    </button>
  );
}

// ── findings body ────────────────────────────────────────────────────────────

/** One severity filter chip; the active chip fills with its severity's tint. */
function SevChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** Severity key for the active tint; null = the "All" chip (accent tint). */
  tone: string | null;
  onClick: () => void;
}) {
  const activeTone = tone ? pillTokens(tone) : { text: TOKENS.act, bg: TOKENS.acbg };
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        font: "inherit",
        fontSize: 11.5,
        fontWeight: 500,
        borderRadius: 4,
        border: `0.5px solid ${active ? "transparent" : TOKENS.bd}`,
        background: active ? activeTone.bg : "transparent",
        color: active ? activeTone.text : TOKENS.t2,
        padding: "2px 10px",
        cursor: "pointer",
        letterSpacing: "inherit",
      }}
    >
      {label} <span style={{ ...num, opacity: 0.6 }}>{count}</span>
    </button>
  );
}

/** One disclosure finding row: pill · id · title · location chip · chevron. */
function FindingRow({
  finding,
  onOpenLink,
}: {
  finding: ReportFinding;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const location = finding.file
    ? finding.line
      ? `${finding.file}:${finding.line}`
      : finding.file
    : null;
  const links = finding.links ?? [];
  const hasActions = links.length > 0 || location !== null || Boolean(finding.fixCommand);
  return (
    <div style={{ ...card, marginBottom: 7, overflow: "hidden" }}>
      <button
        type="button"
        className="mvrep-fhead"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Pill tone={finding.severity}>{finding.severity}</Pill>
        <span style={{ ...num, fontFamily: MV_FONT_MONO, fontSize: 11, color: TOKENS.t3 }}>
          {finding.id}
        </span>
        <span style={{ ...ellipsis, flex: 1, fontWeight: 500 }}>{finding.title}</span>
        {location ? (
          <span style={{ ...ccStyle, ...ellipsis, maxWidth: "10rem", color: TOKENS.t2 }}>
            {location}
          </span>
        ) : null}
        <span style={{ color: TOKENS.t3 }}>
          <Icon name={open ? "chevu" : "chevd"} size={13} />
        </span>
      </button>
      {open ? (
        <div
          style={{
            borderTop: `0.5px solid ${TOKENS.bd}`,
            padding: "10px 12px",
            background: TOKENS.srf,
          }}
        >
          {finding.evidence ? (
            <>
              <div style={{ ...lab, marginBottom: 4 }}>Evidence</div>
              <div
                data-testid="finding-evidence"
                style={{
                  ...ccStyle,
                  display: "block",
                  whiteSpace: "pre-wrap",
                  padding: "8px 10px",
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  color: TOKENS.t2,
                }}
              >
                {finding.evidence}
              </div>
            </>
          ) : null}
          {finding.direction ? (
            <div
              data-testid="finding-direction"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                fontSize: 12,
                color: TOKENS.t2,
              }}
            >
              <span style={{ color: TOKENS.t3 }}>
                <Icon name="arrowr" size={12} />
              </span>
              {finding.direction}
              {finding.effort ? <NeutralPill>effort {finding.effort}</NeutralPill> : null}
            </div>
          ) : null}
          {hasActions ? (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                alignItems: "center",
                marginTop: 9,
              }}
            >
              {links.map((link) => {
                const action = classifyLink(link);
                return (
                  <button
                    key={`${link.kind}:${link.url ?? link.ref ?? link.label}`}
                    type="button"
                    className="mvrep-gbtn"
                    onClick={() => onOpenLink?.(link)}
                  >
                    {action.type === "external" ? <Icon name="ext" size={12} /> : null}
                    {link.label}
                  </button>
                );
              })}
              {location ? (
                <button type="button" className="mvrep-gbtn">
                  <Icon name="file" size={12} />
                  {location}
                </button>
              ) : null}
              {finding.fixCommand ? (
                <CopyAction
                  text={finding.fixCommand}
                  label={finding.fixCommand}
                  icon="copy"
                  testId="finding-fix"
                  style={{
                    color: TOKENS.act,
                    borderColor: "transparent",
                    background: TOKENS.acbg,
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Findings body: severity chips over the disclosure rows plus the truncation note. */
function FindingsBodyView({
  reportId,
  body,
  sevFilter,
  onSevFilter,
  onOpenLink,
}: {
  /** Envelope id — namespaces row keys so `F1` in two reports never shares state. */
  reportId: string;
  body: FindingsBody;
  sevFilter: Severity | null;
  onSevFilter: (s: Severity | null) => void;
  onOpenLink?: (link: LinkRef) => void;
}) {
  const counts = new Map<Severity, number>();
  for (const f of body.findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const present = SEVERITY_ORDER.filter((s) => (counts.get(s) ?? 0) > 0);
  const visible = sevFilter ? body.findings.filter((f) => f.severity === sevFilter) : body.findings;
  return (
    <div>
      <div
        role="group"
        aria-label="Filter by severity"
        data-testid="severity-filter"
        style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "10px 0" }}
      >
        <SevChip
          label="All"
          count={body.findings.length}
          active={sevFilter === null}
          tone={null}
          onClick={() => onSevFilter(null)}
        />
        {present.map((s) => (
          <SevChip
            key={s}
            label={s}
            count={counts.get(s) ?? 0}
            active={sevFilter === s}
            tone={s}
            onClick={() => onSevFilter(s)}
          />
        ))}
      </div>
      {visible.map((f) => (
        // Namespaced by report: finding ids restart at F1 in every register, and
        // a bare `f.id` key would carry one report's open/closed state into the
        // next report's same-position row.
        <FindingRow key={`${reportId}:${f.id}`} finding={f} onOpenLink={onOpenLink} />
      ))}
      {visible.length === 0 ? (
        <div style={{ color: TOKENS.t3, padding: "6px 0", fontSize: 12.5 }}>
          No findings for this severity.
        </div>
      ) : null}
      {body.truncated && sevFilter === null ? (
        <div
          data-testid="truncated-note"
          style={{ ...num, color: TOKENS.t3, fontSize: 11.5, padding: "2px 0" }}
        >
          + {body.truncated} more in the report file
        </div>
      ) : null}
    </div>
  );
}

// ── checks body ──────────────────────────────────────────────────────────────

const CHECK_TONES: Record<string, { icon: IconName; text: string; bg: string }> = {
  pass: { icon: "check", text: TOKENS.grn, bg: TOKENS.grnbg },
  fail: { icon: "x", text: TOKENS.red, bg: TOKENS.redbg },
  pending: { icon: "clock", text: TOKENS.t3, bg: TOKENS.srf2 },
};

/** Checks body: the `d/t` roll-up over a bordered card of icon-square rows. */
function ChecksBodyView({ body }: { body: ChecksBody }) {
  const done = body.checks.filter((c) => c.status === "pass").length;
  const ok = body.checks.length > 0 && done === body.checks.length;
  return (
    <div data-testid="checks-body">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "10px 0 6px" }}>
        <span style={{ ...num, fontSize: 20, fontWeight: 500, color: ok ? TOKENS.grn : TOKENS.t1 }}>
          {done}/{body.checks.length}
        </span>
        <span style={{ fontSize: 12, color: TOKENS.t3 }}>{ok ? "all green" : "in progress"}</span>
      </div>
      <div style={card}>
        {body.checks.map((c, i) => {
          const tone = CHECK_TONES[c.status] ?? CHECK_TONES.pending;
          return (
            <div
              key={c.name}
              style={{
                display: "flex",
                gap: 9,
                alignItems: "center",
                padding: "7px 12px",
                borderBottom: i < body.checks.length - 1 ? `0.5px solid ${TOKENS.bd}` : undefined,
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
                  background: tone.bg,
                  color: tone.text,
                }}
              >
                <Icon name={tone.icon} size={12} />
              </span>
              <span style={{ flex: 1, fontWeight: 500 }}>{c.name}</span>
              {c.note ? (
                <span style={{ ...num, fontSize: 11.5, color: TOKENS.t3 }}>{c.note}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── detail pane ──────────────────────────────────────────────────────────────

/** Positive empty body — a findings report with nothing in it: the clean state. */
function CleanReport({ report, now }: { report: ReportEnvelope; now: number }) {
  return (
    <div data-testid="report-clean" style={{ marginTop: 10, padding: 14, textAlign: "center" }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 4,
          background: TOKENS.grnbg,
          color: TOKENS.grn,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="shield" size={16} />
      </div>
      <div style={{ fontWeight: 500, marginTop: 6, fontSize: 12.5 }}>All clear</div>
      <div style={{ fontSize: 11.5, color: TOKENS.t3, marginTop: 2 }}>
        {report.title} · no findings · {formatAge(report.generatedAt, now)} ago
      </div>
    </div>
  );
}

interface ReportDetailProps {
  report: ReportEnvelope;
  now: number;
  sevFilter: Severity | null;
  onSevFilter: (s: Severity | null) => void;
  onOpenLink?: (link: LinkRef) => void;
  /** Mirrors the shown report id up to the view (KPI engaged states, filters). */
  onShown: (id: string) => void;
}

/** The envelope every report shares (title row + meta row) over its body kind. */
function ReportDetail({
  report,
  now,
  sevFilter,
  onSevFilter,
  onOpenLink,
  onShown,
}: ReportDetailProps) {
  // ListDetail owns row selection; this effect is the one seam that tells the
  // widget WHICH report the detail pane currently shows (keyboard or click).
  useEffect(() => {
    onShown(report.id);
  }, [report.id, onShown]);

  let body: ReactNode;
  if (report.kind === "findings") {
    const b = report.body as FindingsBody;
    body =
      b.findings.length === 0 && !b.truncated ? (
        <CleanReport report={report} now={now} />
      ) : (
        <FindingsBodyView
          reportId={report.id}
          body={b}
          sevFilter={sevFilter}
          onSevFilter={onSevFilter}
          onOpenLink={onOpenLink}
        />
      );
  } else if (report.kind === "checks") {
    body = <ChecksBodyView body={report.body as ChecksBody} />;
  } else {
    body = (
      // The design contract's document typography (docs/design/reports-widget.md
      // §F): microlabel section headings, 12.5px/1.6 secondary-text paragraphs
      // and 1.7 lists — applied over <Markdown>'s neutral output via .mvrep-doc.
      <div
        className="mvrep-doc"
        data-testid="document-body"
        style={{ marginTop: 10, maxWidth: "34rem" }}
      >
        <Markdown source={(report.body as DocumentBody).markdown} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          data-testid="detail-title"
          style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: "-0.01em" }}
        >
          {report.title}
        </span>
        <StatusPill report={report} />
        <div style={{ flex: 1 }} />
        {report.rerunCommand ? (
          <CopyAction
            text={report.rerunCommand}
            label="Re-run"
            icon="refresh"
            testId="detail-rerun"
          />
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          gap: 7,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 5,
          fontSize: 11.5,
          color: TOKENS.t3,
        }}
      >
        <span style={{ ...ccStyle, color: TOKENS.t2 }}>{report.path}</span>
        <span>/marvin:{report.generatedBy}</span>
        <span style={num}>· {formatAge(report.generatedAt, now)} ago</span>
        {report.stale ? <Pill tone="stale">stale</Pill> : null}
      </div>
      {body}
    </div>
  );
}

// ── empty-state CTA ──────────────────────────────────────────────────────────

/**
 * The widget's single filled CTA — copies the first-scan command on click.
 * "Copied" only on a verified write; a denied clipboard reveals the command
 * pre-selected for a manual copy.
 */
function EmptyCta() {
  const [status, copy] = useCopied();
  const manualRef = useRef<HTMLSpanElement>(null);
  useManualSelect(status, manualRef);
  return (
    <button
      type="button"
      data-testid="reports-empty-cta"
      onClick={() => copy("/marvin:sec-scan")}
      style={{
        font: "inherit",
        fontSize: 12,
        fontWeight: 500,
        background: TOKENS.acfill,
        color: TOKENS.acfillt,
        border: "none",
        borderRadius: 4,
        padding: "5px 12px",
        cursor: "pointer",
      }}
    >
      {status === "manual" ? (
        <span ref={manualRef} style={{ fontFamily: MV_FONT_MONO, userSelect: "all" }}>
          /marvin:sec-scan
        </span>
      ) : status === "copied" ? (
        "Copied /marvin:sec-scan"
      ) : (
        "Run first scan"
      )}
    </button>
  );
}

// ── the pure view ────────────────────────────────────────────────────────────

const GROUPS = [
  ["all", "All"],
  ["security", "Security"],
  ["refactor", "Refactor"],
  ["task", "Task"],
  ["handoff", "Handoff"],
] as const;

type GroupKey = "all" | ReportGroup;

export interface ReportsViewProps {
  /** The payload to render; `null` before the first tool-result arrives. */
  data: ReportListPayload | null;
  /** True while the host handshake is in flight and no data has arrived. */
  connecting?: boolean;
  /** A connection/handshake error message, if any. */
  error?: string | null;
  /** Open a link through the host. Omitted in pure-render contexts (tests/story). */
  onOpenLink?: (link: LinkRef) => void;
  /**
   * The zone-A Sync action (design §A): ask the conversation to re-run
   * `/marvin:reports` — the handoffs chat-action precedent. Omitted in
   * pure-render contexts; the button then renders as a quiet no-op.
   */
  onSync?: () => void;
  /** Clock for age labels — injectable so tests and visual stories stay deterministic. */
  now?: number;
  /** Pin a theme (Storybook only); production omits it so the host/OS scheme applies. */
  theme?: MvTheme;
}

/**
 * Pure presentational reports view. Owns only widget-local UI state: the group
 * segment, the search query, the per-report severity filter, and the mirrored
 * "shown report" id. Selection mechanics stay inside `<ListDetail>`; the view
 * reaches selection programmatically (deep-link, KPI cards, group re-selection)
 * by clicking the target row's real DOM button — a documented controlled
 * pattern that leaves the primitive untouched and keeps every path (click,
 * keyboard, programmatic) flowing through the same internal state.
 */
export function ReportsView({
  data,
  connecting,
  error,
  onOpenLink,
  onSync,
  now,
  theme,
}: ReportsViewProps) {
  ensureReportsStyles();
  const nowMs = now ?? Date.now();
  const reports = data?.reports ?? [];

  const [group, setGroup] = useState<GroupKey>("all");
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState<Severity | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const shownIdRef = useRef<string | null>(null);
  /** A programmatic selection in flight: the row to click + the sev filter to land on. */
  const pendingRef = useRef<{ id: string; sev: Severity | null } | null>(null);
  const deepLinked = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [, forceTick] = useState(0);

  /** Called by the detail pane whenever the shown report changes (any path). */
  const handleShown = useCallback((id: string) => {
    if (shownIdRef.current === id) return;
    shownIdRef.current = id;
    setShownId(id);
    const p = pendingRef.current;
    if (p && p.id === id) {
      pendingRef.current = null;
      setSevFilter(p.sev);
    } else {
      // A user-driven selection change resets the severity filter (mockup rsel).
      setSevFilter(null);
    }
  }, []);

  // Deep-link: the payload's `selected` id pre-selects its row exactly once.
  useEffect(() => {
    if (deepLinked.current || !data?.selected) return;
    deepLinked.current = true;
    if (data.reports.some((r) => r.id === data.selected)) {
      pendingRef.current = { id: data.selected, sev: null };
      forceTick((t) => t + 1);
    }
  }, [data]);

  // Programmatic selection: click the pending row's real option button so
  // ListDetail's own state moves. Runs every commit (after the list rendered);
  // a no-op unless something is pending. handleShown consumes pendingRef.
  useEffect(() => {
    const p = pendingRef.current;
    if (!p) return;
    const root = listRef.current;
    if (!root) {
      pendingRef.current = null;
      return;
    }
    const holder = Array.from(root.querySelectorAll<HTMLElement>("[data-report-id]")).find(
      (el) => el.dataset.reportId === p.id,
    );
    const btn = holder?.closest<HTMLButtonElement>('button[role="option"]');
    if (!btn) {
      pendingRef.current = null;
      return;
    }
    if (btn.getAttribute("aria-selected") === "true") {
      pendingRef.current = null;
      setSevFilter(p.sev);
    } else {
      btn.click();
    }
  });

  /** Select a report by id, adjusting whichever filters would hide its row. */
  const selectReport = useCallback(
    (id: string | null, sev: Severity | null = null, forceGroup?: GroupKey) => {
      if (!id) return;
      const target = reports.find((r) => r.id === id);
      if (!target) return;
      setGroup((g) => forceGroup ?? (g === "all" || target.group === g ? g : "all"));
      setSearch((s) => (s && !matchesSearch(target, s) ? "" : s));
      pendingRef.current = { id, sev };
      forceTick((t) => t + 1);
    },
    [reports],
  );

  /** Group segment click — keep the shown report selected when it stays visible. */
  const onGroupSelect = (g: GroupKey) => {
    setGroup(g);
    setSevFilter(null);
    const current = shownIdRef.current
      ? reports.find((r) => r.id === shownIdRef.current)
      : undefined;
    if (current && (g === "all" || current.group === g) && matchesSearch(current, search)) {
      pendingRef.current = { id: current.id, sev: null };
    } else {
      pendingRef.current = null;
    }
    forceTick((t) => t + 1);
  };

  const frame = (children: ReactNode) => (
    <MvRoot theme={theme}>
      <div
        style={{
          background: TOKENS.bg,
          border: `0.5px solid ${TOKENS.bd}`,
          borderRadius: 4,
          padding: 14,
        }}
      >
        {children}
      </div>
    </MvRoot>
  );

  if (error) {
    return frame(
      <div data-testid="reports-error" style={{ color: TOKENS.red, fontSize: 12.5 }}>
        Couldn’t load reports: {error}
      </div>,
    );
  }
  if (!data) {
    if (connecting === false) {
      return frame(
        <div data-testid="reports-nodata" style={{ color: TOKENS.t3, fontSize: 12.5 }}>
          No data.
        </div>,
      );
    }
    // Connecting: a wordless skeleton — four second-surface bars in a card.
    return frame(
      <div data-testid="reports-connecting" aria-hidden="true" style={{ ...card, padding: 12 }}>
        {(["55%", "85%", "70%", "80%"] as const).map((width, i) => (
          <div
            key={width}
            style={{
              background: TOKENS.srf2,
              borderRadius: 4,
              height: 9,
              width,
              marginTop: i === 0 ? 0 : 8,
            }}
          />
        ))}
      </div>,
    );
  }
  if (reports.length === 0) {
    return frame(
      <div data-testid="reports-empty" style={{ ...card, padding: 14, textAlign: "center" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 4,
            background: TOKENS.acbg,
            color: TOKENS.act,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="fsearch" size={16} />
        </div>
        <div style={{ fontWeight: 500, marginTop: 6, fontSize: 12.5 }}>No reports yet</div>
        <div style={{ fontSize: 11.5, color: TOKENS.t3, margin: "2px 0 8px" }}>
          Scans and audits will appear here
        </div>
        <EmptyCta />
      </div>,
    );
  }

  const kpis = computeKpis(data);
  const visible = reports.filter(
    (r) => (group === "all" || r.group === group) && matchesSearch(r, search),
  );

  return frame(
    <>
      {/* A — header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "2px 2px 12px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.015em" }}>
              Reports
            </span>
            <NeutralPill tabular>
              <span data-testid="reports-count">{reports.length}</span>
            </NeutralPill>
          </div>
          <div style={{ fontSize: 12, color: TOKENS.t3 }}>
            <span style={num}>.marvin/</span> · all generated documents
          </div>
        </div>
        <button
          type="button"
          className="mvrep-gbtn"
          data-testid="reports-sync"
          onClick={() => onSync?.()}
        >
          <Icon name="refresh" size={12} />
          Sync
        </button>
      </div>

      {/* B — KPI strip */}
      <div
        data-testid="reports-kpis"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <KpiCard label="Open findings" testId="kpi-open" onClick={() => onGroupSelect("all")}>
          <div style={kpiValue}>{kpis.openTotal}</div>
          <SparkBar counts={kpis.severityCounts} />
        </KpiCard>
        <KpiCard
          label="Critical"
          testId="kpi-critical"
          engaged={sevFilter === "critical"}
          onClick={() => {
            const target = kpis.criticalTargetId
              ? reports.find((r) => r.id === kpis.criticalTargetId)
              : undefined;
            if (target) selectReport(target.id, "critical", target.group);
          }}
        >
          <div style={{ ...kpiValue, color: kpis.criticalTotal > 0 ? TOKENS.red : undefined }}>
            {kpis.criticalTotal}
          </div>
          <div style={{ ...kpiSub, ...num }}>
            {kpis.criticalTotal > 0 ? kpis.criticalBreakdown : "none"}
          </div>
        </KpiCard>
        <KpiCard
          label="Quality gates"
          testId="kpi-gates"
          engaged={kpis.gates !== null && shownId === kpis.gates.reportId}
          onClick={() => selectReport(kpis.gates?.reportId ?? null)}
        >
          {kpis.gates === null ? (
            <div style={{ ...kpiValue, color: TOKENS.t3 }}>—</div>
          ) : kpis.gates.verdict === "pass" ? (
            <div
              style={{
                ...kpiValue,
                color: TOKENS.grn,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="ccheck" size={17} />
              Pass
            </div>
          ) : kpis.gates.verdict === "fail" ? (
            <div
              style={{
                ...kpiValue,
                color: TOKENS.red,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="x" size={17} />
              Fail
            </div>
          ) : (
            <div style={kpiValue}>
              {kpis.gates.done}/{kpis.gates.total}
            </div>
          )}
          <div style={{ ...kpiSub, ...num }}>
            {kpis.gates
              ? `${kpis.gates.done}/${kpis.gates.total} · ${formatAge(kpis.gates.generatedAt, nowMs)} ago`
              : "no verification yet"}
          </div>
        </KpiCard>
        <KpiCard
          label="Stale reports"
          testId="kpi-stale"
          engaged={kpis.oldestStale !== null && shownId === kpis.oldestStale.id}
          onClick={() => selectReport(kpis.oldestStale?.id ?? null)}
        >
          <div style={{ ...kpiValue, color: kpis.staleCount > 0 ? TOKENS.amb : undefined }}>
            {kpis.staleCount}
          </div>
          <div style={{ ...kpiSub, ...num }}>
            {kpis.oldestStale
              ? `oldest ${formatAge(kpis.oldestStale.generatedAt, nowMs)} · ${shortCommand(kpis.oldestStale.generatedBy)}`
              : "all fresh"}
          </div>
        </KpiCard>
      </div>

      {/* C — toolbar: group segments + search, stretched to one height */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          data-testid="group-filter"
          role="group"
          aria-label="Filter by group"
          style={{
            display: "inline-flex",
            background: TOKENS.srf2,
            borderRadius: 4,
            padding: 2,
            gap: 2,
          }}
        >
          {GROUPS.map(([key, label]) => {
            const count =
              key === "all" ? reports.length : reports.filter((r) => r.group === key).length;
            const active = group === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => onGroupSelect(key)}
                style={{
                  font: "inherit",
                  fontSize: 12.5,
                  border: "none",
                  borderRadius: 4,
                  padding: "4px 11px",
                  cursor: "pointer",
                  letterSpacing: "inherit",
                  background: active ? TOKENS.srf : "transparent",
                  color: active ? TOKENS.t1 : TOKENS.t2,
                }}
              >
                {label}
                <span style={{ ...num, color: TOKENS.t3, fontSize: 11, marginLeft: 3 }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: TOKENS.srf,
            border: `0.5px solid ${TOKENS.bd}`,
            borderRadius: 4,
            padding: "0 10px",
            color: TOKENS.t3,
            minWidth: 160,
          }}
        >
          <Icon name="search" size={13} />
          <input
            className="mvrep-search"
            data-testid="reports-search"
            aria-label="Search reports"
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{
              font: "inherit",
              fontSize: 12,
              color: TOKENS.t1,
              background: "transparent",
              border: "none",
              flex: 1,
              minWidth: 0,
              padding: 0,
            }}
          />
        </div>
      </div>

      {/* D/E/F — master list + detail */}
      <div ref={listRef} style={{ ...card, overflow: "hidden" }}>
        <ListDetail
          // Remount on filter change; a pending re-selection restores the row.
          key={`${group}|${search}`}
          items={visible}
          getKey={(r) => r.id}
          ariaLabel="reports"
          emptyLabel="No reports match the current filters."
          renderRow={(r) => (
            <span data-report-id={r.id} style={{ display: "block" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ ...ellipsis, fontWeight: 500, flex: 1 }}>{r.title}</span>
                <StatusPill report={r} />
              </span>
              <span
                style={{
                  ...num,
                  display: "flex",
                  gap: 5,
                  fontSize: 11.5,
                  color: TOKENS.t3,
                  marginTop: 2,
                }}
              >
                {`${r.group} · ${r.generatedBy} · ${formatAge(r.generatedAt, nowMs)}`}
                {r.stale ? <span style={{ color: TOKENS.amb }}>· stale</span> : null}
              </span>
            </span>
          )}
          renderDetail={(r) => (
            <ReportDetail
              report={r}
              now={nowMs}
              sevFilter={sevFilter}
              onSevFilter={setSevFilter}
              onOpenLink={onOpenLink}
              onShown={handleShown}
            />
          )}
        />
      </div>
    </>,
  );
}

// ── transport wiring (the audit/task-list seam pattern) ──────────────────────

/**
 * The transport seam. `useApp` hard-wires a `PostMessageTransport` to
 * `window.parent`, which is `=== window` under happy-dom, so automated tests
 * inject an `App` + in-memory transport instead. Production omits `seam`.
 */
export interface ReportsSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface ReportsWidgetProps {
  /** Test-only injected App + transport. Omit for the production path. */
  seam?: ReportsSeam;
}

/**
 * Widget entry. Picks the live (`useApp`) or seam wiring by whether a seam was
 * injected; the choice is fixed per mount, so this wrapper calls no hooks and
 * the two children each own their hook order.
 */
export function ReportsWidget({ seam }: ReportsWidgetProps) {
  return seam ? <ReportsSeamWidget seam={seam} /> : <ReportsLiveWidget />;
}

/** Production wiring — `useApp()` creates the App + PostMessageTransport and connects. */
function ReportsLiveWidget() {
  const [data, setData] = useState<ReportListPayload | null>(null);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "marvin-reports", version: "0.8.1" },
    capabilities: {},
    onAppCreated: (created) => {
      // Handler set before connect so the first tool-result is never missed.
      created.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as unknown as ReportListPayload);
        }
      };
    },
  });
  const onOpenLink = (link: LinkRef) => {
    if (app) void dispatchLink(app, link).catch(() => {});
  };
  // Zone-A Sync: refresh by asking the conversation to re-run the report tool —
  // the same chat-action path as the handoffs continue button.
  const onSync = () => {
    if (app) {
      void app
        .sendMessage({ role: "user", content: [{ type: "text", text: "/marvin:reports" }] })
        .catch(() => {});
    }
  };
  return (
    <ReportsView
      data={data}
      connecting={!isConnected}
      error={error ? error.message : null}
      onOpenLink={onOpenLink}
      onSync={onSync}
    />
  );
}

/** Test wiring — drive an injected App over the mock-host's in-memory transport. */
function ReportsSeamWidget({ seam }: { seam: ReportsSeam }) {
  const [data, setData] = useState<ReportListPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { app, transport } = seam;
    let cancelled = false;
    app.ontoolresult = (result) => {
      if (!cancelled && result.structuredContent) {
        setData(result.structuredContent as unknown as ReportListPayload);
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
  const onSync = () => {
    void seam.app
      .sendMessage({ role: "user", content: [{ type: "text", text: "/marvin:reports" }] })
      .catch(() => {});
  };

  return (
    <ReportsView
      data={data}
      connecting={!connected}
      error={error}
      onOpenLink={onOpenLink}
      onSync={onSync}
    />
  );
}
