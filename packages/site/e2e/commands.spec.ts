import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the Commands page (spec 009, F3). Drives the real built page via
// `astro preview`, same harness as home.spec.ts. Test titles match the spec's oracle refs
// exactly (AC1–AC4).

// Read the generated catalog as text (not an import) — Node 24 ESM requires an import
// attribute for JSON, and the repo's e2e reads sibling data the same way.
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../src/data/catalog.json"), "utf8"));

const GROUP_KEYS = catalog.groups.map((g: { key: string }) => g.key);
// ["core","adr","pr","task","sec","refactor","track"]
const HUMAN_NAMES = catalog.commands
  .filter((c: { human: boolean }) => c.human)
  .map((c: { name: string }) => `/marvin:${c.name}`);
// ["/marvin:adr-accept","/marvin:adr-supersede","/marvin:adr-sync"]

const strip = (s: string) => s.replace(/\s+/g, "");

test("commands renders the reference header and all seven groups in order", async ({ page }) => {
  await page.goto("/commands");

  // Header: the accent eyebrow and the display-face title, copy verbatim from the mockup.
  await expect(page.locator(".eyebrow").first()).toHaveText("reference");
  await expect(page.locator("h1")).toHaveText("Commands");

  // The seven group sections, in catalog order — scoped to `.gname` (the group headers) so a
  // stray heading elsewhere cannot skew the order assertion.
  const gnames = (await page.locator(".gname").allTextContents()).map((t) => t.trim());
  expect(gnames).toEqual(GROUP_KEYS);

  // Every command in the catalog renders exactly one card (the full grouped catalog, FR-12).
  await expect(page.locator(".cmd")).toHaveCount(catalog.commands.length);

  // Each card shows its `/marvin:<name>` — spot-check the first card carries the prefix.
  expect(strip((await page.locator(".cmd .name").first().textContent()) ?? "")).toContain(
    "/marvin:",
  );
});

test("commands renders every catalog command with human-run marking and the static search shell", async ({
  page,
}) => {
  await page.goto("/commands");

  // The header chip's counts are catalog-driven (no hand-typed numbers, FR-20).
  const chip = page.locator(".chip");
  await expect(chip).toContainText(String(catalog.commands.length)); // 51
  await expect(chip).toContainText(String(catalog.groups.length)); // 7

  // Exactly the three human:true commands (adr-accept / adr-supersede / adr-sync) carry the
  // "human-run" badge — nothing else does.
  await expect(page.locator(".human-badge")).toHaveCount(HUMAN_NAMES.length);
  const marked = (await page.locator(".cmd:has(.human-badge) .name").allTextContents()).map((t) =>
    strip(t),
  );
  expect(marked).toEqual(HUMAN_NAMES.map(strip));

  // The static search-island shell (FR-13 static parts): the search box, its "/" keycap, and the
  // eight filter chips (all + the seven groups) with exactly one active.
  await expect(page.locator(".search")).toBeVisible();
  await expect(page.locator(".search .kbd")).toHaveText("/");
  const chips = (await page.locator(".fchip").allTextContents()).map((t) => t.trim());
  expect(chips).toEqual(["all", ...GROUP_KEYS]);
  await expect(page.locator(".fchip.on")).toHaveCount(1);
});

test("commands holds both themes and responds from 360 to 1440 without horizontal overflow", async ({
  page,
}) => {
  // Themes: with no stored preference the default follows prefers-color-scheme (emulated
  // light, exactly as theme-toggle.spec.ts does); the toggle flips to dark and persists.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/commands");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.locator("#theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark"); // persisted across reload

  // Responsive: no horizontal overflow at the supported widths (the .cmdgrid collapses, the
  // .filters wrap, the example rows ellipsis-truncate).
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/commands");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("commands is a static shell — no island and no premature media", async ({ page }) => {
  await page.goto("/commands");
  // No Preact island hydrates — the page is static HTML/CSS with only Base's inline theme
  // script (the automatable proxy for "ships no JS", Lighthouse ≥ 95).
  await expect(page.locator("astro-island")).toHaveCount(0);
  // The search is an inert shell (Phase 4 wires it): no hydrated <input> field, and no media —
  // a clean guard that the client search behaviour has not shipped early.
  await expect(page.locator("input, img, video, audio, iframe")).toHaveCount(0);
});
