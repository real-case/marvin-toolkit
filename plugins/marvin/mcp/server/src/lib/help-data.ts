import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../storage/frontmatter.js";

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
 * (the model must not auto-trigger them), flagged 👤 in the reference.
 *
 * The skill frontmatter is the *only* source: this reads it at call time rather
 * than mirroring it in a constant, so a flag change in a `SKILL.md` needs no
 * rebuild and no second edit (ADR-0008 reads skills at request time). Parsing
 * goes through the server's frontmatter codec (ADR-0005), whose YAML failsafe
 * schema keeps every scalar a string — so a bare and a quoted value arrive
 * identically and neither needs a special case.
 *
 * The directory comes from `packRoot` alone, never from module-relative state,
 * which is what lets a test point it at a synthetic tree.
 *
 * Fails open. A missing or unreadable skills directory yields an empty set, so
 * the reference degrades to rendering no markers instead of failing the call.
 */
export function humanRunSkills(packRoot: string): Set<string> {
  const skillsDir = join(packRoot, "skills");
  const flagged = new Set<string>();
  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch (err) {
    // Degrading to "nothing is human-run" is the unsafe direction for a flag
    // that exists to hold the model back, so say so on stderr — an unreadable
    // directory must not look like a project with no human-run skills. stderr
    // is free: the MCP transport owns stdout.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`marvin: cannot read ${skillsDir} — no human-run markers will render`, err);
    }
    return flagged;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const { frontmatter } = parseFrontmatter(
        readFileSync(join(skillsDir, entry.name, "SKILL.md"), "utf8"),
      );
      if (frontmatter["disable-model-invocation"] === "true") flagged.add(entry.name);
    } catch {
      // A skill directory without a readable SKILL.md simply carries no flag.
      continue;
    }
  }
  return flagged;
}

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
