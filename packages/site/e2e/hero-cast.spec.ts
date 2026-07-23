import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the Home hero recording (spec 016-website-home-hero-recording, F7).
//
// The hero is the /marvin:task-start CastPlayer in the parity block on "/" — ABOVE the fold, unlike
// the four pipeline stages, so client:visible hydrates it at first paint. Its patterns come from two
// shipped siblings: cast-player.spec.ts for the poster / activation / played-content proofs (AC2-4)
// and pipeline.spec.ts for the payload budget (AC5) and the responsive/theme-with-a-player behaviour
// (AC6). Test titles match the spec's oracle refs verbatim.
//
// Read the generated manifest as text, not an import (Node 24 ESM requires an import attribute for
// JSON), and pull the hero row — the same casts.json cast-player.spec.ts reads for the four stages.
const here = dirname(fileURLToPath(import.meta.url));

interface Cast {
  key: string;
  command: string;
  caption: string;
  file: string;
  duration: number;
  poster: string;
}

const casts: Cast[] = JSON.parse(readFileSync(join(here, "../src/data/casts.json"), "utf8"));
const hero = casts.find((cast) => cast.key === "hero");
if (!hero) throw new Error("src/data/casts.json is missing the hero recording — run gen:casts");

/** Mirrors formatDuration in src/data/casts.ts — the poster prints M:SS, floored like the player. */
function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const heroSel = '.cast[data-stage="hero"]';

test("the hero poster renders the command and duration from the generated manifest", async ({
  page,
}) => {
  await page.goto("/");

  const stage = page.locator(heroSel);
  await expect(stage, "the hero player must be on the home page").toHaveCount(1);
  await expect(stage.locator(".cast-caption")).toHaveText(hero!.caption);
  await expect(stage.locator(".cast-dur")).toHaveText(formatDuration(hero!.duration));

  // The command it advertises is task-start, NOT the verify command the old static hero showed —
  // that command belongs to pipeline stage 3, and recording a DIFFERENT one is the whole point of
  // this variant, so pin it from the manifest and by literal.
  await expect(stage.locator(".cast-cmd")).toHaveText(`➜ ${hero!.command}`);
  await expect(stage.locator(".cast-cmd")).toHaveText("➜ /marvin:task-start");
});

test("the hero is poster-first and never autoplays", async ({ page }) => {
  await page.goto("/");

  const stage = page.locator(heroSel);
  // The poster server-renders as readable, selectable text — not an image — before any player exists.
  await expect(stage.locator(".cast-poster")).toHaveCount(1);
  await expect(page.locator(`${heroSel}[data-status="poster"]`)).toHaveCount(1);

  // The island is above the fold, so client:visible hydrates it at load. Give hydration room and
  // confirm it still mounts no player — the press is the trigger, not the island coming alive. A
  // negative assertion needs the wait; there is no event to await for "must not happen".
  await page.waitForTimeout(1000);
  await expect(page.locator(`${heroSel} .ap-player, ${heroSel} .ap-term`)).toHaveCount(0);
  await expect(page.locator("video, audio")).toHaveCount(0);

  // The play control is a real button, named for its command.
  const play = stage.getByRole("button", { name: "Play the /marvin:task-start recording" });
  await expect(play).toBeVisible();
  await play.click();

  await expect(stage.locator(".ap-term")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-status", "playing");
});

test("activating the hero plays its recorded terminal content", async ({ page }) => {
  await page.goto("/");
  // The hero is above the fold, so its island hydrates at first paint — but wait for the network to
  // settle so Preact has wired the button's onClick before the press, rather than dispatching into
  // the post-load dynamic-import window (a lost click). Matches AC5 and pipeline.spec.ts.
  await page.waitForLoadState("networkidle");

  const stage = page.locator(heroSel);
  await stage.locator(".cast-play").click();

  // The player renders terminal text as REAL DOM (a <pre class="ap-term-text"> of span.ap-line rows),
  // so the text is reachable and selectable. Assert CONTAINMENT — each line is split into one span
  // per style run, so an exact match over a whole coloured line would break.
  const term = stage.locator(".ap-term-text");
  await expect(term, "the hero must mount a terminal").toHaveCount(1);
  await expect(term, "the hero must show its command").toContainText(hero!.command, {
    timeout: 15_000,
  });

  // The drift detector: this line sits in the recording's BODY (the vague ask), so it only appears if
  // the cast actually played on — a cast truncated to its prompt would satisfy the command check
  // above but not this. It is also the marker that proves the hero is its own cut, not stage 1's.
  await expect(term, "the hero must play its recorded output").toContainText("add rate limiting", {
    timeout: 15_000,
  });
});

test("the hero requests no player asset until it is activated", async ({ page }) => {
  const requests: string[] = [];
  const scripts: string[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
    if (request.resourceType() === "script") scripts.push(request.url());
  });

  await page.goto("/");
  await expect(page.locator(`${heroSel} .cast-poster`)).toHaveCount(1);

  // The hero is ABOVE the fold, so client:visible has already hydrated it by the time the network
  // settles — the island's own small chunk is in `scripts` now, and nothing more. This is the case
  // the pipeline's AC5 only ever got to exercise on its own above-the-fold stage 1.
  await page.waitForLoadState("networkidle");

  const isCast = (url: string) => url.includes(".cast");
  const isVendorCss = (url: string) => url.includes("asciinema-player.css");

  expect(requests.filter(isCast), "no recording may be fetched at page load").toEqual([]);
  expect(requests.filter(isVendorCss), "no player stylesheet may be fetched at page load").toEqual(
    [],
  );

  const scriptsBefore = scripts.length;

  await page.locator(`${heroSel} .cast-play`).click();
  await expect(page.locator(`${heroSel} .ap-term-text`)).toHaveCount(1);
  await page.waitForLoadState("networkidle");

  expect(requests.filter(isCast).length, "activation must fetch the recording").toBeGreaterThan(0);
  expect(
    requests.filter(isVendorCss).length,
    "activation must fetch the player stylesheet — it is structural, not decoration",
  ).toBeGreaterThan(0);

  // The clause that actually protects the budget above the fold: the player's chunk cannot be named
  // (Vite hashes it), so assert activation caused a NEW script fetch. Without it, a top-level player
  // import would fold ~330 KB (mostly an inlined WASM blob) into the island's own chunk — which, for
  // the above-the-fold hero, loads at first paint — while the cast and stylesheet stayed lazy and
  // this test stayed green.
  expect(
    scripts.length,
    "activating the hero must fetch at least one new script — the player chunk",
  ).toBeGreaterThan(scriptsBefore);
});

