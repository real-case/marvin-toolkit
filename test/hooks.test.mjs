// Behavioural regression suite for marvin's two blocking PreToolUse guards (ADR-0040).
//
// IT LIVES IN THE ROOT TREE ON PURPOSE. A fixture carrying a credential-shaped string
// under `plugins/marvin/` is installed verbatim into every user's plugin directory,
// where it is found by their secret scanners and by ours. Nothing here writes such a
// string into the repository either: every one is BUILT AT RUNTIME by concatenation,
// inside a `mkdtemp` fixture that is removed again.
//
// TWO LAYERS. The pure exported decision functions carry the command matrix — no
// repository, no shell, no spawned process, so a wrong answer is a one-line diff. The
// spawned runs carry the exit code and the stderr payload, which are the only things a
// pure function cannot prove.
//
// THE SPAWNED RUNS DO NOT HARD-CODE A SCRIPT PATH. They read `hooks/hooks.json`,
// interpolate `${CLAUDE_PLUGIN_ROOT}` against the pack directory, and run the command
// string the manifest actually declares. Nothing else in the suite executes that
// string, so without this a typo in the one line that wires the hooks would ship past
// a green suite (AC10).
//
// EVERY ASSERTION CHECKS THE EXIT CODE *AND* THE PAYLOAD SHAPE. A crashing script also
// exits non-zero, so the code alone cannot tell a deny from a crash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scaffoldLintRoot } from "./_lint-root.mjs";

import {
  gitSubcommand,
  hooksEnabled,
  splitSegments,
  tokenize,
} from "../plugins/marvin/hooks/lib/hook-io.mjs";
import {
  PROTECTED_DEFAULTS,
  inspect,
  protectedBranches,
} from "../plugins/marvin/hooks/bypass-guard.mjs";
import {
  SECRET_PATTERNS,
  pendingDiffArgs,
  scanAddedLines,
} from "../plugins/marvin/hooks/secret-guard.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(repoRoot, "plugins", "marvin");
const hooksManifest = join(packDir, "hooks", "hooks.json");

const BLOCKED = /^marvin:hook:(bypass-guard|secret-guard): BLOCKED - /;

/** A credential-shaped string, assembled here so no literal enters the repository. */
const FAKE_AWS_KEY = `AKIA${"Q7X2M4B9K1TDLW3Z"}`;
const FAKE_GITHUB_TOKEN = `gh${"p"}_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}`;

// ── fixtures ────────────────────────────────────────────────────────────────

const temporary = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `marvin-hooks-${prefix}-`));
  temporary.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/** A real git repository with one commit on `main`, so a diff has something to be against. */
function makeRepo() {
  const dir = scratch("repo");
  const run = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  run("init", "--quiet", "--initial-branch=main");
  run("config", "user.email", "fixture@example.invalid");
  run("config", "user.name", "fixture");
  run("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n");
  run("add", "README.md");
  run("commit", "--quiet", "-m", "seed");
  return { dir, run };
}

/**
 * The command each hook entry DECLARES, with the plugin-root variable interpolated.
 * Parsed from the manifest so a typo in the wiring reddens a test instead of shipping.
 */
function declaredCommands() {
  const manifest = JSON.parse(readFileSync(hooksManifest, "utf8"));
  const entries = [];
  for (const matcher of manifest.hooks.PreToolUse) {
    for (const hook of matcher.hooks) {
      entries.push({
        raw: hook.command,
        command: hook.command.split("${CLAUDE_PLUGIN_ROOT}").join(packDir),
        timeout: hook.timeout,
      });
    }
  }
  return entries;
}

/**
 * Run one declared hook command with a PreToolUse payload on stdin. The base
 * environment is scrubbed of the kill switch so a developer who exported it cannot
 * turn every deny assertion in this file green.
 */
function runHook(command, { cwd, env = {}, payload }) {
  const base = { ...process.env, CLAUDE_PROJECT_DIR: cwd };
  delete base.MARVIN_HOOKS_DISABLED;
  const result = spawnSync("/bin/sh", ["-c", command], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...base, ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function payloadFor(command, cwd) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    cwd,
    tool_input: { command },
  };
}

/** The two guards, addressed by name, through the manifest. */
function hookNamed(name) {
  const found = declaredCommands().find((entry) => entry.raw.includes(`${name}.mjs`));
  assert.ok(found, `hooks.json declares no command for ${name}`);
  return found.command;
}

/**
 * Assert a deny: exit 2, the fixed prefix, the kill-switch sentence, and no stack
 * frame. The exit code alone proves nothing — a crashing script also exits non-zero.
 */
function assertDenied(result, label = "") {
  assert.equal(
    result.status,
    2,
    `${label} expected exit 2, got ${result.status}\n${result.stderr}`,
  );
  const [first] = result.stderr.split("\n");
  assert.match(first, BLOCKED);
  assert.match(result.stderr, /MARVIN_HOOKS_DISABLED=1/);
  assert.ok(
    !result.stderr.includes("\n    at "),
    `${label} deny payload carries a stack frame:\n${result.stderr}`,
  );
}

