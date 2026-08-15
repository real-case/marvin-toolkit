# ADR 0040 — Enforcement runs before the call, as a plugin hook

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-08-15 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0030](0030-toolbox-dashboard-and-usage-log.md) (the kill-switch and fail-open pattern this copies but cannot inherit), [ADR-0027](0027-tool-backed-adr-lifecycle.md) (determinism by name: mechanics belong in code, not prose), [ADR-0015](0015-verify-shell-trust-boundary.md) (the existing execution surface and its disclosure obligation), [ADR-0019](0019-branching-and-pr-flow.md) (what makes `dev` the branch that must not be force-pushed), [ADR-0007](0007-marvin-working-directory.md) (`.marvin/` and its config file), `docs/proposals/workflow-hardening.md` (Phase 4, D4, D7, D8) |

> This record is the whole of WP4.0. No hook script, no `hooks/hooks.json`, and no lint rule
> ship with it. WP4.1 is ordering-blocked behind human ratification, because
> `/marvin:adr-accept` carries `disable-model-invocation: true` and a model cannot ratify a
> consent change on the user's behalf.

## Context

Every guardrail marvin ships today is either prose a model reads or a tool a model chooses to
call. `/marvin:task-deliver` refuses on a failed verification, the DoR gate refuses an
incomplete spec, the critics file receipts — and all of it presupposes that the pipeline was
entered. A model that decides to commit directly, or that appends `--no-verify` to get past a
failing pre-commit chain, meets nothing. The two failures this phase targets are exactly the
ones that survive every amount of prose: a bypassed local gate, and a credential-shaped string
reaching a commit.

Claude Code offers the one mechanism that does not depend on the model's cooperation. A
`PreToolUse` hook runs before the tool call it matches, in a separate process, and can deny the
call outright. It is the only enforcement in the product that a model cannot reason its way
around, because the model is not consulted.

That property is also the cost. Everything marvin ships today is inert until invoked: a skill
is text until it matches, a tool is code until it is called, and the usage log (ADR-0030) is
written only *because* a call already happened. A plugin hook inverts this. It executes on
somebody else's machine, in every project, in response to a tool call they did not connect to
marvin, from the moment the plugin is present. Shipping one is a change in what installing
marvin means, and the shape of that change is what this record fixes — before any script
exists to argue about.

## Decision

**Marvin ships two blocking `PreToolUse` hooks on the `Bash` matcher, under a consent
disclosure, a hard fail-open contract, and a kill switch that a separate process can actually
read.** The hooks themselves are WP4.1; this record binds them.

### 1. What the two hooks do

**Hook A — bypass and destructive-push guard.** Blocks `--no-verify` and `-n` when they appear
as standalone arguments of `git commit` or `git merge`, after quoted strings are stripped from
the command line (so a commit *message* mentioning `--no-verify` is not a match). Blocks
force-pushes — `--force`, `-f`, `--force-with-lease` — targeting a protected ref, per D7 below.

**Hook B — pending-secret guard.** Scans the added lines of the commit a `git commit` call is
about to create, against a high-confidence secret-pattern list, and denies on a match. It must
resolve what "pending" means rather than reading the index alone: at `PreToolUse` time the
index is frequently empty, so `git commit -a` has to be widened to unstaged tracked changes and
an explicit pathspec to those paths. A hook that scanned only `git diff --cached` would pass
every `git commit -am` in the product while appearing to work.

**Both open with a cheap prefix check and exit 0.** The overwhelming majority of `Bash` calls
are not `git commit`, `git merge` or `git push`; those calls must reach the pattern machinery
of neither hook. `Bash` is the hottest tool call in the product and a hook on it is on that
path unconditionally.

### 2. The consent model, and the precedent it reverses

Who receives these hooks, when, and what they can do — **measured**, not assumed:

