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

test("home toolbox teaser mounts its three demos only once scrolled into view", async ({
  page,
}) => {
  await page.goto("/");

  // At first paint the teaser's islands are server-rendered but unhydrated, and — the part that
  // protects the Lighthouse ≥ 95 exit criterion — no widget document has been fetched. Three
  // eager frames would pull ~900 KB into the initial page.
  await expect(page.locator("iframe.wd-frame")).toHaveCount(0);

  // The static panels are the server-rendered fallback, so the section is complete with no JS.
  await expect(page.locator(".wt3 .wpanel")).toHaveCount(3);

  // Scrolling the teaser into view hydrates the islands, which mount their frames.
  await page.locator(".wt3").scrollIntoViewIfNeeded();
  await expect(page.locator("iframe.wd-frame")).toHaveCount(3, { timeout: 15_000 });

  // Each frames its own committed widget document, in FR-9's order.
  for (const widget of ["help", "dashboard", "reports"]) {
    await expect(page.locator(`.wd[data-widget="${widget}"] iframe.wd-frame`)).toHaveAttribute(
      "src",
      new RegExp(`/widget-demos/${widget}\\.html$`),
    );
  }

  // And they actually come up live, rather than silently sitting on the fallback.
  for (const widget of ["help", "dashboard", "reports"]) {
    await expect(page.locator(`.wd[data-widget="${widget}"]`)).toHaveAttribute(
      "data-status",
      "live",
      { timeout: 15_000 },
    );
  }
});
