/**
 * hook-io — the shared substrate of marvin's two blocking `PreToolUse` guards.
 *
 * ADR-0040 binds the guards; this module owns every decision that must not diverge
 * between them: the tokenizer, the kill switch, the git runner and the directory it
 * runs in, the deny payload, and the outermost catch.
 *
 * THE EXIT CONTRACT. `0` = allow, `2` = deny (stderr is fed back to Claude), and any
 * other non-zero is a *non-blocking* error the host surfaces without stopping the
 * call. These guards deliberately produce only 0 and 2.
 *
 * WHY EVERY ERROR PATH EXITS 0, in the record's own two reasons — not the proposal's,
 * which measured false and must not be repeated here:
 *   1. Noise at the hottest call site. An internal error exiting non-zero emits a
 *      non-blocking error on EVERY `Bash` call in every project. A guard that is
 *      broken and loud is worse than one that is broken and silent.
 *   2. Exit 2 must stay reachable only deliberately. Any path that can reach it by
 *      accident silently converts a broken guard into a blocker.
 *
 * Every export here is either pure or explicitly effectful, and named so a test can
 * import it without running a guard.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 32 MB rather than node's 1 MB default. An ordinary large diff crosses 1 MB, and
 * `execFileSync` turns that into a throw, which `runGit` turns into a silent allow —
 * a guard that stops guarding on exactly the commits worth guarding. Above 32 MB the
 * fail-open remains, and is named as a residual limitation in the spec's Design Notes.
 */
export const GIT_MAX_BUFFER = 32 * 1024 * 1024;

/** The line every deny payload ends with, so a blocked user always has both escapes. */
export const KILL_SWITCH_NOTE =
  'To disable marvin\'s hooks: set "hooks": { "enabled": false } in .marvin/config.json, ' +
  "or export MARVIN_HOOKS_DISABLED=1 for this session.";

/** Allow / deny as the two integers the host understands. */
export const ALLOW = 0;
export const DENY = 2;

// ── stdin ───────────────────────────────────────────────────────────────────

/**
 * The `PreToolUse` payload, or null when stdin is unreadable, empty, not JSON, or
 * not a JSON object. Null is an allow, never an error.
 *
 * @returns {Record<string, any> | null}
 */
