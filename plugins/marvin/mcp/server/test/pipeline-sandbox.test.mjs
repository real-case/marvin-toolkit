import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * Sandbox mode (`src/pipeline/sandbox.ts`): which switch combinations the pipeline honours, and
 * the `gh` shim a live sandbox child finds first on its PATH.
 */

const { SANDBOX_PR_URL, effectiveAssignment, installSandboxGh, sandboxSettings } =
  await importTs("src/pipeline/sandbox.ts");
const { PR_URL_PATTERN } = await importTs("src/pipeline/engine.ts");

test("the override is honoured only in the sandbox, Fable never, and the sandbox needs fake CI", () => {
  assert.deepEqual(sandboxSettings({}), { enabled: false, modelOverride: null });
  assert.deepEqual(sandboxSettings({ MARVIN_PIPELINE_SANDBOX: "0" }), {
    enabled: false,
    modelOverride: null,
  });
  const live = {
    MARVIN_PIPELINE_SANDBOX: "1",
    MARVIN_PIPELINE_FAKE_CI: "green",
    MARVIN_PIPELINE_MODEL_OVERRIDE: "haiku",
  };
  assert.deepEqual(sandboxSettings(live), { enabled: true, modelOverride: "haiku" });
  assert.deepEqual(
    sandboxSettings({ ...live, MARVIN_PIPELINE_MODEL_OVERRIDE: "claude-haiku-4-5" }).modelOverride,
    "claude-haiku-4-5",
  );
  assert.throws(
    () => sandboxSettings({ MARVIN_PIPELINE_MODEL_OVERRIDE: "haiku" }),
    /honoured only with MARVIN_PIPELINE_SANDBOX=1/,
  );
  for (const fable of ["fable", "claude-fable-1", "FaBlE"]) {
    assert.throws(
      () => sandboxSettings({ ...live, MARVIN_PIPELINE_MODEL_OVERRIDE: fable }),
      /Fable is not allowed/,
    );
    // Refused before the mode is looked at, so no combination lets it through silently.
    assert.throws(
      () => sandboxSettings({ MARVIN_PIPELINE_MODEL_OVERRIDE: fable }),
      /Fable is not allowed/,
    );
  }
  assert.throws(
    () => sandboxSettings({ ...live, MARVIN_PIPELINE_MODEL_OVERRIDE: "gpt-5" }),
    /model not allowed/,
  );
  assert.throws(
    () => sandboxSettings({ MARVIN_PIPELINE_SANDBOX: "1" }),
    /needs MARVIN_PIPELINE_FAKE_CI/,
  );
  assert.throws(() => sandboxSettings({ MARVIN_PIPELINE_SANDBOX: "yes" }), /must be 1 or 0/);
});

test("the effective assignment swaps the model only, and only with an override in the sandbox", () => {
  const a = { model: "opus", effort: "xhigh" };
  assert.deepEqual(effectiveAssignment(a, { enabled: true, modelOverride: "haiku" }), {
    model: "haiku",
    effort: "xhigh",
  });
  assert.equal(effectiveAssignment(a, { enabled: true, modelOverride: null }), a);
  assert.equal(effectiveAssignment(a, { enabled: false, modelOverride: "haiku" }), a);
});

test("the gh shim plays one draft PR through view, create, edit, diff and ready", () => {
  assert.match(SANDBOX_PR_URL, PR_URL_PATTERN, "the executor's pr_url rule accepts the shim's URL");
  const home = mkdtempSync(join(tmpdir(), "pipe-sandbox-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\temail = s@example.com\n\tname = S\n");
  const repo = join(home, "repo");
  const git = (...a) => execFileSync("git", a, { cwd: repo, env, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "dev", join(home, "origin.git")], { env });
  execFileSync("git", ["clone", "-q", join(home, "origin.git"), repo], { env, stdio: "ignore" });
  git("checkout", "-q", "-b", "dev");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "base");
  git("push", "-q", "origin", "HEAD:dev");
  git("checkout", "-q", "-b", "feature/x");
  writeFileSync(join(repo, "a.txt"), "b\n");
  git("commit", "-q", "-am", "feat: b");

  const runDir = join(home, "run");
  const shimEnv = { ...env, ...installSandboxGh(runDir) };
  const gh = (...a) => spawnSync("gh", a, { cwd: repo, env: shimEnv, encoding: "utf8" });

  const none = gh("pr", "view");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no pull requests found for branch "feature\/x"/);
  assert.equal(gh("pr", "create", "--title", "t").status, 1, "a PR names its base");

  const body = join(home, "body.md");
  writeFileSync(body, "## Summary\nb\n");
  const created = gh(
    "pr",
    "create",
    "--base",
    "dev",
    "--draft",
    "--title",
    "feat: b",
    "--body-file",
    body,
  );
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.stdout.trim(), SANDBOX_PR_URL);
  assert.match(gh("pr", "create", "--base", "dev").stderr, /already exists/);

  const view = JSON.parse(
    gh("pr", "view", "--json", "url,isDraft,body,headRefOid,baseRefName").stdout,
  );
  assert.deepEqual(view, {
    url: SANDBOX_PR_URL,
    isDraft: true,
    body: "## Summary\nb\n",
    headRefOid: git("rev-parse", "HEAD"),
    baseRefName: "dev",
  });
  assert.equal(
    gh("pr", "view", SANDBOX_PR_URL, "--json", "url", "--jq", ".url").stdout.trim(),
    SANDBOX_PR_URL,
  );
  assert.equal(gh("pr", "edit", "--title", "feat: b2").status, 0);
  assert.equal(JSON.parse(gh("pr", "view", "--json", "title").stdout).title, "feat: b2");
  assert.match(gh("pr", "diff").stdout, /\+b/);
  assert.deepEqual(JSON.parse(gh("pr", "list", "--json", "url").stdout), [{ url: SANDBOX_PR_URL }]);
  assert.equal(gh("pr", "ready").status, 0);
  assert.equal(JSON.parse(readFileSync(join(runDir, "sandbox-gh.json"), "utf8")).isDraft, false);

  // Anything the shim does not play fails, as the child guard would refuse it.
  const merge = gh("pr", "merge");
  assert.equal(merge.status, 1);
  assert.match(merge.stderr, /not available in the autopilot sandbox/);
  // Another branch has no PR.
  git("checkout", "-q", "dev");
  assert.equal(gh("pr", "view").status, 1);
});
