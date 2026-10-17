import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";
import { sh } from "./_pipeline-git.mjs";

/**
 * `spec action: "next"` counts the base branch as well as the working tree.
 *
 * Two sessions that allocate a spec number from their own checkouts both see the
 * same highest local number and mint the same `NNN`; the collision surfaces only
 * when the second branch merges. The base branch is where a parallel session's
 * spec lands first, so the allocator takes the maximum over the local directory
 * AND `git ls-tree origin/<base> <specdir>/`. Every way that read can fail — no
 * git, no repository, no origin, no such ref — leaves the local answer exactly as
 * it was.
 *
 * Driven through the tool's `handler` on the compiled `src/` (the `_tsload.mjs`
 * pattern): the committed `dist/server.js` is rebuilt by the integration step, so
 * a stdio test here would exercise the bundle from before this change.
 */

const { buildSpecTool } = await importTs("src/tools/spec.ts");
const { loadEnv } = await importTs("src/lib/env.ts");
const storage = await importTs("src/storage/spec.ts");

const specFile = (slug) => `---\nslug: ${slug}\ntype: feature\nstatus: ready\n---\n\n# ${slug}\n`;

/** Write files under `dir` (`{relPath: contents}`), creating parents. */
function plant(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

function identify(repo) {
  sh(repo, "config", "user.email", "t@t");
  sh(repo, "config", "user.name", "t");
}

/** Commit everything; the add is forced, so a global ignore cannot hide `.marvin/`. */
function commit(repo, message) {
  sh(repo, "add", "-f", "-A");
  sh(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
}

function commitAndPush(repo, branch, message) {
  commit(repo, message);
  sh(repo, "push", "-q", "origin", `HEAD:${branch}`);
}

/**
 * A bare origin, the checkout under test, and a second clone playing the
 * parallel session. The checkout commits `base`, then the parallel session pushes
 * `parallel` and the checkout fetches without merging — the state of a branch cut
 * from the base before another task's spec merged — so `origin/<branch>` is ahead
 * of the spec directory on disk. `local` is planted last and never committed: the
 * draft a `task-start` run has just opened.
 */
function fixture({
  branch = "dev",
  base = {},
  parallel = {},
  parallelLinks = {},
  local = {},
  setHead = false,
}) {
  const root = mkdtempSync(join(tmpdir(), "marvin-spec-next-"));
  const origin = join(root, "origin.git");
  sh(root, "init", "-q", "--bare", "-b", branch, origin);

  const repo = join(root, "repo");
  sh(root, "clone", "-q", origin, repo);
  identify(repo);
  plant(repo, { "README.md": "seed\n", ...base });
  commitAndPush(repo, branch, "seed");

  if (Object.keys(parallel).length > 0) {
    const other = join(root, "other");
    sh(root, "clone", "-q", origin, other);
    identify(other);
    plant(other, parallel);
    for (const [link, target] of Object.entries(parallelLinks)) {
      symlinkSync(target, join(other, link));
    }
    commitAndPush(other, branch, "the parallel session's spec");
    sh(repo, "fetch", "-q", "origin");
  }
  if (setHead) sh(repo, "remote", "set-head", "origin", branch);
  plant(repo, local);
  return { root, repo };
}

/** The ```json spec-corpus``` payload of one corpus read through the handler. */
async function corpusRead(projectDir, args) {
  const tool = buildSpecTool(loadEnv({ CLAUDE_PROJECT_DIR: projectDir }));
  const result = await tool.handler(args);
  const text = result.content.map((c) => c.text).join("\n");
  const m = text.match(/```json spec-corpus\n([\s\S]*?)\n```/);
  assert.ok(m, `no spec-corpus block in output:\n${text}`);
  return { text, isError: !!result.isError, payload: JSON.parse(m[1]) };
}

const next = (projectDir, args = {}) => corpusRead(projectDir, { action: "next", ...args });

const withFixture = (options, fn) => async () => {
  const f = fixture(options);
  try {
    await fn(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
};

test(
  "origin carrying a higher number than the worktree wins",
  withFixture(
    {
      base: { ".marvin/task/001-first.md": specFile("first") },
      parallel: { ".marvin/task/007-parallel.md": specFile("parallel") },
      local: { ".marvin/task/002-mine.md": specFile("mine") },
    },
    async ({ repo }) => {
      const { payload, text, isError } = await next(repo, { slug: "another" });
      assert.equal(isError, false, text);
      assert.equal(payload.next.number, 8, "the local tree alone would answer 3");
      assert.equal(payload.next.id, "008");
      assert.equal(payload.next.filename, "008-another.md");
      assert.deepEqual(payload.next.base, {
        ref: "origin/dev",
        highest: 7,
        taken: [],
        collision: null,
      });
      assert.match(text, /`origin\/dev`/, "the answer names the ref it counted");
    },
  ),
);

test(
  "a number the base branch holds under another filename is reported as taken",
  withFixture(
    {
      base: { ".marvin/task/007-shipped.md": specFile("shipped") },
      parallel: { ".marvin/task/008-other.md": specFile("other") },
      // The draft this session opened before the parallel spec merged, on the same number.
      local: { ".marvin/task/008-mine.md": specFile("mine") },
    },
    async ({ repo }) => {
      const { payload, text } = await next(repo, { slug: "mine" });
      // 007 is on both sides under one name: a spec merged as it is, which takes nothing.
      assert.deepEqual(payload.next.base.taken, [
        { number: 8, filename: "008-other.md", local: "008-mine.md" },
      ]);
      assert.equal(payload.next.base.collision, null);
      assert.match(
        text,
        /Number `008` is already taken on `origin\/dev` by `008-other\.md` \(local `008-mine\.md`\)/,
      );
      assert.equal(payload.next.number, 9, "and the next number clears it");
    },
  ),
);

test(
  "a slug the base branch holds under a file this checkout lacks is a base collision",
  withFixture(
    {
      base: { ".marvin/task/001-first.md": specFile("first") },
      parallel: { ".marvin/task/002-shared.md": specFile("shared") },
      local: { ".marvin/task/002-draft.md": specFile("draft") },
    },
    async ({ repo }) => {
      const claimed = await next(repo, { slug: "shared" });
      assert.deepEqual(claimed.payload.next.base.collision, { filename: "002-shared.md" });
      assert.equal(claimed.payload.next.collision, null, "the local tree holds no such slug");
      assert.match(claimed.text, /Slug collision on the base branch/);
      // A slug the base holds under a filename this checkout has is the local collision's
      // business, and a slug nobody holds collides with nothing.
      for (const slug of ["first", "fresh"]) {
        const { payload } = await next(repo, { slug });
        assert.equal(payload.next.base.collision, null, slug);
      }
    },
  ),
);

test(
  "a local branch named like the remote-tracking ref does not answer for the base",
  withFixture(
    {
      base: { ".marvin/task/001-first.md": specFile("first") },
      parallel: { ".marvin/task/007-parallel.md": specFile("parallel") },
    },
    async ({ repo }) => {
      // A LOCAL branch `origin/dev` on a commit holding 099. A bare `origin/dev`
      // resolves to refs/heads/origin/dev before refs/remotes/origin/dev.
      const home = sh(repo, "branch", "--show-current");
      sh(repo, "checkout", "-q", "-b", "stray");
      plant(repo, { ".marvin/task/099-stray.md": specFile("stray") });
      commit(repo, "stray");
      sh(repo, "branch", "-q", "origin/dev");
      sh(repo, "checkout", "-q", home);

      const { payload } = await next(repo);
      assert.deepEqual(payload.next.base, {
        ref: "origin/dev",
        highest: 7,
        taken: [],
        collision: null,
      });
      assert.equal(payload.next.number, 8);
    },
  ),
);

test(
  "a worktree ahead of origin keeps its own maximum",
  withFixture(
    {
      base: { ".marvin/task/003-shipped.md": specFile("shipped") },
      local: { ".marvin/task/011-draft.md": specFile("draft") },
    },
    async ({ repo }) => {
      const { payload } = await next(repo);
      assert.equal(payload.next.number, 12, "the maximum, not origin's answer");
      assert.deepEqual(payload.next.base, {
        ref: "origin/dev",
        highest: 3,
        taken: [],
        collision: null,
      });
    },
  ),
);

test(
  "a base branch holding no numbered spec is read, and reported as holding none",
  withFixture({ local: { ".marvin/task/004-draft.md": specFile("draft") } }, async ({ repo }) => {
    const { payload } = await next(repo);
    assert.equal(payload.next.number, 5);
    assert.deepEqual(payload.next.base, {
      ref: "origin/dev",
      highest: null,
      taken: [],
      collision: null,
    });
  }),
);

test(
  "the base is config base_branch first, then origin/HEAD",
  withFixture(
    { branch: "main", setHead: true, base: { ".marvin/task/005-on-main.md": specFile("on-main") } },
    async ({ repo }) => {
      // origin's default branch `main` carries 005; a `release` branch carries 020.
      sh(repo, "checkout", "-q", "-b", "release");
      plant(repo, { ".marvin/task/020-on-release.md": specFile("on-release") });
      commitAndPush(repo, "release", "release spec");
      sh(repo, "checkout", "-q", "main");
      sh(repo, "branch", "-q", "-D", "release");

      // No config file: the remote's default branch, read from origin/HEAD.
      const detected = await next(repo);
      assert.deepEqual(detected.payload.next.base, {
        ref: "origin/main",
        highest: 5,
        taken: [],
        collision: null,
      });
      assert.equal(detected.payload.next.number, 6);

      // A configured base_branch outranks detection.
      plant(repo, { ".marvin/config.json": JSON.stringify({ base_branch: "release" }) });
      const configured = await next(repo);
      assert.deepEqual(configured.payload.next.base, {
        ref: "origin/release",
        highest: 20,
        taken: [],
        collision: null,
      });
      assert.equal(configured.payload.next.number, 21);
    },
  ),
);

test(
  "the base is read in the resolved spec directory, and only its numbered specs count",
  withFixture(
    {
      base: {
        ".marvin/config.json": JSON.stringify({ spec: { dir: "docs/rfcs" } }),
        "docs/rfcs/0004-old.md": specFile("old"),
        // Another directory holds a higher number: not this corpus.
        ".marvin/task/090-elsewhere.md": specFile("elsewhere"),
      },
      parallel: {
        "docs/rfcs/0009-parallel.md": specFile("parallel"),
        // None of these is a numbered spec of this directory.
        "docs/rfcs/verification.md": "# Verification Report\n",
        "docs/rfcs/README.md": "# RFCs\n",
        "docs/rfcs/runs/0099-parallel.md": "# a run journal\n",
        "docs/rfcs/0050-notes.txt": "not markdown\n",
        // A directory named like a spec is a tree, not a spec file.
        "docs/rfcs/0088-a-directory.md/inside.md": "# nested\n",
      },
      // A committed symlink is skipped, as the corpus reader skips one on disk.
      parallelLinks: { "docs/rfcs/0077-link.md": "0009-parallel.md" },
    },
    async ({ repo }) => {
      const { payload } = await next(repo, { slug: "new-one" });
      assert.deepEqual(payload.dir, { rel: "docs/rfcs", source: "config" });
      assert.deepEqual(payload.next.base, {
        ref: "origin/dev",
        highest: 9,
        taken: [],
        collision: null,
      });
      assert.equal(payload.next.number, 10);
      assert.equal(payload.next.width, 4, "the corpus's own width");
      assert.equal(payload.next.filename, "0010-new-one.md");
    },
  ),
);

test(
  "a wider id on the base branch sets the width",
  withFixture(
    {
      base: { ".marvin/task/001-first.md": specFile("first") },
      parallel: { ".marvin/task/0012-wide.md": specFile("wide") },
    },
    async ({ repo }) => {
      const { payload } = await next(repo, { slug: "follow-up" });
      assert.equal(payload.next.number, 13);
      assert.equal(payload.next.width, 4);
      assert.equal(payload.next.filename, "0013-follow-up.md");
    },
  ),
);

test(
  "a project root below the repository top level reads its own directory on the base",
  withFixture(
    {
      base: { "pkg/.marvin/task/001-first.md": specFile("first") },
      parallel: {
        "pkg/.marvin/task/009-parallel.md": specFile("parallel"),
        // The repository root's spec directory is another corpus.
        ".marvin/task/050-root.md": specFile("root"),
      },
    },
    async ({ repo }) => {
      // The server was spawned for the repository root; the call targets the package.
      const { payload } = await next(repo, { projectRoot: join(repo, "pkg") });
      assert.deepEqual(payload.next.base, {
        ref: "origin/dev",
        highest: 9,
        taken: [],
        collision: null,
      });
      assert.equal(payload.next.number, 10);
    },
  ),
);

test("fail-open: no repository, no origin, or no such ref leaves the local answer unchanged", async () => {
  const root = mkdtempSync(join(tmpdir(), "marvin-spec-next-open-"));
  try {
    // Not a git repository at all.
    const plain = join(root, "plain");
    plant(plain, { ".marvin/task/004-a.md": specFile("a") });
    const noRepo = await next(plain, { slug: "b" });
    assert.equal(noRepo.isError, false, noRepo.text);
    assert.equal(noRepo.payload.next.number, 5);
    assert.equal(noRepo.payload.next.base, null);
    assert.doesNotMatch(noRepo.text, /origin\//, "nothing is claimed about a ref never read");

    // A repository with no remote.
    const lonely = join(root, "lonely");
    sh(root, "init", "-q", "-b", "dev", lonely);
    plant(lonely, { ".marvin/task/006-a.md": specFile("a") });
    const noOrigin = await next(lonely);
    assert.equal(noOrigin.payload.next.number, 7);
    assert.equal(noOrigin.payload.next.base, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "fail-open: a configured base the remote does not carry",
  withFixture({ base: { ".marvin/task/002-a.md": specFile("a") } }, async ({ repo }) => {
    plant(repo, { ".marvin/config.json": JSON.stringify({ base_branch: "no-such-branch" }) });
    const { payload, isError } = await next(repo);
    assert.equal(isError, false);
    assert.equal(payload.next.number, 3);
    assert.equal(payload.next.base, null);
  }),
);

test(
  "list never consults the base branch",
  withFixture(
    {
      base: { ".marvin/task/001-first.md": specFile("first") },
      parallel: { ".marvin/task/007-parallel.md": specFile("parallel") },
    },
    async ({ repo }) => {
      const { payload } = await corpusRead(repo, { action: "list" });
      assert.deepEqual(
        payload.specs.map((s) => s.slug),
        ["first"],
        "list enumerates the specs this tree holds, not the base branch's",
      );
      assert.equal(payload.next, undefined);
    },
  ),
);

test("storage: filenames held elsewhere count toward the next number and the width", () => {
  const corpus = { records: [{ number: 2, id: "002" }], malformed: [] };
  assert.equal(storage.nextSpecNumber(corpus), 3, "no second argument: the corpus alone");
  assert.equal(storage.nextSpecNumber(corpus, ["007-x.md", "README.md", "verification.md"]), 8);
  assert.equal(storage.nextSpecNumber(corpus, ["001-x.md"]), 3, "a lower number elsewhere");
  assert.equal(storage.nextSpecNumber({ records: [], malformed: [] }, ["005-a.md"]), 6);
  assert.equal(storage.specIdWidth(corpus), 3);
  assert.equal(storage.specIdWidth(corpus, ["0012-x.md"]), 4);
  assert.equal(storage.specIdWidth(corpus, ["notes.md", "0099-x.txt", "verification.md"]), 3);
  assert.equal(storage.specFilenameNumber("0012-wide.md"), 12);
  assert.equal(storage.specFilenameNumber("verification.md"), null);
  assert.equal(storage.specFilenameNumber("legacy.md"), null);
  assert.equal(storage.specFilenameNumber("007-x.txt"), null);
});

test("task-start's pre-seal re-check reads both base claims, in the feature and the bugfix flow", () => {
  // test → server → mcp → marvin
  const skill = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "skills",
      "task-start",
      "SKILL.md",
    ),
    "utf8",
  ).replace(/\s+/g, " ");
  const recheck = (lead) => {
    const start = skill.indexOf(lead);
    assert.ok(start >= 0, `no re-check starting "${lead}"`);
    return skill.slice(start, skill.indexOf("Write & seal", start));
  };
  for (const [flow, lead] of [
    ["feature", "**Re-check the collision, and skip the draft this run created.**"],
    ["bugfix", "**The directory and the collision** — both settled at step 1.5."],
  ]) {
    const rule = recheck(lead);
    assert.match(rule, /`next\.base\.collision`/, `${flow}: the base's slug claim is not read`);
    assert.match(rule, /`next\.base\.taken`/, `${flow}: the base's number claim is not read`);
    assert.match(rule, /whose `local` is the draft's filename/, `${flow}: no match on the draft`);
  }
});
