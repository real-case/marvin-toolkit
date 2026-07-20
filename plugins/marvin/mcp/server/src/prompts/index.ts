import type { PromptDef } from "@marvin-toolkit/mcp-shared";

/**
 * Prompts for the unified `marvin` server. Two body sources:
 *
 *  - **skill-backed** (core / adr / task / sec / refactor groups): `skill` points to a
 *    directory under `plugins/marvin/skills/<name>/SKILL.md`. The skill
 *    file is the single source of truth — Claude Code auto-discovers it
 *    through its own frontmatter `description`, while this server exposes
 *    the same prose under `/marvin:<name>` (frontmatter stripped at
 *    request time).
 *  - **inline-body** (track group): thin wrappers that just instruct the
 *    model to call the matching MCP tool (`task` / `help`) with the right
 *    pre-fills. Bodies are one sentence, so a SKILL.md would be noise.
 *
 * Naming scheme: `/marvin:<group>-<command>`. Singletons stay bare
 * (`commit`, `debug`). See docs/adr/0003-single-plugin-consolidation.md.
 */

function callTool(tool: string, args: Record<string, string> = {}, hint = ""): string {
  const pairs = Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const argText = pairs.length > 0 ? ` with ${pairs.join(", ")}` : "";
  const hintText = hint ? ` ${hint}` : "";
  return `Invoke the \`${tool}\` MCP tool from the \`marvin\` server${argText}.${hintText} The form (if any) covers only what is missing; use the user's choices from it to fill the remaining fields. Do not add preamble — just call the tool.`;
}

