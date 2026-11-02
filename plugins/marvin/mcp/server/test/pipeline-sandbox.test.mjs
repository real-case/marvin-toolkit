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

test("the gh shim plays one draft PR through the REST calls a child makes", () => {
  assert.match(SANDBOX_PR_URL, PR_URL_PATTERN, "the executor's pr_url rule accepts the shim's URL");
  const home = mkdtempSync(join(tmpdir(), "pipe-sandbox-"));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "xdg"),
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

  const PULLS = "repos/{owner}/{repo}/pulls";
  const LOOKUP = `${PULLS}?head={owner}:{branch}&state=open`;
  const api = (...a) => gh("api", ...a);

  const none = api(LOOKUP, "--jq", ".[0].html_url // empty");
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout, "", "no PR yet");
  assert.equal(
    api(PULLS, "-f", "head=feature/x", "-f", "title=t").status,
    1,
    "a PR names its base",
  );

  const body = join(home, "body.md");
  writeFileSync(body, "## Summary\nb\n");
  const open = (...extra) =>
    api(PULLS, "-f", "base=dev", "-f", "head=feature/x", "-f", "title=feat: b", ...extra);
  const created = open("-F", `body=@${body}`, "-F", "draft=true", "--jq", ".html_url");
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.stdout.trim(), SANDBOX_PR_URL);
  assert.match(open().stderr, /already exists/);
  assert.equal(api(LOOKUP, "--jq", ".[0].html_url // empty").stdout.trim(), SANDBOX_PR_URL);

  const view = JSON.parse(api(`${PULLS}/1`).stdout);
  assert.equal(view.html_url, SANDBOX_PR_URL);
  assert.equal(view.draft, true);
  assert.equal(view.body, "## Summary\nb\n");
  assert.deepEqual(view.head, { ref: "feature/x", sha: git("rev-parse", "HEAD") });
  assert.equal(view.base.ref, "dev");
  assert.equal(api(`${PULLS}/1`, "--jq", ".head.ref").stdout.trim(), "feature/x");
  assert.match(api(`${PULLS}/1`, "-H", "Accept: application/vnd.github.diff").stdout, /\+b/);
  assert.deepEqual(JSON.parse(api("repos/{owner}/{repo}/actions/runs?branch=feature/x").stdout), {
    total_count: 0,
    workflow_runs: [],
  });
  assert.equal(gh("pr", "ready", SANDBOX_PR_URL).status, 0);
  assert.equal(JSON.parse(readFileSync(join(runDir, "sandbox-gh.json"), "utf8")).isDraft, false);

  // Anything the shim does not play fails, as the child guard would refuse it.
  for (const call of [
    ["pr", "view"],
    ["pr", "merge"],
    ["api", "graphql"],
    ["api", "-X", "PATCH", `${PULLS}/1`],
  ]) {
    const refused = gh(...call);
    assert.equal(refused.status, 1, call.join(" "));
  }
  assert.match(gh("pr", "view").stderr, /not available in the autopilot sandbox/);
  // Another branch has no PR.
  git("checkout", "-q", "dev");
  assert.equal(api(LOOKUP, "--jq", ".[0].html_url // empty").stdout, "");
  assert.equal(api(`${PULLS}/1`).status, 1);
});
