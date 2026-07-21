// og.test.mjs (spec 014-website-og-images, F14) — the browser-free OpenGraph card guards.
//
// Covers AC1, AC3, AC4, AC5 and AC6 without launching anything: the cards are committed PNGs and
// their manifest is committed JSON, so every property worth asserting is readable from disk. That
// matters for CI-leg parity — scripts/build.mjs no-ops `astro build` below Node 22.12, so anything
// needing a built site runs on the Node-22 leg only, while node:test runs on both.
//
// WHY TEXT AND NOT PIXELS. Chromium output is platform-dependent (Playwright suffixes its own
// snapshots by platform for exactly this reason), so CI cannot regenerate these bytes and compare.
// The manifest therefore records what went INTO each render — the exact strings, the palette, the
// font status — and these assertions compare those against the sources they came from. That is what
// turns "the page was retitled and the card still says the old thing" into a build failure, in an
// artifact that code review cannot read.
//
// Generated data is read with readFileSync + JSON.parse, never `import` — node:test cannot import
// TypeScript and the Node-20 leg has no transpile step, matching seo.test.mjs and catalog.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// assertFontsLoaded is the ONLY import from the generator, and deliberately so: it is the one piece
// whose FAILURE behaviour has to be proven here, because running the generator successfully never
// exercises it. Everything else this file needs — the card size, the token list, the filename rule,
// the expected families — is restated below rather than imported, so a typo in the generator cannot
// satisfy the assertion that is supposed to catch it.
import { assertFontsLoaded } from "../scripts/gen-og.mjs";

