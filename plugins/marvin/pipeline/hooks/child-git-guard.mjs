#!/usr/bin/env node
/**
 * child-git-guard — keeps every pipeline child on its run branch.
 *
 * A child may follow instructions injected through repository content, so the rules are
 * allowlists wherever git's grammar allows one: `git push` has exactly one accepted
 * shape, `git checkout` restores paths only, `git branch` and `git config` read only,
 * `gh` runs a fixed set of PR/run subcommands, and a git subcommand the guard does not
 * know — possibly an alias for `switch` — is refused. Around that sit the forms that
 * would carry git past those rules: wrappers and interpreters, subshells, substitutions,
 * a quoted or escaped command name, `git -c`/`-C`/`--git-dir`, environment overrides
 * (`GIT_CONFIG_*`, `GIT_DIR`, `HOME`, `PATH`), and a `cd` before git.
 *
 * What it cannot see: a script or package script the child wrote and then runs, shell
 * aliases and functions from the user's shell snapshot, and a symlinked directory the
 * shell sits in (the hook checks the payload's `cwd` for that). The role's permission
 * allowlist and `--setting-sources project` stay the primary boundary; this guard is
 * the deterministic second line, and it fails closed.
 */
import { isAbsolute, resolve } from "node:path";
import { gitSubcommand, isMain, readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, pipelineMain } from "./lib/deny.mjs";
import { physicalPath, relativeInside } from "./lib/paths.mjs";
import {
  ASSIGNMENT,
  GIT_WORD,
  commandSegments,
  commandStart,
  execContexts,
  isDynamic,
  programName,
  withoutRedirects,
  words,
} from "./lib/shell.mjs";

/** Run their arguments as a command (the spec's list, the same kind, and `trap`/`alias`). */
const WRAPPERS = new Set([
  "env",
  "command",
  "exec",
  "nohup",
  "time",
  "sudo",
  "builtin",
  "nice",
  "timeout",
  "stdbuf",
  "setsid",
  "doas",
  "script",
  "watch",
  "caffeinate",
  "unbuffer",
  "chronic",
  "trap",
  "alias",
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "busybox"]);
/** Run inline code; a git/gh word anywhere in their arguments is refused. */
const INTERPRETERS = new Set([
  "node",
  "nodejs",
  "deno",
  "bun",
  "python",
  "python2",
  "python3",
  "perl",
  "ruby",
  "php",
  "lua",
  "osascript",
  "awk",
  "gawk",
  "nawk",
  "sed",
  "vim",
  "vi",
  "nvim",
  "ex",
]);
/** Run a shell string through `-c`/`--call`. */
const PACKAGE_RUNNERS = new Set(["npx", "npm", "pnpm", "pnpx", "yarn", "bunx"]);
const ALWAYS_DENIED = new Map([
  ["eval", "eval runs a command the guard cannot read"],
  ["xargs", "xargs assembles its command from input the guard cannot read"],
]);
const DIR_CHANGERS = new Set(["cd", "pushd", "popd"]);
const EXPORTERS = new Set(["export", "declare", "typeset", "local", "readonly", "env"]);

/** Variables that can redirect what git or gh does, reads or runs. */
const SENSITIVE_ENV =
  /^(GIT_\w*|GH_\w*|PATH|HOME|XDG_CONFIG_HOME|XDG_CONFIG_DIRS|EDITOR|VISUAL|PAGER|BASH_ENV|ENV|LD_PRELOAD|DYLD_\w*)$/;
/** The harmless settings of a few of them. */
const SAFE_ENV = new Map([
  ["GIT_TERMINAL_PROMPT", /^0$/],
  ["GIT_PAGER", /^(cat)?$/],
  ["GH_PAGER", /^(cat)?$/],
  ["PAGER", /^(cat)?$/],
  ["GIT_EDITOR", /^(true|:)$/],
  ["GIT_SEQUENCE_EDITOR", /^(true|:)$/],
  ["GH_PROMPT_DISABLED", /^(1|true)$/],
  ["GH_NO_UPDATE_NOTIFIER", /^(1|true)$/],
]);

/** Valueless global options that change nothing about which repository or config git uses. */
const SAFE_GLOBALS = new Set([
  "--no-pager",
  "-P",
  "--no-optional-locks",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
  "--no-replace-objects",
  "--no-advice",
  "--version",
  "--help",
]);

