import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the Quickstart page (spec 008, F2). Drives the real built page via
// `astro preview`, same harness as home.spec.ts / pipeline.spec.ts. Test titles match the
// spec's oracle refs exactly (AC1–AC4).

// Read the generated catalog as text (not an import) — Node 24 ESM requires an import
// attribute for JSON, and the repo's node:test guards read sibling sources the same way.
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../src/data/catalog.json"), "utf8"));

test("quickstart renders the header, prereq, and four numbered install steps in order", async ({
  page,
}) => {
  await page.goto("/quickstart");

  // Header: the accent eyebrow, the h1, and the prerequisite callout.
  await expect(page.locator(".eyebrow").first()).toHaveText("get started");
  await expect(page.locator("h1")).toHaveText("Quickstart.");
  await expect(page.locator(".prereq")).toContainText("Before you start");

  // The four step headings, in document order — scoped to `.qbody h3` so the agentbox's own
  // <h3> ("Working with an agent?") is excluded (it is the fifth h3 on the page).
  const headings = (await page.locator(".qbody h3").allTextContents()).map((t) => t.trim());
  expect(headings).toEqual([
    "Add the marketplace",
    "Install the plugin",
    "Confirm it works",
    "Spec your first task",
  ]);

  // Each step renders its command via a CodeCommand row (`.command .code`), in order.
  const commands = (await page.locator(".qbody .command .code").allTextContents()).map((t) =>
    t.trim(),
  );
  expect(commands).toEqual([
    "/plugin marketplace add real-case/marvin-toolkit",
    "/plugin install marvin@marvin-toolkit",
    "/marvin:help",
    "/marvin:task-start",
  ]);
});

test("quickstart renders the onward next-cards with catalog-driven counts and the agent box", async ({
  page,
}) => {
  await page.goto("/quickstart");

  const cards = page.locator(".nextc");
  await expect(cards).toHaveCount(3);

  // Onward links: the GitHub repo (the FR-19 "link onward to the docs"), then /commands, /toolbox.
  await expect(cards.nth(0)).toHaveAttribute("href", /^https:\/\/github\.com\/real-case/);
  await expect(cards.nth(1)).toHaveAttribute("href", "/commands");
  await expect(cards.nth(2)).toHaveAttribute("href", "/toolbox");

  // Counts are catalog-driven, not hand-typed (FR-20): a plugin change that regenerates the
  // catalog moves both the page and this assertion together.
  await expect(cards.nth(1)).toContainText(String(catalog.commands.length));
  await expect(cards.nth(2)).toContainText(String(catalog.counts.widgets));

  // The agent-native box (FR-24) documents the llms.txt install path.
  const agent = page.locator(".agentbox");
  await expect(agent).toContainText("Working with an agent?");
  await expect(agent.locator("code")).toHaveText("llms.txt");
});

test("quickstart holds both themes and responds from 360 to 1440 without horizontal overflow", async ({
  page,
}) => {
  // Themes: with no stored preference the default follows prefers-color-scheme (emulated
  // light, exactly as theme-toggle.spec.ts does); the toggle flips to dark and persists.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/quickstart");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.locator("#theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark"); // persisted across reload

  // Responsive: no horizontal overflow at the supported widths (the .nexts grid and the
  // .qstep marker/body grid collapse; the command rows ellipsis-truncate).
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/quickstart");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("quickstart is static and ships no premature media — no island and no image or embed", async ({
  page,
}) => {
  await page.goto("/quickstart");
  // No Preact island hydrates — the page is static HTML/CSS with only Base's inline
  // anti-FOUC/toggle script (the automatable proxy for "no JS shipped", Lighthouse ≥ 95).
  await expect(page.locator("astro-island")).toHaveCount(0);
  // No premature media: the /marvin:help screenshot is a static placeholder <div>, so the real
  // capture (a later media phase) has not shipped an <img> — and no recording/embed either.
  await expect(page.locator("img, video, audio, iframe")).toHaveCount(0);
});
