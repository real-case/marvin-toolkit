import { test, expect } from "@playwright/test";

// End-to-end proofs for the live widget demos (spec 011-website-widget-embeds, F9) — AC1, AC2, AC6.
// Test titles match the spec's oracle refs exactly.
//
// These assert against the widget's OWN rendered DOM through frameLocator, never against the
// host's bookkeeping. That is deliberate and load-bearing: the site speaks the MCP Apps wire
// protocol by hand instead of importing the ext-apps SDK, so this suite is the drift detector. If
// the handshake shape ever changes, the frame falls back to its static mini and these assertions
// fail — which is exactly what should happen. Weakening them to check `data-status` would keep the
// suite green while every demo on the site silently degraded.

/** Scroll the canvas into view and wait for its island to hydrate and go live. */
async function openCanvas(page: import("@playwright/test").Page) {
  await page.goto("/toolbox");
  const canvas = page.locator(".wd-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute("data-status", "live", { timeout: 15_000 });
  return canvas;
}

test("toolbox live demo frames the committed widget document and renders fixture content", async ({
  page,
}) => {
  const canvas = await openCanvas(page);

  // The frame points at the copied committed document, and is sandboxed.
  const frame = canvas.locator("iframe.wd-frame");
  await expect(frame).toHaveAttribute("src", /\/widget-demos\/help\.html$/);
  await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);

  // The widget's own DOM: its theme root exists, so the document booted and Preact rendered.
  const inner = page.frameLocator("iframe.wd-frame");
  await expect(inner.locator(".mvroot")).toBeVisible();

  // The handshake actually delivered the fixture. `telegram-publications` is the fixture's own
  // project name — it exists nowhere in the widget's shell, so it can only appear if
  // structuredContent arrived over the wire. That is the assertion that makes this suite a
  // protocol-drift detector rather than a "did an iframe mount" check.
  const body = inner.locator("body");
  await expect(body).toContainText("telegram-publications");
  await expect(body).toContainText("task-start");
  await expect(body).not.toContainText("Connecting…");
  await expect(body).not.toContainText("No help data.");

  // A live frame must occupy real space — a zero-height frame is not a demo.
  const box = await frame.boundingBox();
  expect(box, "frame must have a layout box").not.toBeNull();
  expect(box!.height).toBeGreaterThan(80);
  expect(box!.width).toBeGreaterThan(80);
});

test("live demo follows the site theme toggle", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openCanvas(page);
  const inner = page.frameLocator("iframe.wd-frame");
  const mvroot = inner.locator(".mvroot");

  // The parent pushes the site's theme into the frame — both the token scope and the UA
  // color-scheme, which the .mvroot override does not reach.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(mvroot).toHaveAttribute("data-theme", "light");
  await expect(inner.locator("html")).toHaveCSS("color-scheme", "light");

  // Flipping the site toggle repaints the framed widget.
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(mvroot).toHaveAttribute("data-theme", "dark");
  await expect(inner.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("a demo whose handshake never completes falls back to the static mini", async ({ page }) => {
  // Induce the failure deterministically at the network layer — no timing games, and no
  // production escape hatch that would have to live in the contract. page.route intercepts
  // iframe navigations too.
  await page.route("**/widget-demos/*.html", (route) => route.abort());

  await page.goto("/toolbox");
  const canvas = page.locator(".wd-canvas");
  await canvas.scrollIntoViewIfNeeded();

  // The host gives up and the stage reveals the cloned mini instead of a stuck loading state.
  await expect(canvas).toHaveAttribute("data-status", "failed", { timeout: 15_000 });
  const clone = canvas.locator(".wd-clone");
  await expect(clone).toBeVisible();
  await expect(clone).toContainText("/marvin:help");

  // No stuck spinner, and the clone is decorative — the original mini above is the real one.
  await expect(canvas.locator(".wd-note")).toBeHidden();
  await expect(clone).toHaveAttribute("aria-hidden", "true");

  // The dead frame is torn down, not merely hidden behind the fallback. Leaving it mounted would
  // strand a blank min-height box and keep the host's window listener alive.
  await expect(canvas.locator("iframe")).toHaveCount(0);

  // The fallback still occupies the stage, so the canvas does not collapse.
  const box = await clone.boundingBox();
  expect(box, "fallback must have a layout box").not.toBeNull();
  expect(box!.height).toBeGreaterThan(40);
});

test("a failed Home teaser demo reveals its slotted panel and leaves no empty frame", async ({
  page,
}) => {
  // AC6's statement names the SLOT path — the Home teaser — but its Toolbox oracle above exercises
  // the clone path. This covers the one AC6 literally describes, and it is the case that actually
  // regressed: the stage and the fallback must be strictly complementary, or a dead frame's
  // min-height leaves a blank bordered box sitting above the revealed panel.
  await page.route("**/widget-demos/*.html", (route) => route.abort());

  await page.goto("/");
  await page.locator(".wt3").scrollIntoViewIfNeeded();

  const demo = page.locator('.wd[data-widget="dashboard"]');
  await expect(demo).toHaveAttribute("data-status", "failed", { timeout: 15_000 });

  // The authored panel is visible...
  const fallback = demo.locator(".wd-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("/marvin:dashboard");

  // ...and nothing else is. No orphaned frame, no blank stage holding min-height open.
  await expect(demo.locator("iframe")).toHaveCount(0);
  await expect(demo.locator(".wd-stage")).toBeHidden();
});

test("selecting another widget in the picker frames that widget's document", async ({ page }) => {
  const canvas = await openCanvas(page);

  await canvas.locator('.wd-picker button[data-widget="dashboard"]').click();
  await expect(canvas).toHaveAttribute("data-widget", "dashboard");
  await expect(canvas).toHaveAttribute("data-status", "live", { timeout: 15_000 });

  const frame = canvas.locator("iframe.wd-frame");
  await expect(frame).toHaveAttribute("src", /\/widget-demos\/dashboard\.html$/);

  // The dashboard fixture's own content, proving the payload switched with the document.
  const inner = page.frameLocator("iframe.wd-frame");
  await expect(inner.locator(".mvroot")).toBeVisible();
  await expect(inner.locator("body")).not.toContainText("Connecting…");
});