/** Assert an allow: exit 0 and no BLOCKED payload at all. */
function assertAllowed(result, label = "") {
  assert.equal(
    result.status,
    0,
    `${label} expected exit 0, got ${result.status}\n${result.stderr}`,
  );
  assert.ok(
    !BLOCKED.test(result.stderr),
    `${label} allow path wrote a BLOCKED payload:\n${result.stderr}`,
  );
}

// ── the tokenizer, which both guards stand on ───────────────────────────────

test("the tokenizer records quoting per token and never lets a quote span nest", () => {
  const tokens = tokenize(`git commit -m "stop using --no-verify"`);
  assert.deepEqual(
    tokens.map((t) => [t.text, t.quoted]),
    [
      ["git", false],
      ["commit", false],
      ["-m", false],
      ["stop using --no-verify", true],
    ],
  );

  // The product's own heredoc commit form. The inner `'EOF'` must not close the `"`
  // span, so the whole body is ONE quoted token and its newlines never split it.
  const heredoc = `git commit -m "$(cat <<'EOF'\nfix: stop passing --no-verify\n\nEOF\n)"`;
  assert.equal(splitSegments(heredoc).length, 1, "a quoted newline must not split a segment");
  const body = tokenize(heredoc).at(-1);
  assert.equal(body.quoted, true);
  assert.match(body.text, /--no-verify/);

  // Separators outside quotes do split.
  assert.deepEqual(splitSegments("npm test && git commit -n"), ["npm test ", " git commit -n"]);

  // A HEREDOC BODY IS NOT COMMANDS. Here the delimiter's own quotes close before the
  // newline, so nothing in the shipped form above protects it: every body line became
  // its own segment, and a document that merely SHOWS a force-push — which this
  // repository's `docs/configuration.md` must, to say what the guard blocks — was denied
  // as if it performed one. The leading-git-token rule cannot help, because a body line
  // legitimately starts with `git`.
  assert.deepEqual(
    splitSegments("cat > doc.md <<'EOF'\ngit push --force origin main\nEOF"),
    ["cat > doc.md <<'EOF'"],
    "a quoted-delimiter heredoc body must not be read as commands",
  );
  assert.deepEqual(splitSegments("cat > d.md <<EOF\ngit commit --no-verify\nEOF\nls"), [
    "cat > d.md <<EOF",
    "ls",
  ]);
  assert.deepEqual(splitSegments("cat <<-EOF\n\tgit commit -n\n\tEOF\nls"), ["cat <<-EOF", "ls"]);
  // Two heredocs on one line consume their bodies in the order they were opened.
  assert.deepEqual(
    splitSegments("diff <<A <<B\ngit commit -n\nA\ngit push -f origin main\nB\nls"),
    ["diff <<A <<B", "ls"],
  );
  // Unterminated: the rest is body. The alternative is judging a body as commands.
  assert.deepEqual(splitSegments("cat <<EOF\ngit commit -n"), ["cat <<EOF"]);
  // `<<<` is a herestring, not a heredoc, and a single `<` is an ordinary redirect —
  // neither opens a body, so the segment after `&&` is still judged.
  assert.deepEqual(splitSegments("grep x <<< 'git commit -n'"), ["grep x <<< 'git commit -n'"]);
  assert.deepEqual(splitSegments("sort < in.txt && git commit -n"), [
    "sort < in.txt ",
    " git commit -n",
  ]);
});

test("gitSubcommand walks git's global options and KEEPS the -C value", () => {
  assert.equal(gitSubcommand(tokenize("git commit -am x")).name, "commit");
  assert.equal(gitSubcommand(tokenize("git --no-pager -c user.name=x push")).name, "push");
  assert.equal(gitSubcommand(tokenize("git -C sub commit -a")).chdir, "sub");
  assert.equal(gitSubcommand(tokenize("git -Csub commit")).chdir, "sub");
  assert.equal(gitSubcommand(tokenize("git --git-dir=/tmp/x status")).name, "status");
  assert.equal(gitSubcommand(tokenize("npm test")), null);
  assert.equal(gitSubcommand(tokenize("git")), null);

  // A MENTION IS NOT AN INVOCATION: the git token must lead the segment. Locating it
  // anywhere read `echo git push --force …` as a push, and a comment — a newline is a
  // separator and comments are not stripped — as a commit.
  assert.equal(gitSubcommand(tokenize("echo git push --force origin main")), null);
  assert.equal(gitSubcommand(tokenize("# never pass git commit -n")), null);
  assert.equal(gitSubcommand(tokenize("cat git-notes.md")), null);

  // A leading `VAR=value` assignment is the one thing that may precede a command.
  assert.equal(gitSubcommand(tokenize("GIT_TRACE=1 git commit -a")).name, "commit");
  assert.equal(gitSubcommand(tokenize(`GIT_AUTHOR_NAME="a b" git -C sub push`)).chdir, "sub");
});

// ── AC1 — commit and merge bypass flags ─────────────────────────────────────