/** Subcommands with no rule of their own: they act on the run's own branch and tree. */
const GIT_FREE = new Set([
  "add",
  "am",
  "apply",
  "blame",
  "cat-file",
  "check-attr",
  "check-ignore",
  "cherry",
  "cherry-pick",
  "clean",
  "commit",
  "count-objects",
  "describe",
  "diff",
  "diff-files",
  "diff-index",
  "diff-tree",
  "for-each-ref",
  "format-patch",
  "help",
  "log",
  "ls-files",
  "ls-tree",
  "merge",
  "merge-base",
  "mv",
  "name-rev",
  "range-diff",
  "reset",
  "restore",
  "rev-list",
  "rev-parse",
  "revert",
  "rm",
  "shortlog",
  "show",
  "show-branch",
  "show-ref",
  "status",
  "verify-commit",
  "verify-tag",
  "version",
  "whatchanged",
]);

const GIT_DENIED = new Map([
  ["switch", "git switch leaves the run's branch"],
  ["worktree", "git worktree belongs to the pipeline"],
  ["symbolic-ref", "git symbolic-ref moves HEAD off the run's branch"],
  ["update-ref", "git update-ref rewrites a branch the pipeline owns"],
]);

const GH_ALLOWED = new Set([
  "pr create",
  "pr view",
  "pr edit",
  "pr diff",
  "pr checks",
  "pr list",
  "run view",
  "run list",
]);

const texts = (tokens) => tokens.map((t) => t.text);

/** `--name` or an unambiguous prefix of it at least `min` letters long, `=value` allowed. */
function abbreviates(text, full, min) {
  if (!text.startsWith("--")) return false;
  const name = text.slice(2).split("=")[0];
  return name.length >= min && full.startsWith(name);
}

function envViolation(text) {
  const eq = text.indexOf("=");
  if (eq < 1) return null;
  const name = text.slice(0, eq);
  if (!SENSITIVE_ENV.test(name)) return null;
  if (SAFE_ENV.get(name)?.test(text.slice(eq + 1))) return null;
  return `setting ${name} can redirect what git or gh does`;
}

// ── git subcommands with a rule ─────────────────────────────────────────────

function pushViolation(args, { branch }) {
  const t = texts(args);
  let i = 0;
  while (t[i] === "-u" || t[i] === "--set-upstream") i += 1;
  if (t[i] === "origin") i += 1;
  if (i < t.length) {
    const allowed = new Set(["HEAD"]);
    if (branch !== "") {
      for (const form of [
        `HEAD:${branch}`,
        `HEAD:refs/heads/${branch}`,
        branch,
        `refs/heads/${branch}`,
      ]) {
        allowed.add(form);
      }
    }
    if (allowed.has(t[i]) && !isDynamic(args[i])) i += 1;
  }
  if (i === t.length) return null;
  return (
    `\`git push ${t.join(" ")}\` is not the allowed form — ` +
    `git push [-u|--set-upstream] [origin] [HEAD${branch ? ` | HEAD:${branch} | ${branch}` : ""}]`
  );
}

const CONFIG_READS = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"]);
const CONFIG_WRITES = new Set([
  "--add",
  "--unset",
  "--unset-all",
  "--replace-all",
  "--rename-section",
  "--remove-section",
  "-e",
  "--edit",
]);

function configViolation(args) {
  const t = texts(args);
  const reads = t.some((a) => CONFIG_READS.has(a));
  if (!reads || t.some((a) => CONFIG_WRITES.has(a)) || args.some(isDynamic)) {
    return "git config may only read (--get, --get-all, --get-regexp, --list)";
  }
  return null;
}

const CHECKOUT_OPTIONS = new Set([
  "-q",
  "--quiet",
  "-f",
  "--force",
  "--ours",
  "--theirs",
  "-m",
  "--merge",
  "-p",
  "--patch",
  "--overlay",
  "--no-overlay",
  "--progress",
  "--no-progress",
  "--ignore-skip-worktree-bits",
]);

function checkoutViolation(args) {
  const separator = args.findIndex((a) => a.text === "--");
  const restoresPaths = separator !== -1 && separator < args.length - 1;
  const before = args.slice(0, Math.max(separator, 0));
  const unsafe = before.some(
    (a) =>
      isDynamic(a) ||
      (a.text.startsWith("-") &&
        !CHECKOUT_OPTIONS.has(a.text) &&
        !a.text.startsWith("--conflict=")),
  );
  if (!restoresPaths || unsafe) {
    return "git checkout may only restore paths (`git checkout [<tree-ish>] -- <path>…`); it never switches branches";
  }
  return null;
}

