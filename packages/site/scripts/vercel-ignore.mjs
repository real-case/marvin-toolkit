// Vercel "Ignored Build Step" (spec 015, F2 — AC5). Vercel runs this before every build and reads
// its EXIT CODE: exit 1 ⇒ build, exit 0 ⇒ skip. We rebuild only when a change can affect what the
// built site shows, and fail OPEN (build) on any uncertainty — a skipped-but-stale site is far worse
// than a redundant build.
//
// Wired via the repo-root vercel.json `ignoreCommand`. `shouldBuild` / `exitCodeFor` / `WATCHED` are
// pure and unit-tested (packages/site/test/vercel-ignore.test.mjs); the git shell-out below is the
// only impure part and runs only when this file is executed directly.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// The built site derives from four trees. FR-20 names three — the site workspace itself, the shared
// help-content the catalog reads, and the plugin sources (prompts, plugin.json, and the committed
// widgets) the catalog is generated from. The fourth is packages/marvin-widgets/: gen-widget-demos.mjs
// reads its src/widgets/<name>/fixture.ts files DIRECTLY into the committed demo JSON that the Toolbox
// and Home demos render, so a fixture-only edit there changes the deployed site with no other watched
// file touched. A change under any of these can change the rendered output, so any must trigger a
// rebuild. Deliberately over-inclusive — whole trees, not the exact source files — because a redundant
// build is cheap and a missed one ships a stale site. (The sealed spec-015 contract lists three trees;
// the fourth is a recorded SPEC GAP — gen-widget-demos' fixture read was missed at authoring time.)
export const WATCHED = [
  "packages/site/",
  "packages/marvin-mcp-shared/",
  "packages/marvin-widgets/",
  "plugins/marvin/",
];

/** True ⇒ build (Vercel exit 1); false ⇒ skip (exit 0). */
export function shouldBuild(changedPaths) {
  return changedPaths.some((path) => WATCHED.some((prefix) => path.startsWith(prefix)));
}

/** Map a build decision onto Vercel's exit-code contract: build ⇒ 1, skip ⇒ 0. */
export function exitCodeFor(build) {
  return build ? 1 : 0;
}

// Run the git diff + exit only when invoked as the entrypoint, so the test can import the pure
// functions above without side effects. The `process.argv[1] &&` guard matches the sibling gen-*
// scripts and avoids a pathToFileURL(undefined) throw if this is ever imported with no argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Vercel exposes the last successfully-built commit as VERCEL_GIT_PREVIOUS_SHA; diffing against it
  // (rather than HEAD^) means a branch push whose relevant change sits in a non-tip commit is not
  // under-diffed into a wrongful skip. HEAD^ is the fallback for the very first build.
  const base = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";
  let changed;
  try {
    // execFileSync (no shell) so `base` can only ever be a git revision argument, never interpreted.
    changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    process.exit(1); // fail open: build when we cannot determine the diff
  }
  process.exit(exitCodeFor(shouldBuild(changed)));
}