test("bypass-guard classifies commit and merge bypass flags", () => {
  const ctx = { protected: new Set(["main"]), localBranches: [], headBranch: "topic" };
  const denied = (command) => inspect(command, ctx).allow === false;

  // Denied: the three standalone forms of the bypass.
  assert.ok(denied("git commit --no-verify -m x"));
  assert.ok(denied("git commit -n -m x"));
  assert.ok(denied("git commit -nm x"), "a short bundle is unambiguously a flag group");
  assert.ok(denied("git add . && git commit --no-verify -m x"), "each segment is judged");
  assert.ok(denied("git merge --no-verify topic"));

  // Allowed: the same text as message content, including the shipped heredoc form.
  assert.ok(!denied(`git commit -m "stop using --no-verify"`));
  assert.ok(!denied(`git commit -m 'drop -n from the script'`));
  assert.ok(
    !denied(`git commit -m "$(cat <<'EOF'\nfix: stop passing --no-verify and -n\n\nEOF\n)"`),
    "the heredoc body is one quoted token, not a flag list",
  );

  // Allowed: `-n` on merge is `--no-stat`, a display flag.
  assert.ok(!denied("git merge -n topic"));
  assert.ok(!denied("git merge topic"));
  assert.ok(!denied("git commit -m x"));

  // Allowed: an ATTACHED OPTION VALUE is not a bundle of flag letters. Every one of
  // these is a documented invocation git accepts, and every one was denied for an `-n`
  // the user never typed — `-uno` is `--untracked-files=no`, `-mn` is the message `n`.
  for (const command of [
    "git commit -uno -m x",
    "git commit -Cmain",
    "git commit -Fnotes",
    "git commit -mn",
    "git commit -tTEMPLATEn",
    "git commit -Sjohn -m x",
  ]) {
    assert.ok(!denied(command), `${command} carries no -n`);
  }
  // …while a bundle whose letters are all known no-argument flags still reads as one.
  assert.ok(denied("git commit -an x"), "-an is --all --no-verify");
  assert.ok(denied("git commit -sn -m x"), "-sn is --signoff --no-verify");

  // Allowed: a MENTION is not an invocation. The git token must lead the segment.
  assert.ok(!denied("echo git commit --no-verify"));
  assert.ok(!denied("# never pass git commit -n"));
  assert.ok(!denied("npm test\n# and do not pass git commit -n either\ngit status"));
  assert.ok(denied("GIT_AUTHOR_NAME=x git commit -n -m y"), "an assignment may lead");

  // …and a heredoc body is written to a file, not run. The leading-token rule cannot
  // reach this one: the body line's first token really is `git`.
  assert.ok(!denied("cat > doc.md <<'EOF'\ngit commit --no-verify -m x\nEOF"));
  assert.ok(!denied("cat > doc.md <<EOF\ngit merge --no-verify topic\nEOF"));

  // The reason is a single line, so the payload's first line stays the contract.
  const verdict = inspect("git commit -nm x", ctx);
  assert.equal(verdict.allow, false);
  assert.ok(!verdict.reason.includes("\n"));
});

// ── AC2 — destructive pushes and the protected union ────────────────────────

test("bypass-guard classifies destructive pushes and resolves the protected union", () => {
  const ctx = {
    protected: new Set(["main", "dev"]),
    localBranches: ["main", "dev", "feature/x"],
    headBranch: "main",
  };
  const verdict = (command) => inspect(command, ctx);
  const denied = (command) => verdict(command).allow === false;

  // Force indicators, every shape.
  assert.ok(denied("git push --force origin main"));
  assert.ok(denied("git push -f origin main"));
  assert.ok(denied("git push -fu origin dev"), "a bundle containing f is a force");
  assert.ok(denied("git push --force-with-lease origin main"));
  assert.ok(denied("git push --force-with-lease=main:abc123 origin main"));
  assert.ok(denied("git push origin +main"));
  assert.ok(denied("git push --force --all origin"));

  // Deletion indicators. Deleting a protected branch is the same destruction.
  assert.ok(denied("git push --delete origin main"));
  assert.ok(denied("git push -d origin dev"));
  assert.ok(denied("git push origin :main"));

  // The value-of-an-option case the critic found: no positional names a ref, so the
  // target is what git itself would push — the current branch.
  assert.ok(denied("git push -o ci.skip -f origin"));
  const fallback = verdict("git push -o ci.skip -f origin");
  assert.match(
    fallback.reason,
    /current branch/,
    "a resolved-by-inference deny must explain itself",
  );
  assert.match(fallback.reason, /main/);

  // FOUR ALLOW DIRECTIONS.
  // 1. No destructive indicator — this repository's own release path.
  assert.ok(!denied("git push origin main"));
  assert.ok(!denied("git push -u origin main"));
  // 2. A force whose resolved target is outside the protected set, even from main.
  assert.ok(!denied("git push -f origin feature/x"));
  assert.ok(!denied("git push --force origin HEAD:feature/x"));
  // 3. Any dry run, since a simulated push changes nothing.
  assert.ok(!denied("git push --dry-run -f origin main"));
  assert.ok(!denied("git push -n -f origin main"));
  assert.ok(!denied("git push -nf origin main"));
  // 4. The option-value case from an unprotected branch.
  assert.equal(
    inspect("git push -o ci.skip -f origin", { ...ctx, headBranch: "feature/x" }).allow,
    true,
  );
  // 5. An attached option value is not a flag bundle: `-ofoo` is `--push-option=foo`,
  //    so this is an ordinary push to main and denying it blocked the release path.
  assert.ok(!denied("git push -ofoo origin main"));

  // A FULLY-QUALIFIED refspec is one. `destinationOf` already stripped `refs/heads/`
  // one function away, so failing to recognise it there missed the protected target and
  // denied the unprotected one, both by falling back to the current branch.
  assert.ok(denied("git push --force origin refs/heads/main"));
  assert.ok(!denied("git push --force origin refs/heads/feature/x"));
  assert.equal(
    inspect("git push --force origin refs/heads/feature/x", { ...ctx, headBranch: "dev" }).allow,
    true,
  );

  // A TARGET THIS GUARD CANNOT RESOLVE IS NOT EVIDENCE OF A PROTECTED ONE. A branch
  // that lives only on the remote, or one this push creates, sits in the refspec slot
  // of git's own `[<repository> [<refspec>…]]` grammar: the user named a target, so the
  // current-branch fallback must not answer for it.
  assert.ok(!denied("git push -f origin wip-remote-only"));
  assert.ok(!denied("git push --force-with-lease origin brand-new-topic"));
  // …but with NOTHING in that slot, git would push the current branch, and does.
  assert.ok(denied("git push -f"));
  assert.ok(denied("git push -f origin"));

  // `--all` denies only where a protected branch actually EXISTS. The protected set is
  // a policy and is never empty, so denying against it alone claimed an intersection it
  // had not computed — in a repository whose branches are all topic branches it named
  // four branches that do not exist there.
  assert.equal(
    inspect("git push --force --all origin", {
      protected: new Set(["main", "dev"]),
      localBranches: ["topic", "feature/x"],
      headBranch: "topic",
    }).allow,
    true,
  );
  assert.match(
    verdict("git push --force --all origin").reason,
    /protected dev, main\./,
    "and it names the branches it actually found, not the policy",
  );
});

