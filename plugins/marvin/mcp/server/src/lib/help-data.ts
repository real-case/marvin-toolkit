import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared reference data for the two `help` surfaces. The `help` MCP tool
 * (markdown, model-relayed — `tools/help.ts`) and the standalone ANSI CLI
 * (direct-to-terminal — `cli/help.ts`) render the *same* facts through two very
 * different media. Everything both need — the authored group blurbs, the
 * human-run flag set, the slogan, the description trimmer, and the configured
 * MCP-server probe — lives here once so the two doors can never drift.
 */

export const SLOGAN = "Claude Code toolset for AI development without panic";

/**
 * Authored one-line purpose per command group — the static, human-maintained
 * half of the command reference. The command *names* come from the registry
 * (drift-proof); these blurbs are curated and shipped with the release.
 */
export const GROUP_BLURBS: Record<string, string> = {
  core: "Everyday dev — commits, debugging, docs, ADRs, handoffs",
  adr: "Architecture Decision Record lifecycle",
  pr: "Pull-request lifecycle — create, review, resolve, merge",
  task: "Spec-driven pipeline — start, implement, verify, deliver",
  sec: "Security scanners — secrets, deps, threat models & more",
  refactor: "Code-health — audit, smells, plan, apply",
  kanban: "Lightweight board tracker — create, move, list, configure",
};

/**
 * Authored one-line synopsis per command — the scannable reference text. The
 * command *names* come from the registry (drift-proof); these blurbs are curated
 * so the reference stays tight and column-aligned instead of spilling the full
 * prompt descriptions. Every registry command MUST have an entry — the
 * `help`-tool structured payload ships the blurb verbatim and a test asserts
 * full coverage, so a new command without a blurb here fails CI (drift guard).
 */
export const COMMAND_BLURBS: Record<string, string> = {
  // core
  commit: "Conventional commit, kanban-linked",
  debug: "Systematic root-cause debugging",
  adr: "Create an Architecture Decision Record",
  changelog: "Changelog from git history",
  readme: "Generate or update README",
  "migration-plan": "Plan a migration or major refactor",
  explain: "Explain code, logic, and design",
  "docs-search": "Search project documentation",
  handoff: "Capture a session handoff",
  "handoff-list": "List handoff documents",
  lessons: "Team lessons-learned store",
  help: "This dashboard + command index",
  dashboard: "Whole-toolbox state report",
  // adr
  "adr-review": "Review a proposed ADR",
  "adr-accept": "Ratify an ADR (human-run)",
  "adr-audit": "Lint the whole ADR corpus",
  "adr-coverage": "Find undocumented decisions",
  "adr-supersede": "Roll back an accepted ADR (human-run)",
  "adr-sync": "Refresh the ADR digest in CLAUDE.md (human-run)",
  // pr
  "pr-create": "Open a pull request",
  "pr-review": "Review a PR on GitHub",
  "pr-resolve": "Address PR review threads",
  "pr-merge": "Merge a PR, then sync the base",
  // task
  "task-start": "Spec out a task (Phase 1)",
  "task-implement": "Implement a ready spec",
  "task-verify": "Run the project quality gates",
  "task-deliver": "Commit and open a PR",
  "task-summary": "Delivery digest for a task",
  // sec
  "sec-scan": "Full OWASP Top-10 audit",
  "sec-secrets": "Scan for leaked secrets",
  "sec-deps": "Dependency CVE / license audit",
  "sec-gate": "Fast pre-commit security gate",
  "sec-threat-model": "STRIDE threat model",
  "sec-iac": "Infrastructure-as-Code review",
  "sec-ci": "CI/CD pipeline audit",
  "sec-fix": "Patch a vulnerability with tests",
  "sec-compliance": "OWASP ASVS gap analysis",
  "sec-pentest": "Tailored pentest checklist",
  "sec-report": "List saved security reports",
  // refactor
  "refactor-audit": "Structural audit + hotspots",
  "refactor-smells": "Scoped code-smell scan",
  "refactor-plan": "Sequence findings into steps",
  "refactor-apply": "Apply one refactor step, gated",
  // kanban
  "kanban-menu": "Board action menu",
  "kanban-bug": "New bug task",
  "kanban-feature": "New feature task",
  "kanban-chore": "New chore task",
  "kanban-spike": "New spike task",
  "kanban-start": "Move a task to in-progress",
  "kanban-review": "Move a task to review",
  "kanban-done": "Move a task to done",
  "kanban-list": "List board tasks",
  "kanban-show": "Show one task",
  "kanban-tracker": "Link a tracker URL",
  "kanban-status": "Set a task status",
  "kanban-config": "Show or edit board config",
  "kanban-help": "Board help",
};

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
