/**
 * Curated help reference data — the single source of truth for the `help`
 * command's static content: group blurbs, per-command blurbs, richer
 * descriptions, direct-call examples, and natural-language invocation phrases.
 *
 * Both consumers import this one module so their views can never drift (ADR-0024):
 * the `help` MCP tool (which ships it verbatim as `HelpState`) and the widget's
 * Storybook fixture (which previews exactly what production renders). Keyed by the
 * registry command / group key — the *names* still come from the prompt registry
 * (drift-proof); this file owns the curated prose. It lives beside the widget data
 * `contracts/` that both the server and the widgets already share, for the same
 * reason those do — data both halves need, in one place.
 */

/**
 * Authored one-line purpose per command group — the static, human-maintained
 * half of the command reference (the table-of-contents blurbs). Curated and
 * shipped with the release.
 */
export const GROUP_BLURBS: Record<string, string> = {
  core: "Everyday dev — commits, debugging, docs, ADRs, handoffs",
  adr: "Architecture Decision Record lifecycle",
  pr: "Pull-request lifecycle — create, review, resolve, merge",
  task: "Spec-driven pipeline — start, implement, verify, deliver",
  sec: "Security scanners — secrets, deps, threat models & more",
  refactor: "Code-health — audit, smells, plan, apply",
  track: "Lightweight board tracker — create, move, list, configure",
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
  commit: "Conventional commit, board-linked",
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
  reports: "Unified viewer over all reports",
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
  // track
  "track-menu": "Board action menu",
  "track-new": "New board task",
  "track-list": "List tasks — all, WIP, tracked",
  "track-show": "Show one task",
  "track-start": "Pick up a task, branch off",
  "track-move": "Move a task between statuses",
  "track-config": "Show or edit board config",
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
    "Safe commit — inspects repo state, stages intentionally, screens for secrets (.env, keys, tokens), drafts a Conventional Commits message, and links the current board task.",
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
    "Whole-toolbox state report: board, config, git, artifact inventories, ADR corpus, and local usage.",
  reports:
    "Unified viewer over every generated .marvin/ report — security scans, refactor registers and plans, task specs, verification, handoffs — newest first, with per-report freshness.",
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
    "Open a pull request with a structured description and verification checklist; picks up board-task context when present.",
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
  // track
  "track-menu": "Open the board action menu.",
  "track-new": "Create a board task — bug, feature, chore, or spike — through an interactive form.",
  "track-list":
    "List the board — the full status-grouped list, the current-branch + work-in-progress view, or the tracked tasks linking out to the external tracker.",
  "track-show": "Show one board task in detail.",
  "track-start": "Pick a todo task, create its branch, and mark it work-in-progress.",
  "track-move": "Move a board task — to review, to done, or to any configured status.",
  "track-config": "Show or edit the board configuration (.marvin/config.json).",
};

/**
 * Authored usage example per command — a single copy-pasteable invocation shown
 * as the direct-call chip in the widget's group-detail view. Genuinely optional:
 * commands that are typically run bare (zero-argument, e.g. `readme`,
 * `dashboard`, `sec-scan`) have no entry, and the widget falls back to the bare
 * `/marvin:<name>` call. No coverage guard — absence is a valid state.
 */
export const COMMAND_EXAMPLES: Record<string, string> = {
  // core
  commit: "/marvin:commit fix: guard null session",
  debug: "/marvin:debug TypeError in auth middleware",
  adr: "/marvin:adr Adopt one MCP server",
  changelog: "/marvin:changelog since v0.1.0",
  "migration-plan": "/marvin:migration-plan bundler to Vite",
  explain: "/marvin:explain src/server.ts",
  "docs-search": "/marvin:docs-search how does the verify gate work?",
  handoff: "/marvin:handoff widget work WIP",
  lessons: "/marvin:lessons search dist staleness",
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
  "task-start": "/marvin:task-start add pagination",
  "task-summary": "/marvin:task-summary add-pagination",
  // sec
  "sec-threat-model": "/marvin:sec-threat-model upload flow",
  "sec-fix": "/marvin:sec-fix CVE-2024-1234",
  // refactor
  "refactor-smells": "/marvin:refactor-smells src/tools",
  "refactor-plan": "/marvin:refactor-plan F3,F4",
  // track
  "track-new": "/marvin:track-new bug login 500s",
  "track-start": "/marvin:track-start 12",
  "track-move": "/marvin:track-move 12 blocked",
  "track-show": "/marvin:track-show 12",
};