test("bypass-guard judges the repository the command names, spawned as the host runs it", () => {
  const command = hookNamed("bypass-guard");
  const { dir } = makeRepo(); // one commit on `main`, which is protected
  const { dir: topicOnly, run: runTopic } = makeRepo();
  runTopic("branch", "-m", "topic"); // a repository whose branches are all topic branches

  // Measured on the shipped guard, from `dir`: every one of these exited 2.
  for (const cmd of [
    "echo git push --force origin main", // a mention pushes nothing
    "npm test\n# and never pass git commit -n\ngit status", // a comment is not a command
    "git commit -uno -m x", // --untracked-files=no, not a bundle carrying -n
    "git push -ofoo origin main", // --push-option=foo, and NOT a force
    "git push -f origin wip-remote-only", // a branch this repository does not carry
    "git push --force origin refs/heads/wip-remote-only",
    "cat > doc.md <<'EOF'\ngit push --force origin main\nEOF", // a body is written, not run
    `git -C ${topicOnly} push --force --all origin`, // -C consumed: nothing protected there
  ]) {
    assertAllowed(runHook(command, { cwd: dir, payload: payloadFor(cmd, dir) }), `${cmd}:`);
  }

  // And the denies the same change must not cost.
  for (const cmd of [
    "git commit -nm x",
    "GIT_AUTHOR_NAME=x git commit -n -m y",
    "git push --force origin refs/heads/main",
    "git push -o ci.skip -f origin", // nothing in the refspec slot: the current branch
    "git push --force --all origin", // and here `main` is a local branch
  ]) {
    assertDenied(runHook(command, { cwd: dir, payload: payloadFor(cmd, dir) }), `${cmd}:`);
  }

  // The mirror image of the `-C` case: the same command shape, run FROM the topic-only
  // repository and naming the one that does carry `main`, denies. Only the directory
  // `-C` names separates the two answers, which is what proves it is consumed.
  assertDenied(
    runHook(command, {
      cwd: topicOnly,
      payload: payloadFor(`git -C ${dir} push --force --all origin`, topicOnly),
    }),
    "-C naming a repository with a protected branch:",
  );
  assertAllowed(
    runHook(command, {
      cwd: topicOnly,
      payload: payloadFor("git push --force --all origin", topicOnly),
    }),
    "--all where no protected branch exists:",
  );
});

