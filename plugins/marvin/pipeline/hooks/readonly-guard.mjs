#!/usr/bin/env node
/**
 * readonly-guard — the verifier and retro sessions read; they never write.
 *
 * Every context `execContexts` finds is judged, so a writer inside `$(…)` or after a
 * lone `&` is seen, and a redirect is read from the raw segment with its quotes, so an
 * attached (`>file`), `&>`, `>|`, `>&file` or quoted target is a write like any other.
 * The `dontAsk` allowlist remains the primary boundary for read-only roles.
 */
import { gitSubcommand, isMain, readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, pipelineMain } from "./lib/deny.mjs";
import { commandSegments, commandStart, execContexts, programName, words } from "./lib/shell.mjs";

const GIT_READ = new Set([
  "diff",
  "log",
  "show",
  "status",
  "ls-files",
  "merge-base",
  "rev-parse",
  "blame",
  "cat-file",
  "grep",
  "describe",
  "shortlog",
]);
const WRITERS = new Set([
  "rm",
  "mv",
  "cp",
  "touch",
  "mkdir",
  "rmdir",
  "chmod",
  "chown",
  "ln",
  "tee",
  "truncate",
  "dd",
  "install",
  "patch",
]);
const GH_READ = new Set(["pr view", "pr diff", "pr checks", "run view", "run list"]);
const SAFE_REDIRECT_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);
const SNAPSHOT_UPDATE = /^(-u|--update|--updateSnapshot|--update-snapshots?)(=.*)?$/;

/** `--name` or an unambiguous prefix of it at least `min` letters long, `=value` allowed. */
function abbreviates(text, full, min) {
  if (!text.startsWith("--")) return false;
  const name = text.slice(2).split("=")[0];
  return name.length >= min && full.startsWith(name);
}

/** `-XPUT`, `--method=PUT`, `--field=…`, `--raw-field=…`, `--input=…` as separated forms. */
function separateAttached(args) {
  return args.flatMap((w) => {
    const long = /^(--method|--field|--raw-field|--input)=(.*)$/s.exec(w);
    if (long) return [long[1], long[2]];
    const short = /^(-X|-f|-F)(.+)$/s.exec(w);
    return short ? [short[1], short[2]] : [w];
  });
}

function runsTests(program, rest, all) {
  if (
    program === "vitest" ||
    program === "jest" ||
    all.includes("vitest") ||
    all.includes("jest")
  ) {
    return true;
  }
  if (!/^(npm|pnpm|yarn|bun)$/.test(program)) return false;
  const [first = "", second = ""] = rest;
  return /^(t|test)$/.test(first) || (/^(run|run-script)$/.test(first) && /^test/.test(second));
}

/** The word starting at `at`, quotes removed; it ends at whitespace or an operator. */
function readWord(segment, at) {
  let word = "";
  let quote = null;
  let i = at;
  for (; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/[\s;&|<>()]/.test(ch)) break;
    word += ch;
  }
  return { word, end: i };
}

/** The first unquoted redirect target other than /dev/null and the std streams, or null. */
function redirectTarget(segment) {
  let quote = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch !== ">") continue;
    let j = i + 1;
    if (segment[j] === ">" || segment[j] === "|") {
      j += 1;
    } else if (segment[j] === "&") {
      if (/^(\d+|-)(?=$|[\s;&|<>()])/.test(segment.slice(j + 1))) {
        i = j;
        continue;
      }
      j += 1;
    }
    while (segment[j] === " " || segment[j] === "\t") j += 1;
    const { word, end } = readWord(segment, j);
    if (!SAFE_REDIRECT_TARGETS.has(word)) return word || "a file";
    i = end - 1;
  }
  return null;
}

function segmentViolation(segment) {
  const { command } = commandStart(words(segment));
  const all = command.map((t) => t.text);
  const [, ...rest] = all;
  const program = command.length > 0 ? programName(command[0]) : "";
  if (program === "git") {
    const git = gitSubcommand([{ text: "git", quoted: false }, ...command.slice(1)]);
    if (git && !GIT_READ.has(git.name)) return `git ${git.name} is not read-only`;
    const args = git ? all.slice(git.index + 1) : [];
    if (args.some((a) => abbreviates(a, "output", 2)))
      return `git ${git.name} --output writes a file`;
    if (
      git?.name === "grep" &&
      args.some((a) => a.startsWith("-O") || abbreviates(a, "open-files-in-pager", 2))
    ) {
      return "git grep -O runs a pager command";
    }
  }
  if (WRITERS.has(program)) return `${program} writes to the filesystem`;
  if (
    (program === "sed" || program === "perl") &&
    rest.some((w) => w.startsWith("-i") || w.startsWith("--in-place"))
  ) {
    return `${program} -i edits in place`;
  }
  if (
    /^(npm|pnpm|yarn)$/.test(program) &&
    /^(i|install|ci|add|remove|uninstall|update|link)$/.test(rest[0] ?? "")
  ) {
    return `${program} ${rest[0]} changes dependencies`;
  }
  if (all.includes("--write") || all.includes("--fix"))
    return "formatter or fixer flags write files";
  if (runsTests(program, rest, all) && all.some((w) => SNAPSHOT_UPDATE.test(w))) {
    return "snapshot updates write files";
  }
  if (program === "gh") {
    if (rest[0] === "api") {
      const args = separateAttached(rest.slice(1));
      const m = args.findIndex((w) => w === "-X" || w === "--method");
      if (m >= 0 && (args[m + 1] ?? "").toUpperCase() !== "GET")
        return "gh api with a non-GET method";
      if (args.some((w) => ["-f", "-F", "--field", "--raw-field", "--input"].includes(w))) {
        return "gh api with a request body";
      }
      return "gh api is not available to pipeline children";
    }
    const sub = `${rest[0] ?? ""} ${rest[1] ?? ""}`.trim();
    if (!GH_READ.has(sub)) return `gh ${sub} is not a read`;
  }
  const target = redirectTarget(segment);
  return target === null ? null : `output redirection writes ${target}`;
}

/**
 * Why `command` would write from a read-only session, or null.
 *
 * @param {string} command
 * @returns {string | null}
 */
export function readonlyViolation(command) {
  if (typeof command !== "string") return "the command is unreadable";
  const { contexts, malformed } = execContexts(command);
  if (malformed)
    return "an unterminated or ambiguous substitution or heredoc hides what the command runs";
  for (const context of contexts) {
    for (const segment of commandSegments(context)) {
      const why = segmentViolation(segment);
      if (why) return why;
    }
  }
  return null;
}

if (isMain(import.meta.url)) {
  pipelineMain("readonly-guard", () => {
    const command = readPayload()?.tool_input?.command;
    const why =
      typeof command === "string" ? readonlyViolation(command) : "the Bash call carries no command";
    return why
      ? denyPipeline("readonly-guard", [
          `This session is read-only: ${why}.`,
          "Report the problem as a finding instead of changing anything.",
        ])
      : 0;
  });
}
