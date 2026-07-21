import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the Toolbox page. Originally spec 009 (static shell); updated by spec 011
// (F10), which replaced the Phase-5 absence guards — "no iframe", "no astro-island", the
// placeholder stage copy — with the shipped behaviour now that the demo canvas is a live island.
// Test titles match the specs' oracle refs exactly.
//
// The live-embed proofs themselves live in widget-demo.spec.ts; this file covers the page around
// them: the journey, the canvas's Screenshot side (AC3), and the canvas's responsive/theme
// behaviour (AC7).

// Read the generated catalog as text (not an import) — Node 24 ESM requires an import
// attribute for JSON, and the repo's e2e reads sibling data the same way.
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../src/data/catalog.json"), "utf8"));

// All nine committed widgets are now present: spec 011 added task-detail (to `steer`) and
// task-summary (to `review & share`), which the Phase-3 shell was missing.
//
// These are COMMANDS, not widget names — the two namespaces differ, and printing a widget name as
// a command is how `/marvin:task-list` and `/marvin:task-detail` (neither of which exists) once
// reached this page. `/marvin:track-list` appears twice on purpose: it answers the board view
// (task-list widget) and the tracked view (tracker-list widget). test/command-refs.test.mjs is the
// guard that keeps this list honest against the generated catalog.
const WIDGET_LABELS = [
  "/marvin:help",
  "/marvin:dashboard",
  "/marvin:track-list",
  "/marvin:track-show",
  "/marvin:reports",
  "/marvin:sec-report",
  "/marvin:task-summary",
  "/marvin:handoff-list",
];

