// vercel-ignore.test.mjs (spec 015, F3 → AC5) — the build-skip decision, unit-tested.
//
// shouldBuild classifies which changed paths force a site rebuild; exitCodeFor maps that decision
// onto Vercel's Ignored-Build-Step contract (exit 1 ⇒ build, exit 0 ⇒ skip). Both are pure, so they
// run on both CI legs with no git fixture. The CLI's git shell-out is deliberately NOT unit-tested
// (it cannot be exercised without a repository fixture — see the F2 script header); the mapping it
// relies on IS, which is the part that inverts the whole deploy if it is wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldBuild, exitCodeFor, WATCHED } from "../scripts/vercel-ignore.mjs";

test("shouldBuild builds when any changed path is under a watched tree", () => {
  assert.equal(shouldBuild(["packages/site/src/pages/index.astro"]), true);
  assert.equal(shouldBuild(["packages/marvin-mcp-shared/src/help-content.ts"]), true);
  assert.equal(shouldBuild(["plugins/marvin/mcp/server/src/prompts/index.ts"]), true);
  assert.equal(shouldBuild(["plugins/marvin/widgets/help.html"]), true);
  // packages/marvin-widgets/ is the fourth tree: gen-widget-demos.mjs reads its fixtures into the
  // committed demo JSON the site renders, so a fixture-only edit must rebuild (spec 015 SPEC GAP).
  assert.equal(shouldBuild(["packages/marvin-widgets/src/widgets/help/fixture.ts"]), true);
  // one watched path among unrelated ones is enough to force a build
  assert.equal(
    shouldBuild(["README.md", "docs/design/website-progress.md", "packages/site/astro.config.mjs"]),
    true,
  );
});

test("shouldBuild skips when no changed path is under a watched tree", () => {
  assert.equal(shouldBuild(["README.md"]), false);
  assert.equal(shouldBuild(["docs/design/website-progress.md"]), false);
  assert.equal(shouldBuild([".github/workflows/validate-plugins.yml"]), false);
  assert.equal(shouldBuild([]), false); // empty diff — nothing changed under our reach
});

test("shouldBuild matches on a path PREFIX, not a bare substring", () => {
  // A prefix match is deliberate: a path that merely CONTAINS "packages/site/" mid-string (a
  // sibling workspace, or an unrelated file) must not count as a rebuild trigger.
  assert.equal(shouldBuild(["packages/site-notes/readme.md"]), false);
  assert.equal(shouldBuild(["docs/packages/site/notes.md"]), false);
});

test("exitCodeFor maps the build decision onto Vercel's exit-code contract", () => {
  assert.equal(exitCodeFor(true), 1); // build
  assert.equal(exitCodeFor(false), 0); // skip
});

test("WATCHED names exactly the four trees the built site derives from", () => {
  assert.deepEqual([...WATCHED].sort(), [
    "packages/marvin-mcp-shared/",
    "packages/marvin-widgets/",
    "packages/site/",
    "plugins/marvin/",
  ]);
});
