/**
 * The marvin widget theme — design tokens for the premium flat language approved
 * in docs/design/reports-widget.md (2026-07-16). The values are a 1:1 translation
 * of the approved mockup's `.pvroot` token block onto a `.mvroot` class; the
 * design doc's token table is the contract and `tokens.test.ts` pins every hex.
 *
 * Architecture (mirrors the mockup's `:root` pattern):
 *   1. light values on `.mvroot` (plus the base typography);
 *   2. dark values under `@media (prefers-color-scheme: dark)` — OS-driven;
 *   3. `.mvroot[data-theme="light"]` / `.mvroot[data-theme="dark"]` attribute
 *      overrides — host-forced theme. The attribute selector's specificity
 *      (0,2,0) beats the media-query rule (0,1,0), so a forced theme wins in
 *      BOTH directions regardless of the OS preference.
 *
 * Widgets never declare colors of their own: they style inline through the
 * `var(--…)` references exported below (TOKENS / SEVERITY_TOKENS / BAR_TOKENS).
 * Literal hex lives in this file alone (ground rule). The one token added beyond
 * the mockup sheet is `--acfillt` — the white text on the filled CTA, which the
 * mockup wrote as a literal `color:#fff` and widgets must be able to reference.
 */

/** Themes a host can force via MvRoot's `theme` prop (`data-theme` attribute). */
export type MvTheme = "light" | "dark";

/** The class the injected stylesheet scopes everything to. */
export const MV_ROOT_CLASS = "mvroot";

/** id of the injected `<style>` element — the once-per-document key. */
export const MV_STYLE_ELEMENT_ID = "mv-theme-styles";

/** System sans stack (base typography — 13px/1.5, letter-spacing -0.006em). */
export const MV_FONT_SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`;

/** Mono stack for paths, file:line chips, evidence blocks, command chips. */
export const MV_FONT_MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

// ── token declarations, byte-exact to the approved sheet ─────────────────────
// The dark set deliberately omits --barR/O/A/B and --acfillt: they are identical
// in both themes (design-doc table says "same"), so the base declaration holds.

const LIGHT_TOKEN_DECLARATIONS = `
  --bg:#fbfbfc;--srf:#ffffff;--srf2:#f4f4f5;--bd:#e9e9ec;--bd2:#d9d9de;
  --t1:#18181b;--t2:#52525b;--t3:#a1a1aa;
  --ac:#8b5cf6;--act:#6d28d9;--acbg:rgba(139,92,246,.09);--acfill:#7c3aed;--acfillt:#ffffff;
  --red:#dc2626;--redbg:#fef2f2;--org:#c2410c;--orgbg:#fff7ed;
  --amb:#b45309;--ambbg:#fffbeb;--grn:#15803d;--grnbg:#f0fdf4;
  --blu:#1d4ed8;--blubg:#eff6ff;
  --barR:#ef4444;--barO:#f97316;--barA:#f59e0b;--barB:#3b82f6;
`;

const DARK_TOKEN_DECLARATIONS = `
  --bg:#0b0b0d;--srf:#141417;--srf2:#1d1d22;--bd:#26262c;--bd2:#3a3a42;
  --t1:#f4f4f5;--t2:#a1a1aa;--t3:#70707a;
  --ac:#a78bfa;--act:#c4b5fd;--acbg:rgba(167,139,250,.13);--acfill:#7c3aed;
  --red:#f87171;--redbg:rgba(248,113,113,.11);--org:#fb923c;--orgbg:rgba(251,146,60,.11);
  --amb:#fbbf24;--ambbg:rgba(251,191,36,.10);--grn:#4ade80;--grnbg:rgba(74,222,128,.10);
  --blu:#60a5fa;--blubg:rgba(96,165,250,.11);
