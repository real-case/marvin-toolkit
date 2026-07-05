import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The widgets built by this package (ADR-0024). Each entry is one MCP Apps
 * `ui://` document: a React app that Vite + vite-plugin-singlefile inline into a
 * single self-contained HTML file. Add a widget by adding its `src/widgets/<name>/
 * index.html` entry here — the build emits `<name>.html` into the plugin root.
 */
const WIDGETS = [{ name: "task-list", entry: "src/widgets/task-list/index.html" }] as const;

/**
 * Vite emits an HTML entry at its path relative to the project root
 * (`src/widgets/task-list/index.html`), but the server serves a flat, committed
 * `plugins/marvin/widgets/<name>.html` (read from packRoot per ADR-0008). Rename
 * each emitted HTML asset to `<name>.html` in the bundle so the committed layout
 * stays flat regardless of the source tree. Runs `post` so vite-plugin-singlefile
 * has already inlined the JS/CSS into the asset's source.
 */
function flattenWidgetHtml(): Plugin {
  const byEntry = new Map<string, string>(WIDGETS.map((w) => [w.entry, `${w.name}.html`]));
  return {
    name: "marvin-flatten-widget-html",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const [key, asset] of Object.entries(bundle)) {
        if (!asset.fileName.endsWith(".html")) continue;
        const flat = byEntry.get(asset.fileName);
        if (!flat) continue;
        asset.fileName = flat;
        delete bundle[key];
        bundle[flat] = asset;
      }
    },
  };
}

// Committed widget documents live under the plugin root so the server reads them
// the same way it reads SKILL.md bodies (packRoot, ADR-0008) — NOT under the
// package's own dist/. Guarded byte-for-byte by scripts/verify-widgets.mjs.
const OUT_DIR = resolve(__dirname, "../../plugins/marvin/widgets");

export default defineConfig({
  plugins: [preact(), viteSingleFile(), flattenWidgetHtml()],
  resolve: {
    // Alias every React specifier to preact/compat EXPLICITLY here (not only via
    // @preact/preset-vite's injected aliases) so Vitest — which externalizes
    // node_modules deps like @testing-library/react and would otherwise resolve
    // their internal react / react-dom / react-dom/client imports to the real
    // packages — renders through preact/compat too. Without react-dom/client
    // aliased, testing-library's createRoot feeds Preact vnodes to React's
    // reconciler and throws (coerceRef).
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/client": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
      "react/jsx-dev-runtime": "preact/jsx-runtime",
      "react-dom/test-utils": "preact/test-utils",
    },
  },
  build: {
    outDir: OUT_DIR,
    // The outDir is outside the package root and holds only committed widget
    // HTML; never let a build wipe sibling files there.
    emptyOutDir: false,
    // Minify the committed document. The inlined bundle is ~95% third-party
    // (zod via @modelcontextprotocol/ext-apps, plus preact) — code no reviewer
    // reads line-by-line — so unminified output bought "readability" that never
    // existed while every widget added a ~15k-line diff. Minified it is a compact
    // build artifact like the committed dist/server.js: correctness is guaranteed
    // by verify-widgets (fresh rebuild + hash), and each widget PR is a ~80-line
    // diff. Real review happens in the .tsx source + tests, not this artifact.
    minify: "esbuild",
    // Everything is inlined by vite-plugin-singlefile; no separate assets emit.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: Object.fromEntries(WIDGETS.map((w) => [w.name, resolve(__dirname, w.entry)])),
    },
  },
  // Vitest reads this same config (via vitest/config's defineConfig); `vite build`
  // ignores the `test` key. happy-dom gives the component + mock-host tests a DOM
  // without a real browser.
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
