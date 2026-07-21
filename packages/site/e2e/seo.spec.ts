import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the agent-readable surface and SEO metadata (spec 013, F16). Drives the
// real built site through `astro preview`, same harness as the sibling specs. Test titles match the
// spec's oracle refs exactly (AC1-AC6).
//
// The three endpoints are plain-text/XML documents, so they are fetched with the `request` fixture
// rather than `page.goto` — navigating to them would wrap the body in a browser-generated HTML
// shell and assertions would be reading Chrome's rendering, not our output.

// Read generated data as text, not as an import — Node 24 ESM requires an import attribute for
// JSON, and the repo's guards read sibling sources the same way.
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../src/data/catalog.json"), "utf8"));
const registry = JSON.parse(readFileSync(join(here, "../src/data/pages.json"), "utf8"));

/** Must match `site` in astro.config.mjs — every absolute URL on the site is built from it. */
const ORIGIN = "https://marvin-toolkit.dev";

/**
 * The registry's placeholder substitution, recomputed here from catalog.json rather than imported
 * from src/lib/seo.ts. Deriving the expected value independently is the point — importing the
 * implementation's own helper would make the assertion agree with itself by construction.
 */
const resolve = (text: string) =>
  text
    .replaceAll("{commands}", String(catalog.commands.length))
    .replaceAll("{groups}", String(catalog.groups.length));

test("llms.txt serves the llmstxt.org structure with the README install commands", async ({
  request,
}) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);

  const body = await response.text();
  const lines = body.split("\n");

  // llmstxt.org: an H1 is the only required element, and it comes first.
  expect(lines[0]).toBe("# Marvin");
  expect(lines.filter((line) => line.startsWith("# "))).toHaveLength(1);

  // ...followed by the blockquote summary.
  const blockquote = lines.find((line) => line.startsWith("> "));
  expect(blockquote).toBeTruthy();
  expect(lines.indexOf(blockquote!)).toBeLessThan(4);

  // Both install commands, verbatim. seo.test.mjs is what pins these to README.md on both CI legs;
  // this asserts they actually reach the served document.
  expect(body).toContain("/plugin marketplace add real-case/marvin-toolkit");
  expect(body).toContain("/plugin install marvin@marvin-toolkit");

  // The spec's reserved section for deep reference, so a context-constrained reader can drop it.
  expect(body).toContain("\n## Optional\n");

  // No unresolved placeholder anywhere in the document. Both registry prose fields carry
  // `{commands}`/`{groups}` tokens, and a typo substitutes nothing — shipping a literal brace to
  // an agent. This covers the `summary` path, which the AC5 description assertion cannot see.
  expect(body).not.toMatch(/\{[a-zA-Z]+\}/);

  // Every H2 section holds a markdown link list — the shape a consumer parses.
  const headings = lines.filter((line) => line.startsWith("## "));
  expect(headings).toContain("## Pages");
  expect(headings).toContain("## Documentation");
  expect(headings).toContain("## Optional");
});

