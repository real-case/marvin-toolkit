import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

const { classifyCi } = await importTs("src/pipeline/ci.ts");
const pr = (o = {}) => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  headRefOid: "abc",
  ...o,
});
const run = (o = {}) => ({
  head_sha: "abc",
  status: "completed",
  conclusion: "success",
  name: "tests",
  ...o,
});
const c = (p, runs, minutes = 1) =>
  classifyCi({ pr: p, runs, minutesSincePush: minutes, noCiAfterMinutes: 10 });

test("a conflicting PR is a conflict, never pending", () => {
  assert.equal(
    c(pr({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), []).state,
    "conflict",
  );
});

test("runs for other commits do not count", () => {
  assert.equal(c(pr(), [run({ head_sha: "old" })]).state, "pending");
  assert.equal(c(pr(), [run({ head_sha: "old" })], 15).state, "no_ci");
});

test("in-progress, red, green and closed", () => {
  assert.equal(c(pr(), [run({ status: "in_progress", conclusion: null })]).state, "pending");
  const red = c(pr(), [run(), run({ name: "lint", conclusion: "failure" })]);
  assert.deepEqual([red.state, red.failing], ["red", ["lint"]]);
  assert.equal(c(pr(), [run(), run({ name: "e2e", conclusion: "skipped" })]).state, "green");
  assert.equal(c(pr({ state: "MERGED" }), []).state, "closed");
});

const { prFromRest } = await importTs("src/pipeline/ci.ts");
const { parsePrUrl } = await importTs("src/pipeline/github.ts");
const { childEnvironment, SESSION_IDENTITY_VARIABLES } = await importTs("src/pipeline/launch.ts");
const rest = (o = {}) => ({
  state: "open",
  merged: false,
  draft: false,
  mergeable: true,
  mergeable_state: "clean",
  head: { sha: "abc", ref: "feature/x" },
  base: { ref: "dev" },
  ...o,
});

test("a REST pull request reads as the shape classifyCi has always judged", () => {
  assert.deepEqual(prFromRest(rest()), pr());
  assert.equal(
    c(prFromRest(rest({ mergeable: false, mergeable_state: "dirty" })), []).state,
    "conflict",
  );
  assert.equal(c(prFromRest(rest({ state: "closed", merged: true })), []).state, "closed");
  assert.equal(c(prFromRest(rest({ state: "closed" })), []).state, "closed");
  // GitHub still computing mergeability is neither a conflict nor a block on green.
  const unknown = prFromRest(rest({ mergeable: null, mergeable_state: "unknown" }));
  assert.equal(unknown.mergeable, "UNKNOWN");
  assert.equal(c(unknown, [run()]).state, "green");
});

test("a pull request URL names its repository and number, and nothing else parses", () => {
  assert.deepEqual(parsePrUrl("https://github.com/o/r/pull/12"), {
    owner: "o",
    repo: "r",
    number: 12,
  });
  assert.deepEqual(parsePrUrl("https://github.com/o/r.js/pull/3/files"), {
    owner: "o",
    repo: "r.js",
    number: 3,
  });
  for (const bad of ["https://github.com/o/r/issues/1", "o/r#1", "https://github.com/o/r/pull/0"]) {
    assert.equal(parsePrUrl(bad), null, bad);
  }
});

test("a child's environment drops the parent's session identity and keeps the rest", () => {
  const parent = {
    PATH: "/bin",
    ANTHROPIC_BASE_URL: "https://proxy",
    CLAUDE_SESSION_INGRESS_TOKEN_FILE: "/run/token",
    CLAUDE_CODE_MESSAGING_SOCKET: "/run/sock",
    CLAUDE_CODE_MESSAGING_TOKEN: "t",
    ...Object.fromEntries(SESSION_IDENTITY_VARIABLES.map((k) => [k, "parent"])),
  };
  const env = childEnvironment(parent, { MARVIN_PIPELINE: "1" });
  for (const k of SESSION_IDENTITY_VARIABLES) assert.equal(env[k], undefined, k);
  assert.deepEqual(
    [env.PATH, env.ANTHROPIC_BASE_URL, env.CLAUDE_SESSION_INGRESS_TOKEN_FILE],
    ["/bin", "https://proxy", "/run/token"],
  );
  assert.deepEqual(
    [env.CLAUDE_CODE_MESSAGING_SOCKET, env.CLAUDE_CODE_MESSAGING_TOKEN],
    ["/run/sock", "t"],
  );
  assert.equal(env.MARVIN_PIPELINE, "1");
  assert.equal(
    parent.CLAUDE_CODE_SESSION_ID,
    "parent",
    "the engine's own environment is untouched",
  );
});