test("the hero holds both themes and responds from 360 to 1440 with the player mounted", async ({
  page,
}) => {
  // With no stored preference the default follows prefers-color-scheme (emulated light, exactly as
  // theme-toggle.spec.ts does). The theme then PERSISTS in localStorage across the goto in each
  // iteration, so the loop cannot re-assert a fixed value — it reads the theme, flips it, and asserts
  // the flip. With five widths that alternates light→dark and dark→light, covering both directions.
  await page.emulateMedia({ colorScheme: "light" });

  // 1305 and 1320 straddle the hero's parity grid-break trigger (the .parity panel breaks out -80px
  // at >=1320px, clipped by overflow-x:clip on .hero) — the band the static hero already had to fix.
  for (const width of [360, 768, 1305, 1320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // Wait for hydration before the press (see the activation test) — the island wires its onClick
    // during the post-load dynamic import, so a click dispatched too early is silently lost.
    await page.waitForLoadState("networkidle");
    const html = page.locator("html");

    // Activate INSIDE the loop — the goto above re-navigates each iteration, so a player mounted
    // before it would be gone by the first assertion.
    const stage = page.locator(heroSel);
    await stage.locator(".cast-play").click();

    const term = stage.locator(".ap-term");
    await expect(term, `terminal must mount at ${width}px`).toHaveCount(1);
    // toHaveCount is satisfiable while .cast-stage is still hidden (it un-hides on a re-render after
    // create() returns), and boundingBox() does not retry — so wait for visibility first.
    await expect(term, `terminal must be visible at ${width}px`).toBeVisible();

    // Measure the box, not just overflow: a missing vendor stylesheet mounts the player and collapses
    // every row and span to a point, which an overflow-only assertion passes happily.
    const box = await term.boundingBox();
    expect(box?.width ?? 0, `terminal width at ${width}px`).toBeGreaterThan(0);
    expect(box?.height ?? 0, `terminal height at ${width}px`).toBeGreaterThan(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

    // Both themes must hold WITH THE PLAYER UP — the terminal bridges the player's own custom
    // properties onto the site palette through a specificity trick in CastPlayer.css, which asserting
    // only on the static poster never exercises. Read the current theme, flip it, assert the flip.
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

test("the hero widget card shows the spec-readiness parity not the verify gates", async ({
  page,
}) => {
  await page.goto("/");

  // The parity pair now reads /marvin:task-start on BOTH halves: the terminal is a task-start
  // recording (asserted above) and the paired widget card is the spec-readiness Definition-of-Ready
  // view, redrawn from the verify gates the static hero used to show.
  const card = page.locator(".parity .wcard");
  await expect(card).toContainText("Definition of Ready");
  await expect(card).toContainText("spec contract");

  // The old verify gate content must be gone — if the terminal is task-start while the card still
  // shows verify, the two halves of the pair disagree and the "same command in two surfaces" thesis
  // breaks.
  await expect(card).not.toContainText("quality gates");
  await expect(card.getByText("tests ✓")).toHaveCount(0);
  await expect(card.getByText("build ✓")).toHaveCount(0);
});
