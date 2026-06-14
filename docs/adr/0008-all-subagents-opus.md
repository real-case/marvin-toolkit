# ADR 0008 — All subagents run on Opus; token economy via deterministic tools

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-14                                                  |
| Supersedes    | the model-tier choice in ADR-0005/0006 (critics on `sonnet`) |
| Superseded by | —                                                           |
| Related       | `plugins/marvin/agents/*.md`, `docs/adr/0004-tool-backed-verification.md`, `docs/adr/0005-tool-backed-dor.md`, `docs/adr/0007-portable-spec-contract.md` |

## Context

The plugin's eight subagents ran a mixed tier: `opus` for the code-writers and
interactive agents (`marvin-tm-executor`, `marvin-tm-review-fixer`, `marvin-tm-writer`,
`research`, `onboarding-guide`, `security-reviewer`) and `sonnet` for the two critics
(`marvin-tm-spec-critic`, `marvin-tm-diff-critic`). The sonnet choice (ADR-0005) was a
cost optimisation — the critics sit on the hot path and run frequently.

That optimisation traded model capability for cost at exactly the gates where judgment
matters most. The spec critic is the **semantic complement the deterministic gate cannot
replace** — it judges whether a proof is *genuine*, whether an integration point is *real*,
whether a rejected variant is a strawman. The diff critic is the pre-PR adversarial
reviewer. Under-powering them weakens the one check that catches what code cannot, and (per
the ADR-0007 audit) the critic is already the most-skipped gate in headless runs.

## Decision

**Run every subagent on `opus`.** Recover token cost the way ADR-0004/0005/0007 already
establish — by moving load-bearing work into **deterministic MCP tools** (`spec`, `verify`,
the `task`/`git` tools) so the model does *less*, not by running the model at a *lower tier*.

- **The principle.** A guarantee a tool can prove deterministically should not consume model
  tokens at all; what remains for the model is judgment, and judgment runs on the most
  capable model. **Economy comes from narrowing the model's job, not from cheapening the
  model.** This is the same thesis as ADR-0004 (verification → tool) and ADR-0007 (the spec
  contract → a schema-validated block): every property the gate proves is a property the
  critic no longer has to.
- **Concretely.** `marvin-tm-spec-critic` and `marvin-tm-diff-critic` move `sonnet → opus`;
  the other six agents were already `opus`. New agents default to `opus`.

## Consequences

### Positive

- The semantic gates run at full capability — the ADR-0007 audit's "the critic is the
  cheapest model and the most-skipped" concern is closed on the model-tier axis.
- One model policy, no per-agent tier reasoning when adding an agent.
- The cost lever is explicit and aligned with the codebase thesis: **determinism in the
  tools, capability in the model.**

### Negative / accepted trade-offs

- Higher per-invocation cost on the critics, which run frequently. Accepted: the
  deterministic `spec` gate runs **first** and rejects shape-invalid specs for free, so the
  opus critic is spent only on specs worth its judgment — the ADR-0006 gate ordering, whose
  rationale is *stronger* now that the critic is more expensive.
- The plugin pins `opus` for every host (it does not impose a host-specific cost knob,
  because Claude Code has none — there is no per-plugin model config and no frontmatter
  interpolation). A host that genuinely needs a different tier can set
  `CLAUDE_CODE_SUBAGENT_MODEL` (Claude Code's global subagent-model override).
- `model: inherit` was considered and **rejected**: it would let a weak session model
  silently under-power the autonomous code-writers and the critics — the exact failure this
  ADR avoids. The plugin owns the quality bar for its agents and sets it at the top tier.
