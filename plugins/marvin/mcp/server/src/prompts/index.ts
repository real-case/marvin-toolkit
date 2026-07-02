import type { PromptDef } from "@marvin-toolkit/mcp-shared";

/**
 * Prompts for the unified `marvin` server. Two body sources:
 *
 *  - **skill-backed** (core / sec / task groups): `skill` points to a
 *    directory under `plugins/marvin/skills/<name>/SKILL.md`. The skill
 *    file is the single source of truth — Claude Code auto-discovers it
 *    through its own frontmatter `description`, while this server exposes
 *    the same prose under `/marvin:<name>` (frontmatter stripped at
 *    request time).
 *  - **inline-body** (kanban group): thin wrappers that just instruct the
 *    model to call the matching MCP tool (`task` / `help`) with the right
 *    pre-fills. Bodies are one sentence, so a SKILL.md would be noise.
 *
 * Naming scheme: `/marvin:<group>-<command>`. Singletons stay bare
 * (`commit`, `debug`). See docs/adr/0003-single-plugin-consolidation.md.
 */

function callTool(tool: string, args: Record<string, string> = {}): string {
  const pairs = Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const argText = pairs.length > 0 ? ` with ${pairs.join(", ")}` : "";
  return `Invoke the \`${tool}\` MCP tool from the \`marvin\` server${argText}. Use the user's choices from the elicitation form to fill any other fields. Do not add preamble — just call the tool.`;
}

