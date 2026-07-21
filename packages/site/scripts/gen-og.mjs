#!/usr/bin/env node
// gen-og.mjs — the OpenGraph card images (spec 014-website-og-images, F3).
//
// Emits, from the page registry:
//   public/og/<page>.png   — one 1200x630 card per registry page (COMMITTED, unlike the other
//                            generators' output under public/ — see "committed, not built" below)
//   src/data/og.json       — the COMMITTED manifest: per card its file, dimensions, the exact text
//                            rendered, the palette it rendered with, and the font status observed
//
// COMMITTED, NOT BUILT. Every other generator here (gen-catalog, gen-widget-demos, gen-casts) runs
// on `prebuild`. This one deliberately does NOT, and `gen:og` is deliberately absent from the `gen`
// aggregate. Two reasons, both load-bearing:
//   1. CI's "Build all workspaces" step runs on both Node legs BEFORE any `playwright install`, so a
//      browser-dependent prebuild would fail there today.
//   2. Phase 7 deploys to Vercel, which would then have to download and run Chromium on every
//      deploy.
// Chromium output is also platform-dependent (Playwright suffixes its own snapshots by platform for
// this reason), so CI could not reproduce these bytes anyway. Regeneration is a darwin task, exactly
// like packages/marvin-widgets/__image_snapshots__/. test/og.test.mjs pins the separation so a
// future "why isn't this in gen?" cleanup fails loudly instead of breaking the deploy.
//
// WHY A BROWSER AND NOT AN SVG RASTERIZER. The obvious route — satori + @resvg/resvg-js — cannot
// read the fonts this site ships. @fontsource-variable publishes woff2 only; satori documents woff2
// as unsupported (it parses via opentype.js, which never added it), and resvg-js gates woff2 behind
// `#[cfg(target_arch = "wasm32")]`, so its native Node binding has no woff2 path at all. Reaching
// them needs a committed binary TTF plus a converter — three dependencies to emit five images —
// and satori implements only a CSS subset, so the card would be authored against different layout
// rules than the site's own. Chromium reads woff2 natively and is already a devDependency.
//
// THE SILENT FAILURE THIS FILE EXISTS TO PREVENT is a card rendered in a fallback face. It still
// looks like a finished card, and the artifact is a binary that code review cannot read. See
// assertFontsLoaded and .marvin/memory/document-fonts-check-returns-true-for.md — note in
// particular that `document.fonts.check()` is NOT a usable signal: it returns true against a page
// with zero registered faces, so it cannot detect a typo'd family or a dropped @font-face rule.
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", ".."); // packages/site/scripts → repo root
const OUT_DIR = join(here, "..", "public", "og");
const PAGES_JSON = join(here, "..", "src", "data", "pages.json");
const THEME_CSS = join(here, "..", "src", "styles", "theme.css");
const MANIFEST_JSON = join(here, "..", "src", "data", "og.json");

/** The OpenGraph card size every major platform renders at 1.91:1. */
export const WIDTH = 1200;
export const HEIGHT = 630;

/**
 * The two faces, each declared ONCE.
 *
 * `family` is single-sourced on purpose: it feeds the @font-face declaration, the CSS that asks for
 * it, AND the status lookup below. Split those into separate literals and an asymmetric typo
 * survives every guard — @font-face declares "A" and loads it, the template asks for "B" and gets
 * Helvetica, the lookup finds "A: loaded", and the manifest records success. One constant makes a
 * typo land in all three places (harmless — the face simply registers under the typo) or none.
 */
export const FONTS = {
  display: {
    family: "Hanken Grotesk Variable",
    specifier: "@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2",
  },
  mono: {
    family: "JetBrains Mono Variable",
    specifier: "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  },
};

/**
 * The theme tokens the card template references — and ONLY those.
 *
 * Scoping matters: theme.css's `:root` holds 31 pairs, including font stacks and status colours no
 * card touches. Recording all of them would make an edit to something like `--barR` fail the drift
 * guard and force a pointless five-PNG regeneration. Recording exactly what is rendered means the
 * guard fires when, and only when, a card actually went stale.
 */
export const CARD_TOKENS = ["bg", "t1", "t2", "bd", "acfill"];

/**
 * Parse the light-theme palette out of theme.css.
 *
 * Read rather than retyped, because hand-copied hexes drift silently: while authoring this spec, a
 * hand-typed dark palette read #09090b/#27272a against the real #0b0b0d/#26262c — a card that looks
 * entirely correct in isolation.
 *
 * Deliberately NOT exported. test/og.test.mjs must parse theme.css independently; if it could call
 * this, the assertion would agree with itself by construction and the guard would prove nothing.
 */
function resolvePalette(css) {
  // The FIRST `:root { … }` block is the light palette; the dark one lives inside an @media block
  // further down. Non-greedy and brace-free so it stops at the block's own closing brace.
  const match = css.match(/:root\s*\{([^{}]*)\}/);
  if (!match) throw new Error("[gen-og] could not locate the light :root block in theme.css");

  const declared = {};
  const re = /--([\w-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(match[1])) !== null) declared[m[1]] = m[2].trim();

  const palette = {};
  for (const token of CARD_TOKENS) {
    if (!declared[token]) {
      throw new Error(
        `[gen-og] theme.css declares no --${token}, which the card template renders with. ` +
          `Either the token was renamed (update CARD_TOKENS) or the parse broke.`,
      );
    }
    palette[token] = declared[token];
  }
  return palette;
}

/**
 * Throw unless every expected face reports "loaded".
 *
 * `statuses` maps family → FontFace.status, with "missing" where no FontFace exists at all. Carrying
 * the real status rather than a boolean is what lets the message distinguish a font that failed to
 * parse ("error") from one that was never declared ("missing") — different bugs, different fixes.
 *
 * Exported so test/og.test.mjs can drive the failure path directly. It is the one export this file
 * offers, because it is the one piece whose FAILURE behaviour has to be proven: running the
 * generator successfully only ever exercises the happy path.
 */
export function assertFontsLoaded(statuses) {
  const bad = Object.entries(statuses).filter(([, status]) => status !== "loaded");
  if (bad.length > 0) {
    throw new Error(
      `[gen-og] font(s) did not load: ${bad.map(([f, s]) => `"${f}" (${s})`).join(", ")}. ` +
        `The cards would have rendered in a fallback face and still looked finished. ` +
        `Check the @fontsource-variable paths and the family names in FONTS.`,
    );
  }
}

/** "/" → "home", "/commands" → "commands". The one filename rule, stated so it is never guessed. */
export function cardBasename(path) {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "home" : trimmed.replaceAll("/", "-");
}

/**
 * One page → the self-contained card document.
 *
 * Fonts are embedded as base64 `data:` URIs rather than `file://` URLs: Chromium treats file://
 * origins as opaque, and font fetches from them are CORS-sensitive. `font-display: block` (not
 * `swap`) because a screenshot has no second chance to repaint — a swap would let the capture land
 * on the fallback.
 */
export function buildCardHtml({ page, palette, fonts }) {
  const { display, mono } = FONTS;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"${display.family}";src:url(data:font/woff2;base64,${fonts.display}) format("woff2");font-weight:100 900;font-display:block}
@font-face{font-family:"${mono.family}";src:url(data:font/woff2;base64,${fonts.mono}) format("woff2");font-weight:100 800;font-display:block}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${WIDTH}px;height:${HEIGHT}px}
body{background:${palette.bg};color:${palette.t1};font-family:"${display.family}",sans-serif;position:relative;overflow:hidden}
.grid{position:absolute;inset:0;opacity:.5;
  background-image:linear-gradient(${palette.bd} 1px,transparent 1px),linear-gradient(90deg,${palette.bd} 1px,transparent 1px);
  background-size:40px 40px}