`;

/**
 * The stylesheet MvRoot injects once per document. Beyond the token blocks it
 * carries only what cannot live inline: the base typography on the root, the
 * border-box model, the 150ms color transitions (with the reduced-motion kill),
 * and the accent focus-visible outline (pseudo-classes need a stylesheet).
 * Everything else — surfaces, badges, rows, states — is widget-inline styling
 * over `var(--…)` references.
 */
export const MV_THEME_CSS = `
.mvroot{${LIGHT_TOKEN_DECLARATIONS}
  font-family:${MV_FONT_SANS};
  font-size:13px;line-height:1.5;letter-spacing:-0.006em;color:var(--t1);
}
@media (prefers-color-scheme: dark){
.mvroot{${DARK_TOKEN_DECLARATIONS}}
}
.mvroot[data-theme="light"]{${LIGHT_TOKEN_DECLARATIONS}}
.mvroot[data-theme="dark"]{${DARK_TOKEN_DECLARATIONS}}
.mvroot,.mvroot *{box-sizing:border-box}
.mvroot *{transition:background-color .15s ease,border-color .15s ease,color .15s ease}
@media (prefers-reduced-motion: reduce){
.mvroot,.mvroot *{transition:none!important}
}
.mvroot :focus-visible{outline:2px solid var(--ac);outline-offset:1px}
`;

/**
 * Token references for inline styles — `TOKENS.bg` is the string `"var(--bg)"`.
 * Keys mirror the CSS custom-property names so both sides grep alike.
 */
export const TOKENS = {
  /** widget canvas */
  bg: "var(--bg)",
  /** cards, surfaces */
  srf: "var(--srf)",
  /** second surface step: segmented track, code chips, hover, press */
  srf2: "var(--srf2)",
  /** hairline borders (0.5px) */
  bd: "var(--bd)",
  /** border on hover */
  bd2: "var(--bd2)",
  /** primary text */
  t1: "var(--t1)",
  /** secondary text */
  t2: "var(--t2)",
  /** meta text, microlabels */
  t3: "var(--t3)",
  /** accent: selection rail, active filters, engaged KPI border */
  ac: "var(--ac)",
  /** accent text on tint */
  act: "var(--act)",
  /** accent tint */
  acbg: "var(--acbg)",
  /** filled CTA ground */
  acfill: "var(--acfill)",
  /** text on the filled CTA (white in both themes) */
  acfillt: "var(--acfillt)",
  /** critical, fail */
  red: "var(--red)",
  redbg: "var(--redbg)",
  /** high */
  org: "var(--org)",
  orgbg: "var(--orgbg)",
  /** medium, stale */
  amb: "var(--amb)",
  ambbg: "var(--ambbg)",
  /** pass, clean */
  grn: "var(--grn)",
  grnbg: "var(--grnbg)",
  /** low */
  blu: "var(--blu)",
  blubg: "var(--blubg)",
  /** mid-ramp solid fills for the severity spark bar and mini-charts */
  barR: "var(--barR)",
  barO: "var(--barO)",
  barA: "var(--barA)",
  barB: "var(--barB)",
} as const;

export type MvTokenName = keyof typeof TOKENS;

/**
 * Severity/status → `{ text, bg }` token pair. `text` is the text-grade color
 * for badge text and small glyphs; `bg` is the matching tint. Solid fills in
 * visualizations use BAR_TOKENS instead (the brighter mid-ramp).
 */
export const SEVERITY_TOKENS = {
  critical: { text: TOKENS.red, bg: TOKENS.redbg },
  high: { text: TOKENS.org, bg: TOKENS.orgbg },
  medium: { text: TOKENS.amb, bg: TOKENS.ambbg },
  low: { text: TOKENS.blu, bg: TOKENS.blubg },
  pass: { text: TOKENS.grn, bg: TOKENS.grnbg },
  fail: { text: TOKENS.red, bg: TOKENS.redbg },
  /** neutral — the pending clock sits on the second surface step */
  pending: { text: TOKENS.t2, bg: TOKENS.srf2 },
  stale: { text: TOKENS.amb, bg: TOKENS.ambbg },
  clean: { text: TOKENS.grn, bg: TOKENS.grnbg },
} as const satisfies Record<string, { text: string; bg: string }>;

export type MvSeverityToken = keyof typeof SEVERITY_TOKENS;

/**
 * Severity → solid fill for the KPI spark bar and mini-charts. Keys are declared
 * in ramp order (critical → high → medium → low), so `Object.entries` iterates
 * the segments in render order.
 */
export const BAR_TOKENS = {
  critical: TOKENS.barR,
  high: TOKENS.barO,
  medium: TOKENS.barA,
  low: TOKENS.barB,
} as const satisfies Record<string, string>;

export type MvBarToken = keyof typeof BAR_TOKENS;
