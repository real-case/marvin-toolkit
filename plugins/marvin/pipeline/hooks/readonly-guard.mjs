#!/usr/bin/env node
import {
  deny,
  gitSubcommand,
  isMain,
  main,
  readPayload,
  splitSegments,
  tokenize,
} from "../../hooks/lib/hook-io.mjs";

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
const REDIRECT = /(?:^|\s|\d)>>?\s*(?!&|\/dev\/null)\S/;

export function readonlyViolation(command) {
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    const words = tokens.map((t) => t.text);
    const [head = "", ...rest] = words;
    const git = gitSubcommand(tokens);
    if (git && !GIT_READ.has(git.name)) return `git ${git.name} is not read-only`;
    if (WRITERS.has(head)) return `${head} writes to the filesystem`;
    if ((head === "sed" || head === "perl") && rest.some((w) => w.startsWith("-i")))
      return `${head} -i edits in place`;
    if (
      /^(npm|pnpm|yarn)$/.test(head) &&
      /^(i|install|ci|add|remove|uninstall|update|link)$/.test(rest[0] ?? "")
    )
      return `${head} ${rest[0]} changes dependencies`;
    if (words.includes("--write") || words.includes("--fix"))
      return "formatter or fixer flags write files";
    if (words.includes("vitest") && (words.includes("-u") || words.includes("--update")))
      return "snapshot updates write files";
    if (head === "gh") {
      const sub = `${rest[0] ?? ""} ${rest[1] ?? ""}`.trim();
      if (rest[0] === "api") {
        const m = rest.findIndex((w) => w === "-X" || w === "--method");
        if (m >= 0 && (rest[m + 1] ?? "").toUpperCase() !== "GET")
          return "gh api with a non-GET method";
        if (rest.some((w) => ["-f", "-F", "--field", "--raw-field", "--input"].includes(w)))
          return "gh api with a request body";
      } else if (!GH_READ.has(sub)) {
        return `gh ${sub} is not a read`;
      }
    }
    const bare = tokens
      .filter((t) => !t.quoted)
      .map((t) => t.text)
      .join(" ");
    if (REDIRECT.test(bare)) return "output redirection writes a file";
  }
  return null;
}

if (isMain(import.meta.url)) {
  main("readonly-guard", () => {
    const command = readPayload()?.tool_input?.command;
    if (typeof command !== "string") return 0;
    const why = readonlyViolation(command);
    return why
      ? deny("readonly-guard", [
          `This session is read-only: ${why}.`,
          "Report the problem as a finding instead of changing anything.",
        ])
      : 0;
  });
}