const BRANCH_FLAGS = new Set([
  "--show-current",
  "--list",
  "-l",
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-v",
  "-vv",
]);
const BRANCH_FILTERS = ["--contains", "--merged", "--no-merged"];
/** Flags that put `git branch` in list mode, where a positional is a pattern, not a name. */
const BRANCH_LIST_MODE = new Set(["--list", "-l", "-v", "-vv", ...BRANCH_FILTERS]);

function branchViolation(args) {
  let listMode = false;
  let positional = false;
  for (const arg of args) {
    const t = arg.text;
    if (isDynamic(arg)) return "git branch with an argument the guard cannot read";
    if (BRANCH_FLAGS.has(t) || BRANCH_FILTERS.includes(t)) {
      if (BRANCH_LIST_MODE.has(t)) listMode = true;
    } else if (BRANCH_FILTERS.some((f) => t.startsWith(`${f}=`))) {
      listMode = true;
    } else if (t.startsWith("-")) {
      return `git branch ${t} changes branches; children may only list them`;
    } else {
      positional = true;
    }
  }
  if (positional && !listMode)
    return "git branch <name> creates a branch; children may only list them";
  return null;
}

function uploadPack(t) {
  return abbreviates(t, "upload-pack", 2) || t === "-u" || abbreviates(t, "update-head-ok", 4);
}

const fetchViolation = (name) => (args) => {
  for (const arg of args) {
    const t = arg.text;
    if (isDynamic(arg)) return `git ${name} with an argument the guard cannot read`;
    if (uploadPack(t)) return `git ${name} ${t} runs a command or moves the current branch`;
    if (!t.startsWith("-") && t.includes(":"))
      return `git ${name} ${t} writes a local ref or reads a URL`;
  }
  return null;
};

function lsRemoteViolation(args) {
  const bad = args.find((a) => isDynamic(a) || uploadPack(a.text));
  return bad ? `git ls-remote ${bad.text} runs a command` : null;
}

function grepViolation(args) {
  const bad = args.find(
    (a) => isDynamic(a) || a.text.startsWith("-O") || abbreviates(a.text, "open-files-in-pager", 2),
  );
  return bad ? `git grep ${bad.text} can run a pager command` : null;
}

function remoteViolation(args) {
  const [first, ...rest] = texts(args);
  if (first === undefined) return null;
  if ((first === "-v" || first === "--verbose") && rest.length === 0) return null;
  if ((first === "get-url" || first === "show") && !args.some(isDynamic)) return null;
  return "git remote may only be listed or shown; changing a remote redirects every push";
}

function stashViolation(args) {
  const first = args[0]?.text;
  if ((first === "list" || first === "show") && !args.some(isDynamic)) return null;
  return "the stash is shared by every worktree of the repository; children may only list or show it";
}

function reflogViolation(args) {
  const bad = args.find((a) => isDynamic(a) || ["expire", "delete", "drop"].includes(a.text));
  return bad ? `git reflog ${bad.text} rewrites history the main checkout shares` : null;
}

const GIT_RULES = new Map([
  ["push", pushViolation],
  ["config", configViolation],
  ["checkout", checkoutViolation],
  ["branch", branchViolation],
  ["fetch", fetchViolation("fetch")],
  ["pull", fetchViolation("pull")],
  ["ls-remote", lsRemoteViolation],
  ["grep", grepViolation],
  ["remote", remoteViolation],
  ["stash", stashViolation],
  ["reflog", reflogViolation],
]);

function gitViolation(command, run) {
  const tokens = [{ text: "git", quoted: false }, ...command.slice(1)];
  const sub = gitSubcommand(tokens);
  for (const token of tokens.slice(1, sub ? sub.index : tokens.length)) {
    if (token.text.startsWith("-c") || abbreviates(token.text, "config-env", 3)) {
      return "git -c overrides the repository's configuration";
    }
    if (!SAFE_GLOBALS.has(token.text)) {
      return `git ${token.text} points git at another repository, config or program; run git from the worktree root`;
    }
  }
  if (sub === null) return null;
  const name = sub.name;
  if (!/^[a-z][a-z0-9-]*$/.test(name) || isDynamic(tokens[sub.index])) {
    return `the git subcommand \`${name}\` cannot be read`;
  }
  if (GIT_DENIED.has(name)) return GIT_DENIED.get(name);
  const rule = GIT_RULES.get(name);
  if (rule) return rule(tokens.slice(sub.index + 1), run);
  if (GIT_FREE.has(name)) return null;
  return `git ${name} is not available to pipeline children (an unknown subcommand may be an alias)`;
}

// ── gh ───────────────────────────────────────────────────────────────────────

