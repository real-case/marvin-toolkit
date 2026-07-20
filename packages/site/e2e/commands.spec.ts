import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end proofs for the Commands page. The static-shell tests from spec 009 are replaced
// here by spec 010's interactive proofs (AC1–AC6) — the search island now hydrates. Test titles
// match the spec's oracle refs exactly.

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
const SEC_COUNT = catalog.groups.find((g: { key: string }) => g.key === "sec").count;
// Used to prove the prose branches of the matcher independently of the command name.
const SEC_SCAN = catalog.commands.find((c: { name: string }) => c.name === "sec-scan") as {
  name: string;
  blurb: string;
  description: string;
  phrases: string[];
};

const strip = (s: string) => s.replace(/\s+/g, "");

/** Load /commands and wait for the client:load island to have hydrated. */
async function openCatalog(page: Page, url = "/commands") {
  await page.goto(url);
  // networkidle implies the island's module has been fetched and executed, so its effects
  // (URL sync, the "/" key listener) and its event handlers are live.
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".catalog .searchinput")).toBeVisible();
}

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

test("commands renders every catalog command with human-run marking and the search controls", async ({
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

  // The search controls: a real field, its "/" keycap, the live count, and the eight filter
  // chips (all + the seven groups) with exactly one active.
  await expect(page.locator(".catalog .searchinput")).toBeVisible();
  await expect(page.locator(".catalog .search .kbd")).toHaveText("/");
  await expect(page.locator(".catalog .shown")).toHaveText(`${catalog.commands.length} shown`);
  const chips = (await page.locator(".fchip").allTextContents()).map((t) => t.trim());
  expect(chips).toEqual(["all", ...GROUP_KEYS]);
  await expect(page.locator(".fchip.on")).toHaveCount(1);
  await expect(page.locator(".fchip.on")).toHaveText("all");
});

test("commands holds both themes across the toggle and a reload", async ({ page }) => {
  // With no stored preference the default follows prefers-color-scheme (emulated light,
  // exactly as theme-toggle.spec.ts does); the toggle flips to dark and persists.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/commands");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.locator("#theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark"); // persisted across reload
});

test("commands search filters the catalog to matching commands offline", async ({ page }) => {
  await openCatalog(page);
  const input = page.locator(".catalog .searchinput");

  // Filtering must be pure client work — the corpus already shipped in the bundle.
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await input.fill("changelog");
  // the matching command survives...
  await expect(page.locator('.cmd .name .cn:text-is("changelog")')).toHaveCount(1);
  // ...an unrelated one is filtered out...
  await expect(page.locator('.cmd .name .cn:text-is("sec-iac")')).toHaveCount(0);
  // ...and the view genuinely narrowed.
  const narrowed = await page.locator(".cmd").count();
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThan(catalog.commands.length);
  await expect(page.locator(".catalog .shown")).toHaveText(`${narrowed} shown`);

  // Fuzzy on the command name: a subsequence with gaps still finds it.
  await input.fill("tskst");
  await expect(page.locator('.cmd .name .cn:text-is("task-start")')).toHaveCount(1);

  // The description and trigger phrases are searched too, by substring. Prove each branch with
  // a query that cannot possibly match via the name.
  expect(SEC_SCAN.name).not.toContain("owasp");
  expect(`${SEC_SCAN.description} ${SEC_SCAN.blurb}`.toLowerCase()).toContain("owasp");
  await input.fill("owasp");
  await expect(page.locator('.cmd .name .cn:text-is("sec-scan")')).toHaveCount(1);
  expect(await page.locator(".cmd").count()).toBeLessThan(catalog.commands.length);

  const phrase = "run a security scan";
  expect(SEC_SCAN.phrases.join(" ").toLowerCase()).toContain(phrase);
  expect(`${SEC_SCAN.description} ${SEC_SCAN.blurb}`.toLowerCase()).not.toContain(phrase);
  await input.fill(phrase);
  await expect(page.locator('.cmd .name .cn:text-is("sec-scan")')).toHaveCount(1);

  // Separators do not defeat the name match: a spaced name and a pasted invocation both land.
  for (const variant of ["task start", "/marvin:task-start"]) {
    await input.fill(variant);
    await expect(page.locator('.cmd .name .cn:text-is("task-start")')).toHaveCount(1);
  }

  // Clearing restores the full catalog.
  await input.fill("");
  await expect(page.locator(".cmd")).toHaveCount(catalog.commands.length);

  expect(requests, `filtering must not hit the network, saw: ${requests.join(", ")}`).toHaveLength(
    0,
  );
});

test("commands group chips filter and combine with the query", async ({ page }) => {
  await openCatalog(page);

  // A group chip narrows the catalog to that group and becomes the only active chip.
  await page.locator(".fchip", { hasText: /^sec$/ }).click();
  await expect(page.locator(".fchip.on")).toHaveCount(1);
  await expect(page.locator(".fchip.on")).toHaveText("sec");
  await expect(page.locator(".cmd")).toHaveCount(SEC_COUNT);
  const groupBadges = await page.locator(".cmd .badge.b-acc").allTextContents();
  expect([...new Set(groupBadges)]).toEqual(["sec"]);

  // The query ANDs with the chip — never widens past the selected group.
  await page.locator(".catalog .searchinput").fill("secrets");
  const combined = await page.locator(".cmd").count();
  expect(combined).toBeGreaterThan(0);
  expect(combined).toBeLessThan(SEC_COUNT);
  expect([...new Set(await page.locator(".cmd .badge.b-acc").allTextContents())]).toEqual(["sec"]);

  // "all" clears the group filter; the query still applies, and the view genuinely widens past
  // the group that was selected (asserting the count alone would pass on a dead chip).
  await page.locator(".fchip", { hasText: /^all$/ }).click();
  await expect(page.locator(".fchip.on")).toHaveText("all");
  const widened = [...new Set(await page.locator(".cmd .badge.b-acc").allTextContents())];
  expect(widened, 'the "secrets" matches span more than one group').not.toEqual(["sec"]);
  expect(widened).toContain("sec");
  expect(await page.locator(".cmd").count()).toBeGreaterThan(combined);

  // Clearing both restores everything.
  await page.locator(".catalog .searchinput").fill("");
  await expect(page.locator(".cmd")).toHaveCount(catalog.commands.length);
});

test("commands reflects query and group in the URL and restores them from a deep link", async ({
  page,
}) => {
  await openCatalog(page);

  await page.locator(".catalog .searchinput").fill("scan");
  await page.locator(".fchip", { hasText: /^sec$/ }).click();

  // The filter is mirrored into the URL (FR-14) so the view can be shared. Poll both params
  // together — they are written by separate state updates, so reading one synchronously after
  // the other races the second effect.
  await expect
    .poll(
      () => {
        const params = new URL(page.url()).searchParams;
        return `q=${params.get("q")}&group=${params.get("group")}`;
      },
      { message: "the URL reflects both the query and the group" },
    )
    .toBe("q=scan&group=sec");

  // A deep link restores the same filtered view.
  await openCatalog(page, "/commands?q=scan&group=sec");
  await expect(page.locator(".catalog .searchinput")).toHaveValue("scan");
  await expect(page.locator(".fchip.on")).toHaveText("sec");
  expect([...new Set(await page.locator(".cmd .badge.b-acc").allTextContents())]).toEqual(["sec"]);
  await expect(page.locator('.cmd .name .cn:text-is("sec-scan")')).toHaveCount(1);
});

test("commands focuses the search field on the slash key without inserting the character", async ({
  page,
}) => {
  await openCatalog(page);
  const input = page.locator(".catalog .searchinput");
  await expect(input).not.toBeFocused();

  // "/" pressed outside a field focuses the search box, and preventDefault keeps the slash
  // itself from landing in the field we just focused.
  await page.keyboard.press("/");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");

  // Inside a text field, "/" types normally instead of being hijacked.
  await page.keyboard.type("a/b");
  await expect(input).toHaveValue("a/b");
});

test("commands server-renders the full catalog, hydrates one island, and holds 360 to 1440", async ({
  page,
}) => {
  // Server-rendered: the whole catalog is in the initial HTML, so the page is useful with no
  // JS at all. Fetched raw (no browser execution) to prove it is the server's output.
  const html = await (await page.request.get("/commands")).text();
  expect((html.match(/class="cmd"/g) ?? []).length).toBe(catalog.commands.length);

  // Hydration mounts exactly one island and does not change the rendered card set.
  await openCatalog(page);
  await expect(page.locator("astro-island")).toHaveCount(1);
  await expect(page.locator(".cmd")).toHaveCount(catalog.commands.length);

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

test("commands shows an empty state when nothing matches", async ({ page }) => {
  await openCatalog(page);

  await page.locator(".catalog .searchinput").fill("zzzzqqqxx");
  await expect(page.locator(".catalog .empty")).toBeVisible();
  await expect(page.locator(".cmd")).toHaveCount(0);
  await expect(page.locator(".cmdgroup")).toHaveCount(0);
  await expect(page.locator(".catalog .shown")).toHaveText("0 shown");

  // Recoverable — clearing the query brings the catalog back.
  await page.locator(".catalog .searchinput").fill("");
  await expect(page.locator(".catalog .empty")).toHaveCount(0);
  await expect(page.locator(".cmd")).toHaveCount(catalog.commands.length);
});
