// seo.ts (spec 013-website-agent-surface-seo, F4) — the machine-facing surface, rendered.
//
// Three pure functions behind the three endpoints under src/pages/ (llms.txt.ts, sitemap.xml.ts,
// robots.txt.ts), plus the two helpers Base.astro shares with them. Kept separate from the
// endpoints so the shape of each document is readable in one place rather than spread across three
// route files, and so Base.astro can resolve a page's metadata through the SAME lookup the sitemap
// uses — that shared path is what keeps canonical and <loc> from disagreeing.
//
// THE ONE RULE THAT MATTERS HERE: every emitted URL is built from the registry `path`, never from
// `Astro.url`. Astro's default `trailingSlash: "ignore"` with directory build output means a page
// can resolve as "/commands" or "/commands/", so deriving canonical from the request and <loc>
// from the registry would let a page advertise two different canonical URLs while both AC3 and AC5
// still passed. Building both from one source removes the possibility rather than testing for it.
//
// Type-only imports use `import type` deliberately: tsconfig extends astro/tsconfigs/strict, which
// sets verbatimModuleSyntax, and a value-form import of a type fails as TS1484 (see the lesson
// "A tsc invocation that names files on the command line silently discards tsconfig.json").
import type { Catalog } from "../data/catalog";
import type { OgImage } from "../data/og";
import type { PageMeta } from "../data/pages";

/** The public repository — the docs map's base and the install instructions' source. */
const REPO = "https://github.com/real-case/marvin-toolkit";
const DOCS = `${REPO}/blob/main/docs`;

/**
 * The two install commands, byte-identical to README.md:35-36.
 *
 * test/seo.test.mjs reads the README and asserts these still match, so a change there fails the
 * build rather than silently leaving llms.txt telling agents to run a stale command. That guard is
 * the reason these are a named constant instead of inline strings.
 */
export const INSTALL_COMMANDS = [
  "/plugin marketplace add real-case/marvin-toolkit",
  "/plugin install marvin@marvin-toolkit",
] as const;

/**
 * The configured origin, or a build-time error naming the cause.
 *
 * `Astro.site` is `URL | undefined`, and every URL this module emits depends on it. A non-null
 * assertion would let a config regression through as silently-relative canonical tags and sitemap
 * locs — the exact defect AC3 and AC5 exist to catch, but only visible to a crawler. Failing the
 * build with the reason is cheaper than discovering it in production.
 */
export function requireOrigin(site: URL | undefined): URL {
  if (!site) {
    throw new Error(
      "astro.config.mjs must set `site` — canonical, og:url and every sitemap <loc> are built from it.",
    );
  }
  return site;
}

/** Strip a trailing slash so "/commands/" and "/commands" resolve alike. Home stays "/". */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** The registry record for a pathname, or undefined when the route has no page entry. */
export function findPage(pages: PageMeta[], pathname: string): PageMeta | undefined {
  const target = normalizePath(pathname);
  return pages.find((page) => normalizePath(page.path) === target);
}

/**
 * The OpenGraph card for a pathname, or undefined when the route has no card (spec 014, F6).
 *
 * Resolves through the SAME `normalizePath` as `findPage` — deliberately, and this is the whole
 * reason the lookup lives here rather than next to the data in src/data/og.ts. Base.astro builds
 * canonical from `findPage` and og:image from this; if the two normalized differently, a registry
 * entry written "/commands/" would resolve for one and miss for the other, and the page would
 * advertise a canonical URL with no image while every test still passed.
 *
 * Returning undefined rather than a fallback is intentional: a route with no card (the three
 * text endpoints, any future 404) emits no og:image at all, which is correct, instead of pointing
 * every crawler at a generic image that describes a different page.
 */
export function ogImageFor(images: OgImage[], pathname: string): OgImage | undefined {
  const target = normalizePath(pathname);
  return images.find((image) => normalizePath(image.path) === target);
}

/**
 * Registry prose with its catalog placeholders filled.
 *
 * `/commands` quotes how many commands and groups exist, and those numbers must come from the
 * generated catalog rather than the registry — a literal in pages.json would go stale on the next
 * command added, which is exactly the drift PR #148 cleaned out of the site's comments.
 *
 * Applied to EVERY registry prose field — `title`, `description` and `summary` — wherever it is
 * rendered, so none of them can disagree and none can ship a literal brace. The symmetry is the
 * point: an exception would be invisible at the call site, and `title` in particular reaches both
 * `<title>` and `og:title`, where a stray `{commands}` is seen by every crawler. Takes the string
 * rather than the page so no caller has to know which field another one reads.
 */
export function resolvePlaceholders(text: string, catalog: Catalog): string {
  return text
    .replaceAll("{commands}", String(catalog.commands.length))
    .replaceAll("{groups}", String(catalog.groups.length));
}

/**
 * Absolute URL for a site-root path, e.g. "/commands" -> "https://marvin-toolkit.dev/commands".
 *
 * The path is normalized first, so a registry entry written with a stray trailing slash still
 * produces the canonical slash-free form. `new URL` never appends one, so home resolves to the
 * bare origin with its root slash and nothing else needs trimming.
 */
export function absoluteUrl(path: string, origin: URL): string {
  return new URL(normalizePath(path), origin).href;
}

/** XML text-node escaping for sitemap <loc> values. */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * `/llms.txt` — the agent-readable summary (FR-24), in the llmstxt.org shape: one H1, a blockquote
 * summary, free-form detail, then H2 link-list sections, with deep reference under the spec's
 * reserved `## Optional` heading so a context-constrained reader can drop it cleanly.
 *
 * Every command is listed once, linked to its `/commands?q=<name>` deep link — a real URL, because
 * spec 010 shipped URL-reflected filter state on that page. That keeps the command index a
 * conformant markdown link list rather than bare bullets, and means an agent can follow any entry
 * to a working filtered view. Commands are grouped one H2 per group, the de-facto convention for
 * developer tooling.
 *
 * Note `llms-full.txt` is deliberately absent: it is a vendor convention (Anthropic, Vercel,
 * Mintlify) with no standing in the llms.txt spec, which describes `## Optional` for this purpose.
 */
