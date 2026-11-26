# ADR 0057 — Subagents run on Opus only where their judgment is the last check

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-11-26 |
| Supersedes    | [ADR-0006](0006-all-subagents-opus.md) |
| Superseded by | —                                                           |
| Related       | [ADR-0006](0006-all-subagents-opus.md) (the all-Opus policy this replaces), [ADR-0002](0002-tool-backed-verification.md) and [ADR-0003](0003-tool-backed-dor.md) (the deterministic gates that check a cheaper agent's output), [ADR-0053](0053-hunt-command-family.md) (the hunt agents) |

## Context

ADR-0006 put every subagent on `opus` and recovered cost by moving work into deterministic tools.
Three of its premises no longer hold.

- **The price gap halved.** ADR-0006 was written when Opus cost five times as much as Sonnet.
  Opus 5.5 is priced at $4/$20 per million input/output tokens and Sonnet 5.5 at $2/$10, so the
  gap is now two times. Moving an agent to Sonnet saves at most half its cost, but it also gives up
  less capability than it did, because on checkable work the two models are within a few points
  (FrontierCode 1.1: 54.4% against 52.1%).
- **The host override does not work.** ADR-0006 named `CLAUDE_CODE_SUBAGENT_MODEL` as the knob a
  host could use to pick a cheaper tier. A live autopilot run on 2026-10-10 showed that the
  variable does not replace a model pinned in an agent's frontmatter
  (`plugins/marvin/mcp/server/src/pipeline/sandbox.ts`). Claude Code resolves a subagent's model
  from the call's `model` parameter first, then the frontmatter, then that variable. So the plugin's
  pin is the tier every host gets, and a blanket `opus` is a cost no host can opt out of.
- **The agent set grew.** ADR-0006 covered eight agents. There are now fourteen, and several do
  work that a later mechanism checks: the hunt skeptic's ruling is reviewed by a referee and then by
  a failing test, and the executor's code is run against sealed tests and gates.

ADR-0006's core argument stands: the agents whose judgment nothing checks afterwards should run
at full capability. That argument covers some agents, not all of them.

## Decision

1. **An agent stays on `opus` when its judgment is the last check before a person, a merge or a
   recorded verdict.** These are `marvin-tm-spec-critic`, `marvin-tm-diff-critic`,
   `marvin-hunt-referee`, `marvin-debugger` (its root cause becomes the spec's), `marvin-auditor`
   (a missed vulnerability has no later check), and `marvin-hunt-hunter`. The hunter is kept on Opus
   because its claims are filtered downstream, but a defect it misses is lost, so its recall is
   what matters.
2. **An agent runs on `sonnet` when a later mechanism checks its output, or when it only reads
   and reports.** These are `marvin-tm-executor` and `marvin-tm-review-fixer` (sealed tests, the
   `verify` gates, the diff critic and CI check their code), `marvin-hunt-skeptic` (the referee
   reviews its ruling), and `marvin-hunt-cartographer`, `marvin-refactor-auditor`,
   `marvin-researcher`, `marvin-tm-writer` and `marvin-guide` (they gather, map or explain, and a
   person or a later step acts on what they return).
3. **Every agent names its model explicitly.** `model: inherit` stays rejected, for ADR-0006's
   reason: a weak session model would silently under-power the code writers. A new agent is placed
   by rules 1 and 2. When neither clearly applies, it gets `opus`.
4. **Effort is out of scope.** No agent pins `effort:` here. Agents inherit the calling session's
   level, and the autopilot sets its children's effort through its rubric.

## Consequences

- Eight of fourteen agents run at about half their previous cost per token. The six that are the
  last check keep their tier, so the semantic gates ADR-0006 protected are unchanged.
- A Sonnet agent may need a second pass where Opus would not. For the executor and the review-fixer
  that pass is already built in: a failed gate is a fix iteration. For the skeptic, a weaker
  rebuttal means more claims reach the referee, which costs the referee's time but does not lose a
  defect.
- The autopilot's role children are unaffected. They take their model from the rubric
  (`plugins/marvin/pipeline/rubric.default.yaml`), not from agent frontmatter. A subagent a child
  dispatches, such as the planner's spec critic, still takes its model from its own frontmatter.
- Placing an agent now takes a decision, where ADR-0006 needed none. Rules 1 and 2 keep it to one
  question: does anything check this agent's output after it?
- The measure to watch is the diff critic's and the referee's rejection rate on work produced by
  the Sonnet agents. A rise means an agent belongs back on Opus.

## Alternatives considered

- **Keep ADR-0006.** Rejected: at a 2x price gap, paying Opus rates for read-only mapping and for
  code that sealed tests check buys little, and no host can lower the tier.
- **Move the critics to Sonnet as well.** Rejected for ADR-0006's reason: they are the semantic
  check the deterministic gates cannot replace, and nothing reviews them.
- **`model: inherit` for the code writers**, so that they follow an Opus session and the
  autopilot's escalation. Rejected: in a Sonnet or Haiku session the executor would silently run on
  that model, which is the failure ADR-0006 named.
- **Haiku for the read-only agents.** Not adopted yet. Haiku 5.5 keeps its price advantage only
  under 100K tokens per request, and a whole-project refactor audit or codebase tour exceeds that.
  The guide is the likeliest candidate once it is measured.
