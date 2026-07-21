// /sitemap.xml (spec 013, F11) — FR-23.
//
// The URL set is the page registry, so a page cannot appear here without also having a title, a
// description and a canonical tag: test/seo.test.mjs asserts the registry and src/pages agree in
// both directions (AC7).
import type { APIRoute } from "astro";
import { pages } from "../data/pages";
import { renderSitemap, requireOrigin } from "../lib/seo";

export const GET: APIRoute = ({ site }) =>
  new Response(renderSitemap(pages, requireOrigin(site)), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
