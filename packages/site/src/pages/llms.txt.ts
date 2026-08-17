// /llms.txt (spec 013, F10) — the agent-readable surface, FR-24.
//
// A thin wrapper: the document's shape lives in lib/seo.ts so it is readable in one place and
// testable without a route. The Quickstart page has advertised this file since Phase 3 without it
// existing — AC6 is what makes that claim true.
import type { APIRoute } from "astro";
import { catalog } from "../data/catalog";
import { pages } from "../data/pages";
import { renderLlmsTxt, requireOrigin } from "../lib/seo";

export const GET: APIRoute = ({ site }) =>
  new Response(renderLlmsTxt(pages, catalog, requireOrigin(site)), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
