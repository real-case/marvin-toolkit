import { describe, expect, it } from "vitest";
import { BAR_TOKENS, MV_FONT_SANS, MV_THEME_CSS, SEVERITY_TOKENS, TOKENS } from "./tokens";

/**
 * The design contract, restated (docs/design/reports-widget.md token table /
 * the approved mockup's .pvroot block). A deliberate second copy: the source
 * builds the CSS from its own declarations, so drifting a hex there fails here.
 */
const APPROVED_LIGHT: Record<string, string> = {
  "--bg": "#fbfbfc",
  "--srf": "#ffffff",
  "--srf2": "#f4f4f5",
  "--bd": "#e9e9ec",
  "--bd2": "#d9d9de",
  "--t1": "#18181b",
  "--t2": "#52525b",
  "--t3": "#a1a1aa",
  "--ac": "#8b5cf6",
  "--act": "#6d28d9",
  "--acbg": "rgba(139,92,246,.09)",
  "--acfill": "#7c3aed",
  "--acfillt": "#ffffff",
  "--red": "#dc2626",
  "--redbg": "#fef2f2",
  "--org": "#c2410c",
  "--orgbg": "#fff7ed",
  "--amb": "#b45309",
  "--ambbg": "#fffbeb",
  "--grn": "#15803d",
  "--grnbg": "#f0fdf4",
  "--blu": "#1d4ed8",
  "--blubg": "#eff6ff",
  "--barR": "#ef4444",
  "--barO": "#f97316",
  "--barA": "#f59e0b",
  "--barB": "#3b82f6",
};

/**
 * Dark redeclares everything EXCEPT --barR/O/A/B and --acfillt, which the
 * design doc marks "same" in both themes — those inherit from the base block.
 */
const APPROVED_DARK: Record<string, string> = {
  "--bg": "#0b0b0d",
  "--srf": "#141417",
  "--srf2": "#1d1d22",
  "--bd": "#26262c",
  "--bd2": "#3a3a42",
  "--t1": "#f4f4f5",
  "--t2": "#a1a1aa",
  "--t3": "#70707a",
  "--ac": "#a78bfa",
  "--act": "#c4b5fd",
  "--acbg": "rgba(167,139,250,.13)",
  "--acfill": "#7c3aed",
  "--red": "#f87171",
  "--redbg": "rgba(248,113,113,.11)",
  "--org": "#fb923c",
  "--orgbg": "rgba(251,146,60,.11)",
  "--amb": "#fbbf24",
  "--ambbg": "rgba(251,191,36,.10)",
  "--grn": "#4ade80",
  "--grnbg": "rgba(74,222,128,.10)",
  "--blu": "#60a5fa",
  "--blubg": "rgba(96,165,250,.11)",
};

/**
 * Body of the first rule whose selector starts at/after `from`. Runs at module
 * scope too, so it throws plainly instead of asserting via expect().
 */
