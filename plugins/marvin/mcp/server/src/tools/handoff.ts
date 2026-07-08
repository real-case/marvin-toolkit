import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { HandoffDetail, HandoffDetailPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { readAllHandoffs } from "../storage/handoff.js";
import type { Handoff } from "../storage/schema.js";
import type { ServerEnv } from "../lib/env.js";
import { HANDOFFS_WIDGET_URI } from "../resources/widgets.js";

const HandoffInput = z.object({
  action: z.enum(["list"]).optional(),
});

export function buildHandoffTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "handoff",
    description:
      "List the session-continuation handoff documents saved under .marvin/handoff/, newest first.",
    inputSchema: HandoffInput,
    // Bind the handoffs `ui://` widget for MCP Apps hosts (ADR-0024 #5). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: HANDOFFS_WIDGET_URI } },
    // One action today (list); its structuredContent carries full detail (bodies +
    // continue prompts) so the bound widget browses the whole set — no separate
    // `show` action (see .marvin/task/001-widget-handoffs.md, Variant A). The
    // optional enum still leaves room to grow without a breaking schema change.
    handler: () => Promise.resolve(runList(env)),
  });
}

function runList(env: ServerEnv): ToolResult {
  const { handoffs, malformed } = readAllHandoffs(env.handoffDir);

  const body =
    handoffs.length === 0
      ? "_No handoffs yet — run `/marvin:handoff` to capture the current work._"
      : handoffs.map(formatHandoffLine).join("\n");
  const warning =
    malformed.length > 0
      ? `\n\n_⚠ ${malformed.length} handoff(s) without valid frontmatter: ${malformed
          .map((m) => m.filename)
          .join(", ")} (regenerate with \`/marvin:handoff\`)_`
      : "";

  return {
    content: [{ type: "text", text: `# Handoffs (${handoffs.length})\n\n${body}${warning}` }],
    // Widget payload for MCP Apps hosts (ADR-0024 #5) — the handoffs browser.
    // A superset of the text surface: every card PLUS its markdown body and a
    // derived continue prompt, typed to HandoffDetailPayload. Terminals render
    // `content` and ignore this.
    structuredContent: buildHandoffDetailPayload(handoffs),
  };
}

function formatHandoffLine(h: Handoff): string {
  const fm = h.frontmatter;
  const pr = fm.pr_url ? ` · PR: ${fm.pr_url}` : "";
  const base = fm.base ? ` → \`${fm.base}\`` : "";
  return `- **${fm.id}** ${fm.objective} · \`${fm.branch}\`${base}${pr}`;
}

/** Map handoff artifacts to the HandoffDetailPayload widget contract (ADR-0024 #5). */
function buildHandoffDetailPayload(handoffs: Handoff[]): HandoffDetailPayload {
  const details: HandoffDetail[] = handoffs.map((h) => {
    const fm = h.frontmatter;
    return {
      id: fm.id,
      slug: fm.slug,
      objective: fm.objective,
      branch: fm.branch,
      ...(fm.base ? { base: fm.base } : {}),
      // Contract field is nullable-required; storage omits it when absent.
      pr_url: fm.pr_url ?? null,
      ...(fm.spec_slug ? { spec_slug: fm.spec_slug } : {}),
      created: fm.created,
      // The two detail-only fields the browser widget renders (ADR-0024 #5).
      continue_prompt: continuePromptFor(h),
      body_markdown: h.body,
    };
  });
  return { handoffs: details };
}

/**
 * Reconstruct the paste-ready continuation prompt for a handoff. Mirrors the
 * handoff skill's step-5 template (skills/handoff/SKILL.md) so the widget's
 * copy-to-chat action matches what `/marvin:handoff` printed — derived, not
 * stored (no frontmatter/skill change; existing handoffs gain it for free). The
 * path uses the real on-disk `filename`, so it is correct regardless of the
 * `<NNN>-<slug>` separator convention.
 */
function continuePromptFor(h: Handoff): string {
  const fm = h.frontmatter;
  return (
    `Continue work on ${fm.objective}. Full context is in ` +
    `\`.marvin/handoff/${h.filename}\` — read that file first, then resume at its ` +
    `"Next steps". Repo is on branch \`${fm.branch}\`.`
  );
}