- **Who.** Anyone for whom the plugin directory is present. A skills-directory entry containing
  a `.claude-plugin/` directory is routed through the same plugin loader as a marketplace
  install, and that loader probes for `hooks/hooks.json` unconditionally. This includes this
  repository's own live symlink install (`~/.claude/skills/marvin`).
- **When.** Immediately, with no install step and no enablement entry. A skills-directory
  plugin is enabled by default: marvin is absent from both `installed_plugins.json` and
  `enabledPlugins`, and is nonetheless loaded. Verified by probe — a throwaway skills-directory
  plugin carrying only a manifest and a `hooks/hooks.json` fired its hook in a fresh session,
  and stopped firing when the directory was removed.
- **What they can do.** Deny a `Bash` tool call, with a message fed back to the model. Nothing
  else: they receive the call's parameters on stdin and can only permit, deny, or say nothing.

So the honest statement is stronger than the proposal's: shipping `hooks/hooks.json` **arms the
hooks for anyone who has the directory, with no consent step anywhere in the path.** The user's
consent is granted at install time, to a plugin, and this record is what makes the grant
legible. Every disclosure surface — `docs/configuration.md`, the README, the plugin
description — must say plainly that marvin can block a shell command, which of them it blocks,
and how to turn it off, in the register `docs/configuration.md`'s `## Telemetry` section
already uses for the usage log.

**The precedent this reverses is marvin's own.** `.claude/hooks/marvin-router.sh` implements
the `marvin <intent>` wake-word convention as a `UserPromptSubmit` hook. It is opt-in
(a user hand-copies a block into their own `~/.claude/settings.json`), advisory (it injects
context and never blocks), and user-installed (it lives in this repository's `.claude/`, not
inside the plugin). WP4.1 reverses all three axes at once: shipped-by-default, blocking, and
plugin-owned. That reversal is the substance of the consent question and the reason D4 is
declined below.

### 3. Fail-open, with the correct reason

**Any internal error in a hook script exits 0.** Unreadable stdin, malformed JSON, an
unexpected exception, a missing file — every path that is not a confirmed match ends in exit 0.

The proposal justified this by claiming a broken hook that returns non-zero breaks every `Bash`
call in every user project. **That claim is false**, and the correction matters more than the
prescription. The documented exit-code contract is three-valued: `0` is success (stdout shown
in the transcript), `2` is a *blocking* error (stderr fed back to Claude), and **any other
non-zero is a non-blocking error**. A crashing hook therefore does not break anything; it
surfaces as a non-blocking error and the call proceeds.

The prescription survives on two reasons that are true:

1. **Noise at the hottest call site.** An internal error exiting non-zero emits a non-blocking
   error on every single `Bash` call. A hook that is broken and loud is worse than one that is
   broken and silent, because the user cannot work.
2. **Accidental blocking.** Exit 2 is the deny path. Any code path that can reach it by
   accident — an unguarded `set -e`, an error propagating through a pipeline, a helper that
   exits on its own — silently converts a broken guard into a blocker. Keeping every
   non-match on an explicit `exit 0` is what makes exit 2 reachable only deliberately.

**The false reason must not reach the code comments.** The proposal's wording is the kind of
statement that gets copied verbatim into a script header and read as fact by the next
maintainer; WP4.1's comments carry reasons 1 and 2 or no reason at all.

### 4. The kill switch, and why it cannot inherit ADR-0030's

The switch is **`hooks.enabled`** in `.marvin/config.json`, following ADR-0030's `usage.enabled`
pattern in shape and in failure mode. It cannot follow it in implementation. `loadConfig` lives
inside the bundled server and imports its siblings; `dist/server.js` is an MCP stdio server, not
a CLI, and a hook is a separate process with no import path to any of it. WP4.1 writes a
**second, independent raw-JSON reader**, and this record fixes its contract so the two cannot
drift:

- **Path:** `$CLAUDE_PROJECT_DIR/.marvin/config.json`. `CLAUDE_PROJECT_DIR` is measured present
  in the hook's environment.
