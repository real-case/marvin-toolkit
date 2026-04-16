# Marvin

> Claude Code toolkit for those who don't panic.

Marvin is a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin marketplace shipping skills, agents, and MCP servers that cover the full development lifecycle. Three packs, 24 skills, 5 agents, 2 MCP servers — install what you need and get structured, repeatable workflows inside Claude Code.

## Quick start

```shell
# Add the Marvin marketplace
/plugin marketplace add real-case/marvin-toolkit

# Install the packs you need
/plugin install marvin-core-pack@marvin-plugins
/plugin install marvin-security-pack@marvin-plugins
/plugin install marvin-taskmaster-pack@marvin-plugins
```

## What's included

| Pack | Skills | Agents | MCP Servers | Prefix |
|------|--------|--------|-------------|--------|
| [marvin-core-pack](#marvin-core-pack) | 10 | 2 | 2 | `mn.` |
| [marvin-security-pack](#marvin-security-pack) | 10 | 1 | — | `mn.sec.` |
| [marvin-taskmaster-pack](#marvin-taskmaster-pack) | 4 | 2 | — | `mn.` |

### marvin-core-pack

Core developer tools — language-agnostic, used by every engineer.

| Command | Description |
|---------|-------------|
| `/mn.commit` | Generate conventional commit messages with sensitive file detection |
| `/mn.pr` | Create PRs with structured descriptions and pre-flight checks |
| `/mn.review` | Code review by severity (critical, warning, suggestion) |
| `/mn.debug` | Systematic root-cause analysis with hypotheses |
| `/mn.adr` | Create Architecture Decision Records |
| `/mn.changelog` | Generate changelog from git history |
| `/mn.readme` | Generate or update README.md |
| `/mn.migration-plan` | Plan migrations with risks and rollback strategy |
| `/mn.explaining-code` | Explain code, architecture, and execution flow |
| `/mn.docs-search` | Search and synthesize project documentation |

**Agents:**
- `onboarding-guide` — helps new developers navigate the codebase
- `research` — documentation lookup via Context7, GitMCP, and web search

**MCP Servers:**
- `context7` — library and framework documentation lookup
- `gitmcp` — documentation from any GitHub repository

### marvin-security-pack

Security-focused tools — OWASP Top 10, dependency audits, compliance checks.

| Command | Description |
|---------|-------------|
| `/mn.sec.scan` | Comprehensive OWASP Top 10:2025 audit (orchestrates secrets + deps + static analysis) |
| `/mn.sec.secrets` | Deep scan for leaked secrets and credentials across code, config, and git history |
| `/mn.sec.deps` | Audit dependencies for vulnerabilities, license risks, and maintenance health |
| `/mn.sec.gate` | Fast pre-commit security check — scoped to staged changes only |
| `/mn.sec.threat-model` | STRIDE-based threat modeling for features or systems |
| `/mn.sec.iac` | Infrastructure-as-Code security (Terraform, K8s, Docker, CloudFormation) |
| `/mn.sec.ci` | CI/CD pipeline security audit (GitHub Actions, GitLab CI, Jenkins) |
| `/mn.sec.fix` | Generate and verify fixes for vulnerabilities with regression tests |
| `/mn.sec.compliance` | OWASP ASVS compliance checking (L1/L2/L3) |
| `/mn.sec.pentest` | Generate application-specific penetration testing checklist |

> `/mn.security-scan` is available as a backward-compatible alias for `/mn.sec.scan`.

**Agent:** `security-reviewer` — reviews code and architecture for security issues, prioritizes remediation.

### marvin-taskmaster-pack

Spec-driven task pipeline — separates human decisions from automated execution across 3 phases.

```
Phase 1: Spec Co-creation    Phase 2: Dispatch           Phase 3: Review & Fix
(interactive, sequential)     (automated, batch)          (human-led)

/mn.spec-create → spec.md    dispatch.sh → worktrees     /mn.fix-pr → apply fixes
                              → headless agents → PRs
```

**Pipeline commands:**

| Command | Phase | Description |
|---------|-------|-------------|
| `/mn.spec-create` | 1 | Interactive spec co-creation (feature/bugfix flows, solution variants, DoR gate) |
| `dispatch.sh` | 2 | Batch dispatch specs to headless agents in isolated git worktrees |
| `/mn.fix-pr` | 3 | Apply PR review comments as code fixes |

**Standalone commands** (reusable outside the pipeline):

| Command | Description |
|---------|-------------|
| `/mn.verify` | Run quality gates (tests, lint, type-check, build) with stack auto-detection |
| `/mn.deliver` | Commit + PR (delegates to core-pack), gates on verification |

**Agents:**
- `spec-writer` — conversational requirements exploration (Phase 1 companion)
- `executor` — headless execution agent (read by dispatch.sh for Phase 2)

## Development lifecycle

```
Plan            Code            Review          Secure           Document         Ship             Pipeline
├─ mn.adr       ├─ mn.debug     └─ mn.review    ├─ mn.sec.scan   ├─ mn.readme     ├─ mn.commit     ├─ mn.spec-create
└─ mn.migration ├─ mn.explaining                ├─ mn.sec.secrets├─ mn.changelog  └─ mn.pr         ├─ dispatch.sh
   -plan        │  -code                        ├─ mn.sec.deps   └─ mn.docs                       ├─ mn.fix-pr
                └─ mn.docs                      ├─ mn.sec.gate      -search                       ├─ mn.verify
                   -search                      ├─ mn.sec.iac                                     └─ mn.deliver
                                                ├─ mn.sec.ci
                                                └─ ...
```

## Namespace convention

All commands use a dot-separated namespace to prevent collisions with other plugins:

| Pack | Prefix | Example |
|------|--------|---------|
| Core | `mn.` | `/mn.commit`, `/mn.review` |
| Security | `mn.sec.` | `/mn.sec.scan`, `/mn.sec.deps` |
| Taskmaster | `mn.` | `/mn.spec-create`, `/mn.verify` |

## Project structure

```
.claude-plugin/marketplace.json         # Marketplace manifest
plugins/
  <pack-name>/
    .claude-plugin/plugin.json          # Pack manifest (name, version, description)
    .mcp.json                           # MCP server definitions (optional)
    skills/<skill-name>/SKILL.md        # Skill definition
    commands/<command-name>.md           # Command definition
    agents/<agent-name>.md              # Agent definition
```

## Contributing

1. Create a branch for your changes
2. Add or modify plugins in `plugins/`
3. Update `marketplace.json` if adding a new plugin pack
4. Validate locally: `claude plugin validate .`
5. Create a PR — CI validates manifests, frontmatter, and structure automatically

See [CLAUDE.md](./CLAUDE.md) for development guidelines.

## License

[MIT](./LICENSE)