test("the protected set is the union of the config, origin/HEAD and the shipped defaults", () => {
  // Every default is present with no config and no remote at all.
  const bare = scratch("bare");
  const union = protectedBranches(bare);
  for (const name of PROTECTED_DEFAULTS) assert.ok(union.has(name), `${name} must be protected`);
  assert.ok(union.has("dev"), "dev is protected with no config change and no committable config");

  // The config's base_branch is added, whatever it is — input 1.
  const configured = scratch("configured");
  mkdirSync(join(configured, ".marvin"), { recursive: true });
  writeFileSync(
    join(configured, ".marvin", "config.json"),
    JSON.stringify({ base_branch: "integration" }),
  );
  assert.ok(protectedBranches(configured).has("integration"));

  // origin/HEAD is added — input 2. A repository whose default branch is named
  // something the shipped list does not carry is still protected.
  const { dir, run } = makeRepo();
  run("checkout", "--quiet", "-b", "trunk");
  run("remote", "add", "origin", dir);
  run("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
  const remote = protectedBranches(dir);
  assert.ok(remote.has("trunk"), "the origin/HEAD default must be protected");
  assert.ok(remote.has("main"), "and it must be a UNION, not a replacement");

  // A malformed config contributes nothing and is not an error.
  const broken = scratch("broken-config");
  mkdirSync(join(broken, ".marvin"), { recursive: true });
  writeFileSync(join(broken, ".marvin", "config.json"), "{ not json");
  assert.ok(protectedBranches(broken).has("main"));
});

// ── AC3 — what "pending" means, and a clean commit ──────────────────────────

test("secret-guard resolves the pending set and allows a clean commit", () => {
  const argsFor = (command) => pendingDiffArgs(tokenize(command));

  // `-a` / `--all` / a bundle containing `a` widen to tracked index+worktree.
  assert.deepEqual(argsFor("git commit -a -m x").slice(0, 2), ["diff", "HEAD"]);
  assert.deepEqual(argsFor("git commit --all -m x").slice(0, 2), ["diff", "HEAD"]);
  assert.deepEqual(argsFor(`git commit -am "wip"`).slice(0, 2), ["diff", "HEAD"]);

  // Only tokens after a BARE `--` are a pathspec.
  const scoped = argsFor("git commit -m x -- src/foo.ts src/bar.ts");
  assert.deepEqual(scoped.slice(0, 2), ["diff", "HEAD"]);
  assert.deepEqual(scoped.slice(-3), ["--", "src/foo.ts", "src/bar.ts"]);

  // Everything else is the index — INCLUDING the product's own commit form, whose
  // message is a positional token that must never be handed to git as a path.
  assert.deepEqual(argsFor(`git commit -m "fix auth"`).slice(0, 2), ["diff", "--cached"]);
  assert.deepEqual(argsFor("git commit").slice(0, 2), ["diff", "--cached"]);
  assert.deepEqual(argsFor("git commit --amend --no-edit").slice(0, 2), ["diff", "--cached"]);
  assert.deepEqual(argsFor("git commit src/foo.ts").slice(0, 2), ["diff", "--cached"]);
  assert.equal(argsFor("git push origin main"), null);

  // Every branch carries the same diff flags, so a hunk header is always parseable.
  for (const command of ["git commit -a", "git commit -m x -- a.txt", "git commit"]) {
    for (const flag of ["--unified=0", "--no-color", "--no-ext-diff"]) {
      assert.ok(argsFor(command).includes(flag), `${command} must pass ${flag}`);
    }
  }

  // A credential in the added lines is found with its file and line.
  const diff = [
    "diff --git a/src/aws.ts b/src/aws.ts",
    "--- a/src/aws.ts",
    "+++ b/src/aws.ts",
    "@@ -4,0 +5,2 @@",
    `+const key = "${FAKE_AWS_KEY}";`,
    "+const region = 'eu-west-1';",
    "@@ -20,1 +30,0 @@",
    `-const old = "${FAKE_GITHUB_TOKEN}";`,
  ].join("\n");
  assert.deepEqual(scanAddedLines(diff), [
    { id: "aws-access-key-id", file: "src/aws.ts", line: 5 },
  ]);

  // A clean diff yields nothing, in every resolution branch, and a malformed header
  // costs its hunk rather than throwing.
  assert.deepEqual(scanAddedLines(""), []);
  assert.deepEqual(scanAddedLines("+++ b/a.txt\n@@ garbage @@\n+ordinary line\n"), []);
});

test("secret-guard denies a pending secret end to end and never echoes it", () => {
  const command = hookNamed("secret-guard");
  const { dir, run } = makeRepo();

  // Staged: the `git diff --cached` branch.
  writeFileSync(join(dir, "aws.ts"), `export const key = "${FAKE_AWS_KEY}";\n`);
  run("add", "aws.ts");
  const staged = runHook(command, {
    cwd: dir,
    payload: payloadFor(`git commit -m "fix auth"`, dir),
  });
  assertDenied(staged);
  assert.match(staged.stderr, /aws-access-key-id/);
  assert.match(staged.stderr, /aws\.ts:1/);
  assert.ok(!staged.stderr.includes(FAKE_AWS_KEY), "the matched value must never be printed");

  // Unstaged but tracked: the `git commit -am` branch, which `git diff --cached`
  // alone would pass while appearing to work.
  run("commit", "--quiet", "-m", "seed the file");
  writeFileSync(join(dir, "aws.ts"), `export const token = "${FAKE_GITHUB_TOKEN}";\n`);
  const dirty = runHook(command, { cwd: dir, payload: payloadFor(`git commit -am "wip"`, dir) });
  assertDenied(dirty);
  assert.match(dirty.stderr, /github-token/);
  assert.ok(!dirty.stderr.includes(FAKE_GITHUB_TOKEN));

  // The same worktree change is invisible to the index branch: allow.
  assertAllowed(
    runHook(command, { cwd: dir, payload: payloadFor("git commit -m x", dir) }),
    "an unstaged change is not in the index:",
  );

  // A pathspec after a bare `--` scopes the scan to those paths, and only those.
  run("checkout", "--", "aws.ts");
  writeFileSync(join(dir, "clean.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "leak.ts"), "export const key = 1;\n");
  run("add", "clean.ts", "leak.ts");
  run("commit", "--quiet", "-m", "two tracked files");
  writeFileSync(join(dir, "leak.ts"), `export const key = "${FAKE_AWS_KEY}";\n`);
  assertDenied(
    runHook(command, { cwd: dir, payload: payloadFor("git commit -m x -- leak.ts", dir) }),
    "a pathspec that carries the secret:",
  );
  assertAllowed(
    runHook(command, { cwd: dir, payload: payloadFor("git commit -m x -- clean.ts", dir) }),
    "a pathspec that does not:",
  );

  // And the message of the product's own commit form is never read as a path: with
  // nothing staged, `git commit -m "fix auth"` resolves to a clean index and allows,
  // rather than failing open on a git error about an unknown pathspec.
  assertAllowed(
    runHook(command, { cwd: dir, payload: payloadFor(`git commit -m "fix auth"`, dir) }),
    "a quoted message is not a pathspec:",
  );

  // Hook B stands on the same segmenter, so it inherited the same heredoc defect: with
  // the secret staged, writing a document whose body merely SHOWS a commit denied the
  // write. The body is a file's contents, not a commit.
  run("add", "leak.ts");
  assertDenied(
    runHook(command, { cwd: dir, payload: payloadFor("git commit -m x", dir) }),
    "the secret really is staged:",
  );
  assertAllowed(
    runHook(command, {
      cwd: dir,
      payload: payloadFor("cat > doc.md <<'EOF'\ngit commit -m 'example'\nEOF", dir),
    }),
    "a heredoc body is written, not committed:",
  );
});

// ── AC4 — fail open on every internal error ─────────────────────────────────

test("both guards fail open on every internal error", () => {
  const cwd = scratch("failopen");
  for (const name of ["bypass-guard", "secret-guard"]) {
    const command = hookNamed(name);

    // Unreadable / non-JSON stdin.
    for (const input of ["", "not json at all", "[1,2,3]", "null"]) {
      const result = spawnSync("/bin/sh", ["-c", command], {
        cwd,
        input,
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
      });
      assertAllowed({ status: result.status, stdout: "", stderr: result.stderr ?? "" });
    }

    // A payload with no command, and a command of the wrong type.
    assertAllowed(runHook(command, { cwd, payload: { hook_event_name: "PreToolUse" } }));
    assertAllowed(runHook(command, { cwd, payload: { tool_input: { command: 42 } } }));

    // A directory that is not a git repository at all — the guard still matches the
    // substring gate, still tokenizes, and still allows because every git call fails.
    assertAllowed(runHook(command, { cwd, payload: payloadFor("git commit -a -m x", cwd) }));
  }

  // An unexpected throw anywhere inside a guard is caught by `main`, the outermost
  // wrapper both guards run through, and becomes exit 0.
  const probeDir = scratch("throw");
  const probe = join(probeDir, "probe.mjs");
  const hookIo = pathToFileURL(join(packDir, "hooks", "lib", "hook-io.mjs")).href;
  writeFileSync(
    probe,
    `import { main } from ${JSON.stringify(hookIo)};\n` +
      `main("probe", () => { throw new Error("boom"); });\n`,
  );
  const thrown = spawnSync(process.execPath, [probe], { encoding: "utf8" });
  assert.equal(thrown.status, 0, "main must swallow a throw and exit 0");
  assert.ok(!BLOCKED.test(thrown.stderr ?? ""));

  // And a `run` that returns something that is not the deny code cannot become one.
  for (const value of ["2", 1, true, undefined, null]) {
    writeFileSync(
      probe,
      `import { main } from ${JSON.stringify(hookIo)};\n` +
        `main("probe", () => (${JSON.stringify(value) ?? "undefined"}));\n`,
    );
    const result = spawnSync(process.execPath, [probe], { encoding: "utf8" });
    assert.equal(result.status, 0, `main must not turn ${String(value)} into a block`);
  }
});

// ── AC5 — the kill switch ───────────────────────────────────────────────────

test("the kill switch disables only on an explicit false", () => {
  const dir = scratch("killswitch");
  const configPath = join(dir, ".marvin", "config.json");
  mkdirSync(join(dir, ".marvin"), { recursive: true });
  const write = (value) => writeFileSync(configPath, value);

  // Enabled in every direction that is not an explicit disable.
  assert.equal(hooksEnabled(scratch("no-config")), true, "an absent config means enabled");
  write("{ not json");
  assert.equal(hooksEnabled(dir), true, "a malformed config means enabled");
  write(JSON.stringify({ base_branch: "main" }));
  assert.equal(hooksEnabled(dir), true, "no hooks block means enabled");
  write(JSON.stringify({ hooks: {} }));
  assert.equal(hooksEnabled(dir), true, "an empty hooks block means enabled");
  write(JSON.stringify({ hooks: { bypass: { enabled: false } } }));
  assert.equal(hooksEnabled(dir), true, "an unrecognised key under hooks means enabled");
  write(JSON.stringify({ hooks: { enabled: "false" } }));
  assert.equal(hooksEnabled(dir), true, "only the BOOLEAN false disables");
  write(JSON.stringify({ hooks: { enabled: true } }));
  assert.equal(hooksEnabled(dir), true);
  write(JSON.stringify([1, 2, 3]));
  assert.equal(hooksEnabled(dir), true, "a non-object config means enabled");

  // Disabled, on exactly one value.
  write(JSON.stringify({ hooks: { enabled: false } }));
  assert.equal(hooksEnabled(dir), false);

  // The reader IGNORES MARVIN_TASKS_CONFIG even when it is set: that variable scopes
  // to the server, and a test-isolation affordance must not decide what a blocking
  // guard reads.
  const foreign = scratch("foreign");
  mkdirSync(join(foreign, ".marvin"), { recursive: true });
  writeFileSync(
    join(foreign, ".marvin", "config.json"),
    JSON.stringify({ hooks: { enabled: false } }),
  );
  const previous = process.env.MARVIN_TASKS_CONFIG;
  process.env.MARVIN_TASKS_CONFIG = join(foreign, ".marvin", "config.json");
  try {
    write(JSON.stringify({ hooks: { enabled: true } }));
    assert.equal(hooksEnabled(dir), true, "MARVIN_TASKS_CONFIG must not repoint the hook");
  } finally {
    if (previous === undefined) delete process.env.MARVIN_TASKS_CONFIG;
    else process.env.MARVIN_TASKS_CONFIG = previous;
  }

  // Both switches, end to end, on a command that is otherwise a certain deny.
  const { dir: repo, run } = makeRepo();
  writeFileSync(join(repo, "aws.ts"), `export const key = "${FAKE_AWS_KEY}";\n`);
  run("add", "aws.ts");
  const secret = hookNamed("secret-guard");
  const payload = payloadFor("git commit -m x", repo);
  assertDenied(runHook(secret, { cwd: repo, payload }));
  assertAllowed(
    runHook(secret, { cwd: repo, payload, env: { MARVIN_HOOKS_DISABLED: "1" } }),
    "MARVIN_HOOKS_DISABLED=1 disables the session",
  );
  assertDenied(
    runHook(secret, { cwd: repo, payload, env: { MARVIN_HOOKS_DISABLED: "true" } }),
    "only the exact string 1 disables",
  );
  mkdirSync(join(repo, ".marvin"), { recursive: true });
  writeFileSync(
    join(repo, ".marvin", "config.json"),
    JSON.stringify({ hooks: { enabled: false } }),
  );
  assertAllowed(runHook(secret, { cwd: repo, payload }));
});

// ── AC6 — no subprocess on the common path ──────────────────────────────────

test("neither guard spawns git for an unrelated command", () => {
  const stubDir = scratch("stub");
  const witness = join(stubDir, "invoked.log");
  writeFileSync(
    join(stubDir, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(witness)}\nexit 0\n`,
  );
  chmodSync(join(stubDir, "git"), 0o755);

  const cwd = scratch("unrelated");
  for (const name of ["bypass-guard", "secret-guard"]) {
    // Three groups, widening: a command with no git substring at all; one that carries
    // `git`/`commit` only as a substring (`digital`, `commitment`) and so gets past both
    // gates; and the read-only git commands that dominate the hot path — these reach the
    // tokenizer and resolve a REAL subcommand, which is where a regression would land.
    // `git log --grep=commit` is the one probe that also passes Hook B's second gate, so
    // it exercises `pendingDiffArgs` rather than stopping at the substring test.
    for (const command of [
      "ls -la",
      "npm test",
      "cat README.md",
      "echo digital",
      `echo "a digital commitment"`,
      "git status",
      "git log --oneline -5",
      "git diff",
      "git show HEAD",
      "git log --grep=commit",
    ]) {
      const result = spawnSync("/bin/sh", ["-c", hookNamed(name)], {
        cwd,
        input: JSON.stringify(payloadFor(command, cwd)),
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: cwd,
          PATH: `${stubDir}:${process.env.PATH}`,
        },
      });
      assert.equal(result.status, 0, `${name} must allow \`${command}\``);
    }
  }

  const log = existsSync(witness) ? readFileSync(witness, "utf8") : "";
  assert.equal(log, "", `a git stub first on PATH was invoked:\n${log}`);
});

// ── AC7 — lint-manifests rule 8 ─────────────────────────────────────────────

/** Write a hooks manifest and a plugin manifest into a scaffolded lint root. */
function withHooks(api, { manifest, pluginHooks } = {}) {
  mkdirSync(join(api.packDir, "hooks"), { recursive: true });
  writeFileSync(join(api.packDir, "hooks", "hooks.json"), manifest);
  writeFileSync(
    join(api.packDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "marvin",
      version: "0.0.1",
      ...(pluginHooks === undefined ? {} : { hooks: pluginHooks }),
    }),
  );
  return api;
}

