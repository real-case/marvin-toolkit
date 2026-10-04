import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

export function repoWithOrigin(files = { "package-lock.json": "{}\n" }) {
  const root = mkdtempSync(join(tmpdir(), "pipe-git-"));
  const origin = join(root, "origin.git");
  sh(root, "init", "--bare", "-b", "dev", origin);
  const repo = join(root, "repo");
  sh(root, "clone", origin, repo);
  sh(repo, "config", "user.email", "t@t");
  sh(repo, "config", "user.name", "t");
  for (const [path, body] of Object.entries(files)) writeFileSync(join(repo, path), body);
  sh(repo, "add", ".");
  sh(repo, "commit", "-m", "init");
  sh(repo, "push", "origin", "HEAD:dev");
  return repo;
}
