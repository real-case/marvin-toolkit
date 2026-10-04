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

export function childGitViolation(command, base) {
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    const words = tokens.map((t) => t.text);
    if (words[0] === "gh" && words[1] === "pr" && (words[2] === "merge" || words[2] === "ready"))
      return `gh pr ${words[2]} belongs to the pipeline`;
    const git = gitSubcommand(tokens);
    if (!git) continue;
    const args = words.slice(git.index + 1);
    if (git.name === "switch" || git.name === "worktree")
      return `git ${git.name} leaves the run's branch`;
    if (git.name === "checkout" && !args.includes("--"))
      return "git checkout without `--` switches branches";
    if (git.name === "branch" && args.some((a) => /^-(m|M|d|D)$/.test(a)))
      return "renaming or deleting branches belongs to the pipeline";
    if (git.name === "push") {
      if (args.some((a) => a === "-f" || a.startsWith("--force") || a.startsWith("+")))
        return "force-push is not allowed; merge the base branch instead of rebasing";
      if (args.some((a) => a === base || a.endsWith(`:${base}`) || a === "main"))
        return `pushing to ${base}/main is not allowed`;
    }
  }
  return null;
}

if (isMain(import.meta.url)) {
  main("child-git-guard", () => {
    const command = readPayload()?.tool_input?.command;
    if (typeof command !== "string") return 0;
    const why = childGitViolation(command, process.env.MARVIN_PIPELINE_BASE ?? "dev");
    return why ? deny("child-git-guard", [`Pipeline child: ${why}.`]) : 0;
  });
}
