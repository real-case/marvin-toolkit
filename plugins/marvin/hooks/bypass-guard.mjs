/**
 * bypass-guard — Hook A of ADR-0040. A blocking `PreToolUse` guard on the `Bash`
 * matcher that refuses two classes of command:
 *
 *   1. A local-gate bypass: `git commit --no-verify` / `-n` (and the same bundled,
 *      as in `git commit -nm msg`), and `git merge --no-verify`.
 *   2. A destructive push at a protected branch: a force or a deletion whose
 *      resolved target is in the protected set.
 *
 * EXIT 0 IS EVERYTHING ELSE, including every internal error. See `lib/hook-io.mjs`
 * for the two reasons that contract is right (noise at the hottest call site, and
 * keeping exit 2 reachable only deliberately).
 *
 * WHY `git merge -n` IS NOT BLOCKED. There `-n` is `--no-stat`, a display flag.
 * Blocking it would be a false positive on a harmless command, which contradicts
 * ADR-0040's own "deliberately narrow" trade-off. `-n` is narrowed to `git commit`.
 *
 * WHY `git push -n` ALLOWS UNCONDITIONALLY. There `-n` is `--dry-run`. A simulated
 * push changes nothing, so denying one is the same class of false positive.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALLOW,
  deny,
  gitDir,
  gitSubcommand,
  hasShortFlag,
  hooksEnabled,
  isMain,
  main,
  readPayload,
  runGit,
  splitSegments,
  tokenize,
} from "./lib/hook-io.mjs";

const HOOK_NAME = "bypass-guard";

/**
 * The shipped third input to the protected-branch union.
 *
 * A plain exported array on purpose: the acceptance criterion asserts the UNION, not
 * these literals, so the list can grow without a test rewrite, and a reader can see
 * the policy in one place rather than infer it from a regex.
 *
 * Narrow by construction — four literal names, not patterns. `release/*` is excluded
 * because it needs glob semantics this guard deliberately does not have, and `trunk`
 * because a repository using it has it as its default branch, where the `origin/HEAD`
 * input already catches it. A project whose integration branch is named anything else
 * sets `base_branch` in `.marvin/config.json`, which is the first input.
 */
export const PROTECTED_DEFAULTS = ["main", "master", "dev", "develop"];

/**
 * The three-input union: `base_branch` from the raw project config, the `origin/HEAD`
 * default branch, and the shipped defaults above.
 *
 * The config is read raw rather than through the server's `loadConfig`, which lives
 * inside a bundled MCP server a separate process has no import path to. Any failure
 * contributes nothing and is not an error — the other two inputs stand alone.
 *
 * @param {string} projectDir
 * @returns {Set<string>}
 */
export function protectedBranches(projectDir) {
  const names = new Set(PROTECTED_DEFAULTS);

  try {
    const parsed = JSON.parse(readFileSync(join(projectDir, ".marvin", "config.json"), "utf8"));
    if (typeof parsed?.base_branch === "string" && parsed.base_branch !== "") {
      names.add(parsed.base_branch);
    }
  } catch {
    // Absent, unreadable or malformed: the union is the other two inputs.
  }

  const head = runGit(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], projectDir);
  if (typeof head === "string") {
    const ref = head.trim().replace(/^refs\/remotes\/origin\//, "");
    if (ref !== "" && !ref.includes("/")) names.add(ref);
  }

  return names;
}

// ── flag shapes ─────────────────────────────────────────────────────────────

/**
 * True when `args` carries the short flag `letter` for `sub`, alone or in a bundle.
 *
 * The bundle READING lives in `lib/hook-io.mjs`, so both guards agree on what `-am`
 * means and neither can read an option's attached value as flag letters — `-uno` is
 * `--untracked-files=no`, not a bundle carrying `-n`.
 */
function hasShort(args, sub, letter) {
  return hasShortFlag(args, sub, letter);
}

