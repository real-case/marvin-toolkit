// seo.test.mjs — the two SEO guards that do not need a browser (spec 013, F15).
//
// Everything requiring a built, served site lives in e2e/seo.spec.ts and runs on the Node-22 leg
// only, because scripts/build.mjs no-ops `astro build` below Node 22.12. These two assertions are
// filesystem-and-text level, so they run on BOTH legs — which is exactly why they read pages.json
// and README.md with readFileSync rather than importing TypeScript. Same convention as
// catalog.test.mjs and command-refs.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const SITE = join(here, "..");
const PAGES_JSON = join(SITE, "src", "data", "pages.json");
const PAGES_DIR = join(SITE, "src", "pages");
const SEO_TS = join(SITE, "src", "lib", "seo.ts");
const README = join(here, "..", "..", "..", "README.md");

/**
 * Every page file under src/pages, recursively, as a path relative to that directory.
 *
 * Recursive on purpose: a flat readdir would not see `src/pages/docs/index.astro`, so a nested
 * page could ship with no registry entry — no canonical, no OpenGraph, no sitemap row — while this
 * guard stayed green. That is precisely AC7's stated failure mode, so the guard must not have a
 * blind spot shaped like it. Mirrors the walker in command-refs.test.mjs.
 */
function pageFilesUnder(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return pageFilesUnder(join(dir, entry.name), `${prefix}${entry.name}/`);
    // `.astro` only. The endpoints (llms.txt.ts, sitemap.xml.ts, robots.txt.ts) are routes but NOT
    // pages — they render no HTML, so they carry no metadata and must not appear in the sitemap.
    // Excluding by EXTENSION rather than by a filename list means a future endpoint needs no edit
    // here, while a future page is caught immediately.
    return entry.name.endsWith(".astro") ? [`${prefix}${entry.name}`] : [];
  });
}

/**
 * The site-root path a page file serves, by Astro's file-based routing:
 * `index.astro` -> "/", `commands.astro` -> "/commands", `docs/index.astro` -> "/docs".
 */
function routeFor(relativePath) {
  const base = relativePath.replace(/\.astro$/, "");
  if (base === "index") return "/";
  return base.endsWith("/index") ? `/${base.slice(0, -"/index".length)}` : `/${base}`;
}

test("the page registry and src/pages agree in both directions", () => {
  const registry = JSON.parse(readFileSync(PAGES_JSON, "utf8"));

  const pageFiles = pageFilesUnder(PAGES_DIR);

  // Non-vacuity floor, mirroring command-refs.test.mjs:70. Without it, a readdir that silently
  // returned [] would satisfy "every file has an entry" and "every entry has a file" is the only
  // half left doing work — the assertion would pass while guarding nothing.
  assert.ok(
    pageFiles.length >= 5,
    `expected at least the five known pages under src/pages, found ${pageFiles.length}`,
  );
  assert.ok(
    registry.length >= 5,
    `expected at least five registry entries, got ${registry.length}`,
  );

  const fromFiles = pageFiles.map(routeFor).sort();
  const fromRegistry = registry.map((page) => page.path).sort();

  assert.deepEqual(
    fromRegistry,
    fromFiles,
    "src/data/pages.json and src/pages/*.astro disagree.\n" +
      "Every page needs a registry entry — the entry is what gives it a <title>, a meta " +
      "description, a canonical tag and a sitemap row. A page added without one ships with the " +
      "generic default metadata and is invisible to the sitemap, which is the gap that let the " +
      "site advertise an llms.txt it did not serve.",
  );

  // Titles are what crawlers show; two pages sharing one is a real defect, not a style issue.
  const titles = registry.map((page) => page.title);
  assert.equal(new Set(titles).size, titles.length, `registry titles must be unique: ${titles}`);

  // Canonical form: no trailing slash anywhere except the site root.
  for (const page of registry) {
    assert.ok(
      page.path === "/" || !page.path.endsWith("/"),
      `registry path "${page.path}" must not end in a slash — canonical and <loc> are built from it`,
    );
    assert.ok(page.path.startsWith("/"), `registry path "${page.path}" must be site-root-relative`);
  }
});

test("llms.txt install commands match the README verbatim", () => {
  // Read seo.ts as TEXT, not as a module: node:test cannot import TypeScript and the Node-20 leg
  // has no transpile step. command-refs.test.mjs scans raw source the same way. The point is to
  // catch drift, and drift is visible in the text.
  const source = readFileSync(SEO_TS, "utf8");
  const block = source.match(/export const INSTALL_COMMANDS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, "could not find INSTALL_COMMANDS in src/lib/seo.ts — has it been renamed?");

  const declared = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(declared.length, 2, `expected two install commands, found ${declared.length}`);

  // The README is the source of truth: it is what a human is told to run.
  const readme = readFileSync(README, "utf8");
  const fromReadme = [...readme.matchAll(/^(\/plugin .+)$/gm)].map((match) => match[1].trim());
  assert.ok(
    fromReadme.length >= 2,
    `expected the README to document at least two /plugin commands, found ${fromReadme.length}`,
  );

  assert.deepEqual(
    declared,
    fromReadme.slice(0, 2),
    "llms.txt would tell agents to run different install commands than README.md documents.\n" +
      "An agent following llms.txt must land in the same place a human following the README does; " +
      "a stale command here fails silently, because nothing else compares the two.",
  );
});