.pad{position:absolute;inset:0;padding:76px 80px;display:flex;flex-direction:column;justify-content:space-between}
.mark{font-family:"${mono.family}",monospace;font-size:34px;font-weight:700;color:${palette.acfill};letter-spacing:-.01em}
h1{font-size:82px;font-weight:800;letter-spacing:-.03em;line-height:1.02}
.card{font-size:29px;color:${palette.t2};margin-top:20px;max-width:30ch;line-height:1.35}
</style></head><body>
<div class="grid"></div>
<div class="pad">
<div class="mark">/marvin:</div>
<div><h1>${escapeHtml(page.title)}</h1><div class="card">${escapeHtml(page.card)}</div></div>
</div>
</body></html>`;
}

/** Registry prose is authored, not user input — but a stray `&` would still break the document. */
function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Serialization for the committed manifest — matches the sibling generators so Prettier stays out. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// Run directly (`npm run gen:og`) → render the cards. Imported (by the guard) → export only.
//
// `chromium` is imported HERE rather than at module top level, and that placement is load-bearing:
// test/og.test.mjs imports this file to reach assertFontsLoaded, and a top-level import would pull
// the entire Playwright module graph into a suite that is deliberately browser-free on both CI legs.
// The sibling gen-casts.mjs never had to solve this — it imports only node: builtins.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("@playwright/test");

  const require = createRequire(import.meta.url);
  const pages = JSON.parse(readFileSync(PAGES_JSON, "utf8"));
  const palette = resolvePalette(readFileSync(THEME_CSS, "utf8"));
  const fonts = {
    display: readFileSync(require.resolve(FONTS.display.specifier)).toString("base64"),
    mono: readFileSync(require.resolve(FONTS.mono.specifier)).toString("base64"),
  };
  const families = Object.values(FONTS).map((f) => f.family);

  // Rebuild from scratch so a page removed from the registry cannot leave a stale card behind.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const manifest = [];

  for (const page of pages) {
    const basename = cardBasename(page.path);
    const tab = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    await tab.setContent(buildCardHtml({ page, palette, fonts }), { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);

    // Built from the EXPECTED families, never by iterating document.fonts. In the never-registered
    // case that set is EMPTY, so iterating it yields {} and assertFontsLoaded would throw nothing
    // while five fallback-rendered cards were written — the same vacuity trap the readdir guards
    // in test/ defend against.
    const statuses = await tab.evaluate((expected) => {
      const out = {};
      for (const family of expected) {
        const face = [...document.fonts].find((f) => f.family === family);
        out[family] = face ? face.status : "missing";
      }
      return out;
    }, families);

    // Inside the per-card loop, immediately before the capture, so it cannot be bypassed for one
    // card — and the same map is what the manifest records, so the guard in test/ can confirm the
    // check actually ran for every committed card rather than merely being available to call.
    assertFontsLoaded(statuses);

    await tab.screenshot({
      path: join(OUT_DIR, `${basename}.png`),
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });
    await tab.close();

    manifest.push({
      path: page.path,
      file: `/og/${basename}.png`,
      width: WIDTH,
      height: HEIGHT,
      title: page.title,
      card: page.card,
      palette,
      fonts: statuses,
    });
  }

  await browser.close();
  writeFileSync(MANIFEST_JSON, serializeManifest(manifest));

  console.log(
    `[gen-og] wrote ${relative(ROOT, OUT_DIR)} — ${manifest.length} cards ` +
      `(${manifest.map((m) => m.file.replace("/og/", "")).join(", ")}) at ${WIDTH}x${HEIGHT}, ` +
      `and ${relative(ROOT, MANIFEST_JSON)}`,
  );
}