export function readPayload() {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── the tokenizer: one scanner, two consumers with opposite needs ────────────

/*
 * QUOTE SPANS DO NOT NEST, in both scanners below: the first opener wins, so a `'`
 * inside a double-quoted span is a literal character that closes nothing, and the
 * reverse likewise.
 *
 * That single rule is what makes the shipped heredoc commit form resolve correctly:
 *
 *   git commit -m "$(cat <<'EOF'
 *   ... --no-verify ...
 *   EOF
 *   )"
 *
 * The `"` opens a span the inner `'EOF'` cannot close, so `splitSegments` never cuts
 * the body into segments, `tokenize` yields ONE quoted token spanning its newlines,
 * Hook A never reads its contents as flags, and Hook B never reads them as a pathspec.
 */

/** The shell separators a command line is cut on, longest first so `&&` beats `|`. */
const SEPARATORS = ["&&", "||", ";", "|", "\n"];

/**
 * Read a heredoc redirection at `at`, where `command.startsWith("<<", at)`.
 *
 * `<<` and `<<-` only; `<<<` is a herestring, whose word is data on the SAME line and
 * so needs nothing here. The delimiter may be quoted (`<<'EOF'`, `<<"EOF"`) or bare
 * (`<<EOF`) — the quoting changes only whether the shell expands the body, never where
 * the body ends, which is all this scanner needs.
 *
 * @param {string} command
 * @param {number} at Index of the first `<`.
 * @returns {{delimiter: string, stripTabs: boolean, end: number} | null} null when the
 *   text is not a heredoc redirection, in which case the caller scans on unchanged.
 */
function heredocRedirect(command, at) {
  if (!command.startsWith("<<", at) || command.startsWith("<<<", at)) return null;
  let i = at + 2;
  let stripTabs = false;
  if (command[i] === "-") {
    stripTabs = true;
    i += 1;
  }
  while (command[i] === " " || command[i] === "\t") i += 1;
  const quote = command[i];
  if (quote === "'" || quote === '"') {
    const close = command.indexOf(quote, i + 1);
    if (close === -1) return null;
    return { delimiter: command.slice(i + 1, close), stripTabs, end: close + 1 };
  }
  let j = i;
  while (j < command.length && /[A-Za-z0-9_.-]/.test(command[j])) j += 1;
  if (j === i) return null;
  return { delimiter: command.slice(i, j), stripTabs, end: j };
}

/**
 * Advance past the bodies of the heredocs opened on the line just ended, in the order
 * they were opened, and return the index the next command starts at.
 *
 * An UNTERMINATED heredoc consumes the rest of the string. That is the safe direction:
 * the alternative is judging a body as commands, which is the false denial this whole
 * function exists to stop.
 *
 * @param {string} command
 * @param {number} from Index just past the newline that ended the opening line.
 * @param {Array<{delimiter: string, stripTabs: boolean}>} pending
 * @returns {number}
 */
function skipHeredocBodies(command, from, pending) {
  let at = from;
  for (const { delimiter, stripTabs } of pending) {
    while (at < command.length) {
      const newline = command.indexOf("\n", at);
      const end = newline === -1 ? command.length : newline;
      const line = command.slice(at, end);
      at = newline === -1 ? command.length : newline + 1;
      if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
    }
  }
  return at;
}

/**
 * Split a command line into segments on the shell separators OUTSIDE quotes, so each
 * segment can be judged as its own invocation. A quoted separator is message text.
 *
 * A HEREDOC BODY IS NOT COMMANDS, and this is where that is decided. A newline is a
 * separator and a heredoc's delimiter word closes its own quotes before it, so
 * `cat > doc.md <<'EOF'` used to cut every body line into its own segment: a document
 * that merely SHOWS `git push --force origin main` — which this repository's own
 * `docs/configuration.md` must, to document what the guard blocks — was denied as if it
 * performed one. Skipping the body is not merely the safe direction here, it is the
 * correct reading: those lines are written to a file, not run.
 *
 * Its cost is a missed bypass in `bash <<'EOF' … EOF`, where the body IS executed. One
 * skipped check, never a block on a command that does nothing.
 *
 * The shipped heredoc COMMIT form is untouched, and for a different reason: there the
 * `<<` sits inside a double-quoted span, so the scanner never reaches this branch and
 * the whole `"$(cat <<'EOF' … )"` stays one token, exactly as before.
 *
 * @param {string} command
 * @returns {string[]}
 */
export function splitSegments(command) {
  if (typeof command !== "string" || command === "") return [];
  const segments = [];
  let start = 0;
  let i = 0;
  let quote = null;
  let pending = [];
  while (i < command.length) {
    const ch = command[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "<") {
      // Read the redirection whole, so a quoted delimiter never opens a quote span.
      const heredoc = heredocRedirect(command, i);
      if (heredoc !== null) {
        pending.push(heredoc);
        i = heredoc.end;
        continue;
      }
    }
    const hit = SEPARATORS.find((sep) => command.startsWith(sep, i));
    if (hit) {
      segments.push(command.slice(start, i));
      i += hit.length;
      if (hit === "\n" && pending.length > 0) {
        i = skipHeredocBodies(command, i, pending);
        pending = [];
      }
      start = i;
      continue;
    }
    i += 1;
  }
  segments.push(command.slice(start));
  return segments.filter((segment) => segment.trim() !== "");
}

/**
 * Split one segment into `{text, quoted}` tokens. `quoted` is true when ANY character
 * of the token came from inside a quoted span — the exact mechanism behind ADR-0040's
 * "after quoted strings are stripped".
 *
 * The two consumers need opposite things from the same scan: Hook A must IGNORE
 * anything quoted (a quoted `--no-verify` is message text), while Hook B must READ
 * quoted values (a quoted pathspec is a real path). One tokenizer serves both; two
 * hand-rolled parsers would drift on the first edge case.
 *
 * Backslash escapes are deliberately not interpreted. They can only ever split a
 * token further or leave a stray character in it, so they subtract matches rather
 * than adding them — the safe direction for a guard that must never deny wrongly.
 *
 * @param {string} segment
 * @returns {Array<{text: string, quoted: boolean}>}
 */
export function tokenize(segment) {
  if (typeof segment !== "string") return [];
  const tokens = [];
  let text = "";
  let quoted = false;
  let started = false;
  let quote = null;
  const flush = () => {
    if (!started) return;
    tokens.push({ text, quoted });
    text = "";
    quoted = false;
    started = false;
  };
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      text += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    text += ch;
    started = true;
  }
  flush();
  return tokens;
}

