import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the Toolbox page (spec 009, F4). Drives the real built page via
// `astro preview`, same harness as home.spec.ts / commands.spec.ts. Test titles match the
// spec's oracle refs exactly (AC5–AC8).

// Read the generated catalog as text (not an import) — Node 24 ESM requires an import
// attribute for JSON, and the repo's e2e reads sibling data the same way.
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../src/data/catalog.json"), "utf8"));

const WIDGET_LABELS = [
  "/marvin:help",
  "/marvin:dashboard",
  "/marvin:task-list",
  "/marvin:track-list",
  "/marvin:reports",
  "/marvin:sec-report",
  "/marvin:handoff-list",
];

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

  // The seven widget minis are labelled by their command — the whole family is presented.
  const labels = (await page.locator(".wmini .h").allTextContents()).join(" ");
  for (const label of WIDGET_LABELS) {
    expect(labels, `missing widget mini "${label}"`).toContain(label);
  }
});

test("toolbox renders the demo-canvas shell, the parity line, and the catalog-driven widget count", async ({
  page,
}) => {
  await page.goto("/toolbox");

  // The widget count is catalog-driven, not hand-typed (FR-20).
  await expect(page.locator(".chip")).toContainText(String(catalog.counts.widgets)); // 9

  // The demo canvas is a static Live demo / Screenshot toggle (one segment active) over the
  // sandboxed-iframe placeholder — the live embeds are Phase 5.
  const toggle = page.locator(".canvas .toggle");
  await expect(toggle).toContainText("Live demo");
  await expect(toggle).toContainText("Screenshot");
  const active = page.locator(".canvas .toggle span.on");
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText("Live demo");
  await expect(page.locator(".stage-area")).toContainText("sandboxed iframe");

  // The closing terminal-parity line.
  await expect(page.locator(".parline")).toContainText("Interactive in MCP Apps hosts");
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

test("toolbox is a static shell — no island and no live widget embeds", async ({ page }) => {
  await page.goto("/toolbox");
  // No Preact island hydrates — the page is static HTML/CSS with only Base's inline theme
  // script (the automatable proxy for "ships no JS", Lighthouse ≥ 95).
  await expect(page.locator("astro-island")).toHaveCount(0);
  // The live widget demos are Phase-5 placeholders: no sandboxed iframe (or any media) ships
  // yet — a clean guard against a live embed leaking in early.
  await expect(page.locator("iframe, img, video, audio")).toHaveCount(0);
});