const wrapper = (command, timeout = 10) =>
  JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command, timeout }] }],
    },
  });

test("lint-manifests rule 8 rejects an unreachable hook command", () => {
  // A hook manifest whose script exists and is invoked through node: clean.
  const clean = withHooks(scaffoldLintRoot(scratch("lint-clean")), {
    manifest: wrapper('node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"'),
  });
  writeFileSync(join(clean.packDir, "hooks", "guard.mjs"), "//\n");
  const cleanRun = clean.runLinter();
  assert.equal(cleanRun.failed, false, cleanRun.output);

  // 1. The script does not exist.
  const missing = withHooks(scaffoldLintRoot(scratch("lint-missing")), {
    manifest: wrapper('node "${CLAUDE_PLUGIN_ROOT}/hooks/renamed.mjs"'),
  });
  const missingRun = missing.runLinter();
  assert.equal(missingRun.failed, true);
  assert.match(missingRun.output, /references a script that does not exist/);
  assert.match(missingRun.output, /renamed\.mjs/);

  // 2. A bare path without the execute bit — the one form that depends on it.
  const bare = withHooks(scaffoldLintRoot(scratch("lint-bare")), {
    manifest: wrapper('"${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"'),
  });
  writeFileSync(join(bare.packDir, "hooks", "guard.mjs"), "//\n");
  chmodSync(join(bare.packDir, "hooks", "guard.mjs"), 0o644);
  const bareRun = bare.runLinter();
  assert.equal(bareRun.failed, true);
  assert.match(bareRun.output, /as a bare path but it is not owner-executable/);

  // The same bare path WITH the bit is accepted, which is what proves the rule reads
  // the mode rather than merely rejecting every bare path.
  chmodSync(join(bare.packDir, "hooks", "guard.mjs"), 0o755);
  const bareOk = bare.runLinter();
  assert.equal(bareOk.failed, false, bareOk.output);

  // 3. The settings.json shape — events at top level — which the loader ignores.
  const shape = withHooks(scaffoldLintRoot(scratch("lint-shape")), {
    manifest: JSON.stringify({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node x.mjs" }] }],
    }),
  });
  const shapeRun = shape.runLinter();
  assert.equal(shapeRun.failed, true);
  assert.match(shapeRun.output, /not the plugin wrapper shape/);

  // 4. plugin.json declaring the standard path, which the loader treats as an error.
  const duplicate = withHooks(scaffoldLintRoot(scratch("lint-duplicate")), {
    manifest: wrapper('node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"'),
    pluginHooks: ["./hooks/hooks.json"],
  });
  writeFileSync(join(duplicate.packDir, "hooks", "guard.mjs"), "//\n");
  const duplicateRun = duplicate.runLinter();
  assert.equal(duplicateRun.failed, true);
  assert.match(duplicateRun.output, /pointing at the standard hooks\/hooks\.json path/);
});