// ── git's own grammar ───────────────────────────────────────────────────────

/**
 * Git's global options that consume the FOLLOWING token as their value. An option
 * whose value is attached with `=` needs no entry here.
 *
 * This is a table, and a table rots — but only about git's own *global* options,
 * which have been stable for a decade, and its failure mode is benign: an unlisted
 * value-taking option makes its value look like the subcommand, which yields a
 * subcommand no guard matches, which is an allow. Nothing downstream reads an option
 * table; the two places that would have needed one (a commit pathspec, a push target)
 * are resolved by properties of git's grammar instead.
 */
const GIT_GLOBAL_VALUE_OPTIONS = new Set([
  "-c",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--attr-source",
]);

/** True when `token` invokes git, whether bare or by path. */
function isGitToken(token) {
  if (token.quoted) return false;
  const text = token.text;
  return text === "git" || text.endsWith("/git");
}

/**
 * A leading `VAR=value` assignment. Assignments are the only thing that legitimately
 * precedes a command in a segment, so they are stepped over rather than ending the scan.
 */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Walk git's global options and return the subcommand plus the value of the last
 * `-C <dir>` seen, or null when the segment does not INVOKE git.
 *
 * THE GIT TOKEN MUST BE THE SEGMENT'S FIRST TOKEN, after any leading `VAR=value`
 * assignments. Locating it anywhere in the segment turns a mention into an invocation:
 * `echo git push --force origin main` pushes nothing, and `# never use git commit -n`
 * on its own line — a newline is a separator and comments are not stripped — is a
 * comment, yet both resolved to a subcommand and reached exit 2. A mention is not an
 * invocation, and multi-line `Bash` calls carrying comments are routine.
 *
 * The rule's cost is a missed bypass wherever a wrapper precedes git (`sudo git …`,
 * `xargs git …`) or the invocation is nested in a substitution. That is the safe
 * direction: one skipped check, never a block on a command that does nothing.
 *
 * `-C` is the one global option whose value is KEPT rather than discarded. Parsing it
 * and then dropping it — which "skip git's global options" quietly invites — would
 * make `git -C sub commit -a` scan the wrong repository and fail open.
 *
 * @param {Array<{text: string, quoted: boolean}>} tokens
 * @returns {{name: string, chdir: string | null, index: number} | null}
 */
export function gitSubcommand(tokens) {
  if (!Array.isArray(tokens)) return null;
  let at = 0;
  while (at < tokens.length && ENV_ASSIGNMENT.test(tokens[at]?.text ?? "")) at += 1;
  if (at >= tokens.length || !isGitToken(tokens[at])) return null;
  let chdir = null;
  for (let i = at + 1; i < tokens.length; i += 1) {
    const { text } = tokens[i];
    if (text === "") continue;
    if (text[0] !== "-") return { name: text, chdir, index: i };
    if (text === "-C") {
      const value = tokens[i + 1];
      if (value === undefined) return null;
      chdir = value.text;
      i += 1;
      continue;
    }
    if (text.startsWith("-C") && text.length > 2) {
      chdir = text.slice(2);
      continue;
    }
    if (GIT_GLOBAL_VALUE_OPTIONS.has(text)) {
      i += 1;
      continue;
    }
    // `--git-dir=…`, `--no-pager`, `--paginate`, `--bare`, and every other valueless
    // or `=`-attached global option: skipped and discarded.
  }
  return null;
}

