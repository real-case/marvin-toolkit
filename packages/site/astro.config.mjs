import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Static marketing + reference site for the marvin plugin (website Phase 1 scaffold,
// spec .marvin/task/004-website-scaffold.md). The Preact integration is wired for the
// interactive islands added in Phase 4 — nothing hydrates yet, so the build ships zero
// framework JS beyond the anti-FOUC inline theme script.
export default defineConfig({
  // The production origin (spec 013, F1). Required, not cosmetic: canonical, og:url and every
  // sitemap <loc> must be absolute, and `Astro.site` is where they come from — without it those
  // renderers have no origin to build on. Referenced through `Astro.site` rather than duplicated
  // as a literal, so Phase 7's domain work changes exactly this key.
  site: "https://marvin-toolkit.dev",
  output: "static",
  integrations: [preact()],
});