/** Hint for the create prompt: mine the user's message for arguments. */
const CREATE_HINT =
  "If the user's message already contains a title, a description, or a tracker id (like ABC-123) for the task, pass them as the `title` / `description` / `tracker_id` arguments instead of leaving them to the form.";

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
    // Thin tool wrapper (inline body) — the human door to the lessons store
    // (ADR-0028): search, add, stats, and prune without leaving chat.
    name: "lessons",
    description:
      "Browse the project lessons-learned store under .marvin/memory — search lessons, add one, show counts by type/tag, or prune stale and duplicate entries.",
    body:
      "Invoke the `lessons` MCP tool from the `marvin` server. Map the user's ask onto `action`: " +
      '"search" (pass `query` keywords and/or `type` ∈ bug-pattern | gotcha | convention | pitfall | process; no query returns the most recent), ' +
      '"add" (pass `type`, a one-line `title`, a 2–4 sentence `body`, optional comma-separated `tags` and `source`; on a near-duplicate warning either extend the named lesson or, if the user insists, retry with `force: true`), ' +
      '"stats" (counts by type and tag), or ' +
      '"prune" (no `slug` lists stale/duplicate candidates; with `slug` it deletes that lesson — confirmation is asked via a form, or pass `confirm: true` once the user has approved). ' +
      'With nothing to go on, default to "search" with no query. Do not add preamble — just call the tool and present its result.',
  },
  {
    // Thin tool wrapper (inline body) — the marvin dashboard + command index,
    // derived from this registry (ADR-0024). Optional `section` filter.
    name: "help",
    description:
      "Marvin welcome banner + dashboard — project summary, configured MCP servers, the command groups, and the full per-command reference, optionally filtered to one group (core/adr/pr/task/sec/refactor/track).",
    body: "Invoke the `help` MCP tool from the `marvin` server. If the user named a section (core, adr, pr, task, sec, refactor, track) in their message, pass it as `section`; otherwise call with no arguments. Present the dashboard verbatim — reproduce the fenced banner block exactly, do not summarise or add preamble.",
  },
  {
    // Thin tool wrapper (inline body) — the whole-toolbox state report backed
    // by the deterministic `dashboard` tool (ADR-0030). The command index
    // stays on `help`; this aggregates the artifact/corpus/usage state.
    name: "dashboard",
    description:
      "Marvin toolbox dashboard — task board, artifact inventories with freshness, ADR corpus by status, lessons stats, and the local usage summary in one report.",
    body: "Invoke the `dashboard` MCP tool from the `marvin` server. If the user named a section (project, board, artifacts, adr, lessons, usage, commands) in their message, pass it as `section`; otherwise call with no arguments. Present the report as-is; no preamble.",
  },
  {
    // Thin tool wrapper (inline body) — the unified read side of every report
    // marvin writes under .marvin/ (docs/design/reports-widget.md, ADR-0024).
    name: "reports",
    description:
      "Unified viewer over every generated .marvin/ report — security, refactor, task, handoff — newest first, with per-report freshness.",
    body: 'Invoke the `report` MCP tool from the `marvin` server. If the user named a specific report (a path under .marvin/, or unambiguously by title — e.g. "the verification report"), pass its project-relative path as the `selected` argument; otherwise call with no arguments. Do not add preamble — just call the tool and present its result.',
  },
  {
    // Skill-backed (three doors) — the template-only export feature (ADR-0033):
    // Claude fills the shipped print template; the server ships no export code.
    name: "report-export",
    description:
      "Export a generated .marvin/ report to PDF (print-ready HTML), standalone HTML, or a Markdown digest — filled from the print-quality template styled on the widget theme tokens.",
    skill: "report-export",
  },

  // ── adr lifecycle (ADR-0027; creation stays on the bare `adr` above) ─
  {
    name: "adr-review",
    description:
      "Deep review of one proposed ADR — section validation, codebase grounding, formal auto-fixes, verdict READY_FOR_ACCEPTANCE or a defect list. Never sets accepted.",
    skill: "adr-review",
  },
  {
    name: "adr-accept",
    description:
      "Ratify a proposed ADR — proposed → accepted with a date stamp, through the adr tool's fail-closed readiness gate. Human-run.",
    skill: "adr-accept",
  },
  {
    name: "adr-audit",
    description:
      "Read-only lint of the ADR corpus — dangling references, numbering holes/duplicates, broken supersede pairs, placeholder residue, invalid statuses, stale index — with remediation guidance.",
    skill: "adr-audit",
  },
  {
    name: "adr-coverage",
    description:
      "Read-only gap analysis — recorded ADRs vs the decisions visible in the actual stack; ranks undocumented decisions by blast radius.",
    skill: "adr-coverage",
  },
  {
    name: "adr-supersede",
    description:
      "Roll back an accepted ADR properly — a successor record supersedes it; links pair both ways, the old record's status flips, its content is never edited. Human-run.",
    skill: "adr-supersede",
  },
  {
    name: "adr-sync",
    description:
      "Regenerate the marker-managed architecture-decisions digest in CLAUDE.md from accepted ADRs only — diff shown, confirmation before writing. Human-run.",
    skill: "adr-sync",
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
  {
    // Thin tool wrapper (inline body) — the read side of the sec-* family
    // (ADR-0024 #7): list the typed audit-report blocks the scanners wrote.
    name: "sec-report",
    description:
      "List the structured security-audit reports under .marvin/security/ — each sec-* scanner's typed findings by severity, newest first.",
    body: callTool("audit", { action: "list" }),
  },

  // ── refactor (code-health family, ADR-0029) ─────────────────────────
  {
    name: "refactor-audit",
    description:
      "Whole-project structural refactoring audit — architecture map, churn×size hotspots, dependency tangles, dead-code candidates. Read-only; writes a numbered findings register under .marvin/refactor/.",
    skill: "refactor-audit",
  },
  {
    name: "refactor-smells",
    description:
      "Scoped code-smell scan of a path, module, or diff — smells, anti-patterns, idiom and naming inconsistencies. Same findings-register format as refactor-audit, composable reports.",
    skill: "refactor-smells",
  },
  {
    name: "refactor-plan",
    description:
      "Turn selected refactoring findings into a sequenced, risk-annotated plan under .marvin/refactor/ — small behaviour-preserving steps inline, oversized items routed to the task pipeline. Changes no code.",
    skill: "refactor-plan",
  },
  {
    name: "refactor-apply",
    description:
      "Execute exactly one behaviour-preserving refactoring step under hard rails — verify green before and after, coverage refusal with a pin-down-test offer, lessons recall/capture, rollback on red.",
    skill: "refactor-apply",
  },

  // ── track (lightweight task tracker; inline tool wrappers, ADR-0032) ─
  // Seven commands over the same tools: the prompts route, the tools decide.
  {
    name: "track-menu",
    description: "Marvin tasks main menu",
    body: callTool(
      "task",
      {},
      "Map whatever the user already said onto the tool's arguments instead of leaving it to the menu: `action` (create / list / status / start / review / done / move / link-pr / config / archive), `type`, `title`, `description` and `tracker_id` for create, `taskId` for start / review / done / move / archive, `status` (the target status key) for move.",
    ),
  },
  {
    name: "track-new",
    description: "Create a board task — bug, feature, chore, or spike",
    body: callTool(
      "task",
      { action: "create" },
      `Pass \`type\` (bug / feature / chore / spike) when the user named or implied one. ${CREATE_HINT}`,
    ),
  },
  {
    // Routing wrapper (ADR-0032): three read views of the same board — the
    // full list, the current-branch + WIP view (`status`), and the tracked
    // link-out view (the `tracker` tool + widget, ADR-0024 #6).
    name: "track-list",
    description: "List board tasks — all, work-in-progress, or tracked",
    body: 'Show the board. Default: invoke the `task` MCP tool from the `marvin` server with action="list". If the user asked what they are working on (the current branch / work-in-progress view), invoke `task` with action="status" instead. If they asked for the tracked tasks (external tracker ids, linking out), invoke the `tracker` MCP tool with no arguments. Do not add preamble — just call the right tool.',
  },
  {
    // Thin tool wrapper (inline body) — one task's full detail (fields +
    // markdown body), backed by the task-detail tool + widget (ADR-0024 #2).
    name: "track-show",
    description: "Show one task in full — fields + markdown body",
    body: callTool(
      "task-detail",
      {},
      "If the user named a task (an id like 007, or unambiguously by title), pass its id as the `taskId` argument; otherwise the task linked to the current branch is shown.",
    ),
  },
  {
    name: "track-start",
    description: "Pick a todo task, branch off, and mark it WIP",
    body: callTool(
      "task",
      { action: "start" },
      "If the user named the task (an id like 007, or unambiguously by title), pass its id as the `taskId` argument.",
    ),
  },
  {
    // Routing wrapper (ADR-0032): one verb for every status transition. The
    // role-driven `review` / `done` actions (ADR-0026) stay preferred when the
    // user names a lifecycle stage; `move` covers any configured status key.
    name: "track-move",
    description: "Move a task — to review, done, or any configured status",
    body: 'Move a board task between statuses via the `task` MCP tool from the `marvin` server. When the user names a lifecycle stage, prefer the role-driven actions: action="review" (send to review) or action="done" (finish) — both default to the current branch\'s task and take `taskId` if a task was named. For any other target, call action="move" with `taskId` and `status` (the target status key). Do not add preamble — just call the tool.',
  },
  {
    name: "track-config",
    description:
      "Show or edit the board configuration — base branch, tracker URL template, branch template, statuses",
    body: callTool(
      "task",
      { action: "config" },
      "Mine the user's message for configuration values and pass them as arguments: `base_branch`, `tracker_url_template` (with `{tracker_id}` marking where the id goes), `branch_template` (placeholders {type_prefix}, {type}, {seq}, {tracker}, {slug}), and `statuses` (a JSON array of {key, role, tracker_status?} — roles: todo, wip, review, done, blocked; tracker_status is the tracker's exact workflow name). Pass an empty string to clear a setting. If the user wants to change settings but named no values, pass edit=true (interactive form for the scalar fields); with no arguments at all the current configuration is shown.",
    ),
  },
];