function ruleBody(css: string, marker: string, from = 0): string {
  const at = css.indexOf(marker, from);
  if (at < 0) throw new Error(`selector not found in MV_THEME_CSS: ${marker}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  if (open < 0 || close < 0) throw new Error(`unbraced rule in MV_THEME_CSS: ${marker}`);
  return css.slice(open + 1, close);
}

/** All `--name: value` declarations in a rule body. */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g)) {
    out[`--${match[1]}`] = match[2].trim();
  }
  return out;
}

const lightBlock = declarations(ruleBody(MV_THEME_CSS, ".mvroot{"));
const mediaDarkBlock = declarations(
  ruleBody(MV_THEME_CSS, ".mvroot", MV_THEME_CSS.indexOf("@media (prefers-color-scheme: dark)")),
);
const attrLightBlock = declarations(ruleBody(MV_THEME_CSS, '.mvroot[data-theme="light"]'));
const attrDarkBlock = declarations(ruleBody(MV_THEME_CSS, '.mvroot[data-theme="dark"]'));

describe("MV_THEME_CSS token blocks", () => {
  it("declares exactly the approved light values on .mvroot", () => {
    expect(lightBlock).toEqual(APPROVED_LIGHT);
  });

  it("declares exactly the approved dark values under prefers-color-scheme: dark", () => {
    expect(mediaDarkBlock).toEqual(APPROVED_DARK);
  });

  it("repeats the dark values under the host-forced [data-theme=dark] override", () => {
    expect(attrDarkBlock).toEqual(APPROVED_DARK);
  });

  it("repeats the light values under the host-forced [data-theme=light] override", () => {
    expect(attrLightBlock).toEqual(APPROVED_LIGHT);
  });
});

describe("MV_THEME_CSS base rules", () => {
  it("sets the base typography on the root", () => {
    const root = ruleBody(MV_THEME_CSS, ".mvroot{");
    expect(root).toContain(`font-family:${MV_FONT_SANS}`);
    expect(root).toContain("font-size:13px");
    expect(root).toContain("line-height:1.5");
    expect(root).toContain("letter-spacing:-0.006em");
    expect(root).toContain("color:var(--t1)");
  });

  it("applies border-box to the root and every descendant", () => {
    expect(MV_THEME_CSS).toContain(".mvroot,.mvroot *{box-sizing:border-box}");
  });

  it("declares the 150ms color transitions and kills them under reduced motion", () => {
    expect(MV_THEME_CSS).toContain(
      ".mvroot *{transition:background-color .15s ease,border-color .15s ease,color .15s ease}",
    );
    const reducedAt = MV_THEME_CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(reducedAt).toBeGreaterThanOrEqual(0);
    expect(ruleBody(MV_THEME_CSS, ".mvroot,.mvroot *", reducedAt)).toContain(
      "transition:none!important",
    );
  });

  it("outlines keyboard focus with the accent", () => {
    expect(ruleBody(MV_THEME_CSS, ".mvroot :focus-visible")).toContain(
      "outline:2px solid var(--ac)",
    );
  });
});

describe("token constants", () => {
  it("every TOKENS entry is a var() over a custom prop the light block declares", () => {
    for (const [key, ref] of Object.entries(TOKENS)) {
      const name = ref.match(/^var\((--[\w-]+)\)$/)?.[1];
      expect(name, `TOKENS.${key} is not a bare var() reference: ${ref}`).toBeTruthy();
      expect(lightBlock[name as string], `TOKENS.${key} → ${name} is undeclared`).toBeDefined();
    }
  });

  it("SEVERITY_TOKENS pairs resolve to declared custom props", () => {
    for (const [severity, pair] of Object.entries(SEVERITY_TOKENS)) {
      for (const ref of [pair.text, pair.bg]) {
        const name = ref.match(/^var\((--[\w-]+)\)$/)?.[1];
        expect(name, `${severity} ref is not a bare var(): ${ref}`).toBeTruthy();
        expect(lightBlock[name as string], `${severity} → ${name} is undeclared`).toBeDefined();
      }
    }
  });

  it("maps the severity semantics the design doc fixes", () => {
    expect(SEVERITY_TOKENS.critical).toEqual({ text: "var(--red)", bg: "var(--redbg)" });
    expect(SEVERITY_TOKENS.high).toEqual({ text: "var(--org)", bg: "var(--orgbg)" });
    expect(SEVERITY_TOKENS.medium).toEqual({ text: "var(--amb)", bg: "var(--ambbg)" });
    expect(SEVERITY_TOKENS.low).toEqual({ text: "var(--blu)", bg: "var(--blubg)" });
    expect(SEVERITY_TOKENS.pass).toEqual({ text: "var(--grn)", bg: "var(--grnbg)" });
    expect(SEVERITY_TOKENS.fail).toEqual({ text: "var(--red)", bg: "var(--redbg)" });
    expect(SEVERITY_TOKENS.pending).toEqual({ text: "var(--t2)", bg: "var(--srf2)" });
    expect(SEVERITY_TOKENS.stale).toEqual({ text: "var(--amb)", bg: "var(--ambbg)" });
    expect(SEVERITY_TOKENS.clean).toEqual({ text: "var(--grn)", bg: "var(--grnbg)" });
  });

  it("BAR_TOKENS walks the mid-ramp in severity order", () => {
    expect(Object.entries(BAR_TOKENS)).toEqual([
      ["critical", "var(--barR)"],
      ["high", "var(--barO)"],
      ["medium", "var(--barA)"],
      ["low", "var(--barB)"],
    ]);
    for (const ref of Object.values(BAR_TOKENS)) {
      const name = ref.match(/^var\((--[\w-]+)\)$/)?.[1];
      expect(lightBlock[name as string], `${ref} is undeclared`).toBeDefined();
    }
  });
});