const here = import.meta.dirname;
const registry = JSON.parse(readFileSync(join(here, "..", "src", "data", "pages.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(here, "..", "src", "data", "og.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const themeCss = readFileSync(join(here, "..", "src", "styles", "theme.css"), "utf8");
const OG_DIR = join(here, "..", "public", "og");

/** The OpenGraph card size. Hard-coded here on purpose — importing the generator's constants would
 *  let a typo there satisfy the assertion here. */
const WIDTH = 1200;
const HEIGHT = 630;

/** The tokens the card renders with, and the two faces it renders in — restated, not imported. */
const CARD_TOKENS = ["bg", "t1", "t2", "bd", "acfill"];
const FONT_FAMILIES = ["Hanken Grotesk Variable", "JetBrains Mono Variable"];

/** "/" → "home", "/commands" → "commands". The filename rule, restated so the guard is independent. */
function cardBasename(path) {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "home" : trimmed.replaceAll("/", "-");
}

/** PNG signature, then IHDR width/height as big-endian uint32 at byte 16 and 20. No image library. */
function pngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.subarray(0, 8).equals(signature), "file is not a PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Parse theme.css's light `:root` block INDEPENDENTLY of the generator.
 *
 * Deliberately a second implementation rather than an import of gen-og.mjs's resolver: calling the
 * generator's own parser would make this assertion agree with itself by construction and prove
 * nothing. Same reasoning e2e/seo.spec.ts applies to placeholder substitution.
 */
function lightTokens() {
  const block = themeCss.match(/:root\s*\{([^{}]*)\}/);
  assert.ok(block, "could not locate the light :root block in theme.css");
  const map = {};
  const re = /--([\w-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(block[1])) !== null) map[m[1]] = m[2].trim();
  return map;
}

test("every registry page has a committed 1200x630 card with no orphans", () => {
  // Non-vacuity floor first: a silently-empty registry or readdir would satisfy every "for each"
  // assertion below without checking anything. seo.test.mjs and catalog.test.mjs carry the same.
  assert.ok(registry.length >= 5, `expected >=5 registry pages, got ${registry.length}`);
  assert.equal(
    manifest.length,
    registry.length,
    "og.json must carry exactly one row per registry page",
  );

  const files = readdirSync(OG_DIR).filter((name) => name.endsWith(".png"));
  assert.equal(
    files.length,
    registry.length,
    `public/og/ must hold exactly one PNG per registry page — found ${files.join(", ")}`,
  );

  // Registry -> manifest, and the file on disk.
  for (const page of registry) {
    const row = manifest.find((entry) => entry.path === page.path);
    assert.ok(row, `no og.json row for registry page ${page.path}`);
    assert.equal(
      row.file,
      `/og/${cardBasename(page.path)}.png`,
      `card filename for ${page.path} does not follow the naming rule`,
    );

    const bytes = readFileSync(join(OG_DIR, `${cardBasename(page.path)}.png`));
    const size = pngSize(bytes);
    assert.deepEqual(
      size,
      { width: WIDTH, height: HEIGHT },
      `${row.file} is ${size.width}x${size.height}; every platform crops anything else`,
    );
    // The declared dimensions reach crawlers as og:image:width/height, so a mismatch would have
    // them lay out for a size the file is not.
    assert.equal(row.width, WIDTH, `${row.file} declares the wrong width in og.json`);
    assert.equal(row.height, HEIGHT, `${row.file} declares the wrong height in og.json`);
  }

  // Manifest -> registry: catches a card left behind after a page is removed.
  const paths = new Set(registry.map((page) => page.path));
  for (const row of manifest) {
    assert.ok(paths.has(row.path), `og.json has an orphan row for ${row.path}`);
  }
});

test("the committed manifest matches the page registry", () => {
  assert.ok(manifest.length >= 5, `expected >=5 manifest rows, got ${manifest.length}`);

  for (const page of registry) {
    const row = manifest.find((entry) => entry.path === page.path);
    assert.ok(row, `no og.json row for ${page.path}`);

    // These two strings were RENDERED INTO the PNG. If the registry has since changed, the
    // committed card shows text that appears nowhere on the page — and because the card is binary,
    // this assertion is the only thing that can see it.
    assert.equal(
      row.title,
      page.title,
      `${page.path}: card was rendered with the old title. Re-run \`npm run gen:og\` on darwin.`,
    );
    assert.equal(
      row.card,
      page.card,
      `${page.path}: card was rendered with the old card line. Re-run \`npm run gen:og\` on darwin.`,
    );
  }

  // Neither string rendered into a card may carry a catalog placeholder — a committed PNG cannot
  // resolve one, so it would bake the literal `{commands}` into the image.
  //
  // `title` matters as much as `card` and is the easier one to miss: gen-og.mjs renders it RAW,
  // while Base.astro renders it through resolvePlaceholders. So a title with a placeholder would
  // show the resolved count on the page and the literal braces on the card — and the title
  // comparison above would stay green, because it compares raw against raw.
  for (const page of registry) {
    for (const field of ["title", "card"]) {
      assert.doesNotMatch(
        page[field],
        /\{(commands|groups)\}/,
        `${page.path}: ${field} is rendered into the card, which cannot resolve placeholders`,
      );
    }
  }
});

test("the recorded card palette matches the theme tokens", () => {
  const tokens = lightTokens();
  assert.ok(Object.keys(tokens).length >= 20, "theme.css parse yielded too few tokens");
  assert.ok(CARD_TOKENS.length >= 3, "expected the card to render with at least three tokens");

  for (const row of manifest) {
    // Non-vacuity: an empty palette would pass a for-each comparison trivially.
    assert.deepEqual(
      Object.keys(row.palette).sort(),
      [...CARD_TOKENS].sort(),
      `${row.file}: palette must record exactly the tokens the card template renders with`,
    );

    for (const [token, value] of Object.entries(row.palette)) {
      assert.equal(
        value,
        tokens[token],
        `${row.file}: --${token} is "${tokens[token]}" in theme.css but the card was rendered ` +
          `with "${value}". The committed cards are off-brand — re-run \`npm run gen:og\` on darwin.`,
      );
    }
  }
});

test("card generation stays outside the prebuild script closure", () => {
  const scripts = pkg.scripts;
  assert.equal(typeof scripts["gen:og"], "string", "gen:og must exist as its own script");

  // Walk what `npm run build` transitively reaches. Resolving the closure rather than
  // string-matching `gen` means renaming the aggregate, or adding a layer between the build and the
  // generator, cannot smuggle a browser into the build.
  //
  // npm's IMPLICIT pre/post hooks are followed too, and that is not theoretical tidiness: a
  // `postbuild` or `pregen` script invoking gen:og would defeat this guard entirely while every
  // assertion stayed green, because neither is ever named by an `npm run` token.
  const reached = new Set();
  const visit = (name) => {
    if (!name || reached.has(name) || typeof scripts[name] !== "string") return;
    reached.add(name);
    for (const m of scripts[name].matchAll(/npm run ([\w:-]+)/g)) visit(m[1]);
    visit(`pre${name}`);
    visit(`post${name}`);
  };
  visit("build");

  // Sanity, so the walk cannot pass by reaching nothing at all.
  assert.ok(reached.has("prebuild"), "sanity: build should reach its prebuild hook");
  assert.ok(reached.has("gen"), "sanity: prebuild should still reach the gen aggregate");
  assert.ok(
    !reached.has("gen:og"),
    `build reaches gen:og via ${[...reached].join(" -> ")}. Card generation must stay out of ` +
      `the build: CI builds all workspaces on both legs BEFORE installing a browser, and Phase 7's ` +
      `Vercel deploy would have to download Chromium on every build.`,
  );

  // The direct form too — a script that calls the generator without going through `npm run`.
  for (const name of reached) {
    assert.doesNotMatch(
      scripts[name],
      /gen-og\.mjs/,
      `script "${name}" is reachable from the build and invokes gen-og.mjs directly`,
    );
  }
});

test("the font guard throws on a missing face and every committed card recorded both faces loaded", () => {
  // Clause (i): the guard rejects each way a face can fail to render. "missing" is the important
  // one — it is what a typo'd family or a dropped @font-face rule produces, and it is invisible to
  // document.fonts.check(), which returns TRUE against a page with zero registered faces.
  assert.throws(
    () => assertFontsLoaded({ "Hanken Grotesk Variable": "missing" }),
    /did not load.*Hanken Grotesk Variable.*missing/s,
    "a family with no FontFace at all must be rejected",
  );
  assert.throws(
    () => assertFontsLoaded({ "JetBrains Mono Variable": "error" }),
    /did not load.*JetBrains Mono Variable.*error/s,
    "a face that failed to parse must be rejected",
  );
  assert.throws(
    () => assertFontsLoaded({ a: "loaded", b: "unloaded" }),
    /did not load.*"b"/s,
    "one bad face among good ones must still be rejected",
  );
  assert.doesNotThrow(() => assertFontsLoaded({ a: "loaded", b: "loaded" }));

  // Clause (ii): the check actually RAN on the render path for every committed card. Without this,
  // clause (i) only proves a function can throw — nothing would tie it to the artifacts.
  for (const row of manifest) {
    assert.deepEqual(
      Object.keys(row.fonts).sort(),
      [...FONT_FAMILIES].sort(),
      `${row.file}: fonts must record a status for every expected family`,
    );
    for (const [family, status] of Object.entries(row.fonts)) {
      assert.equal(
        status,
        "loaded",
        `${row.file}: "${family}" was ${status} at render time — this card is in a fallback face ` +
          `and still looks finished. Re-run \`npm run gen:og\` on darwin.`,
      );
    }
  }
});