/**
 * Git's short options that take NO argument, per subcommand. Every letter absent from a
 * row is either an option that CONSUMES the rest of the token as its value (commit's
 * `-c`/`-C`/`-F`/`-m`/`-t`/`-u`/`-S`, push's `-o`) or one this module does not claim to
 * know.
 *
 * Rows are per subcommand because the same letter differs between them: `-o` is
 * commit's valueless `--only` and push's value-taking `--push-option`.
 */
const NO_ARG_SHORT_FLAGS = {
  commit: "aeinopqsvz",
  merge: "enqv",
  push: "dfnquv",
};

/**
 * The letters of an all-alpha short bundle, read left to right and stopping at the
 * first letter that is not a known no-argument short flag for `subcommand`. `""` for
 * anything that is not such a bundle.
 *
 * THE STOP IS THE WHOLE POINT, and it is what the naive `/^-[A-Za-z]+$/` got wrong.
 * `git commit -uno` is `--untracked-files=no`, a documented invocation git accepts;
 * reading it as a bundle found an `-n` the user never typed and denied the commit.
 * Measured the same way: `-Cmain`, `-Fnotes`, `-mn`, `-Sjohn` on commit, and
 * `git push -ofoo origin main` — a NON-force push to main — denied as a force.
 *
 * An unrecognised letter therefore means "the shape is unknown, so read nothing
 * further": a letter that takes an attached value swallows everything after it, so no
 * letter beyond the first unknown one can be trusted to be a flag. Both directions of
 * the table's incompleteness are safe — a missing no-argument letter shortens the read
 * and yields an allow, and a value-taking letter is simply never listed.
 *
 * @param {string} arg One argument token's text.
 * @param {string} subcommand `"commit"`, `"merge"` or `"push"`.
 * @returns {string} The flag letters, e.g. `"n"` for `-nm` and `""` for `-uno`.
 */
export function bundleFlags(arg, subcommand) {
  if (typeof arg !== "string" || arg.length < 2 || arg[0] !== "-" || arg[1] === "-") return "";
  const known = NO_ARG_SHORT_FLAGS[subcommand];
  if (known === undefined) return "";
  let letters = "";
  for (const letter of arg.slice(1)) {
    if (!known.includes(letter)) break;
    letters += letter;
  }
  return letters;
}

/**
 * True when `args` carries the short flag `letter` for `subcommand`, alone or inside a
 * bundle. The one reading of `-am` both guards share, so they cannot drift on it.
 *
 * @param {string[]} args Unquoted argument texts.
 * @param {string} subcommand
 * @param {string} letter A single letter.
 * @returns {boolean}
 */
export function hasShortFlag(args, subcommand, letter) {
  if (!Array.isArray(args)) return false;
  return args.some((arg) => bundleFlags(arg, subcommand).includes(letter));
}

/**
 * The directory every git call runs in: `CLAUDE_PROJECT_DIR`, else the payload's
 * `cwd`, else `process.cwd()`, with the segment's `-C <dir>` resolved against it.
 *
 * @param {Record<string, any> | null} payload
 * @param {string | null} chdir
 * @returns {string}
 */
export function gitDir(payload, chdir) {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  const fromPayload = typeof payload?.cwd === "string" ? payload.cwd : "";
  const base = fromEnv || fromPayload || process.cwd();
  if (typeof chdir !== "string" || chdir === "") return base;
  return isAbsolute(chdir) ? chdir : resolve(base, chdir);
}

/**
 * Run git and return its stdout, or null on ANY failure — a non-zero exit, a missing
 * binary, a directory that is not a repository, or a buffer overrun. Never throws.
 *
 * @param {string[]} args
 * @param {string} cwd Always a `gitDir` result; never `process.cwd()` reached implicitly.
 * @returns {string | null}
 */
