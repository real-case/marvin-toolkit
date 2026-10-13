import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

const g = await importTs("src/pipeline/gate.ts");

const KEPT = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_SSH_COMMAND",
  "GIT_TERMINAL_PROMPT",
];
const DROPPED = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_REPLACE_REF_BASE",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_SOMETHING_GIT_ADDS_LATER",
];

test("the hardened git env keeps identity and config location, and drops what names a repository", () => {
  const inherited = { PATH: "/bin", HOME: "/h" };
  for (const key of [...KEPT, ...DROPPED]) inherited[key] = `v-${key}`;
  const env = g.hardenedGitEnv({}, inherited);
  for (const key of KEPT) assert.equal(env[key], `v-${key}`, `${key} is kept`);
  for (const key of DROPPED.filter((k) => k !== "GIT_NO_REPLACE_OBJECTS")) {
    assert.equal(env[key], undefined, `${key} is dropped`);
  }
  assert.equal(env.GIT_NO_REPLACE_OBJECTS, "1", "object replacement stays off");
  assert.equal(env.PATH, "/bin");
  assert.equal(env.HOME, "/h");
  for (const key of KEPT) assert.ok(g.GIT_ENV_KEPT.has(key), `${key} is on the allowlist`);
});

/**
 * Runs `body` with `process.env` replaced: every inherited `GIT_*` variable removed, `HOME` and
 * `XDG_CONFIG_HOME` pointed at an empty directory whose `.gitconfig` turns identity
 * auto-detection off, so only what `vars` supplies can name the committer, on any host.
 */
function withHostEnv(vars, body) {
  const saved = { ...process.env };
  const home = mkdtempSync(join(tmpdir(), "pipe-git-env-home-"));
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
  Object.assign(process.env, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    ...vars(home),
  });
  try {
    return body();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/** A repository with no identity in its own config and one staged-to-be file. */
function bareRepo() {
  const repo = mkdtempSync(join(tmpdir(), "pipe-git-env-repo-"));
  execFileSync("git", ["init", "-q", "-b", "dev", repo], {
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", HOME: repo },
  });
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "test", "clamp.test.mjs"), "// sealed\n");
  return repo;
}

/** The seal commit as the engine makes it: through `isolatedGit`, `--only` the sealed path. */
function sealCommit(repo) {
  const git = g.isolatedGit(repo, join(repo, ".git"), { GIT_LITERAL_PATHSPECS: "1" });
  git.text("add", "--", "test/clamp.test.mjs");
  git.text("commit", "-q", "-m", "test(clamp): sealed", "--only", "--", "test/clamp.test.mjs");
  return git.text("log", "-1", "--format=%an <%ae>|%cn <%ce>").trim();
}

test("with no identity anywhere the seal commit fails: the controls below prove something", () => {
  const repo = bareRepo();
  withHostEnv(
    () => ({}),
    () => assert.throws(() => sealCommit(repo), /identity|email|ident/i),
  );
});

test("a seal commit succeeds with an empty HOME and identity only in GIT_CONFIG_GLOBAL", () => {
  const repo = bareRepo();
  const who = withHostEnv(
    (home) => {
      const path = join(home, "host-gitconfig");
      writeFileSync(path, "[user]\n\tname = Host CI\n\temail = ci@example.com\n");
      return { GIT_CONFIG_GLOBAL: path };
    },
    () => sealCommit(repo),
  );
  assert.equal(who, "Host CI <ci@example.com>|Host CI <ci@example.com>");
});

test("a seal commit succeeds with an empty HOME and identity only in GIT_AUTHOR_*/GIT_COMMITTER_*", () => {
  const repo = bareRepo();
  const who = withHostEnv(
    () => ({
      GIT_AUTHOR_NAME: "Author Env",
      GIT_AUTHOR_EMAIL: "author@example.com",
      GIT_COMMITTER_NAME: "Committer Env",
      GIT_COMMITTER_EMAIL: "committer@example.com",
    }),
    () => sealCommit(repo),
  );
  assert.equal(who, "Author Env <author@example.com>|Committer Env <committer@example.com>");
});
