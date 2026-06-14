import { defineConfig } from "tsup";

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
  noExternal: [/^@marvin-toolkit\//, "@modelcontextprotocol/sdk", "zod", "yaml"],
  // `yaml`'s bundled CJS does `require("process")`. esbuild rewrites that to its
  // `__require` shim, which throws in an ESM output unless a real `require` is in
  // scope. Inject one via createRequire so the shim delegates to it.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