/** Bring the canvas island into view and wait for it to hydrate. */
async function openCanvas(page: import("@playwright/test").Page) {
  const canvas = page.locator(".wd-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas.locator(".wd-picker button").first()).toBeVisible({ timeout: 15_000 });
  return canvas;
}

test("toolbox renders the visual-toolbox header and the arrive, steer, review journey in order", async ({
  page,
}) => {
  await page.goto("/toolbox");

  // Header: the accent eyebrow and the display-face title, copy verbatim from the mockup.
  await expect(page.locator(".eyebrow").first()).toHaveText("visual toolbox");
  await expect(page.locator("h1")).toHaveText("The toolbox.");

  // The three journey step labels, in document order (arrive → steer → review & share).
  const steps = (await page.locator(".journey .step").allTextContents()).map((t) => t.trim());
  expect(steps).toEqual(["arrive", "steer", "review & share"]);

  // Every committed widget is presented — the whole family, one mini each.
  const labels = (await page.locator(".wmini .h").allTextContents()).join(" ");
  for (const label of WIDGET_LABELS) {
    expect(labels, `missing widget mini "${label}"`).toContain(label);
  }
  await expect(page.locator(".wmini")).toHaveCount(catalog.counts.widgets); // 9
});

test("toolbox renders the demo-canvas shell, the parity line, and the catalog-driven widget count", async ({
  page,
}) => {
  await page.goto("/toolbox");

  // The widget count is catalog-driven, not hand-typed (FR-20).
  await expect(page.locator(".chip")).toContainText(String(catalog.counts.widgets)); // 9

  const canvas = await openCanvas(page);

  // The demo canvas opens on Live demo (exactly one segment active).
  const toggle = canvas.locator(".toggle");
  await expect(toggle).toContainText("Live demo");
  await expect(toggle).toContainText("Screenshot");
  const active = canvas.locator('.toggle button[aria-pressed="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText("Live demo");

  // The picker offers every widget, and opens on help.
  await expect(canvas.locator(".wd-picker button")).toHaveCount(catalog.counts.widgets);
  await expect(canvas).toHaveAttribute("data-widget", "help");

  // The closing terminal-parity line.
  await expect(page.locator(".parline")).toContainText("Interactive in MCP Apps hosts");
});

test("toolbox screenshot side renders the static mini and mounts no iframe", async ({ page }) => {
  await page.goto("/toolbox");
  const canvas = await openCanvas(page);

  // Wait for the live side to actually come up, so the swap below proves a real teardown rather
  // than racing a frame that never mounted.
  await expect(canvas).toHaveAttribute("data-status", "live", { timeout: 15_000 });
  await expect(canvas.locator("iframe.wd-frame")).toHaveCount(1);

  // Switching to Screenshot moves the marker and tears the frame down entirely.
  await canvas.locator('.toggle button[data-stage="shot"]').click();
  const active = canvas.locator('.toggle button[aria-pressed="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText("Screenshot");
  await expect(canvas.locator("iframe")).toHaveCount(0);

  // The selected widget's static mini stands in, cloned from the journey grid above.
  const clone = canvas.locator(".wd-clone");
  await expect(clone).toBeVisible();
  await expect(clone).toContainText("/marvin:help");
  // Decorative — the authored original above it is the one in the accessibility tree.
  await expect(clone).toHaveAttribute("aria-hidden", "true");

  // Selecting a different widget swaps which mini is shown, still with no frame.
  await canvas.locator('.wd-picker button[data-widget="reports"]').click();
  await expect(canvas.locator(".wd-clone")).toContainText("/marvin:reports");
  await expect(canvas.locator("iframe")).toHaveCount(0);

  // ...and back to Live remounts a frame.
  await canvas.locator('.toggle button[data-stage="live"]').click();
  await expect(canvas.locator("iframe.wd-frame")).toHaveCount(1);
});

test("toolbox demo canvas sizes and themes correctly from 360 to 1440", async ({ page }) => {
  // AC7 deliberately measures the island's OWN stage — the live frame, or the cloned fallback —
  // and never `.stage-area`, which existed and rendered non-zero before this feature and would
  // therefore prove the Astro page rather than WidgetDemo.css.
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/toolbox");
    const canvas = await openCanvas(page);
    await expect(canvas).toHaveAttribute("data-status", "live", { timeout: 15_000 });

    const frame = canvas.locator("iframe.wd-frame");
    const box = await frame.boundingBox();
    expect(box, `demo stage must have a layout box at ${width}px`).not.toBeNull();
    expect(box!.width, `demo stage collapsed horizontally at ${width}px`).toBeGreaterThan(80);
    expect(box!.height, `demo stage collapsed vertically at ${width}px`).toBeGreaterThan(80);

    // The frame must not push the page sideways — a replaced element with an intrinsic width is
    // exactly what reintroduces the grid-overflow trap the Phase-3 slices had to fix.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }

  // Both themes hold on the canvas, and the framed widget follows (proved in depth by
  // widget-demo.spec.ts; here it guards the page-level pairing).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/toolbox");
  const canvas = await openCanvas(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(canvas).toHaveAttribute("data-status", "live", { timeout: 15_000 });
  await expect(page.frameLocator("iframe.wd-frame").locator(".mvroot")).toHaveAttribute(
    "data-theme",
    "light",
  );

  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.frameLocator("iframe.wd-frame").locator(".mvroot")).toHaveAttribute(
    "data-theme",
    "dark",
  );
});

test("toolbox holds both themes and responds from 360 to 1440 without horizontal overflow", async ({
  page,
}) => {
  // Themes: with no stored preference the default follows prefers-color-scheme (emulated
  // light, exactly as theme-toggle.spec.ts does); the toggle flips to dark and persists.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/toolbox");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.locator("#theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark"); // persisted across reload

  // Responsive: no horizontal overflow at the supported widths (the .wgrid journey grids
  // collapse and the minis contain).
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/toolbox");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("toolbox ships exactly one island and no eager widget embed", async ({ page }) => {
  await page.goto("/toolbox");
  // One island: the demo canvas. The nine minis stay plain Astro markup on purpose — wrapping
  // them would hand `.wgrid > * { min-width: 0 }` to the island wrapper and drop each mini a
  // level, reintroducing the 360px overflow trap.
  await expect(page.locator("astro-island")).toHaveCount(1);
  // client:visible, so nothing is fetched until the canvas is scrolled to — this is what keeps
  // ~300 KB of widget document off the initial page load.
  await expect(page.locator("iframe")).toHaveCount(0);
});