test("llms.txt lists every catalog command exactly once as a deep link", async ({ request }) => {
  const body = await (await request.get("/llms.txt")).text();

  // Section order must match catalog.groups — the same order /commands renders. Asserting the
  // sequence, not just presence, is what catches the two surfaces drifting apart.
  const headings = [...body.matchAll(/^## Commands: (\S+)$/gm)].map((match) => match[1]);
  // Groups that actually have commands, in catalog order. A group with none emits no section —
  // a heading over an empty list would be noise — so the expectation is filtered the same way.
  const populated = catalog.groups
    .filter((group: { key: string }) =>
      catalog.commands.some((command: { group: string }) => command.group === group.key),
    )
    .map((group: { key: string }) => group.key);
  expect(headings).toEqual(populated);

  const listed = [...body.matchAll(/^- \[\/marvin:([a-z0-9-]+)\]\((\S+)\): (.+)$/gm)];
  const names = listed.map((match) => match[1]);

  // Exactly once each, and nothing extra: a hardcoded or dropped command fails here rather than
  // silently disagreeing with the registry the next time a command is added.
  expect(names.slice().sort()).toEqual(
    catalog.commands.map((command: { name: string }) => command.name).sort(),
  );
  expect(new Set(names).size).toBe(names.length);
  expect(names).toHaveLength(catalog.commands.length);

  // Each entry carries its OWN blurb and sits under its OWN group's heading. Without this the
  // suite passed on a renderer that emitted all 52 commands under `## Commands: core` plus six
  // empty headings — AC2 says "with its group and blurb", and presence checks alone proved
  // neither. Section membership is derived by walking the body and tracking the current heading.
  const sectionOf = new Map<string, string>();
  let current = "";
  for (const line of body.split("\n")) {
    const heading = line.match(/^## Commands: (\S+)$/);
    if (heading) current = heading[1];
    const entry = line.match(/^- \[\/marvin:([a-z0-9-]+)\]/);
    if (entry) sectionOf.set(entry[1], current);
  }

  for (const command of catalog.commands as { name: string; group: string; blurb: string }[]) {
    expect(sectionOf.get(command.name), `section for ${command.name}`).toBe(command.group);
  }
  for (const [, name, href, blurb] of listed) {
    expect(href).toBe(`${ORIGIN}/commands?q=${name}`);
    const source = catalog.commands.find((command: { name: string }) => command.name === name);
    expect(blurb, `blurb for ${name}`).toBe(source.blurb);
  }
});

test("sitemap lists exactly the registry pages as absolute URLs", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expected = registry.map((page: { path: string }) =>
    page.path === "/" ? `${ORIGIN}/` : `${ORIGIN}${page.path}`,
  );

  expect(locs.slice().sort()).toEqual(expected.slice().sort());

  for (const loc of locs) {
    // Absolute, on the production origin — a relative or localhost loc is rejected by crawlers.
    expect(loc.startsWith(`${ORIGIN}/`)).toBe(true);
    // No trailing slash except the site root, matching the canonical form Base.astro emits.
    if (loc !== `${ORIGIN}/`) expect(loc.endsWith("/")).toBe(false);
  }
});

test("robots.txt serves and points at the absolute sitemap URL", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toContain("User-agent: *");
  expect(body).toContain("Allow: /");
  // Absolute: a crawler fetches this with no page context to resolve a relative path against.
  expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
});

test("every page emits canonical and OpenGraph metadata matching its sitemap entry", async ({
  page,
  request,
}) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const locs = new Map(
    registry.map((entry: { path: string }) => [
      entry.path,
      entry.path === "/" ? `${ORIGIN}/` : `${ORIGIN}${entry.path}`,
    ]),
  );

  const seenTitles = new Set<string>();

  for (const entry of registry as { path: string; title: string; description: string }[]) {
    await page.goto(entry.path);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
    const ogDescription = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");

    // The whole point of building both from the registry: a page cannot advertise one canonical
    // URL while the sitemap advertises another.
    expect(canonical, `canonical on ${entry.path}`).toBe(locs.get(entry.path));
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
    expect(ogUrl, `og:url on ${entry.path}`).toBe(canonical);

    // Registry-sourced, so index.astro no longer inherits Base's generic default. Titles run
    // through the same placeholder resolution as the other two prose fields — a no-op for every
    // title today, asserted anyway so the symmetry cannot quietly lapse.
    await expect(page).toHaveTitle(resolve(entry.title));
    expect(ogTitle).toBe(resolve(entry.title));
    // Strict equality, not truthiness. On `/` this is the ONLY assertion with discriminating
    // power: Base.astro's fallback title is byte-identical to the registry's home title and its
    // fallback canonical resolves to the same URL, so if the registry lookup silently returned
    // undefined for home every other check here would still pass. The fallback description is
    // deliberately different, which is what makes this one able to tell them apart.
    expect(ogDescription, `og:description on ${entry.path}`).toBe(resolve(entry.description));

    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "website");
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      "content",
      "Marvin",
    );
    // The one tag X will not infer from OpenGraph. `summary_large_image` since Phase 6b shipped the
    // cards — it must move in lockstep with og:image, because declaring the large type with no
    // image renders an empty box rather than degrading to the small card.
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );

    expect(seenTitles.has(entry.title), `duplicate title: ${entry.title}`).toBe(false);
    seenTitles.add(entry.title);
  }

  expect(seenTitles.size).toBe(registry.length);
});

test("every page emits an absolute og:image that resolves to a 1200x630 PNG", async ({
  page,
  request,
}) => {
  // The card manifest, read independently of the site's own module — same discipline as `resolve`
  // above: importing what Base.astro imports would let a wrong manifest agree with itself.
  const cards = JSON.parse(readFileSync(join(here, "../src/data/og.json"), "utf8"));
  expect(cards.length, "expected a card manifest with one row per page").toBeGreaterThanOrEqual(5);

  for (const entry of registry) {
    await page.goto(entry.path);

    const card = cards.find((row: { path: string }) => row.path === entry.path);
    expect(card, `no og.json row for ${entry.path}`).toBeTruthy();

    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");

    // Absolute, not relative. A crawler fetches og:image with no page context to resolve against,
    // so a relative value is silently dropped — the failure is invisible from inside the page.
    expect(ogImage, `og:image on ${entry.path}`).toBe(`${ORIGIN}${card.file}`);

    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      "content",
      "1200",
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      "content",
      "630",
    );
    // Alt text is not required by any platform; emitted because a card carrying the page's only
    // headline should not be invisible to a screen reader in a feed.
    const alt = await page.locator('meta[property="og:image:alt"]').getAttribute("content");
    expect(alt, `og:image:alt on ${entry.path}`).toContain(card.card);

    // The URL has to actually serve the bytes. This is what catches a card that was declared but
    // never committed, or a path Astro does not publish from public/.
    const response = await request.get(card.file);
    expect(response.status(), `${card.file} must be served`).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");

    // And the served file must really be the declared size — IHDR width/height as big-endian
    // uint32 at byte 16 and 20. A wrong-sized card is cropped by every platform.
    const bytes = Buffer.from(await response.body());
    expect(bytes.readUInt32BE(16), `${card.file} width`).toBe(1200);
    expect(bytes.readUInt32BE(20), `${card.file} height`).toBe(630);
  }
});

test("quickstart agentbox links to a resolving llms.txt and names the install path", async ({
  page,
  request,
}) => {
  await page.goto("/quickstart");

  const box = page.locator(".agentbox");
  const link = box.locator('a[href="/llms.txt"]');
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();

  // The claim the page made from Phase 3 onward, now true: the link resolves.
  expect((await request.get("/llms.txt")).status()).toBe(200);

  // FR-24 asks the Quickstart to *document* the agent-install path, not merely link it — so the
  // box must say what the file is for. Asserting two stable substrings rather than exact copy
  // keeps the wording free to change without amending a test.
  const text = (await box.innerText()).toLowerCase();
  expect(text).toContain("llms.txt");
  expect(text).toContain("install");
});
