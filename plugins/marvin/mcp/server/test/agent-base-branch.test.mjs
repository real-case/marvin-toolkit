import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two headless agents target the project's base branch, never a default.
 *
 * `marvin-tm-diff-critic` diffed a branch against a hard-coded `main`, so on a
 * `dev`-based repository its "branch" mode reviewed every commit `dev` held over
 * `main` as part of the task. `marvin-tm-executor` ran `gh pr create` with no
 * `--base`, so the PR targeted whatever GitHub's default branch was. Both now
 * resolve the base the way every marvin tool resolves it (`loadConfig`): the
 * configured `base_branch`, else `origin/HEAD` on a config-less project, else
 * `dev`. Prose read as prose, the pattern `critique-protocol.test.mjs` and
 * `metrics-record.test.mjs` already use for these agents.
 */

const here = dirname(fileURLToPath(import.meta.url));
// test → server → mcp → marvin
const AGENTS = join(here, "..", "..", "..", "agents");
const read = (name) => readFileSync(join(AGENTS, `${name}.md`), "utf8");

/** The three tiers of the shared resolution, each stated where the agent acts on it. */
function assertResolvesBase(body, name) {
  assert.match(body, /`base_branch`/, `${name}: the configured base_branch is not consulted`);
  assert.match(body, /\.marvin\/config\.json/, `${name}: the config file is not named`);
  assert.match(
    body,
    /git symbolic-ref --quiet --short refs\/remotes\/origin\/HEAD/,
    `${name}: no origin/HEAD fallback for a config-less project`,
  );
  assert.match(body, /schema default/, `${name}: the last-resort default is not stated`);
}

test("the diff critic diffs against the resolved base branch, never a hard-coded main", () => {
  const critic = read("marvin-tm-diff-critic");
  assert.doesNotMatch(critic, /merge-base HEAD main\b/, "the hard-coded main is back");
  assert.match(
    critic,
    /git diff \$\(git merge-base HEAD <base-ref>\)\.\.\.HEAD/,
    "branch mode must take its merge base from the resolved ref",
  );
  assertResolvesBase(critic, "marvin-tm-diff-critic");
  // The read-only git surface it states must cover what the resolution runs.
  for (const sub of ["merge-base", "rev-parse", "symbolic-ref"]) {
    assert.match(critic, new RegExp(`\`${sub}\``), `capabilities omit \`git ${sub}\``);
  }
});

test("every gh pr create in the executor targets the resolved base branch", () => {
  const executor = read("marvin-tm-executor");
  // An invocation carries flags; prose that only names the command does not.
  const creates = executor.split("\n").filter((l) => /\bgh pr create --/.test(l));
  assert.ok(creates.length >= 3, "expected the ready, the draft and the blocker invocation");
  for (const line of creates) {
    assert.match(line, /--base "<base>"/, `no --base on: ${line.trim()}`);
  }
  assertResolvesBase(executor, "marvin-tm-executor");
});
