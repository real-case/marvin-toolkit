import { test, expect } from "@playwright/test";

// End-to-end proofs for the Pipeline page. Originally spec 007 (static tour); updated by spec 012
// (F10), which replaced the Phase-5 absence guards — "no astro-island", "no iframe/video/audio" —
// with the shipped behaviour now that each stage poster is a lazy player island. Drives the real
// built page via `astro preview`, same harness as home.spec.ts / theme-toggle.spec.ts. Test titles
// match the specs' oracle refs exactly.
//
// The recordings themselves (poster data, no-autoplay, played content) are proved in
// cast-player.spec.ts; this file covers the page around them — the payload budget (AC5) and the
// responsive/theme behaviour with a player mounted (AC6).

test("pipeline renders the header, rail, and four stage cards in order", async ({ page }) => {
  await page.goto("/pipeline");

  // Header: the accent eyebrow and the display-face title, copy verbatim from the mockup.
  await expect(page.locator(".eyebrow").first()).toHaveText("the workflow");
  await expect(page.locator("h1")).toHaveText("The task pipeline.");

  // The current page's nav link carries the active state, and it is the only one that does
  // (feedback: the menu items had no active state).
  await expect(page.locator('.nav__links a[href="/pipeline"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator('.nav__links a[aria-current="page"]')).toHaveCount(1);

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

test("pipeline holds both themes and responds from 360 to 1440 with a player mounted", async ({
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
  // .uth (3-col) grids collapse, the rail wraps, and the terminal contains.
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/pipeline");

    // Activate INSIDE the loop. This loop re-navigates on every iteration, so a player mounted
    // before it would be destroyed by the first `goto` — and the test would quietly go back to
    // measuring the static page it was rewritten to stop measuring.
    const stage = page.locator('.cast[data-stage="task-start"]');
    await stage.scrollIntoViewIfNeeded();
    await stage.locator(".cast-play").click();

    const term = stage.locator(".ap-term");
    await expect(term, `terminal must mount at ${width}px`).toHaveCount(1);
    // Wait for visibility before reading geometry: `toHaveCount` is satisfiable while `.cast-stage`
    // is still hidden, because the component un-hides it on a re-render after create() returns.
    // boundingBox() does not retry, so without this the measurement below rides on Preact's
    // microtask scheduling rather than on anything this test controls.
    await expect(term, `terminal must be visible at ${width}px`).toBeVisible();

    // Measure the box, not just the overflow. A missing vendor stylesheet is a SILENT failure: the
    // player mounts without error and every terminal row and span collapses to a single point —
    // against which an overflow-only assertion passes very happily.
    const box = await term.boundingBox();
    expect(box?.width ?? 0, `terminal width at ${width}px`).toBeGreaterThan(0);
    expect(box?.height ?? 0, `terminal height at ${width}px`).toBeGreaterThan(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

    // Both themes must hold WITH THE PLAYER UP, not just on the static page above. The terminal
    // bridges the player's own custom properties onto the site palette through a specificity
    // trick (CastPlayer.css: the vendor sheet is <link>ed later, so an equal-specificity rule
    // would lose) — asserting themes only before any player exists never exercises it.
    //
    // Each iteration flips ONE theme, and the theme persists across iterations, so the loop
    // alternates (dark→light, light→dark, dark→light) and covers both directions across the three
    // widths. That coverage rides on the alternation: adding a fourth width, or clearing storage
    // between iterations, would collapse it to a single direction. Assert on the flipped value
    // rather than a fixed one so the test stays correct either way.
    const before = await html.getAttribute("data-theme");
    await page.locator("#theme-toggle").click();
    await expect(html).toHaveAttribute("data-theme", before === "dark" ? "light" : "dark");

    await expect(term, `terminal must survive a theme flip at ${width}px`).toBeVisible();
    const flipped = await term.boundingBox();
    expect(flipped?.width ?? 0, `terminal width after theme flip at ${width}px`).toBeGreaterThan(0);
    expect(flipped?.height ?? 0, `terminal height after theme flip at ${width}px`).toBeGreaterThan(
      0,
    );

    const flippedOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(flippedOverflow, `overflow after theme flip at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("pipeline is poster-first and requests no player asset until a stage is activated", async ({
  page,
}) => {
  const requests: string[] = [];
  const scripts: string[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
    if (request.resourceType() === "script") scripts.push(request.url());
  });

  await page.goto("/pipeline");
  await expect(page.locator(".cast-poster")).toHaveCount(4);

  // Scroll the first stage in and let the network settle, so the island has genuinely hydrated
  // (client:visible) before we claim nothing was fetched. Hydration must cost the island's own
  // small chunk and nothing more.
  await page.locator('.cast[data-stage="task-start"]').scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");

  const isCast = (url: string) => url.includes(".cast");
  const isVendorCss = (url: string) => url.includes("asciinema-player.css");

  expect(requests.filter(isCast), "no recording may be fetched at page load").toEqual([]);
  expect(requests.filter(isVendorCss), "no player stylesheet may be fetched at page load").toEqual(
    [],
  );

  const scriptsBefore = scripts.length;

  await page.locator('.cast[data-stage="task-start"] .cast-play').click();
  await expect(page.locator(".ap-term-text")).toHaveCount(1);
  await page.waitForLoadState("networkidle");

  expect(requests.filter(isCast).length, "activation must fetch the recording").toBeGreaterThan(0);
  expect(
    requests.filter(isVendorCss).length,
    "activation must fetch the player stylesheet — it is structural, not decoration",
  ).toBeGreaterThan(0);

  // The clause that actually protects the budget, and the one that is easy to leave out. The
  // player's chunk cannot be named — Vite derives chunk names from the entry module's filename, so
  // it emits as an unstable hash — so assert that activation caused a NEW script fetch. Without
  // this, moving the player to a top-level import would fold its ~330 KB (mostly an inlined WASM
  // terminal emulator that minification cannot shrink) into the island's own chunk — which, for
  // the above-the-fold stage 1, loads essentially at page load — while the cast and the stylesheet
  // stayed lazy and this test stayed green.
  expect(
    scripts.length,
    "activating a stage must fetch at least one new script — the player chunk",
  ).toBeGreaterThan(scriptsBefore);
});
