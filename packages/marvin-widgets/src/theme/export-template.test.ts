import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MV_FONT_MONO, MV_FONT_SANS, MV_THEME_CSS } from "./tokens";

/**
 * Lockstep + hygiene guard for the report-export print template (ADR-0033,
 * spec 002-report-export-template). The committed template is a static plugin
 * asset the server never renders, so the drift guard lives here, next to the
 * token source of truth: it consumes the EXPORTED sheet (`MV_THEME_CSS` — the
 * declaration consts are module-private) and greps the template. Two-direction
 * rule: a pinned required subset must appear in the template, and every color
 * literal in the template must come from the sheet — so the guard can flag
 * palette drift without ever forcing unused declarations into the template.
 */

const SKILL_DIR = "plugins/marvin/skills/report-export";

// node:path string math, deliberately not `new URL(relative, import.meta.url)` —
// the happy-dom test environment overrides the global URL, whose relative
// resolution mangles the path (`…/src/theme/undefined`).
const HERE = dirname(fileURLToPath(import.meta.url));
const repoFile = (rel: string): string => join(HERE, "..", "..", "..", "..", rel);

const template = readFileSync(repoFile(`${SKILL_DIR}/references/export-template.html`), "utf8");
const digest = readFileSync(repoFile(`${SKILL_DIR}/references/export-template.md`), "utf8");
const skillMd = readFileSync(repoFile(`${SKILL_DIR}/SKILL.md`), "utf8");

/**
 * Canonical color form for comparison: lowercase, whitespace stripped, and every
 * decimal number normalized through parseFloat — the sheet writes
 * `rgba(139,92,246,.09)` / `.10` while Prettier formats the template side as
 * `rgba(139, 92, 246, 0.09)` / `0.1`. Hex digits pass through unchanged
 * (integer → identical string).
 */
const canon = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\d*\.?\d+/g, (n) => String(parseFloat(n)));

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

const sheetColors = new Set((MV_THEME_CSS.match(COLOR_RE) ?? []).map(canon));
const templateColors = new Set((template.match(COLOR_RE) ?? []).map(canon));

/** The pinned required subset (spec contract): surfaces, borders, text, accent, severity pairs. */
const REQUIRED_TOKENS = [
  "--bg",
  "--srf",
  "--srf2",
  "--bd",
  "--bd2",
  "--t1",
  "--t2",
  "--t3",
  "--ac",
  "--act",
  "--acbg",
  "--red",
  "--redbg",
  "--org",
  "--orgbg",
  "--amb",
  "--ambbg",
  "--grn",
  "--grnbg",
  "--blu",
  "--blubg",
] as const;

/** Every value the sheet declares for a token name (light + dark blocks). */
const sheetValuesOf = (token: string): string[] =>
  [...MV_THEME_CSS.matchAll(new RegExp(`${token}:([^;}]+)`, "g"))].map((m) => canon(m[1]!));

const PINNED_SLOTS = ['data-mv="title"', 'data-mv="meta"', 'data-mv="body"'];
const PINNED_MARKERS = [
  "<!-- mv:cookbook:findings -->",
  "<!-- mv:cookbook:checks -->",
  "<!-- mv:cookbook:document -->",
];
const PROVENANCE_LABELS = ["Source:", "Command:", "Generated:", "Exported:", "Marvin:"];

describe("export-template guard", () => {
  it("template is self-contained and token-locked", () => {
    // Required subset: every sheet value (light AND dark) of each pinned token
    // appears in the template.
    for (const token of REQUIRED_TOKENS) {
      const values = sheetValuesOf(token);
      expect(values.length, `${token} missing from MV_THEME_CSS`).toBeGreaterThan(0);
      for (const value of values) {
        expect(templateColors, `${token} value ${value} missing from template`).toContain(value);
      }
    }

    // No foreign colors: every color literal in the template comes from the sheet.
    for (const color of templateColors) {
      expect(sheetColors, `template color ${color} is not in the token sheet`).toContain(color);
    }

    // Both family font stacks, whitespace-insensitively (Prettier reflows them).
    const flatTemplate = template.replace(/\s+/g, "");
    expect(flatTemplate).toContain(MV_FONT_SANS.replace(/\s+/g, ""));
    expect(flatTemplate).toContain(MV_FONT_MONO.replace(/\s+/g, ""));

    // Print + theming blocks.
    expect(template).toMatch(/@media print/);
    expect(template).toMatch(/@page/);
    expect(template).toMatch(/prefers-color-scheme:\s*dark/);

    // Pinned slots and cookbook markers (spec contract vocabulary).
    for (const slot of PINNED_SLOTS) expect(template).toContain(slot);
    for (const marker of PINNED_MARKERS) expect(template).toContain(marker);
    for (const label of PROVENANCE_LABELS) expect(template).toContain(label);

    // Self-contained: no scripts, no external loads of any kind.
    expect(template).not.toMatch(/<script/i);
    expect(template).not.toMatch(/<link/i);
    expect(template).not.toMatch(/@import/);
    expect(template).not.toMatch(/url\(/i);
  });

  it("skill references resolve and the md skeleton mirrors the structure", () => {
    // Every references/ path the skill names must ship with the plugin.
    const refs = new Set(skillMd.match(/references\/[\w./-]+/g) ?? []);
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(existsSync(repoFile(`${SKILL_DIR}/${ref}`)), `${ref} does not exist`).toBe(true);
    }

    // The Markdown skeleton carries the same pinned vocabulary: the three
    // cookbook markers and the five provenance labels.
    for (const marker of PINNED_MARKERS) expect(digest).toContain(marker);
    for (const label of PROVENANCE_LABELS) expect(digest).toContain(`**${label}**`);
  });
});