export function renderLlmsTxt(pages: PageMeta[], catalog: Catalog, origin: URL): string {
  const url = (path: string) => absoluteUrl(path, origin);
  const commandsUrl = url("/commands");

  // Iterate catalog.GROUPS, not the commands. Bucketing by whatever `command.group` says would
  // order the sections by first appearance, which puts `pr` before `adr` — the reverse of
  // catalog.groups and of what /commands renders (CommandCatalog.tsx keeps catalog order
  // deliberately). Two surfaces listing the same seven groups in different orders is the kind of
  // small incoherence nobody reports and everybody notices.
  const sections = catalog.groups
    .map((group) => ({
      group,
      commands: catalog.commands.filter((command) => command.group === group.key),
    }))
    // A group with no commands would otherwise emit a heading and a blurb over nothing. Skipping
    // it keeps the document honest; the empty group itself is a catalog defect, and catalog
    // integrity is guarded by catalog.test.mjs rather than papered over here.
    .filter(({ commands }) => commands.length > 0)
    .map(({ group, commands }) => ({
      commands,
      text: [
        `## Commands: ${group.key}`,
        "",
        group.blurb,
        "",
        ...commands.map(
          (command) =>
            `- [/marvin:${command.name}](${commandsUrl}?q=${encodeURIComponent(command.name)}): ${command.blurb}`,
        ),
      ].join("\n"),
    }));

  // The cost of iterating groups is that a command whose group has no catalog.groups entry would
  // vanish from llms.txt entirely rather than appearing under a stray heading. Silent omission is
  // the worst failure mode for a document whose whole job is completeness, so it fails the build.
  const listed = sections.reduce((total, section) => total + section.commands.length, 0);
  if (listed !== catalog.commands.length) {
    const known = new Set(catalog.groups.map((group) => group.key));
    const orphans = catalog.commands.filter((command) => !known.has(command.group));
    // Two distinct causes reach this branch, and naming the wrong one sends the reader hunting in
    // the wrong file: too FEW listed means orphaned commands, too MANY means duplicate group keys
    // double-counting them.
    const cause = orphans.length
      ? `These name a group absent from catalog.groups: ${orphans.map((c) => `${c.name} (${c.group})`).join(", ")}`
      : "No command names an unknown group, so catalog.groups most likely contains a duplicate key.";
    throw new Error(
      `llms.txt would list ${listed} of ${catalog.commands.length} commands. ${cause}`,
    );
  }

  return [
    "# Marvin",
    "",
    `> Claude Code toolset for AI-assisted development. Without panic. One plugin backed by one MCP server, exposing ${catalog.commands.length} commands across ${catalog.groups.length} groups — core dev tools, a spec-driven task pipeline, security scanners, an ADR lifecycle, refactoring, and a task board.`,
    "",
    "Install inside Claude Code:",
    "",
    "```",
    ...INSTALL_COMMANDS,
    "```",
    "",
    `Version ${catalog.counts.version} · ${catalog.counts.tools} MCP tools · ${catalog.counts.agents} agents · ${catalog.counts.widgets} widgets · ${catalog.counts.license} licensed.`,
    "",
    "## Pages",
    "",
    ...pages.map(
      (page) =>
        `- [${resolvePlaceholders(page.title, catalog)}](${url(page.path)}): ` +
        resolvePlaceholders(page.summary, catalog),
    ),
    "",
    "## Documentation",
    "",
    `- [Getting started](${DOCS}/getting-started.md): install, confirm it works, run your first commands.`,
    `- [Usage guide](${DOCS}/usage.md): worked walkthroughs for committing, the task pipeline, the board, security and refactoring.`,
    `- [Configuration](${DOCS}/configuration.md): the .marvin/ working directory, config.json, and the MARVIN_* environment variables.`,
    `- [Command reference](${DOCS}/commands.md): every command with its arguments and behaviour.`,
    "",
    ...sections.flatMap((section) => [section.text, ""]),
    "## Optional",
    "",
    `- [Architecture](${DOCS}/architecture.md): how the plugin, the MCP server and the skills fit together.`,
    `- [Architecture decisions](${DOCS}/adr/): the ADR corpus behind the current design.`,
    `- [Repository](${REPO}): source, issues and releases.`,
    "",
  ].join("\n");
}

/**
 * `/sitemap.xml` — one <url> per registry page (FR-23).
 *
 * Hand-rolled rather than delegated to @astrojs/sitemap: that integration is compatible, but it
 * would add three transitive dependencies to emit five URLs, and its output is produced inside
 * `astro build`, which the Node-20 CI leg no-ops. The registry is the URL set either way.
 */
export function renderSitemap(pages: PageMeta[], origin: URL): string {
  const entries = pages.map((page) =>
    [
      "  <url>",
      `    <loc>${escapeXml(absoluteUrl(page.path, origin))}</loc>`,
      `    <priority>${page.priority.toFixed(1)}</priority>`,
      "  </url>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * `/robots.txt` — allow-all plus an absolute Sitemap directive.
 *
 * Allow-all is a deliberate exposure decision, not a default: the site is public marketing with no
 * private routes, and the product's audience explicitly includes coding agents. The Sitemap
 * directive must be absolute — crawlers fetch it without page context to resolve against.
 */
export function renderRobots(origin: URL): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml", origin)}`,
    "",
  ].join("\n");
}
