import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { HandoffCard, HandoffListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { readAllHandoffs } from "../storage/handoff.js";
import type { Handoff } from "../storage/schema.js";
import type { ServerEnv } from "../lib/env.js";

const HandoffInput = z.object({
  action: z.enum(["list"]).optional(),
});

export function buildHandoffTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "handoff",
    description:
      "List the session-continuation handoff documents saved under .marvin/handoff/, newest first.",
    inputSchema: HandoffInput,
    // Only one action today (list); the optional enum leaves room to grow
    // (e.g. a `show` detail action) without a breaking schema change.
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
    // Widget payload for MCP Apps hosts (ADR-0024) — the handoff viewer (#5).
    // Same data the text renders, typed to the HandoffListPayload contract;
    // terminals render `content` and ignore this.
    structuredContent: buildHandoffListPayload(handoffs),
  };
}

function formatHandoffLine(h: Handoff): string {
  const fm = h.frontmatter;
  const pr = fm.pr_url ? ` · PR: ${fm.pr_url}` : "";
  const base = fm.base ? ` → \`${fm.base}\`` : "";
  return `- **${fm.id}** ${fm.objective} · \`${fm.branch}\`${base}${pr}`;
}

/** Map handoff artifacts to the HandoffListPayload widget contract (ADR-0024). */
function buildHandoffListPayload(handoffs: Handoff[]): HandoffListPayload {
  const cards: HandoffCard[] = handoffs.map((h) => {
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
    };
  });
  return { handoffs: cards };
}
