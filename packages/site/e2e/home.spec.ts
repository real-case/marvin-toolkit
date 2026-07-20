import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the Home page (spec 006, F3). Drives the real built page via
// `astro preview`, same harness as theme-toggle.spec.ts. Test titles match the spec's
// oracle refs exactly (AC1–AC4).

// Read the generated catalog as text (not an import) — Node 24 ESM requires an import
// attribute for JSON, and the repo's node:test guards read sibling sources the same way.
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../src/data/catalog.json"), "utf8"));

test("home renders the five-claim narrative in document order", async ({ page }) => {
  await page.goto("/");

  // Hero: the mono /marvin wordmark and the "Without panic." tagline.
  await expect(page.locator("h1.h1name")).toContainText("marvin");
  await expect(page.locator(".tagline")).toContainText("Without panic.");

  // The four section eyebrows, in document order — robust to copy tweaks inside a section
  // while still catching a dropped, reordered, or carried-over placeholder eyebrow.
  const eyebrows = (await page.locator(".eyebrow").allTextContents()).map((t) => t.trim());
  expect(eyebrows).toEqual(["the workflow", "artifacts", "visual toolbox", "entry points"]);

  // The workflow stepper closes on the learn loop.
  await expect(page.locator(".step.loop")).toContainText("learn ↺");

  // The engineering strip and the install-band close.
  await expect(page.getByText("Built in the open.")).toBeVisible();
  await expect(page.getByText("Two commands. About a minute.")).toBeVisible();

  // Both install commands are present (hero + install band render each).
  await expect(
    page.getByText("/plugin marketplace add real-case/marvin-toolkit").first(),
  ).toBeVisible();
  await expect(page.getByText("/plugin install marvin@marvin-toolkit").first()).toBeVisible();
});

test("counts band renders the generated catalog values", async ({ page }) => {
  await page.goto("/");

  // The five count cells, in order, equal the generated catalog values — a forward drift
  // guard: the page reads them from catalog.counts (no numeric literals), so a plugin change
  // that regenerates the catalog moves both the site and this assertion together.
  const cells = (await page.locator(".counts .count .n").allTextContents()).map((t) => t.trim());
  expect(cells).toEqual([
    String(catalog.counts.prompts),
    String(catalog.counts.tools),
    String(catalog.counts.agents),
    String(catalog.counts.widgets),
    catalog.counts.license,
  ]);
});

test("home holds both themes and responds from 360 to 1440 without horizontal overflow", async ({
  page,
}) => {
  // Themes: with no stored preference the default follows prefers-color-scheme (emulated
  // light, exactly as theme-toggle.spec.ts does); the toggle flips to dark and persists.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.locator("#theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark"); // persisted across reload

  // Responsive: no horizontal overflow at the supported widths, including the hero's
  // deliberate grid break (the parity panel overflows the shell, never the viewport).
  // 1305 + 1320 straddle the hero grid-break trigger — the band that overflowed before the fix.
  for (const width of [360, 768, 1305, 1320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("home ships no hydrated island", async ({ page }) => {
  await page.goto("/");
  // No Preact island hydrates on Home — the page is static HTML/CSS with only Base's inline
  // anti-FOUC/toggle script. The automatable proxy for the "no JavaScript shipped yet" exit
  // criterion (Lighthouse ≥ 95).
  await expect(page.locator("astro-island")).toHaveCount(0);
});
