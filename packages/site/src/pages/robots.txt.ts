// /robots.txt (spec 013, F12) — FR-23.
//
// Allow-all, deliberately: public marketing with no private routes, for a product whose audience
// includes coding agents.
import type { APIRoute } from "astro";
import { renderRobots, requireOrigin } from "../lib/seo";

export const GET: APIRoute = ({ site }) =>
  new Response(renderRobots(requireOrigin(site)), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