export const PROMPTS: PromptDef[] = [
  // ── core (bare + pr group) ───────────────────────────────────────────
  {
    name: "commit",
    description:
      "Safe git commit workflow — inspects repo state, stages intentionally, detects sensitive files, drafts a Conventional Commits message, confirms with the user, and handles pre-commit hook failures cleanly.",
    skill: "commit",
  },
  {
    name: "pr-create",
    description:
      "Create a pull request with structured description, verification checklist, and issue linking.",
    skill: "pr-create",
  },
  {
    name: "pr-review",
    description:
      "Review a pull request on GitHub and post the review there — fetch the diff, review for bugs, security, performance, and style, then submit a GitHub review with inline comments grouped by severity.",
    skill: "pr-review",
  },
  {
    name: "pr-resolve",
    description:
      "Resolve open PR review feedback — fetch the unresolved review threads, draft a change plan, apply minimal fixes, push, then reply to each thread and mark it resolved.",
    skill: "pr-resolve",
  },
  {
    name: "pr-merge",
    description:
      "Merge a pull request, then return to the base branch with the merge pulled in — confirm mergeability, merge via gh (delete the head branch), check out the base branch (e.g. dev) and pull.",
    skill: "pr-merge",
  },
  {
    name: "debug",
    description:
      "Systematic root-cause debugging — guides hypothesis-driven analysis, evidence gathering, and minimal reproductions instead of guessing.",
    skill: "debug",
  },
  {
    name: "adr",
    description:
      "Create a structured Architecture Decision Record (ADR) capturing context, alternatives considered, the decision, and consequences in MADR / Nygard format.",
    skill: "adr",
  },
  {
    name: "changelog",
    description:
      "Generate a changelog from git commit history between tags, date ranges, or arbitrary refs.",
    skill: "changelog",
  },
  {
    name: "readme",
    description: "Generate or update README.md based on actual codebase analysis.",
    skill: "readme",
  },
  {
    name: "migration-plan",
    description:
      "Plan a migration or large-scale refactor with explicit dependency analysis, phased steps, risk inventory, rollback strategy, and verification checkpoints.",
    skill: "migration-plan",
  },
  {
    name: "explain",
    description: "Explain selected code, architecture decisions, or system behavior.",
    skill: "explain",
  },
  {
    name: "docs-search",
    description:
      "Search and retrieve relevant documentation from the codebase and external sources — ADRs, READMEs, runbooks, configs.",
    skill: "docs-search",
  },
  {
    name: "handoff",
    description:
      "Capture the current work's full context into a durable handoff document under .marvin/handoff/ and emit a paste-ready prompt to continue in a fresh session.",
    skill: "handoff",
  },
  {
    // Thin tool wrapper (inline body) — the read side of the handoff group has
    // no workflow prose, so it calls the `handoff` MCP tool directly (ADR-0024).
    name: "handoff-list",
    description: "List the session-continuation handoff documents under .marvin/handoff/.",
    body: callTool("handoff", { action: "list" }),
  },
  {
    // Thin tool wrapper (inline body) — the marvin dashboard + command index,
    // derived from this registry (ADR-0024). Optional `section` filter.
    name: "help",
    description:
      "Marvin dashboard — project state and the full command index, optionally filtered to one group (core/pr/task/sec/kanban).",
    body: "Invoke the `help` MCP tool from the `marvin` server. If the user named a section (core, pr, task, sec, kanban) in their message, pass it as `section`; otherwise call with no arguments. Present the dashboard as-is; no preamble.",
  },

  // ── task (taskmaster spec pipeline) ──────────────────────────────────
  {
    name: "task-start",
    description:
      "Start work on a task through structured dialogue — produces immutable, testable specs (features and bug fixes) with solution variants, acceptance criteria, and a Definition-of-Ready gate before dispatch.",
    skill: "task-start",
  },
  {
    name: "task-implement",
    description:
      "Execute a ready spec interactively in the current session — implements the spec following its Chosen Approach, then auto-chains into verify and deliver.",
    skill: "task-implement",
  },
  {
    name: "task-verify",
    description:
      "Run project quality gates — tests, lint, type-check, and build — with automatic stack detection (Node, Python, Go, Rust, Ruby, Java). Produces verification.md that gates delivery.",
    skill: "task-verify",
  },
  {
    name: "task-deliver",
    description:
      "Final delivery phase — commits changes and opens a PR (delegates to marvin:commit and marvin:pr-create). Refuses to proceed unless verification passed.",
    skill: "task-deliver",
  },
  {
    // Thin tool wrapper (inline body) — aggregates a spec's "what was done"
    // summary from already-typed sources (ADR-0024); no workflow prose.
    name: "task-summary",
    description:
      "Summarise what a task delivered — acceptance criteria vs verification, commits, lessons and links.",
    body: "Invoke the `summary` MCP tool from the `marvin` server. If the user named a spec slug in their message, pass it as `slug`; otherwise call it with no arguments to summarise the most recent spec. Do not add preamble — call the tool and present its result.",
  },

  // ── sec (security) ───────────────────────────────────────────────────
  {
    name: "sec-scan",
    description:
      "Comprehensive security audit aligned with OWASP Top 10:2025 — orchestrates secrets/deps/IaC scans plus deep static analysis.",
    skill: "sec-scan",
  },
  {
    name: "sec-secrets",
    description:
      "Deep scan for leaked secrets, credentials, API keys, and private keys across code, configs, and full git history. Produces deduped findings with rotation guidance.",
    skill: "sec-secrets",
  },
  {
    name: "sec-deps",
    description:
      "Audit project dependencies for CVEs, license risks, unmaintained packages, typosquats, and transitive risk. Produces a prioritized findings report with upgrade paths.",
    skill: "sec-deps",
  },
  {
    name: "sec-gate",
    description:
      "Fast pre-commit security gate — scoped to the diff, scans for injected secrets, obvious injections, unsafe deserialization, hard-coded credentials.",
    skill: "sec-gate",
  },
  {
    name: "sec-threat-model",
    description:
      "STRIDE-based threat models for a feature, service, or full application — data flows, trust boundaries, threats per category, mitigations, residual risk.",
    skill: "sec-threat-model",
  },
  {
    name: "sec-iac",
    description:
      "Security review of Infrastructure-as-Code: Terraform, CloudFormation, Pulumi, Kubernetes, Helm, Dockerfiles, docker-compose — IAM, encryption, network boundaries, privileged containers.",
    skill: "sec-iac",
  },
  {
    name: "sec-ci",
    description:
      "Audit CI/CD pipelines (GitHub Actions, GitLab CI, CircleCI, Jenkins) — pinned actions, least-privilege tokens, secret exposure, supply chain risks.",
    skill: "sec-ci",
  },
  {
    name: "sec-fix",
    description:
      "Generate and verify minimal, tested patches for security vulnerabilities flagged by any scanner or manual review.",
    skill: "sec-fix",
  },
  {
    name: "sec-compliance",
    description:
      "Check code against OWASP ASVS controls at L1/L2/L3 and report a gap analysis with evidence and remediation steps.",
    skill: "sec-compliance",
  },
  {
    name: "sec-pentest",
    description:
      "Generate a tailored penetration-testing checklist for the application — auth, authz, input surfaces, business logic, APIs, infrastructure — mapped to PTES / OWASP Testing Guide.",
    skill: "sec-pentest",
  },

  // ── kanban (lightweight task tracker; inline tool wrappers) ──────────
  {
    name: "kanban-menu",
    description: "Marvin tasks main menu",
    body: callTool("task"),
  },
  {
    name: "kanban-bug",
    description: "Create a bug task",
    body: callTool("task", { action: "create", type: "bug" }),
  },
  {
    name: "kanban-feature",
    description: "Create a feature task",
    body: callTool("task", { action: "create", type: "feature" }),
  },
  {
    name: "kanban-chore",
    description: "Create a chore task",
    body: callTool("task", { action: "create", type: "chore" }),
  },
  {
    name: "kanban-spike",
    description: "Create a spike task",
    body: callTool("task", { action: "create", type: "spike" }),
  },
  {
    name: "kanban-start",
    description: "Pick a todo task, branch off, and mark it WIP",
    body: callTool("task", { action: "start" }),
  },
  {
    name: "kanban-review",
    description: "Move current task to review",
    body: callTool("task", { action: "review" }),
  },
  {
    name: "kanban-done",
    description: "Mark current task done",
    body: callTool("task", { action: "done" }),
  },
  {
    name: "kanban-list",
    description: "List all tasks grouped by status",
    body: callTool("task", { action: "list" }),
  },
  {
    name: "kanban-status",
    description: "Current branch + WIP tasks",
    body: callTool("task", { action: "status" }),
  },
  {
    name: "kanban-help",
    description: "Marvin tasks dashboard and prompt list",
    body: callTool("help"),
  },
];
