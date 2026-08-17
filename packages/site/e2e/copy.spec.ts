import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Copy-to-clipboard proofs (spec 010, F9 → AC7 / FR-2). ONE delegated handler in Base.astro
// serves every `.copy` button, so this exercises BOTH render paths: a server-rendered
// CodeCommand row on the home hero, and a card the CommandCatalog island renders on /commands
// after hydration. Read-back via navigator.clipboard.readText() is the proof — the "copied"
// label is only a secondary assertion.

// Read the generated catalog as text (not an import) — Node 24 ESM requires an import
// attribute for JSON, and the repo's e2e reads sibling data the same way.
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../src/data/catalog.json"), "utf8"));

// Only some commands carry an example, and only those cards render a copy button — pick one
// out of the data rather than hard-coding a name that could later lose its example.
const WITH_EXAMPLE = catalog.commands.find((c: { example?: string }) => c.example) as {
  name: string;
  example: string;
};

test("copy writes the command text to the clipboard from a static snippet and an island-rendered card", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());

  // ---- 1. a server-rendered CodeCommand row (the home hero) ----
  await page.goto("/");
  const heroRow = page.locator(".command").first();
  const heroCopy = heroRow.locator(".copy");
  const heroText = ((await heroRow.locator(".code").textContent()) ?? "").trim();
  expect(heroText.length, "the hero renders a command to copy").toBeGreaterThan(0);

  await heroCopy.click();
  await expect(heroCopy).toHaveText("copied");
  expect(await readClipboard()).toBe(heroText);

  // The label reverts, so the control stays reusable.
  await expect(heroCopy).toHaveText("copy", { timeout: 3000 });

  // ...and it answers the keyboard, not just the mouse — AC7 says "click or keyboard".
  await heroCopy.focus();
  await page.keyboard.press("Enter");
  await expect(heroCopy).toHaveText("copied");
  expect(await readClipboard()).toBe(heroText);

  // ---- 2. a card rendered by the Preact island (/commands) ----
  await page.goto("/commands");
  await page.waitForLoadState("networkidle");

  const card = page.locator(`.cmd:has(.name .cn:text-is("${WITH_EXAMPLE.name}"))`);
  await expect(card).toHaveCount(1);
  const cardCopy = card.locator(".copy");

  await cardCopy.click();
  await expect(cardCopy).toHaveText("copied");
  // exact text — the island's <code> is a clean text node, so nothing decorative leaks in
  expect(await readClipboard()).toBe(WITH_EXAMPLE.example);
});

test("copy controls are keyboard-operable buttons", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  const heroCopy = page.locator(".command").first().locator(".copy");
  // a real <button>, not the decorative span it used to be — focusable and Enter-activated
  await expect(heroCopy).toHaveJSProperty("tagName", "BUTTON");

  await heroCopy.focus();
  await expect(heroCopy).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(heroCopy).toHaveText("copied");
});
