import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-side helpers for the `help` tool (`tools/help.ts`): the slogan, the
 * human-run flag set, the one-line description trimmer, and the configured-
 * MCP-server probe.
 *
 * The curated *content* of the command reference — group blurbs, per-command
 * blurbs, richer descriptions, direct-call examples, and prose phrases — no longer
 * lives here. It moved to the shared package
 * (`@marvin-toolkit/mcp-shared/help-content`) as the single source both the `help`
 * tool and the widget Storybook fixture import, so the preview can never drift
 * from what the tool ships (ADR-0024). It is re-exported here so the tool's
 * existing imports keep resolving through this one module.
 */
export {
  GROUP_BLURBS,
  COMMAND_BLURBS,
  COMMAND_DETAILS,
  COMMAND_EXAMPLES,
  COMMAND_PROMPTS,
} from "@marvin-toolkit/mcp-shared/help-content";

export const SLOGAN = "Claude Code toolset for AI development without panic";

/**
 * Commands whose skills carry `disable-model-invocation: true` — human-run only
 * (the model must not auto-trigger them), flagged 👤 in the reference. The skill
 * frontmatter is the source of truth (the `adr-*` lifecycle, ADR-0027); this
 * short list mirrors it because the prompt registry does not surface the flag.
 * Keep in sync when a skill's flag changes.
 */
export const HUMAN_RUN = new Set(["adr-accept", "adr-supersede", "adr-sync"]);

/** First clause of a prompt description, trimmed to one scannable line. */
export function shortDesc(desc: string, max = 72): string {
  const oneLine = desc.replace(/\s+/g, " ").trim();
  const firstClause = oneLine.split(/ — | – |\. /)[0] ?? oneLine;
  const base = firstClause.length <= oneLine.length ? firstClause : oneLine;
  if (base.length <= max) return base;
  const cut = base.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** One MCP server configured for this project, with its enabled state. */
export interface McpServerState {
  name: string;
  /** Lit unless the server is in a `disabledMcpjsonServers` set (ADR-0024). */
  enabled: boolean;
}

/**
 * MCP servers configured for this project (union of `.mcp.json` + settings),
 * each flagged enabled/disabled. This is what is *configured*, not a live probe
 * — the server has no view of which of them the host actually connected — so the
 * honest lit/dim signal is the enable state: a server named in any
 * `disabledMcpjsonServers` list renders dim, everything else lit.
 */
export function projectMcpServers(projectDir: string): McpServerState[] {
  const names = new Set<string>();
  const disabled = new Set<string>();
  // `.mcp.json` is either flat (`{ server: {...} }`, as marvin ships it) or
  // wrapped (`{ "mcpServers": {...} }`); Claude settings always use the wrapper.
  collectServers(join(projectDir, ".mcp.json"), true, names, disabled);
  collectServers(join(projectDir, ".claude", "settings.json"), false, names, disabled);
  collectServers(join(projectDir, ".claude", "settings.local.json"), false, names, disabled);
  return [...names].sort().map((name) => ({ name, enabled: !disabled.has(name) }));
}

/** Read server keys + the `disabledMcpjsonServers` set from one JSON file. */
function collectServers(
  path: string,
  allowFlat: boolean,
  names: Set<string>,
  disabled: Set<string>,
): void {
  if (!existsSync(path)) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const wrapped = parsed.mcpServers;
    const servers = wrapped && typeof wrapped === "object" ? wrapped : allowFlat ? parsed : null;
    if (servers) for (const k of Object.keys(servers)) names.add(k);
    const off = parsed.disabledMcpjsonServers;
    if (Array.isArray(off)) for (const d of off) if (typeof d === "string") disabled.add(d);
  } catch {
    /* unreadable / malformed → contributes nothing */
  }
}
