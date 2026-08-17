// Shared types for the generated OpenGraph cards (spec 014-website-og-images, F5).
//
// scripts/gen-og.mjs emits og.json alongside the five committed PNGs under public/og/. This module
// declares its shape and re-exports it typed, exactly as catalog.ts, casts.ts and pages.ts do.
// Base.astro reads it so no card URL or dimension is hand-typed, which is also what makes swapping
// in a hand-designed card later a content-only change: replace the PNG and its row, touch nothing
// else.
//
// Data only. The `ogImageFor` lookup lives in lib/seo.ts with `findPage` and `normalizePath`,
// because that file owns every path-resolution rule on this site and says so in its header — a
// second, differently-normalizing lookup here would let "/commands/" resolve for canonical and miss
// for og:image.
//
// Like its siblings this is a STRAIGHT re-export with an explicit type annotation — no `as` cast —
// so --resolveJsonModule structurally checks the JSON's real contents against OgImage for free.
// The `check:catalog` tsc pass covers this file, keeping the type and the JSON in lockstep.
import data from "./og.json";

/** One page's OpenGraph card, as emitted by gen-og.mjs. */
export interface OgImage {
  /** Registry path this card belongs to, canonical form — NO trailing slash (home is "/"). */
  path: string;
  /** Site-root URL of the PNG, e.g. "/og/commands.png" — unhashed and stable, served from public/. */
  file: string;
  /** Always 1200. Declared in the tags so crawlers can lay out before fetching the image. */
  width: number;
  /** Always 630. */
  height: number;
  /** The title text as RENDERED into the PNG. Compared against the registry by test/og.test.mjs. */
  title: string;
  /** The card line as RENDERED into the PNG. Same guard. */
  card: string;
  /**
   * The theme tokens the card actually rendered with, token name → value.
   *
   * Recorded because a committed binary cannot be diffed in review and Chromium output is
   * platform-dependent, so pixel comparison is impossible in CI. Comparing these strings against
   * theme.css is what turns "the palette changed and the cards did not" into a build failure.
   */
  palette: Record<string, string>;
  /**
   * Font family → FontFace.status observed at render time; every entry must read "loaded".
   *
   * This is the evidence that the generator's font check actually ran on the render path for THIS
   * card, rather than merely existing as a function someone could call. A fallback-rendered card
   * still looks finished, so nothing else would catch it.
   */
  fonts: Record<string, string>;
}

export const ogImages: OgImage[] = data;

export default ogImages;