// ── AC10 — the manifest shape, and the command it declares actually running ──

test("hooks.json is the plugin wrapper shape and the command it declares runs", () => {
  const manifest = JSON.parse(readFileSync(hooksManifest, "utf8"));

  // The plugin wrapper: events under a top-level `hooks` key, never at top level.
  assert.deepEqual(Object.keys(manifest), ["hooks"]);
  assert.deepEqual(Object.keys(manifest.hooks), ["PreToolUse"]);
  assert.equal(manifest.hooks.PreToolUse.length, 1);
  const [entry] = manifest.hooks.PreToolUse;
  assert.equal(entry.matcher, "Bash");
  assert.equal(entry.hooks.length, 2, "two entries: one guard cannot silence the other");
  for (const hook of entry.hooks) {
    assert.equal(hook.type, "command");
    assert.equal(hook.timeout, 10, "pinned so it cannot drift to the 60-second default");
    assert.match(hook.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.mjs"$/);
  }

  // The manifest key must stay absent: the loader auto-discovers hooks/hooks.json and
  // a manifest key naming the same path is an error, not a duplicate.
  const pluginJson = JSON.parse(
    readFileSync(join(packDir, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal("hooks" in pluginJson, false);

  // And the string each entry DECLARES resolves and runs. Spawned with a deny-shaped
  // payload it exits 2 with the fixed prefix, so the wiring is executed rather than
  // merely inspected.
  const { dir, run } = makeRepo();
  writeFileSync(join(dir, "aws.ts"), `export const key = "${FAKE_AWS_KEY}";\n`);
  run("add", "aws.ts");
  const denials = {
    "bypass-guard": "git commit --no-verify -m x",
    "secret-guard": "git commit -m x",
  };
  for (const hook of entry.hooks) {
    const name = /hooks\/([a-z-]+)\.mjs/.exec(hook.command)[1];
    const command = hook.command.split("${CLAUDE_PLUGIN_ROOT}").join(packDir);
    assertDenied(runHook(command, { cwd: dir, payload: payloadFor(denials[name], dir) }));
  }
});

// ── the shipped pattern list is not vacuous ─────────────────────────────────

test("every shipped secret pattern compiles and matches a value of its own shape", () => {
  assert.ok(SECRET_PATTERNS.length > 0);
  const ids = SECRET_PATTERNS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "pattern ids must be unique");
  for (const pattern of SECRET_PATTERNS) {
    assert.doesNotThrow(() => new RegExp(pattern.regex), `${pattern.id} must compile`);
    assert.ok(
      typeof pattern.note === "string" && pattern.note !== "",
      `${pattern.id} needs a note`,
    );
  }
  // Two representative shapes, built at runtime, prove the list is not inert.
  assert.deepEqual(
    scanAddedLines(`+++ b/a.ts\n@@ -0,0 +1,1 @@\n+const k = "${FAKE_AWS_KEY}";\n`).map((f) => f.id),
    ["aws-access-key-id"],
  );
  assert.deepEqual(
    scanAddedLines(`+++ b/a.ts\n@@ -0,0 +7,1 @@\n+const t = "${FAKE_GITHUB_TOKEN}";\n`),
    [{ id: "github-token", file: "a.ts", line: 7 }],
  );
});
