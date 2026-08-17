import { test, expect } from "@playwright/test";

// End-to-end smoke for the Phase 1 scaffold (spec 004, F19). Drives the real built page
// via `astro preview`: the theme toggle (AC3), self-hosted fonts (AC4), and the five-route
// FR-1 chrome (AC5). Test titles match the spec's oracle refs exactly.

const ROUTES = ["/", "/commands", "/pipeline", "/toolbox", "/quickstart"];
const REPO = "https://github.com/real-case/marvin-toolkit";

test("defaults to light regardless of the OS color-scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  // No stored preference → the anti-FOUC script defaults to light even when the OS prefers dark;
  // only an explicit toggle switches away.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("toggle flips and persists the theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.locator("#theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark"); // persisted across reload
});

test("fonts are self-hosted and loaded with swap", async ({ page }) => {
  const fontHosts = new Set<string>();
  page.on("request", (req) => {
    if (req.resourceType() === "font") fontHosts.add(new URL(req.url()).host);
  });

  await page.goto("/");
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    // forEach (not spread/Array.from) — FontFaceSet isn't typed as an array under Astro's lib.
    const out: { family: string; display: string }[] = [];
    document.fonts.forEach((f) => {
      if (f.status === "loaded") out.push({ family: f.family, display: f.display });
    });
    return out;
  });

  const hanken = loaded.find((f) => /Hanken/i.test(f.family));
  const jetbrains = loaded.find((f) => /JetBrains/i.test(f.family));
  expect(hanken, "a Hanken Grotesk face should be loaded").toBeTruthy();
  expect(jetbrains, "a JetBrains Mono face should be loaded").toBeTruthy();
  expect(hanken!.display).toBe("swap");
  expect(jetbrains!.display).toBe("swap");

  // Mono on the hero command...
  const codeFamily = await page
    .locator(".code")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(codeFamily).toMatch(/JetBrains/i);

  // ...and the display face (Hanken) on a heading. The home hero wordmark used to be the one
  // h1 deliberately set in mono (FR-4 as written), which is why this assertion looks at an
  // inner page; it now renders Hanken like every other heading, so either page would prove it.
  await page.goto("/commands");
  const h1Family = await page
    .locator("h1")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(h1Family).toMatch(/Hanken/i);

  // Same-origin only — no external font host was contacted.
  const origin = new URL(page.url()).host;
  expect(fontHosts.size, "at least one font was fetched").toBeGreaterThan(0);
  expect(Array.from(fontHosts).every((h) => h === origin)).toBe(true);
});

test("all five routes serve the FR-1 nav and footer", async ({ page }) => {
  for (const route of ROUTES) {
    const resp = await page.goto(route);
    expect(resp?.status(), `GET ${route}`).toBe(200);

    // Nav (FR-1): wordmark, the four inner links, a GitHub link, the theme toggle.
    await expect(page.locator(".nav__brand")).toHaveText("Marvin");
    for (const href of ["/commands", "/pipeline", "/toolbox", "/quickstart"]) {
      await expect(page.locator(`.nav__links a[href="${href}"]`)).toHaveCount(1);
    }
    await expect(page.locator(".nav__github")).toHaveAttribute("href", REPO);
    await expect(page.locator("#theme-toggle")).toHaveCount(1);

    // Footer (FR-1): repository, releases, docs, MIT license, author.
    for (const label of ["Repository", "Releases", "Docs", "MIT License", "Author"]) {
      await expect(page.locator(".footer__links a", { hasText: label })).toHaveCount(1);
    }
    await expect(page.locator(".footer__links a", { hasText: "Author" })).toHaveAttribute(
      "href",
      /^https:\/\/github\.com\/real-case/,
    );
  }
});
