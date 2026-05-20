import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

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
  noExternal: [/^@marvin-toolkit\//, "@modelcontextprotocol/sdk", "zod"],
  onSuccess: async () => {
    // Copy prompt bodies next to the bundle so resolvePromptBody can read
    // them with `dirname(import.meta.url)/prompts/<name>.md`.
    const srcDir = join(process.cwd(), "src", "prompts");
    const outDir = join(process.cwd(), "dist", "prompts");
    copyDir(srcDir, outDir);
  },
});

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) {
      copyDir(s, d);
    } else if (entry.endsWith(".md")) {
      mkdirSync(dirname(d), { recursive: true });
      copyFileSync(s, d);
    }
  }
}
