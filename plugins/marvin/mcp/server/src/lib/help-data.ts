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
 * Authored richer detail per command — the 1–2 sentence synopsis shown in the
 * `ui://` help widget's "Read more" group-detail view (ADR-0024), one level down
 * from the scannable one-line `COMMAND_BLURBS`. Like the blurbs, the command
 * *names* come from the registry (drift-proof) and every registry command MUST
 * have an entry: the `help` tool falls back to `""` for a missing key (never the
 * blurb), so a drift-guard test asserting a non-empty `description` on every
 * command fails CI. The terminal markdown door does not render this — it is
 * widget-only.
 */
export const COMMAND_DETAILS: Record<string, string> = {
  // core
  commit:
    "Safe commit — inspects repo state, stages intentionally, screens for secrets (.env, keys, tokens), drafts a Conventional Commits message, and links the current kanban board task.",
  debug:
    "Hypothesis-driven root-cause analysis: reproduce the bug, gather evidence, rank hypotheses, confirm the mechanism at file:line, then propose a minimal fix.",
  adr: "Draft an Architecture Decision Record capturing context, alternatives, the decision, and consequences. Lands as status proposed; ratification is the separate human-run adr-accept.",
  changelog: "Generate a changelog from git history between tags, dates, or arbitrary refs.",
  readme: "Generate or refresh README.md from actual codebase analysis.",
  "migration-plan":
    "Plan a migration or major refactor: dependency analysis, sequenced steps, risks, and a rollback strategy.",
  explain:
    "Explain how code works — logic, architecture, and design rationale — without changing it.",
  "docs-search":
    "Search and synthesize project documentation — ADRs, README, runbooks, conventions.",
  handoff:
    "Capture the session's full context into a durable handoff document plus a paste-ready prompt to continue in a fresh session.",
  "handoff-list":
    "List the saved session-continuation handoff documents under .marvin/handoff/, newest first.",
  lessons:
    "Team lessons-learned store — capture and recall bug-patterns and gotchas across tasks (.marvin/memory).",
  help: "This welcome dashboard and the full command index; pass a group to focus the reference.",
  dashboard:
    "Whole-toolbox state report: kanban, config, git, artifact inventories, ADR corpus, and local usage.",
  // adr
  "adr-review":
    "Deep review of one proposed ADR — section validation, codebase grounding, formal auto-fixes, and a readiness verdict. Never sets accepted.",
  "adr-accept":
    "Ratify a proposed ADR — proposed → accepted with a date stamp, through the fail-closed readiness gate. Human-run.",
  "adr-audit":
    "Read-only lint of the whole ADR corpus — dangling references, numbering holes, broken supersede pairs, stale index.",
  "adr-coverage":
    "Gap analysis — recorded ADRs vs the decisions visible in the actual stack, ranked by blast radius.",
  "adr-supersede":
    "Roll back an accepted ADR properly — a successor record supersedes it and the links pair both ways. Human-run.",
  "adr-sync":
    "Regenerate the Architecture-decisions digest in CLAUDE.md from accepted ADRs only. Human-run.",
  // pr
  "pr-create":
    "Open a pull request with a structured description and verification checklist; picks up kanban board-task context when present.",
  "pr-review":
    "Review a pull request on GitHub and post the review there — inline comments by severity plus a summary.",
  "pr-resolve":
    "Resolve open PR review threads — fetch the unresolved ones, plan and apply fixes, push, then reply and mark each resolved.",
  "pr-merge": "Merge a pull request, then switch back to the base branch and pull.",
  // task
  "task-start":
    "Phase 1 of the task pipeline — a structured dialogue that produces an immutable, testable spec under .marvin/task/.",
  "task-implement":
    "Execute a ready spec interactively in the current session, then auto-chain into verify and deliver.",
  "task-verify":
    "Run the project quality gates — tests, lint, type-check, build — with automatic stack detection, and write verification.md.",
  "task-deliver": "Commit changes and open a pull request; refuses if verification failed.",
  "task-summary":
    "Summarise what a task delivered — acceptance criteria vs verification, commits, lessons, and links.",
  // sec
  "sec-scan":
    "Comprehensive security audit aligned with OWASP Top 10:2025 — orchestrates secrets, dependency, and IaC scans plus deep static analysis.",
  "sec-secrets":
    "Deep scan for leaked secrets, credentials, and API keys across code, config, and git history.",
  "sec-deps": "Audit dependencies for known vulnerabilities, license risk, and maintenance health.",
  "sec-gate": "Fast security check on staged or recent changes — a lightweight pre-commit gate.",
  "sec-threat-model":
    "Generate a STRIDE-based threat model for a feature, system, or the whole application.",
  "sec-iac":
    "Security review of Infrastructure-as-Code — Terraform, CloudFormation, Kubernetes, Docker, Helm.",
  "sec-ci":
    "Audit CI/CD pipelines for supply-chain risks, secret exposure, and excessive permissions.",
  "sec-fix":
    "Generate and verify a minimal, tested patch for a security finding, with a regression test.",
  "sec-compliance":
    "Check code against OWASP ASVS compliance requirements — a structured compliance matrix.",
  "sec-pentest": "Generate a penetration-testing checklist tailored to the specific application.",
  "sec-report":
    "List the structured security-audit reports under .marvin/security/ — typed findings by severity, newest first.",
  // refactor
  "refactor-audit":
    "Whole-project structural refactoring audit — architecture map, churn×size hotspots, dependency tangles, dead-code candidates. Read-only.",
  "refactor-smells":
    "Scoped code-smell scan of a path, module, or diff — smells, anti-patterns, and naming inconsistencies. Read-only.",
  "refactor-plan":
    "Turn selected refactoring findings into a sequenced, risk-annotated plan; oversized items route to the task pipeline.",
  "refactor-apply":
    "Execute exactly one behaviour-preserving refactoring step under hard rails — verify green before and after, rollback on red.",
  // kanban
  "kanban-menu": "Open the board action menu.",
  "kanban-bug": "Create a bug task on the board.",
  "kanban-feature": "Create a feature task on the board.",
  "kanban-chore": "Create a chore task on the board.",
  "kanban-spike": "Create a spike — a time-boxed investigation task.",
  "kanban-start": "Move a board task to in-progress.",
  "kanban-review": "Move a board task to review.",
  "kanban-done": "Move a board task to done.",
  "kanban-list": "List the tasks on the board.",
  "kanban-show": "Show one board task in detail.",
  "kanban-tracker": "Link an external tracker URL to a board task.",
  "kanban-status": "Set a board task's status directly.",
  "kanban-config": "Show or edit the board configuration (.marvin/config.json).",
  "kanban-help": "Show board help.",
};