/**
 * Curated natural-language invocation phrases per marvin command — the "prose"
 * half of the help widget's "two ways to call" detail (ADR-0024): every command
 * shows its direct `/marvin:<name>` call AND ≥3 example utterances a user might
 * type instead ("marvin, show me the dashboard"). Claude Code matches user prose
 * against skill descriptions to trigger a command; these phrases teach that door.
 * Every registry command MUST have an entry with ≥3 phrases (a coverage test in
 * the server package guards it).
 */
export const COMMAND_PROMPTS: Record<string, readonly string[]> = {
  // core
  commit: [
    "marvin, commit this",
    "marvin, stage and commit my changes",
    "marvin, make a conventional commit linked to the board",
  ],
  debug: [
    "marvin, why is this test failing?",
    "marvin, help me debug this crash",
    "marvin, find the root cause of this error",
  ],
  adr: [
    "marvin, record this decision as an ADR",
    "marvin, write an architecture decision record",
    "marvin, capture the rationale for this choice",
  ],
  changelog: [
    "marvin, generate a changelog",
    "marvin, what changed since the last release?",
    "marvin, draft release notes since v0.1.0",
  ],
  readme: [
    "marvin, update the README",
    "marvin, generate the project documentation",
    "marvin, refresh the readme from the code",
  ],
  "migration-plan": [
    "marvin, plan this migration",
    "marvin, how do we refactor this safely?",
    "marvin, draft a migration plan with a rollback",
  ],
  explain: [
    "marvin, explain how this works",
    "marvin, walk me through this module",
    "marvin, what does this function do?",
  ],
  "docs-search": [
    "marvin, where is this documented?",
    "marvin, find the docs on the verify gate",
    "marvin, search the project docs for this",
  ],
  handoff: [
    "marvin, hand off this session",
    "marvin, save the context so I can continue later",
    "marvin, prep a handoff for a fresh session",
  ],
  "handoff-list": [
    "marvin, list the handoffs",
    "marvin, show me the saved handoff docs",
    "marvin, what handoffs do we have?",
  ],
  lessons: [
    "marvin, save this as a lesson",
    "marvin, what lessons do we have on this?",
    "marvin, recall past gotchas for this bug",
  ],
  help: ["marvin, show the help dashboard", "marvin, what commands are available?", "marvin, help"],
  dashboard: [
    "marvin, show me the dashboard",
    "marvin, what's the state of the toolbox?",
    "marvin, give me the whole-project report",
  ],
  reports: [
    "marvin, show me the reports",
    "marvin, what reports do we have?",
    "marvin, open the latest security report",
  ],
  // adr
  "adr-review": [
    "marvin, review this ADR",
    "marvin, is ADR 31 ready to accept?",
    "marvin, check this decision record",
  ],
  "adr-accept": [
    "marvin, accept this ADR",
    "marvin, ratify ADR 31",
    "marvin, mark the decision record accepted",
  ],
  "adr-audit": [
    "marvin, audit the ADRs",
    "marvin, lint the decision records",
    "marvin, are the ADRs consistent?",
  ],
  "adr-coverage": [
    "marvin, what decisions are undocumented?",
    "marvin, check our ADR coverage",
    "marvin, which ADRs are we missing?",
  ],
  "adr-supersede": [
    "marvin, supersede this ADR",
    "marvin, roll back ADR 12",
    "marvin, replace an accepted decision record",
  ],
  "adr-sync": [
    "marvin, sync the ADR digest",
    "marvin, refresh the decisions in CLAUDE.md",
    "marvin, regenerate the ADR summary",
  ],
  // pr
  "pr-create": [
    "marvin, open a pull request",
    "marvin, create a PR for this branch",
    "marvin, push and open a PR",
  ],
  "pr-review": [
    "marvin, review this PR",
    "marvin, review PR 42 on GitHub",
    "marvin, start a pull-request review",
  ],
  "pr-resolve": [
    "marvin, address the PR feedback",
    "marvin, resolve the review comments",
    "marvin, apply the reviewer's suggestions on PR 42",
  ],
  "pr-merge": [
    "marvin, merge this PR",
    "marvin, merge PR 42 and sync the base",
    "marvin, land the pull request",
  ],
  // task
  "task-start": [
    "marvin, start a new task",
    "marvin, spec this out",
    "marvin, define the task for pagination",
  ],
  "task-implement": [
    "marvin, implement the spec",
    "marvin, run the task",
    "marvin, build out the ready spec",
  ],
  "task-verify": [
    "marvin, run the quality gates",
    "marvin, verify the project",
    "marvin, are the tests and lint green?",
  ],
  "task-deliver": [
    "marvin, deliver the task",
    "marvin, commit and open a PR for this",
    "marvin, ship this task",
  ],
  "task-summary": [
    "marvin, summarize what this task delivered",
    "marvin, give me the delivery digest",
    "marvin, recap the task's acceptance criteria",
  ],
  // sec
  "sec-scan": [
    "marvin, run a security scan",
    "marvin, do a full OWASP audit",
    "marvin, harden this before release",
  ],
  "sec-secrets": [
    "marvin, scan for leaked secrets",
    "marvin, check for exposed API keys",
    "marvin, look for credentials in the git history",
  ],
  "sec-deps": [
    "marvin, audit the dependencies",
    "marvin, any vulnerable packages?",
    "marvin, check dependency CVEs and licenses",
  ],
  "sec-gate": [
    "marvin, quick security check on my changes",
    "marvin, run the pre-commit security gate",
    "marvin, is this staged diff safe?",
  ],
  "sec-threat-model": [
    "marvin, threat-model this feature",
    "marvin, run a STRIDE analysis on the upload flow",
    "marvin, what are the attack surfaces here?",
  ],
  "sec-iac": [
    "marvin, review the Terraform for security",
    "marvin, scan the Kubernetes manifests",
    "marvin, check the infrastructure-as-code",
  ],
  "sec-ci": [
    "marvin, audit the CI pipeline",
    "marvin, check the GitHub Actions for supply-chain risk",
    "marvin, review the workflow permissions",
  ],
  "sec-fix": [
    "marvin, fix this vulnerability",
    "marvin, patch CVE-2024-1234 with a test",
    "marvin, remediate this security finding",
  ],
  "sec-compliance": [
    "marvin, check OWASP ASVS compliance",
    "marvin, run a compliance gap analysis",
    "marvin, build the compliance matrix",
  ],
  "sec-pentest": [
    "marvin, give me a pentest checklist",
    "marvin, plan a penetration test for this app",
    "marvin, what should I test for exploits?",
  ],
  "sec-report": [
    "marvin, list the security reports",
    "marvin, show me past audit findings",
    "marvin, what security scans have we run?",
  ],
  // refactor
  "refactor-audit": [
    "marvin, audit the code health",
    "marvin, where is the tech debt?",
    "marvin, map the refactoring hotspots",
  ],
  "refactor-smells": [
    "marvin, scan this module for code smells",
    "marvin, check src/tools for anti-patterns",
    "marvin, find the smells in this diff",
  ],
  "refactor-plan": [
    "marvin, plan the refactoring",
    "marvin, sequence findings F3 and F4 into steps",
    "marvin, turn these findings into a plan",
  ],
  "refactor-apply": [
    "marvin, apply the next refactor step",
    "marvin, execute step 2 of the plan",
    "marvin, do the refactoring under the gates",
  ],
  // track
  "track-menu": [
    "marvin, open the board menu",
    "marvin, show the board actions",
    "marvin, what can I do on the board?",
  ],
  "track-new": [
    "marvin, add a bug to the board",
    "marvin, new feature: dark mode",
    "marvin, track this chore",
  ],
  "track-list": [
    "marvin, what's on the board?",
    "marvin, what am I working on?",
    "marvin, show the tracked tasks",
  ],
  "track-show": [
    "marvin, show task 12",
    "marvin, open this card",
    "marvin, give me the details of task 12",
  ],
  "track-start": [
    "marvin, start task 12",
    "marvin, pick up the next todo",
    "marvin, begin work on this task",
  ],
  "track-move": [
    "marvin, move task 12 to review",
    "marvin, mark this task done",
    "marvin, set task 12 to blocked",
  ],
  "track-config": [
    "marvin, show the board config",
    "marvin, edit the board statuses",
    "marvin, configure the board",
  ],
};
