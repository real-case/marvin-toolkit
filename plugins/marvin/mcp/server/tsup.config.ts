import { defineConfig } from "tsup";
import { existsSync, readFileSync } from "node:fs";

// Single source of truth: the server's reported version is injected from its own
// package.json at build time, so it can never drift from the manifest. sync-version.mjs
// keeps every package version equal and lint-manifests.mjs guards the invariant.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// A checkout with no node_modules of its own, which is what `git worktree add`
// leaves until someone installs into it, resolves dependencies by walking up past
// the checkout, and esbuild bakes that longer relative depth into every module-path
// comment in the bundle. The output is functionally identical and byte-different,
// which is precisely what the committed artifact must never be — warn where the
// difference originates rather than leaving verify-dist to explain it later. The
// condition is installed-or-not, not worktree-or-not: an installed worktree builds
// a committable bundle and stays silent here.
const checkoutRoot = new URL("../../../../", import.meta.url);
if (!existsSync(new URL("node_modules", checkoutRoot))) {
  console.warn(
    `! no node_modules in ${checkoutRoot.pathname} — dependencies resolve outside this\n` +
      "  checkout, so dist/server.js will differ byte-for-byte from a build made in the\n" +
      "  main checkout. Fine for local runs; rebuild in the main checkout before committing.",
  );
}

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