export function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

// ── the kill switch ─────────────────────────────────────────────────────────

/**
 * The second, independent raw-JSON config reader ADR-0040 §4 fixes. It returns false
 * ONLY for `MARVIN_HOOKS_DISABLED === "1"` exactly, or a config whose `hooks.enabled`
 * is the boolean `false`. An absent, unreadable or malformed file, a config with no
 * `hooks` block, an unrecognised key under `hooks`, and any other value all mean
 * ENABLED — a guard that disarms itself on a JSON typo is worse than no guard.
 *
 * It deliberately never reads `MARVIN_TASKS_CONFIG`. That variable is set in the
 * marvin server's `env` block in `.mcp.json`, so it scopes to the server and is absent
 * from a hook's environment; honouring it on the one path where it is not dead — a
 * session that happens to export it — would let a *test-isolation affordance* decide
 * which file a blocking guard reads. `docs/configuration.md` states the divergence.
 *
 * @param {string} projectDir The PROJECT directory, never a `-C` target: a
 *   subdirectory must not be able to disarm the guard.
 * @returns {boolean}
 */
export function hooksEnabled(projectDir) {
  if (process.env.MARVIN_HOOKS_DISABLED === "1") return false;
  let raw;
  try {
    raw = readFileSync(join(projectDir, ".marvin", "config.json"), "utf8");
  } catch {
    return true;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (typeof parsed !== "object" || parsed === null) return true;
  const hooks = parsed.hooks;
  if (typeof hooks !== "object" || hooks === null) return true;
  // Forward-compatible by construction: only `enabled` is recognised, and only the
  // boolean `false` disables, so a later `hooks.<guard>.enabled` is a pure addition.
  return hooks.enabled !== false;
}

// ── the deny payload ────────────────────────────────────────────────────────

/**
 * Write the fixed deny payload and return the deny code. The FIRST line is the
 * contract the tests assert on, so the wording below it can improve freely.
 *
 * `writeSync` rather than `process.stderr.write`: a piped stderr write is not
 * guaranteed to have flushed when `process.exit` runs, and a deny whose reason never
 * reaches the transcript is a block nobody can diagnose.
 *
 * @param {string} hookName
 * @param {string[]} lines First entry is the reason; the rest are detail.
 * @returns {2}
 */
export function deny(hookName, lines) {
  const [reason, ...detail] = lines;
  const payload = [`marvin:hook:${hookName}: BLOCKED - ${reason}`, ...detail, KILL_SWITCH_NOTE];
  try {
    writeSync(2, `${payload.join("\n")}\n`);
  } catch {
    // A guard that cannot write its reason still denies; the host reports exit 2.
  }
  return DENY;
}

// ── the outermost wrapper ───────────────────────────────────────────────────

/**
 * The only entry point either guard has. `run` is called inside a catch that swallows
 * EVERYTHING — this is where ADR-0040 §3's "an unexpected exception" clause is
 * discharged, and the one place in either guard where a bare catch may swallow
 * silently. No guard has a top-level statement outside it.
 *
 * Anything other than the exact deny code becomes exit 0, so a helper that returns
 * `undefined`, a string, or a stray truthy value cannot become a block.
 *
 * @param {string} _hookName
 * @param {() => number} run
 * @returns {never}
 */
export function main(_hookName, run) {
  let code;
  try {
    code = run();
  } catch {
    code = ALLOW;
  }
  process.exit(code === DENY ? DENY : ALLOW);
}

/**
 * The house main-guard predicate: run directly → execute, imported → export only.
 *
 * Total, because it is the ONE expression each guard evaluates outside `main`'s catch.
 * A throw here would escape that catch entirely; returning false instead means the
 * worst case is a guard that declines to run, which is an allow.
 */
export function isMain(url) {
  try {
    return Boolean(process.argv[1]) && url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}
