import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the pipeline tour's terminal recordings (spec 012, F12 — AC2/AC3/AC4).
// Test titles match the spec's oracle refs exactly. The page around them — the payload budget (AC5)
// and the responsive/theme behaviour with a player mounted (AC6) — is covered in pipeline.spec.ts.
//
// Read the generated manifest as text, not an import: Node 24 ESM requires an import attribute for
// JSON, and the repo's e2e reads sibling generated data the same way (toolbox.spec.ts).
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

// The manifest also carries the Home hero recording (spec 016), which /pipeline never renders — it
// looks its four stages up by name. This suite is the PIPELINE tour's proof, so every manifest-derived
// assertion below iterates only the four stage rows; the hero has its own suite, hero-cast.spec.ts.
const stages = casts.filter((cast) => cast.key !== "hero");

/** Mirrors formatDuration in src/data/casts.ts — the posters print M:SS, floored like the player. */
function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * A distinctive early line from each recording's OUTPUT, kept in sync with the authored scripts in
 * scripts/gen-casts.mjs.
 *
 * Asserting the command alone would not prove much: the poster already prints it, so a cast that
 * played nothing but its own prompt would pass. These strings exist only inside the cast files, so
 * seeing one on screen proves the recording was fetched, parsed and rendered. Early lines on
 * purpose — each appears about two seconds in, so the assertion does not wait out a whole take.
 */
const OUTPUT_MARKER: Record<string, string> = {
  "task-start": "Intake",
  "task-implement": "Resolving spec",
  "task-verify": "Detecting stack",
  "task-deliver": "Delivery gate",
};

test("stage posters render the command and duration from the generated manifest", async ({
  page,
}) => {
  await page.goto("/pipeline");

  expect(stages.length, "the manifest must carry the four tour stages").toBe(4);

  for (const cast of stages) {
    const stage = page.locator(`.cast[data-stage="${cast.key}"]`);
    await expect(stage, `stage "${cast.key}" must be on the page`).toHaveCount(1);
    await expect(stage.locator(".cast-cmd")).toHaveText(`➜ ${cast.command}`);
    await expect(stage.locator(".cast-caption")).toHaveText(cast.caption);
    await expect(stage.locator(".cast-dur")).toHaveText(formatDuration(cast.duration));
  }

  // The four durations the page prints ARE the manifest's, in tour order — no hand-typed value
  // survives anywhere on the page.
  expect(await page.locator(".cast-dur").allTextContents()).toEqual(
    stages.map((cast) => formatDuration(cast.duration)),
  );

  // Regression proof for the drift this spec closed: the four hand-typed durations are gone, so no
  // stated runtime can disagree with the recording it labels.
  const html = await page.content();
  for (const stale of ["0:42", "1:18", "0:55", "0:38"]) {
    expect(html, `hardcoded duration ${stale} is still on the page`).not.toContain(stale);
  }
  // Belt-and-braces on the stage-3 command. PR #144 corrected this poster from a tool name to the
  // real prompt and added a source scanner to stop it recurring; this asserts it on the RENDERED
  // page, which the scanner cannot see, and the string now arrives from the manifest rather than
  // from markup — so it is a different failure path than the one #144 closed.
  expect(html, "the page advertises a command that does not exist").not.toContain("/marvin:verify");
  await expect(page.locator('.cast[data-stage="task-verify"] .cast-cmd')).toHaveText(
    "➜ /marvin:task-verify",
  );
});

test("stages are poster-first and never autoplay", async ({ page }) => {
  await page.goto("/pipeline");

  // Every stage server-renders its poster as readable, selectable text — not an image — so the
  // command is available to a screen reader and to copy/paste before any player exists.
  await expect(page.locator(".cast-poster")).toHaveCount(4);
  await expect(page.locator('.cast[data-status="poster"]')).toHaveCount(4);

  // Nothing is mounted and nothing can autoplay. `iframe` stays in the list even though this page
  // has never had one: it was in the Phase-5 absence guard this test replaced, and dropping it
  // would silently retire the check against someone embedding a third-party player later.
  await expect(page.locator(".ap-player, .ap-term")).toHaveCount(0);
  await expect(page.locator("video, audio, iframe")).toHaveCount(0);

  // The islands hydrate on visibility (client:visible). Scroll the first stage in, give hydration
  // room, and confirm that hydrating still mounts no player — the press is the trigger, not the
  // island coming alive. A negative assertion needs the wait; there is no event to await for
  // "something that must not happen".
  const first = page.locator('.cast[data-stage="task-start"]');
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await expect(page.locator(".ap-player, .ap-term")).toHaveCount(0);

  // The play control is a real button, named for its stage.
  const play = first.getByRole("button", { name: "Play the /marvin:task-start recording" });
  await expect(play).toBeVisible();

  await play.click();

  await expect(first.locator(".ap-term")).toHaveCount(1);
  await expect(first).toHaveAttribute("data-status", "playing");

  // Only the pressed stage mounted — activation is per-stage, so a visitor who plays one recording
  // does not pull three more players' worth of payload.
  await expect(page.locator(".ap-term")).toHaveCount(1);
  await expect(page.locator('.cast[data-status="poster"]')).toHaveCount(3);
});

test("activating a stage plays its recorded terminal content", async ({ page }) => {
  await page.goto("/pipeline");

  for (const cast of stages) {
    const stage = page.locator(`.cast[data-stage="${cast.key}"]`);
    await stage.scrollIntoViewIfNeeded();
    await stage.locator(".cast-play").click();

    // The player renders terminal text as REAL DOM — a <pre class="ap-term-text"> of span.ap-line
    // rows — so the text is reachable and selectable (the sibling <canvas> carries only block
    // glyphs and cell backgrounds).
    //
    // Assert CONTAINMENT on that container rather than an exact match: each line is split into one
    // span per style run, so the green prompt and the command are separate spans, and an exact
    // getByText over a whole line would break the moment the colouring changes.
    const term = stage.locator(".ap-term-text");
    await expect(term, `stage "${cast.key}" must mount a terminal`).toHaveCount(1);
    await expect(term, `stage "${cast.key}" must show its command`).toContainText(cast.command, {
      timeout: 15_000,
    });

    // This is the drift detector. The command above arrives in the first second or so of every
    // recording, so a cast truncated to its header and prompt would satisfy it; this marker sits in
    // the body and only appears if the recording actually played on. If either assertion is ever
    // weakened to "the player element exists", a broken or empty recording ships green.
    await expect(term, `stage "${cast.key}" must play its recorded output`).toContainText(
      OUTPUT_MARKER[cast.key],
      { timeout: 15_000 },
    );
  }
});