/**
 * Authored usage example per command — a single copy-pasteable invocation shown
 * under the description in the widget's group-detail view. Genuinely optional:
 * commands that are typically run bare (zero-argument, e.g. `readme`,
 * `dashboard`, `sec-scan`) have no entry, and the widget renders the `e.g.` line
 * only when one is present. No coverage guard — absence is a valid state.
 */
export const COMMAND_EXAMPLES: Record<string, string> = {
  // core
  commit: '/marvin:commit "fix: guard null session"',
  debug: '/marvin:debug "TypeError in auth middleware"',
  adr: '/marvin:adr "Adopt one MCP server"',
  changelog: "/marvin:changelog since v0.1.0",
  "migration-plan": '/marvin:migration-plan "bundler to Vite"',
  explain: "/marvin:explain src/server.ts",
  "docs-search": '/marvin:docs-search "how does the verify gate work?"',
  handoff: '/marvin:handoff "widget work WIP"',
  lessons: '/marvin:lessons search "dist staleness"',
  help: "/marvin:help sec",
  // adr
  "adr-review": "/marvin:adr-review 31",
  "adr-accept": "/marvin:adr-accept 31",
  "adr-supersede": "/marvin:adr-supersede 12",
  // pr
  "pr-review": "/marvin:pr-review 42",
  "pr-resolve": "/marvin:pr-resolve 42",
  "pr-merge": "/marvin:pr-merge 42",
  // task
  "task-start": '/marvin:task-start "add pagination"',
  "task-summary": "/marvin:task-summary add-pagination",
  // sec
  "sec-threat-model": '/marvin:sec-threat-model "upload flow"',
  "sec-fix": '/marvin:sec-fix "CVE-2024-1234"',
  // refactor
  "refactor-smells": "/marvin:refactor-smells src/tools",
  "refactor-plan": "/marvin:refactor-plan F3,F4",
  // kanban
  "kanban-bug": '/marvin:kanban-bug "login 500s"',
  "kanban-feature": '/marvin:kanban-feature "dark mode"',
  "kanban-chore": '/marvin:kanban-chore "bump deps"',
  "kanban-spike": '/marvin:kanban-spike "try Preact"',
  "kanban-start": "/marvin:kanban-start 12",
  "kanban-review": "/marvin:kanban-review 12",
  "kanban-done": "/marvin:kanban-done 12",
  "kanban-show": "/marvin:kanban-show 12",
  "kanban-tracker": "/marvin:kanban-tracker 12",
  "kanban-status": "/marvin:kanban-status 12 blocked",
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