/** True when `args` carries `--name`, with or without an `=value` suffix. */
function hasLong(args, name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

// ── refspec shapes ──────────────────────────────────────────────────────────

/**
 * The ONE place either function below decides what git's `refs/` grammar looks like.
 * Splitting that decision is how `destinationOf` came to strip `refs/heads/` while
 * `looksLikeRefspec` did not recognise the same form — an asymmetry inside one module,
 * which let `git push --force origin refs/heads/main` past the predicate and then
 * resolved the target from the current branch instead.
 *
 * @param {string} text
 * @returns {{name: string, qualified: boolean}} `qualified` is git's own `refs/` form.
 */
function refname(text) {
  return { name: text.replace(/^refs\/heads\//, ""), qualified: text.startsWith("refs/") };
}

/**
 * `+refs/heads/main` → `main`; `HEAD:main` → `main`; `main` → `main`.
 *
 * `ctx` rather than a resolved head name so the `rev-parse` behind `ctx.headBranch`
 * runs only for a token that actually resolves to it.
 */
function destinationOf(token, ctx) {
  let text = token.startsWith("+") ? token.slice(1) : token;
  const colon = text.indexOf(":");
  if (colon !== -1) text = text.slice(colon + 1);
  text = refname(text).name;
  if (text === "HEAD") return ctx.headBranch;
  return text === "" ? null : text;
}

/** A refspec whose source side is empty — `git push origin :main` deletes `main`. */
function isDeletionRefspec(token) {
  const text = token.startsWith("+") ? token.slice(1) : token;
  return text.startsWith(":") && text.length > 1;
}

/**
 * Does this positional token name a ref?
 *
 * This predicate exists INSTEAD of a per-subcommand option-argument table for the
 * REFSPEC. Such a table is a list that must be kept complete against a moving upstream.
 * "Does this token name a ref" is a property of the repository or of git's own `refs/`
 * grammar, and neither can rot.
 *
 * Its failures are unrecognised names, never wrong ones — a branch that exists only on
 * the remote, or one being created by this very push. Those are handled where the
 * target is resolved: an unrecognised token sitting in the refspec slot means the user
 * named a target this guard cannot resolve, and the answer to that is allow.
 */
function looksLikeRefspec(token, ctx) {
  if (token.includes(":") || token.startsWith("+")) return true;
  if (refname(token).qualified) return true;
  if (token === "HEAD") return true;
  if (ctx.protected.has(token)) return true;
  const local = ctx.localBranches;
  return Array.isArray(local) && local.includes(token);
}

/**
 * The push options whose value is the NEXT token, and so must be kept out of the
 * positional list. An attached form (`-ofoo`, `--push-option=foo`) needs no entry: it
 * starts with `-` and is never positional.
 *
 * Five entries, every one an unambiguous `OPT_STRING` in git's own `builtin/push.c`.
 * The table is small and certain on purpose — over-listing is the direction that hurts,
 * since swallowing a token that is really the repository shifts a refspec into the
 * repository slot. A MISSING entry only leaves a value in the list, where it resolves
 * to a destination no protected name matches, which is an allow.
 */
const PUSH_VALUE_OPTIONS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

/**
 * The positional tokens of a push, with each known option's separated value dropped.
 *
 * @param {string[]} args
 * @returns {string[]} `[<repository>, <refspec>...]` in git's own argument order.
 */
function pushPositionals(args) {
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "") continue;
    if (arg[0] === "-") {
      if (PUSH_VALUE_OPTIONS.has(arg)) i += 1;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

// ── the decision ────────────────────────────────────────────────────────────

/**
 * Judge one segment. Returns a reason string to deny, or null to allow.
 *
 * `contextFor(chdir)` is called at most once, and only on the push path after a
 * destructive indicator has been found in the token text alone; the context it returns
 * is itself read lazily, so no git call happens before that point either.
 */
function inspectSegment(tokens, sub, contextFor) {
  // Flags are read from UNQUOTED tokens only. A token any part of which was quoted is
  // message text, so `git commit -m "stop using --no-verify"` is not a match.
  const after = tokens.slice(sub.index + 1);
  const args = after.filter((t) => !t.quoted).map((t) => t.text);

  if (sub.name === "commit") {
    if (args.includes("--no-verify")) {
      return "`git commit --no-verify` skips the project's pre-commit gate.";
    }
    if (hasShort(args, "commit", "n")) {
      return "`git commit -n` skips the project's pre-commit gate.";
    }
    return null;
  }

  if (sub.name === "merge") {
    // `-n` is deliberately absent here: on merge it is `--no-stat`, a display flag.
    if (args.includes("--no-verify")) {
      return "`git merge --no-verify` skips the project's commit-msg and pre-merge gates.";
    }
    return null;
  }

  // ── push, in three ordered steps ──────────────────────────────────────────

  // 1. A dry-run changes nothing, so it is never denied. `-n` here is `--dry-run`.
  if (args.includes("--dry-run") || hasShort(args, "push", "n")) return null;

  const positionals = pushPositionals(args);

  // 2. A destructive indicator must be present. Pure token inspection: no git call yet.
  const forced =
    args.includes("--force") ||
    hasShort(args, "push", "f") ||
    hasLong(args, "--force-with-lease") ||
    hasLong(args, "--force-if-includes") ||
    positionals.some((token) => token.startsWith("+"));
  const deleting =
    args.includes("--delete") || hasShort(args, "push", "d") || positionals.some(isDeletionRefspec);
  if (!forced && !deleting) return null;

  const verb = forced ? "force-push" : "branch deletion";

  // 3. The candidate target set must intersect the protected set. Only here does a
  //    git call become possible, through the context.
  const ctx = contextFor(sub.chdir);

  if (args.includes("--all") || args.includes("--mirror")) {
    // The protected set is a POLICY (config + origin/HEAD + the shipped defaults) and is
    // never empty, so denying against it alone claimed an intersection it had not
    // computed: `git push --force --all origin` in a repository whose branches are all
    // topic branches was denied by naming four branches that do not exist there. `--all`
    // pushes local branches, so a protected name with no local branch cannot be a target.
    // (`--mirror` also carries refs a local branch does not back; missing those is a
    // skipped check, which is the direction this guard errs in.)
    const local = ctx.localBranches;
    const present = Array.isArray(local) ? local : [];
    const covered = [...ctx.protected].filter((name) => present.includes(name)).sort();
    if (covered.length === 0) return null;
    return `\`git push --${args.includes("--all") ? "all" : "mirror"}\` under a ${verb} covers every branch, including the protected ${covered.join(", ")}.`;
  }

  const refspecs = positionals.filter((token) => looksLikeRefspec(token, ctx));
  let targets;
  let how;
  if (refspecs.length > 0) {
    targets = refspecs.map((token) => destinationOf(token, ctx));
    how = "the refspec argument";
  } else if (positionals.length > 1) {
    // git's grammar is `git push [<repository> [<refspec>...]]`, so a positional beyond
    // the first sits in the REFSPEC slot: the user named a target, and this guard failed
    // to resolve it — a branch that lives only on the remote, or one this push creates.
    // Falling back to the current branch here denied `git push -f origin wip-remote-only`
    // from `main` while naming `main`, a target the command never mentions. An
    // unresolved name is not evidence of a protected one.
    return null;
  } else {
    // Nothing occupies the refspec slot, so git would push the current branch. This is
    // the one residual that can resolve to DENY on an inference, which is why the
    // message states both the target and how it was reached.
    targets = [ctx.headBranch];
    how = "the current branch, because no argument named a ref";
  }

  const blocked = targets.filter((name) => typeof name === "string" && ctx.protected.has(name));
  if (blocked.length === 0) return null;

  return `\`git push\` requests a ${verb} at "${blocked.join('", "')}", resolved from ${how}, and that branch is protected.`;
}

/**
 * The pure decision function the tests drive: no repository, no shell, no subprocess.
 *
 * `context` is either one context object used for every segment — what a test passes —
 * or a function of the segment's `-C <dir>`, which is what the guard passes so that
 * `git -C ../other push --force …` is judged against the repository it would reach.
 *
 * @param {string} command
 * @param {Ctx | ((chdir: string | null) => Ctx)} context
 * @returns {{allow: true} | {allow: false, reason: string}}
 * @typedef {{protected: Set<string>, localBranches: string[], headBranch: string | null}} Ctx
 */
export function inspect(command, context) {
  const contextFor = typeof context === "function" ? context : () => context;
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    const sub = gitSubcommand(tokens);
    if (sub === null) continue;
    if (sub.name !== "commit" && sub.name !== "merge" && sub.name !== "push") continue;
    const reason = inspectSegment(tokens, sub, contextFor);
    if (reason !== null) return { allow: false, reason };
  }
  return { allow: true };
}

// ── the guard ───────────────────────────────────────────────────────────────

/**
 * The context for ONE directory, behind memoised getters: each git call runs at most
 * once, and only if the decision actually reaches it. At most three run — the protected
 * union's `symbolic-ref`, the local-branch listing, and `rev-parse` — and none before a
 * destructive indicator has been found in the token text.
 *
 * @param {string} dir A `gitDir` result.
 */
function contextIn(dir) {
  let protectedSet;
  let localBranches;
  let headBranch;
  return {
    get protected() {
      if (protectedSet === undefined) protectedSet = protectedBranches(dir);
      return protectedSet;
    },
    get localBranches() {
      if (localBranches === undefined) {
        const out = runGit(["branch", "--format=%(refname:short)"], dir);
        localBranches =
          typeof out === "string"
            ? out
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
            : [];
      }
      return localBranches;
    },
    get headBranch() {
      if (headBranch === undefined) {
        const out = runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
        const name = typeof out === "string" ? out.trim() : "";
        headBranch = name === "" || name === "HEAD" ? null : name;
      }
      return headBranch;
    },
  };
}

function run() {
  const payload = readPayload();
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || command === "") return ALLOW;

  // The substring gate, before any tokenizing. `Bash` is the hottest tool call in the
  // product and this hook is on that path unconditionally.
  if (!command.includes("git")) return ALLOW;

  const projectDir = gitDir(payload, null);
  if (!hooksEnabled(projectDir)) return ALLOW;

  // ONE CONTEXT PER REPOSITORY THE COMMAND NAMES. `-C` is consumed here rather than
  // parsed and discarded: resolving `git -C ../other push --force …` against THIS
  // project's branches and HEAD judged a push in a repository the guard never looked
  // at, and because the unresolved case fell back to the current branch, the result was
  // a wrong DENY rather than a fail-open. The kill switch above stays deliberately on
  // the project directory — a subdirectory must not be able to disarm the guard.
  const contexts = new Map();
  const contextFor = (chdir) => {
    const dir = gitDir(payload, chdir);
    let ctx = contexts.get(dir);
    if (ctx === undefined) {
      ctx = contextIn(dir);
      contexts.set(dir, ctx);
    }
    return ctx;
  };

  const verdict = inspect(command, contextFor);
  if (verdict.allow) return ALLOW;
  return deny(HOOK_NAME, [
    verdict.reason,
    "Fix the underlying failure instead, or re-run without the flag.",
  ]);
}

if (isMain(import.meta.url)) main(HOOK_NAME, run);
