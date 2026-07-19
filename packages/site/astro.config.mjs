import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Static marketing + reference site for the marvin plugin (website Phase 1 scaffold,
// spec .marvin/task/004-website-scaffold.md). The Preact integration is wired for the
// interactive islands added in Phase 4 — nothing hydrates yet, so the build ships zero
// framework JS beyond the anti-FOUC inline theme script.
export default defineConfig({
  output: "static",
  integrations: [preact()],
});
