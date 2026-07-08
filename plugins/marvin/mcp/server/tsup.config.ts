import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

// Single source of truth: the server's reported version is injected from its own
// package.json at build time, so it can never drift from the manifest. sync-version.mjs
// keeps every package version equal and lint-manifests.mjs guards the invariant.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/server.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node20",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  treeshake: true,
  define: { __MARVIN_VERSION__: JSON.stringify(version) },
  noExternal: [/^@marvin-toolkit\//, "@modelcontextprotocol/sdk", "zod", "yaml"],
  // `yaml`'s bundled CJS does `require("process")`. esbuild rewrites that to its
  // `__require` shim, which throws in an ESM output unless a real `require` is in
  // scope. Inject one via createRequire so the shim delegates to it.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