/** Values of `--long v`, `--long=v`, `-S v` and `-Sv`. */
function flagValues(t, long, short) {
  const values = [];
  for (let i = 0; i < t.length; i += 1) {
    const a = t[i];
    if (a === long || a === short) values.push(t[i + 1] ?? "");
    else if (a.startsWith(`${long}=`)) values.push(a.slice(long.length + 1));
    else if (a.startsWith(short) && !a.startsWith("--") && a.length > 2) values.push(a.slice(2));
  }
  return values;
}

function ghViolation(command, { base, branch }) {
  const t = texts(command.slice(1));
  const sub = `${t[0] ?? ""} ${t[1] ?? ""}`.trim();
  if (!GH_ALLOWED.has(sub) || command.slice(1, 3).some(isDynamic)) {
    return `gh ${sub} is not available to pipeline children (gh pr create|view|edit|diff|checks|list, gh run view|list only)`;
  }
  if (sub !== "pr create" && sub !== "pr edit") return null;
  const rest = t.slice(2);
  if (rest.some((a) => /^-[A-Za-z]*[BHR]/.test(a) && !/^-[BHR]/.test(a))) {
    return `gh ${sub} with a bundled -B/-H/-R flag the guard cannot read`;
  }
  if (flagValues(rest, "--repo", "-R").length > 0)
    return `gh ${sub} --repo targets another repository`;
  const bases = flagValues(rest, "--base", "-B");
  if (sub === "pr create" && bases.length === 0) {
    return `gh pr create must name the run's base: --base ${base || "<base>"}`;
  }
  if (bases.some((b) => base === "" || b !== base)) {
    return `gh ${sub} may only target the run's base (${base || "unknown"})`;
  }
  const heads = sub === "pr create" ? flagValues(rest, "--head", "-H") : [];
  if (heads.some((h) => branch === "" || h !== branch)) {
    return `gh pr create may only open a PR from the run branch (${branch || "unnamed yet"})`;
  }
  return null;
}

// ── segments ─────────────────────────────────────────────────────────────────

function isGitOrGh(token) {
  const name = programName(token);
  return name === "git" || name === "gh";
}

/** `-c`, `-lc`, `-s`, operands: does this shell read its commands from stdin? */
function shellReadsStdin(args) {
  let operand = false;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i].text;
    if (t.startsWith("<")) return true;
    if (/^[-+][oO]$/.test(t)) {
      i += 1;
      continue;
    }
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) return false;
    if (/^-[A-Za-z]*[si][A-Za-z]*$/.test(t)) return true;
    if (!t.startsWith("-") && !t.startsWith("+")) operand = true;
  }
  return !operand;
}

