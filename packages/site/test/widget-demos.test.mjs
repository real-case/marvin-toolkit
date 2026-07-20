// widget-demos.test.mjs (spec 011-website-widget-embeds, F12) — the demo-asset guard (AC5).
//
// Mirrors catalog.test.mjs: node:test, assert/strict, sibling sources read by relative path, and
// the generator's PURE exports rather than its output directory — public/widget-demos/ is a
// git-ignored build output that may not exist in a fresh clone, so asserting against it would make
// the suite order-dependent on `npm run build`. Runs browser-free on both CI Node legs.
//
// What this pins: every committed widget has a demo payload, the count agrees with the generated
// catalog, and no fixture resolves to something the widget would render as its empty state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDemoPayloads,
  listWidgets,
  serializeFixture,
  PRIMARY_FIXTURE,
} from "../scripts/gen-widget-demos.mjs";

const here = import.meta.dirname;
const ROOT = join(here, "..", "..", ".."); // packages/site/test → repo root
const CATALOG_JSON = join(here, "..", "src", "data", "catalog.json");
const WIDGETS_HTML_DIR = join(ROOT, "plugins", "marvin", "widgets");

test("emits one document and one fixture per committed widget", async () => {
  const widgets = listWidgets();
  const payloads = await buildDemoPayloads();

  // One fixture payload per widget — no widget framed without data, no orphan payload.
  assert.deepEqual(
    Object.keys(payloads).sort(),
    widgets,
    "every committed widget needs exactly one demo fixture",
  );

  // The other half of AC5 is the HTML copy. This guard calls only the pure builder (see the
  // header), so instead of asserting on public/ it asserts the copy's SOURCE is real: each widget
  // resolves to a committed, non-trivial, self-contained document. A readdir-vs-readdir compare
  // here would be vacuous — both sides would be the same computation over the same directory.
  for (const widget of widgets) {
    const html = readFileSync(join(WIDGETS_HTML_DIR, `${widget}.html`), "utf8");
    assert.ok(html.length > 1000, `${widget}.html is implausibly small (${html.length} bytes)`);
    assert.match(html, /<script/i, `${widget}.html must carry its inlined bundle`);
    // `[^>]*` not `[^>]+`: with `+` the pattern needs an attribute BEFORE src, so the likeliest
    // regression shape — vite-plugin-singlefile disabled, emitting a bare `<script src="…">` —
    // would slip straight through the guard meant to catch it.
    assert.doesNotMatch(
      html,
      /<script[^>]*\ssrc=/i,
      `${widget}.html must be self-contained — an external script would 404 under the site's origin`,
    );
  }

  // The count the site advertises comes from the catalog; the demos must agree with it, or
  // /toolbox would claim N widgets while shipping a different number of demos.
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"));
  assert.equal(
    widgets.length,
    catalog.counts.widgets,
    `demo count (${widgets.length}) must equal catalog.counts.widgets (${catalog.counts.widgets})`,
  );

  // Each payload is a non-empty object — a widget fed `{}` renders its no-data state, which would
  // ship a "live demo" that looks broken.
  for (const widget of widgets) {
    const payload = payloads[widget];
    assert.equal(typeof payload, "object", `${widget}: payload must be an object`);
    assert.notEqual(payload, null, `${widget}: payload must not be null`);
    assert.ok(Object.keys(payload).length > 0, `${widget}: payload must not be empty`);
    // Round-trips as JSON — the demo is fetched and JSON.parsed in the browser.
    assert.deepEqual(JSON.parse(serializeFixture(payload)), payload, `${widget}: must serialize`);
  }
});

test("every committed widget has an explicit primary-fixture mapping", () => {
  const widgets = listWidgets();
  for (const widget of widgets) {
    assert.ok(
      PRIMARY_FIXTURE[widget],
      `widget "${widget}" has no PRIMARY_FIXTURE entry — a new widget must be mapped to its ` +
        `representative fixture export, never inferred (edge-case fixtures must not reach the site)`,
    );
  }
  // No stale entries either: a mapping for a widget that no longer exists is dead config.
  for (const mapped of Object.keys(PRIMARY_FIXTURE)) {
    assert.ok(widgets.includes(mapped), `PRIMARY_FIXTURE has a stale entry for "${mapped}"`);
  }
});
