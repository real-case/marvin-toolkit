import { test, expect } from "@playwright/test";

// End-to-end proofs for the Pipeline page (spec 007, F2). Drives the real built page via
// `astro preview`, same harness as home.spec.ts / theme-toggle.spec.ts. Test titles match
// the spec's oracle refs exactly (AC1–AC4). Pipeline imports no generated catalog data
// (it renders no counts), so — unlike home.spec.ts — there is no catalog.json read here.

test("pipeline renders the header, rail, and four stage cards in order", async ({ page }) => {
  await page.goto("/pipeline");

  // Header: the accent eyebrow and the display-face title, copy verbatim from the mockup.
  await expect(page.locator(".eyebrow").first()).toHaveText("the workflow");
  await expect(page.locator("h1")).toHaveText("The task pipeline.");

  // The tick-and-node rail walks the four stages and closes on the learn loop. Substring
  // checks over the joined .rstep text are robust to the numbered <small> prefix and to
  // Prettier whitespace reflow inside the rail.
  const railJoined = (await page.locator(".rstep").allTextContents()).join(" ");
  for (const label of ["spec", "implement", "verify", "deliver", "learn ↺"]) {
    expect(railJoined, `rail missing "${label}"`).toContain(label);
  }

  // The four stage cards, in order — scoped to `.stage .snum` so the LOOP·lessons card
  // (a bare .stagecard, NOT inside a .stage) is correctly excluded from the four.
  const snums = (await page.locator(".stage .snum").allTextContents()).map((t) => t.trim());
  expect(snums).toEqual([
    "STAGE 1 · task-start",
    "STAGE 2 · task-implement",
    "STAGE 3 · task-verify",
    "STAGE 4 · task-deliver",
  ]);

  // Each stage heading is present.
  for (const heading of [
    "Formalize the requirement",
    "Build it against the spec",
    "Prove it green",
    "Ship it, documented",
  ]) {
    await expect(page.locator(".stagecard h3", { hasText: heading })).toHaveCount(1);
  }
});

test("pipeline renders the lessons loop, under-the-hood trio, and quickstart cta", async ({
  page,
}) => {
  await page.goto("/pipeline");

  // The lessons loop card and its captured → stored → recalled row. Scope to the heading
  // role — the hero lead ("…the toolbox learns as it ships") is a substring match otherwise.
  await expect(page.getByRole("heading", { name: "The toolbox learns" })).toBeVisible();
  const loop = (await page.locator(".looprow .c").allTextContents()).map((t) => t.trim());
  expect(loop).toEqual([
    "captured at deliver / debug",
    ".marvin/memory/",
    "recalled at the next task-start",
  ]);

  // The under-the-hood section: its accent eyebrow and the three tool cards, whose bare
  // <code> titles are spec / verify / lessons (NOT the .code primitive — see the spec).
  await expect(page.locator(".eyebrow", { hasText: "under the hood" })).toHaveCount(1);
  const tools = (await page.locator(".uthc .t code").allTextContents()).map((t) => t.trim());
  expect(tools).toEqual(["spec", "verify", "lessons"]);

  // The closing call to action links to /quickstart.
  const cta = page.locator("a.btn--accent", { hasText: "Quickstart" });
  await expect(cta).toHaveText("Quickstart →");
  await expect(cta).toHaveAttribute("href", "/quickstart");
});

test("pipeline holds both themes and responds from 360 to 1440 without horizontal overflow", async ({
  page,
}) => {
  // Themes: with no stored preference the default follows prefers-color-scheme (emulated
  // light, exactly as theme-toggle.spec.ts does); the toggle flips to dark and persists.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/pipeline");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.locator("#theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark"); // persisted across reload

  // Responsive: no horizontal overflow at the supported widths — the .stage (1fr/1fr) and
  // .uth (3-col) grids collapse, the rail wraps, and the posters contain.
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/pipeline");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("pipeline is static and poster-first — no island and no autoplaying media", async ({
  page,
}) => {
  await page.goto("/pipeline");
  // No Preact island hydrates — the page is static HTML/CSS with only Base's inline theme
  // script (the automatable proxy for "ships no JS", Lighthouse ≥ 95 / FR-15).
  await expect(page.locator("astro-island")).toHaveCount(0);
  // Poster-first: the stage recordings are Phase-5 placeholders, so no media element ships
  // yet — a clean guard against an autoplaying <video>/<audio> or an <iframe> embed.
  await expect(page.locator("video, audio, iframe")).toHaveCount(0);
});
