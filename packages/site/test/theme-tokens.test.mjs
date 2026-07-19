// theme-tokens.test.mjs (spec 004, F18) — the token drift guard (AC2).
//
// Reads the widget theme source of truth (packages/marvin-widgets/src/theme/tokens.ts)
// and the site's ported theme.css as text, parses each token→value map, and asserts the
// site declares every widget token with an identical value per theme block. Values are
// canonicalised numerically first, because Prettier reformats the site's CSS
// ("rgba(139,92,246,.09)" in the TS source becomes "rgba(139, 92, 246, 0.09)" in CSS) —
// a naive string compare would false-fail. No cross-workspace import: both files are read
// as text, so the guard has no build dependency.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const tokensPath = join(here, "..", "..", "marvin-widgets", "src", "theme", "tokens.ts");
const themeCssPath = join(here, "..", "src", "styles", "theme.css");

// Canonical form: lowercase, whitespace-stripped; rgba/rgb parsed to numbers so
// ".09" == "0.09" == " 0.09 " and ".10" == "0.1".
function canon(value) {
  const v = value.trim().toLowerCase().replace(/;+$/, "").trim();
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return `rgba(${parts.join(",")})`;
  }
  return v.replace(/\s+/g, "");
}

// Parse `--name: value;` custom-property declarations from a block into { name: canon }.
function parsePairs(block) {
  const map = {};
  const re = /--([\w-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    map[m[1]] = canon(m[2]);
  }
  return map;
}

function extract(re, text, label) {
  const m = text.match(re);
  assert.ok(m, `could not locate ${label}`);
  return m[1];
}

test("token values match the widget theme", () => {
  const tokensTs = readFileSync(tokensPath, "utf8");
  const css = readFileSync(themeCssPath, "utf8");

  // AC2 structure: the site declares the three theming mechanisms.
  assert.match(css, /:root\s*\{/, "theme.css must declare tokens on :root");
  assert.match(
    css,
    /@media\s*\(prefers-color-scheme:\s*dark\)/,
    "theme.css must carry a prefers-color-scheme dark block",
  );
  assert.match(css, /:root\[data-theme="light"\]/, "theme.css must carry a forced-light override");
  assert.match(css, /:root\[data-theme="dark"\]/, "theme.css must carry a forced-dark override");

  const widgetLight = parsePairs(
    extract(/LIGHT_TOKEN_DECLARATIONS\s*=\s*`([\s\S]*?)`/, tokensTs, "LIGHT_TOKEN_DECLARATIONS"),
  );
  const widgetDark = parsePairs(
    extract(/DARK_TOKEN_DECLARATIONS\s*=\s*`([\s\S]*?)`/, tokensTs, "DARK_TOKEN_DECLARATIONS"),
  );
  // All four site blocks that carry the palette are checked, not just the toggled ones:
  // the bare :root (light default) and the @media (prefers-color-scheme: dark) :root are
  // the no-JS / pre-inline-script render; the two [data-theme] overrides are the toggled
  // render. A `[^{}]*` sweep finds the two bare :root blocks in document order (light, then
  // the @media dark). Checking all four means a token edit can't drift one copy past CI.
  const bareRoots = [...css.matchAll(/:root\s*\{([^{}]*)\}/g)].map((m) => m[1]);
  assert.ok(bareRoots.length >= 2, "expected a base :root and an @media dark :root block");

  const lightBlocks = {
    "base :root": parsePairs(bareRoots[0]),
    'forced :root[data-theme="light"]': parsePairs(
      extract(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/, css, "forced-light block"),
    ),
  };
  const darkBlocks = {
    "@media dark :root": parsePairs(bareRoots[1]),
    'forced :root[data-theme="dark"]': parsePairs(
      extract(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/, css, "forced-dark block"),
    ),
  };

  // Sanity: the widget source actually yielded tokens (guards a parser regression).
  assert.ok(Object.keys(widgetLight).length >= 20, "expected >=20 widget light tokens");
  assert.ok(Object.keys(widgetDark).length >= 15, "expected >=15 widget dark tokens");

  for (const [label, block] of Object.entries(lightBlocks)) {
    for (const [name, value] of Object.entries(widgetLight)) {
      assert.ok(name in block, `${label} is missing light token --${name}`);
      assert.equal(block[name], value, `light --${name} drifted from the widget theme in ${label}`);
    }
  }
  for (const [label, block] of Object.entries(darkBlocks)) {
    for (const [name, value] of Object.entries(widgetDark)) {
      assert.ok(name in block, `${label} is missing dark token --${name}`);
      assert.equal(block[name], value, `dark --${name} drifted from the widget theme in ${label}`);
    }
  }
});