- **Absent, unreadable, or malformed means enabled.** So does a config with no `hooks` block.
  Only an explicit `false` disables, mirroring `usageEnabled`'s `config.usage?.enabled ?? true`.
  This is fail-open in the toolkit's existing sense, and it is deliberate: a guard that
  silently disarms itself on a JSON typo is worse than no guard, and one that blocks every
  commit because a config file is malformed is unusable.
- **One-shot override:** `MARVIN_HOOKS_DISABLED=1`, joining the `MARVIN_*` family. Note the
  scope: a `PreToolUse` hook runs *before* the command it inspects, and inherits the session's
  environment rather than the inspected command's. Prefixing the variable onto the blocked git
  command puts it in the command string, where the hook does not read it. The override applies
  to a session, not to a call.
- **The `MARVIN_TASKS_CONFIG` trap.** That variable repoints the **server only**. It is set in
  the `env` block of the marvin server's spawn in `.mcp.json` and read by `lib/env.ts`; a hook
  does not inherit it (measured empty in the hook's environment). A project that repoints its
  config therefore gets a server reading one file and a hook reading another, and the kill
  switch would appear not to work. WP4.1 must document this; reconciling it is an open
  question below.

**No schema change is required, and that has a cost worth naming.** `Config` is a plain
`z.object`, not `.strict()`, so a hand-added `hooks` key parses successfully and is stripped
from the parsed data; `updateConfigFile` writes the raw merged object rather than the parsed
one, so the key survives a `track-config` read-modify-write. Both halves are measured. The
consequence is that a `hooks` block persists across every config edit and is readable by a
raw-JSON reader while remaining wholly invisible to `track-config`, `dashboard`, `verify` and
every other server reader. That invisibility is accepted for now as the cost of not versioning
a schema for a feature that has not shipped, and is explicitly revisitable once the hooks have
run in the field.

### 5. D7 — the protected ref is a union of two sources

**Hook A protects the union of `base_branch` from `.marvin/config.json` and the default branch
from `origin/HEAD`.** Not either alone. In this repository the two differ by design —
`origin/HEAD` resolves to `main` while ADR-0019 makes `dev` the integration branch — a
force-push to either is destructive, and `.gitignore`'s `.marvin/*` makes a config pinning
`dev` uncommittable here. Relying on the config alone would leave the repository that ships the
hook unprotected; relying on `origin/HEAD` alone would ignore an explicit project setting.

A measurement taken while grounding this record qualifies the decision without reopening it.
The union's current *value* in this repository is `{main}` alone: the local
`.marvin/config.json` pins `base_branch: "main"`, and `origin/HEAD` also resolves to `main`, so
neither input yields `dev`. That local config also carries an obviously polluted
`branch_template` value, so its `base_branch` may itself be fixture residue rather than intent
— but the file as it sits yields `{main}` either way. The union stands as the decision; whether
it needs a third input, or whether `dev` is covered by a named follow-up, is recorded as an
open question below rather than settled here.

### 6. D8 — the interpreter is node, and the scripts are `.mjs`

`node` is guaranteed: `.mcp.json` already spawns the marvin server with it, and the plugin
cannot function without it. `jq` is guaranteed by nothing on Linux or Windows. The existing
router hook concedes this itself with a `command -v jq || exit 0` guard — acceptable in an
advisory hook, but in a *blocking* one that guard degrades into a silently skipped check, which
is the worst available outcome: a guard that reports nothing and protects nothing.

The proposal framed the glob consequence as a cost. **It is a benefit, and the record should say
so plainly.** `.claude/**` is excluded from both ESLint and Prettier, and `.sh` matches no
lint-staged pattern, so today's router hook is covered by nothing at all. A `.mjs` hook under
`plugins/marvin/hooks/` is under no ignore list and matches lint-staged's `*.{ts,mjs,js}`, so it
is linted, formatted and pre-commit-checked like the rest of the server; `hooks.json` is covered
by `format:check`. For a blocking script shipped to every user, being inside the quality gates
is the point.

### 7. D4 — the policy loader is rejected for now

**Considered:** a `SessionStart` / `UserPromptSubmit` hook that loads marvin's working
protocol into context at the start of a session, as an addressed alternative to an
always-loaded constitution file. It is the natural neighbour of this phase and shares its
consent surface.

**Declined, for now.** It widens the grant from "two blocking hooks that inspect `Bash` calls"
to the whole ambient-execution surface: a `SessionStart` hook fires on every session start and
a `UserPromptSubmit` hook on every user message, in every project, whether or not marvin is
being used in that session. The two guards in this record are defensible because their scope is
legible in one sentence and their trigger is a specific, dangerous class of command. A policy
loader has no such boundary — it runs always, and what it injects is prose, which is precisely
the enforcement mode Phase 4 exists to stop relying on.

**What would change the answer:** evidence from the shipped guards. Once the two hooks have run
in the field and the consent disclosure has survived contact with users, the marginal cost of a
third hook is measurable rather than speculative. A policy loader also becomes materially more
attractive if the injected content is small, deterministic and demonstrably reduces a failure
the guards cannot catch. Either way it gets its own record, and its own acceptance.

### 8. Where the code and the checks live

- **`plugins/marvin/hooks/hooks.json`, in the plugin wrapper format** — events nested under a
  top-level `hooks` key, each with a `matcher` and a list of `{type: "command", command,
  timeout}` entries. The wrapper is required for a plugin and must not be used in
  `settings.json`, which takes events at top level. `${CLAUDE_PLUGIN_ROOT}` is interpolated
  inside the command string and quoted.
- **`plugin.json` gains nothing.** `hooks/hooks.json` is auto-discovered by an existence check,
  and the manifest `hooks` key only *supplements* it with additional files. Pointing the
  manifest key at the standard path is a loader error, not a harmless duplicate.
- **Regression fixtures live in the root `test/` tree, never inside the plugin.** A fixture
  carrying a credential-shaped string that lives under `plugins/marvin/` is installed into
  every user's plugin directory, where it will be found by their own secret scanners and ours.
  Fixtures are built at runtime under `mkdtemp`, per the house pattern, and assert the exit code
  **and** the stderr payload — a crashing script also exits non-zero, so the code alone does not
  distinguish a working guard from a broken one.
- **The executability check goes inside `scripts/lint-manifests.mjs`** as rule 8, documented in
  its numbered header block: walk `hooks.<event>[].hooks[]`, resolve `${CLAUDE_PLUGIN_ROOT}`
  against the pack directory, and fail on a missing or non-executable command. The primary
  reason is cohesion — it is a manifest-structure check and the linter already owns per-pack
  file checks. It is reinforced by a measured constraint: `test/ci-workflow.test.mjs` pins a
  contiguous triple of workflow steps (`Lint skills` immediately before `Lint manifests`,
  `Trigger-eval harness` immediately after), so a new CI step in either adjacent slot breaks the
  suite. The accurate statement is that the slot *adjacent to the manifest lint* is locked, not
  that no new step is possible — Phase 3's docs-drift step was added safely outside the triple.

## Alternatives considered

- **Distributing the hooks as a copy-in `settings.json` block**, like the router hook. Rejected:
  it preserves the consent property but forfeits the entire point. A guard against
  `--no-verify` protects nobody if reaching it requires the same deliberateness the bypass
  itself expresses.
- **Non-blocking, warning-only hooks** (exit 0 with a message). Rejected for the same reason: a
  warning is prose delivered by a different transport, and the model's ability to proceed past
  prose is the failure being fixed. The kill switch, not a softer verdict, is the answer for
  users who do not want the block.
- **Folding the secret scan into the existing `sec-gate` command** rather than a hook. Rejected:
  `sec-gate` is a command someone runs. The scan is needed exactly in the sessions where nobody
  thought to run it.
- **A shell implementation with a `jq` guard**, matching the router hook. Rejected under D8: the
  guard's failure mode is a silent no-op, which in a blocking guard is indistinguishable from
  protection.

## Consequences

### Positive

- The first enforcement in the toolkit that does not depend on the model choosing to invoke it.
- The two most common irreversible mistakes in the pipeline — a bypassed local gate, a
  committed credential — become deterministic denials rather than post-hoc findings.
- The hook scripts enter the repository's lint, format and pre-commit gates (D8), where every
  other shipped script already lives.

### Negative / accepted trade-offs

- **Installing marvin now changes what a shell command can do.** The mitigation is disclosure
  plus a kill switch, in the same register ADR-0015 uses for the `verify` trust boundary; it is
  not a technical containment, because a guard that can be contained is not a guard.
- **A false positive blocks a legitimate command.** Both hooks are deliberately narrow — a
  standalone-argument match for Hook A, a high-confidence pattern list for Hook B — and the
  escape is `MARVIN_HOOKS_DISABLED=1` on the session or `hooks.enabled: false` in the config.
- **The kill switch is invisible to every server reader**, because the `hooks` key is stripped by
  the config schema. `track-config` will not show it and `dashboard` will not report it, so a
  user who disabled the hooks has no marvin surface confirming it. Accepted for now; revisitable
  once the hooks have shipped.
- **Two config readers now exist for one file**, one inside the bundle and one in each hook,
  with different failure semantics available to them. They must be kept aligned by test, not by
  intention.

## Open questions

These are unresolved. WP4.1 must answer them in its spec rather than discover them in code.

1. **`dev` is not in the protected set today.** The D7 union resolves to `{main}` alone in this
   repository, so the branch ADR-0019 designates as the integration branch — and the one this
   record's own PR targets — would be unprotected by Hook A as specified. WP4.1 either adds a
   third input to the union, or ships with this stated as a known limitation plus a named
   follow-up. It must not ship silently.
2. **Whether the local `base_branch: "main"` is intentional.** The same config carries a
   `branch_template` value that is plainly test-fixture pollution from the known
   `MARVIN_TASKS_CONFIG` env-leak, so the `base_branch` reading may be residue rather than
   configuration. This affects question 1's diagnosis, not its remedy.
3. **How the `MARVIN_TASKS_CONFIG` divergence is reconciled.** Documenting the trap is the
   minimum. Whether the hook should also honour the variable when it happens to be present in
   the session environment, and whether that would be more confusing than the divergence it
   fixes, is undecided.
4. **Whether per-hook granularity is needed.** This record specifies `hooks.enabled` as a single
   master switch. Whether a user needs to disable Hook A while keeping Hook B is unknown, and
   the answer should come from use rather than from anticipation.
5. **How the secret-pattern list stays consistent with `skills/sec-gate/SKILL.md`.** The plan
   calls for the list to be canonical in the script and referenced from the skill, with a
   consistency test. The skill's current list cannot support a naive one: it mixes true regexes,
   bare literal prefixes, and at least one purely semantic rule. WP4.1 must either restructure
   that list into a parseable block or scope the test to a named subset, and must decide whether
   patterns matching as bare substrings are compatible with the skill's own stated
   low-false-positive constraint.
6. **What a hook `timeout` cut-off means.** It must be treated as allow, not deny — but which
   timeout value makes that outcome rare enough to be acceptable on a slow machine, given the
   hook is on the `Bash` path, is unmeasured.
7. **Whether the index tables will say `Accepted` after ratification.** `scripts/check-docs-drift.mjs`
   validates the ADR *link* only and never the status column, so a later `/marvin:adr-accept`
   will leave both index tables silently reading `Proposed`. Nothing will prompt the update, and
   WP4.1 is gated on that acceptance — so whoever runs it must edit both tables by hand.
