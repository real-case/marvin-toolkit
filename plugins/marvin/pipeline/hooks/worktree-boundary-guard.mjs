#!/usr/bin/env node
import { isAbsolute, relative, resolve } from "node:path";
import { deny, main, readPayload } from "../../hooks/lib/hook-io.mjs";

main("worktree-boundary-guard", () => {
  const input = readPayload()?.tool_input ?? {};
  const target = input.file_path ?? input.notebook_path;
  const root = process.env.CLAUDE_PROJECT_DIR;
  if (typeof target !== "string" || !root) return 0;
  const rel = relative(root, resolve(root, target));
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  return inside
    ? 0
    : deny("worktree-boundary-guard", [
        `${target} is outside this run's worktree (${root}).`,
        "Edit files only inside the worktree; never the main checkout.",
      ]);
});
