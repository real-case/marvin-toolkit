import { test, expect, type Page } from "@playwright/test";

// Vercel Web Analytics proofs (spec 015 — FR-22). The site wires analytics through the
// @vercel/analytics package: the <Analytics/> component (Base.astro <head>) sets up window.va, and a
// delegated listener fires track() on install-command copies and GitHub-link clicks. On any
// non-Vercel origin the collector script 404s, so track() simply enqueues into window.va's queue
// (window.vaq) — which is what these tests read. Measurement is only provable on a Vercel deploy; the
// in-repo oracle is that the wiring FIRES the event. Harness = astro preview (see copy.spec.ts).

// @vercel/analytics' initQueue() defines window.va to push its raw argument array onto window.vaq —
// so track("x") appends ["event", { name: "x", ... }]. We read only the event names, ignoring the
// component's own ["pageview", ...] entry.
async function trackedEventNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const queue = (window as unknown as { vaq?: unknown[][] }).vaq ?? [];
    return queue
      .filter((entry) => entry[0] === "event")
      .map((entry) => (entry[1] as { name?: string }).name)
      .filter((name): name is string => typeof name === "string");
  });
}

test("the Analytics bootstrap initializes window.va on a static page", async ({ page }) => {
  await page.goto("/quickstart");
  await page.waitForLoadState("networkidle");

  // The <Analytics/> custom element upgrades and calls inject(), which defines the window.va queue.
  // Without it track() is optional-chained to a no-op and every event is silently dropped.
  const vaType = await page.evaluate(() => typeof (window as unknown as { va?: unknown }).va);
  expect(vaType, "window.va must be a function so events can queue").toBe("function");

  // The wiring must not turn a static page into a hydrated island — a processed <script> and the
  // <Analytics/> .astro component are not astro-islands, so the zero-framework-JS budget holds.
  await expect(page.locator("astro-island")).toHaveCount(0);
});

test("copying an install command fires install_copy while an ordinary command copy does not", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/quickstart");
  await page.waitForLoadState("networkidle");

  // Install rows carry data-va-event="install_copy"; /marvin:help and /marvin:task-start do not.
  const installCopy = page
    .locator('.command[data-va-event="install_copy"]')
    .first()
    .locator(".copy");
  await installCopy.click();
  await expect(async () => {
    expect(await trackedEventNames(page)).toContain("install_copy");
  }).toPass();

  // An unmarked command copy must NOT enqueue install_copy — this is what proves the marker
  // discriminates rather than every copy firing the event.
  const before = (await trackedEventNames(page)).filter((n) => n === "install_copy").length;
  const plainCopy = page.locator(".command:not([data-va-event]) .copy").first();
  await plainCopy.click();
  await expect(plainCopy).toHaveText("copied"); // the copy itself worked (shared clipboard handler)
  const after = (await trackedEventNames(page)).filter((n) => n === "install_copy").length;
  expect(after, "an unmarked command copy must not enqueue install_copy").toBe(before);
});

test("clicking a GitHub link fires github_click", async ({ page }) => {
  // Cancel the outbound navigation in a capture-phase listener so the analytics bubble listener
  // still fires but the browser never leaves for github.com (nothing external is fetched in CI).
  await page.addInitScript(() => {
    document.addEventListener(
      "click",
      (event) => {
        const link = (event.target as Element | null)?.closest?.('a[href*="github.com"]');
        if (link) event.preventDefault();
      },
      true,
    );
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.locator('a[href*="github.com"]').first().click();
  await expect(async () => {
    expect(await trackedEventNames(page)).toContain("github_click");
  }).toPass();
});

test("the footer discloses cookieless analytics", async ({ page }) => {
  await page.goto("/");
  const disclosure = page.locator('[data-slot="analytics-disclosure"]');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText(/no cookies/i);
});
