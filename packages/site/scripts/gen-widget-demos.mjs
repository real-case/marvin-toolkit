#!/usr/bin/env node
// gen-widget-demos.mjs — the website's live widget-demo assets (spec 011-website-widget-embeds, F1).
//
// Emits packages/site/public/widget-demos/, the two files each Toolbox / Home demo needs:
//   <name>.html — a byte copy of the COMMITTED plugins/marvin/widgets/<name>.html, the same
//                 document the MCP server serves as a ui:// resource. The site frames the real
//                 artifact, not a parallel build (ADR-0024 / spec 011 Chosen Approach).
//   <name>.json — that widget's primary fixture export, read from the widgets workspace's own
//                 src/widgets/<name>/fixture.ts, so the demo shows exactly what the widget tests
//                 and Storybook show and cannot drift into hand-written mock data.
//
// Both are BUILD OUTPUTS: git-ignored (packages/site/.gitignore) and Prettier-ignored
// (.prettierignore). Prettier does not read nested gitignores, so the .prettierignore entry is
// load-bearing — without it `format:check` fails on the copied widget HTML.
//
// The fixtures are read with the gen-catalog mechanism: transpile the `.ts` in memory and import
// the result as a `data:` URL — no build step, no dependency on the widgets workspace being built.
// Eight of the nine fixtures import only a TYPE (erased by transpile), so they are self-contained.
// `help/fixture.ts` alone has a runtime import of `@marvin-toolkit/mcp-shared/help-content`; its
// specifier is rewritten to a nested `data:` URL of that module, transpiled the same way.
//
// Fails loudly rather than silently skipping: a widget with no fixture, a fixture with no primary
// export, or a fixture/widget count mismatch aborts the build. A widget added to the plugin must
// therefore be given a fixture mapping here before the site will build.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", ".."); // packages/site/scripts → repo root

const WIDGETS_HTML_DIR = join(ROOT, "plugins", "marvin", "widgets");
const WIDGETS_SRC_DIR = join(ROOT, "packages", "marvin-widgets", "src", "widgets");
const HELP_CONTENT_TS = join(ROOT, "packages", "marvin-mcp-shared", "src", "help-content.ts");
const OUT_DIR = join(here, "..", "public", "widget-demos");

/**
 * The primary fixture export per widget — the "representative, fully populated" one each widget's
 * fixture module leads with. Explicit rather than inferred: every fixture module also exports
 * edge-case variants (`empty*`, `minimal*`, `failing*`, `noServers*`) that exist for tests and must
 * never be what the marketing site shows. Keyed by widget FILE name, which is what the committed
 * HTML and the site's data-widget attributes use.
 */
export const PRIMARY_FIXTURE = {
  audit: "auditListFixture",
  dashboard: "dashboardFixture",
  handoffs: "handoffsFixture",
  help: "helpFixture",
  reports: "reportsFixture",
  "task-detail": "taskDetailFixture",
  "task-list": "taskListFixture",
  "task-summary": "taskSummaryFixture",
  "tracker-list": "trackerListFixture",
};

/** The committed widget documents, by file name, in directory order. */
export function listWidgets() {
  return readdirSync(WIDGETS_HTML_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length))
    .sort();
}

/** Transpile a `.ts` source string in memory to an importable `data:` URL. */
function toDataUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  });
  return "data:text/javascript;base64," + Buffer.from(outputText, "utf8").toString("base64");
}

/**
 * Load one widget's fixture module. `help/fixture.ts` is the only one with a runtime import, so its
 * bare specifier is swapped for an inlined `data:` URL of the transpiled help-content module before
 * transpiling — a bare specifier cannot resolve from inside a `data:` URL.
 */
async function loadFixtureModule(widget) {
  const path = join(WIDGETS_SRC_DIR, widget, "fixture.ts");
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `[gen-widget-demos] no fixture for widget "${widget}" — expected ${relative(ROOT, path)}. ` +
        `Every committed widget needs a fixture so its demo has data.`,
    );
  }

  if (source.includes("@marvin-toolkit/mcp-shared/help-content")) {
    const helpContentUrl = toDataUrl(readFileSync(HELP_CONTENT_TS, "utf8"));
    source = source.replaceAll("@marvin-toolkit/mcp-shared/help-content", helpContentUrl);
  }

  return import(toDataUrl(source));
}

/**
 * Build every widget's demo payload. Pure — returns the data, writes nothing, so the drift guard
 * can call it without touching the working tree.
 */
export async function buildDemoPayloads() {
  const widgets = listWidgets();
  const payloads = {};

  for (const widget of widgets) {
    const exportName = PRIMARY_FIXTURE[widget];
    if (!exportName) {
      throw new Error(
        `[gen-widget-demos] widget "${widget}" has no PRIMARY_FIXTURE mapping. Add one so its ` +
          `demo shows the representative fixture rather than an edge case.`,
      );
    }

    const mod = await loadFixtureModule(widget);
    const value = mod[exportName];
    if (value === undefined) {
      throw new Error(
        `[gen-widget-demos] fixture for "${widget}" does not export "${exportName}". ` +
          `Available: ${Object.keys(mod).join(", ") || "(none)"}`,
      );
    }
    if (value === null || typeof value !== "object" || Object.keys(value).length === 0) {
      throw new Error(
        `[gen-widget-demos] fixture "${exportName}" for "${widget}" is empty — a demo framed with ` +
          `it would render the widget's no-data state.`,
      );
    }

    payloads[widget] = value;
  }

  return payloads;
}

/** Serialization for the emitted fixture JSON — compact, since these are fetched, not read. */
export function serializeFixture(payload) {
  return JSON.stringify(payload) + "\n";
}

// Run directly (`node scripts/gen-widget-demos.mjs`) → write the assets. Imported (by the test) →
// export only, so the guard can rebuild the payloads without writing into public/.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payloads = await buildDemoPayloads();
  const widgets = Object.keys(payloads);

  // Rebuild from scratch so a widget removed from the plugin cannot leave a stale demo behind.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const widget of widgets) {
    writeFileSync(
      join(OUT_DIR, `${widget}.html`),
      readFileSync(join(WIDGETS_HTML_DIR, `${widget}.html`)),
    );
    writeFileSync(join(OUT_DIR, `${widget}.json`), serializeFixture(payloads[widget]));
  }

  console.log(
    `[gen-widget-demos] wrote ${relative(ROOT, OUT_DIR)} — ${widgets.length} widget documents ` +
      `+ ${widgets.length} fixtures (${widgets.join(", ")})`,
  );
}
