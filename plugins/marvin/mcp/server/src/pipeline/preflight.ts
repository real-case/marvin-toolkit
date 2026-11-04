import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a run worktree needs before any child spends anything, checked by `prepare` from the
 * worktree's own files. A run worktree lies outside the repository (D18), so it has no
 * `node_modules` of its own and none above it to walk up to: a project whose gates need its
 * dependencies gets them only from `pipeline.bootstrap`. Five runs in two repositories
 * (2026-10-20/21) were configured without one; each found out at its first gate, after the
 * planner and often the executor had run, and stopped there.
 */

/** A package manager known by its lockfile, with the bootstrap that installs from it. */
interface Manager {
  lockfiles: readonly string[];
  install: string;
  /** The command a writing role runs this manager's scripts with. */
  runner: string;
}

const MANAGERS: readonly Manager[] = [
  { lockfiles: ["bun.lock", "bun.lockb"], install: "bun install --frozen-lockfile", runner: "bun" },
  { lockfiles: ["pnpm-lock.yaml"], install: "pnpm install --frozen-lockfile", runner: "pnpm" },
  { lockfiles: ["yarn.lock"], install: "yarn install --immutable", runner: "yarn" },
  { lockfiles: ["package-lock.json", "npm-shrinkwrap.json"], install: "npm ci", runner: "npm" },
];

/** The package manager whose lockfile the worktree root holds, the first in `MANAGERS` order. */
export function packageManager(worktree: string): Manager | null {
  return MANAGERS.find((m) => m.lockfiles.some((f) => existsSync(join(worktree, f)))) ?? null;
}

/** Whether the root `package.json` declares any dependency; an unreadable one counts as none. */
function declaresDependencies(worktree: string): boolean {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(worktree, "package.json"), "utf8"));
  } catch {
    return false;
  }
  if (typeof manifest !== "object" || manifest === null) return false;
  return ["dependencies", "devDependencies", "optionalDependencies"].some((key) => {
    const deps = (manifest as Record<string, unknown>)[key];
    return typeof deps === "object" && deps !== null && Object.keys(deps).length > 0;
  });
}

/**
 * Why the run cannot install what its gates need, or null: a root `package.json` with
 * dependencies, no `node_modules` beside it and no bootstrap to make one. The answer names the
 * bootstrap the lockfile calls for.
 */
export function dependencyGap(worktree: string, bootstrap: string | null): string | null {
  if (bootstrap) return null;
  if (existsSync(join(worktree, "node_modules"))) return null;
  if (!declaresDependencies(worktree)) return null;
  const manager = packageManager(worktree);
  const suggestion = manager ? ` (\`${manager.install}\` for its ${manager.runner} lockfile)` : "";
  return `the run worktree has no node_modules and no pipeline.bootstrap installs them, so no gate and no child can run the project's tests: set pipeline.bootstrap${suggestion}`;
}

/**
 * Why the writing roles cannot run the project's own scripts, or null: its lockfile is another
 * manager's than npm's and no `allowed_commands` prefix starts with that manager. The executor
 * then cannot run a single test before the gate does, as in a bun repository's 2026-10-20 runs.
 */
export function runnerGap(worktree: string, allowed: readonly string[]): string | null {
  const manager = packageManager(worktree);
  if (!manager || manager.runner === "npm") return null;
  const covers = (prefix: string) =>
    prefix === manager.runner || prefix.startsWith(`${manager.runner} `);
  if (allowed.some(covers)) return null;
  return `the project's lockfile is ${manager.runner}'s, and pipeline.allowed_commands has no \`${manager.runner}\` prefix, so the planner, test-author and executor cannot run its scripts: add \`${manager.runner} run\``;
}