function segmentViolation(segment, run, state) {
  const tokens = withoutRedirects(words(segment));
  const { assignments, command } = commandStart(tokens);
  for (const assignment of assignments) {
    const why = envViolation(assignment.text);
    if (why) return why;
    if (command.length === 0 && GIT_WORD.test(assignment.text)) {
      return "a variable holding a git/gh command hides what later runs";
    }
  }
  if (tokens.some((t) => t.escaped && isGitOrGh(t))) {
    return "an escaped git/gh name bypasses the command the guard checks";
  }
  const [head, ...rest] = command;
  if (head === undefined) return null;
  if (head.text.startsWith("(")) return "a subshell hides the commands it runs; run them directly";
  if (isDynamic(head))
    return "a command name built from a variable or substitution cannot be checked";
  const program = programName(head);
  if (DIR_CHANGERS.has(program)) state.dirChanges.push({ program, args: rest });
  if (EXPORTERS.has(program)) {
    for (const t of rest) {
      const why = ASSIGNMENT.test(t.text) ? envViolation(t.text) : null;
      if (why) return why;
      if (program !== "env" && GIT_WORD.test(t.text)) {
        return "a variable holding a git/gh command hides what later runs";
      }
    }
  }
  if (program === "git") {
    state.git = true;
    return gitViolation(command, run);
  }
  if (program === "gh") {
    state.git = true;
    return ghViolation(command, run);
  }
  if (ALWAYS_DENIED.has(program)) return ALWAYS_DENIED.get(program);
  if (WRAPPERS.has(program) || SHELLS.has(program) || INTERPRETERS.has(program)) {
    if (rest.some((t) => GIT_WORD.test(t.text))) return `wrapped git/gh invocation (${program})`;
    if (!INTERPRETERS.has(program) && rest.some(isDynamic)) {
      return `${program} runs an argument the guard cannot read`;
    }
    if (SHELLS.has(program) && shellReadsStdin(rest)) {
      return `${program} would run commands from its input, which the guard cannot read`;
    }
    return null;
  }
  if (PACKAGE_RUNNERS.has(program)) {
    const inline = flagValues(texts(rest), "--call", "-c");
    if (inline.some((code) => GIT_WORD.test(code) || /[$`]/.test(code))) {
      return `wrapped git/gh invocation (${program} -c)`;
    }
  }
  const late = rest.find(
    (t) => !t.quoted && isGitOrGh(t) && (t.text.startsWith("/") || /^(git|gh)$/i.test(t.text)),
  );
  return late ? `${late.text} runs inside \`${head.text}\`; run git/gh as its own command` : null;
}

/**
 * A directory change in a command that also runs git/gh is allowed only when it is a
 * single plain `cd <dir>` whose physical target lies inside the worktree — the common
 * `cd <worktree> && git status`. Anything the guard cannot resolve is refused: several
 * changes (each relative to the last), `pushd`/`popd`, `cd -`, a dynamic target, or a
 * call without the worktree and the shell's directory to resolve against. The target must
 * be inside both as a logical `cd` reads `..` (lexically) and as a physical one does.
 */
function dirChangeViolation(dirChanges, { root, cwd }) {
  const refusal =
    "git/gh after cd/pushd/popd may act on another checkout; run git from the worktree root";
  if (dirChanges.length !== 1 || typeof root !== "string" || root === "") return refusal;
  if (typeof cwd !== "string" || cwd === "") return refusal;
  const [{ program, args }] = dirChanges;
  if (program !== "cd" || args.length !== 1 || isDynamic(args[0]) || args[0].text.startsWith("-")) {
    return refusal;
  }
  const dir = args[0].text;
  const realRoot = physicalPath(resolve(root));
  const readings = [isAbsolute(dir) ? dir : `${cwd}/${dir}`, resolve(cwd, dir)];
  return readings.every((path) => relativeInside(physicalPath(path), realRoot) !== null)
    ? null
    : refusal;
}

/**
 * Why `command` would take a pipeline child off its run branch, or null.
 *
 * @param {string} command The Bash tool's command.
 * @param {{base: string, branch: string, root?: string, cwd?: string}} run The run's base
 *   branch and its own branch (`""` while it has none: then only `HEAD` may be pushed);
 *   with the worktree `root` and the shell's `cwd`, one `cd` into the worktree is allowed.
 * @returns {string | null}
 */
export function childGitViolation(command, run) {
  const base = typeof run?.base === "string" ? run.base : "";
  const branch = typeof run?.branch === "string" ? run.branch : "";
  if (typeof command !== "string") return "the command is unreadable";
  const { contexts, malformed } = execContexts(command);
  if (malformed)
    return "an unterminated or ambiguous substitution or heredoc hides what the command runs";
  const state = { dirChanges: [], git: false };
  for (const context of contexts) {
    for (const segment of commandSegments(context)) {
      const why = segmentViolation(segment, { base, branch }, state);
      if (why) return why;
    }
  }
  if (state.git && state.dirChanges.length > 0) {
    return dirChangeViolation(state.dirChanges, { root: run?.root, cwd: run?.cwd });
  }
  return null;
}

/** A git/gh command run from a shell that has left the worktree acts on another checkout. */
function cwdViolation(command, cwd, root) {
  if (!GIT_WORD.test(command)) return null;
  if (typeof cwd !== "string" || cwd === "" || typeof root !== "string" || root === "") {
    return "the shell's working directory is unknown, so git/gh cannot be confined to the worktree";
  }
  const inside = relativeInside(physicalPath(resolve(cwd)), physicalPath(resolve(root)));
  return inside === null
    ? `the shell's working directory (${cwd}) is outside the run's worktree`
    : null;
}

if (isMain(import.meta.url)) {
  pipelineMain("child-git-guard", () => {
    const payload = readPayload();
    const command = payload?.tool_input?.command;
    const env = process.env;
    const why =
      typeof command === "string"
        ? (childGitViolation(command, {
            base: env.MARVIN_PIPELINE_BASE ?? "",
            branch: env.MARVIN_PIPELINE_BRANCH ?? "",
            root: env.CLAUDE_PROJECT_DIR,
            cwd: payload?.cwd,
          }) ?? cwdViolation(command, payload?.cwd, env.CLAUDE_PROJECT_DIR))
        : "the Bash call carries no command";
    return why
      ? denyPipeline("child-git-guard", [
          `Pipeline child: ${why}.`,
          "Report the problem in your result instead of working around it.",
        ])
      : 0;
  });
}
