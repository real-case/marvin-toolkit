import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { importTs } from "./_tsload.mjs";
import { callTool } from "./_driver.mjs";

/**
 * Spec corpus mechanics (ADR-0037): the four storage primitives, the readers
 * routed onto them, and the shipped prose that must now delegate rather than
 * restate the rules.
 *
 * The storage layer is exercised directly through `_tsload.mjs` (the
 * `state-digest.test.mjs` / `provenance.test.mjs` pattern for `src` modules the
 * stdio bundle does not expose); the two cases that are about a TOOL's answer —
 * the foreign-root config tier and the slugless summary target — drive the live
 * server over stdio, because the resolution they prove is module-private.
 */
const spec = await importTs("src/storage/spec.ts");
const lib = await importTs("src/lib/state.ts");

const here = dirname(fileURLToPath(import.meta.url));
// test → server → mcp → marvin → plugins → repoRoot
const repoRoot = join(here, "..", "..", "..", "..", "..");
const skill = (name) =>
  readFileSync(join(repoRoot, "plugins/marvin/skills", name, "SKILL.md"), "utf8");

/** A minimal spec file: frontmatter identity + a title. */
function specFile({ slug, status = "ready", title = "A spec", sha = "abc123" } = {}) {
  return [
    "---",
    `slug: ${slug}`,
    "type: feature",
    ...(status ? [`status: ${status}`] : []),
    ...(sha ? [`contract_sha: ${sha}`] : []),
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

const withRoot = (fn) => async () => {
  const root = mkdtempSync(join(tmpdir(), "marvin-corpus-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

/** Seed `<root>/<rel>` with files (`{name: contents}`) and return the abs dir. */
function seed(root, rel, files) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

test(
  "corpus enumeration, numbering and width",
  withRoot(async (root) => {
    const dir = seed(root, ".marvin/task", {
      "001-a.md": specFile({ slug: "a", title: "First spec" }),
      "0012-b.md": specFile({ slug: "b", title: "Twelfth spec" }),
      "legacy.md": specFile({ slug: "legacy", title: "A legacy unnumbered spec" }),
      "verification.md": "# Verification Report\n",
      // Not a spec: no numeric prefix, and its frontmatter claims no identity.
      "notes.md": "# Just some notes\n\nNothing to do with the pipeline.\n",
    });
    // The runs/ subdirectory is excluded by the regular-file check, not by its
    // name: a journal file landing there under an .md name must stay invisible.
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "runs", "a.md"), "# a run\n");
    // A symlink must not pull out-of-tree content into the corpus.
    const outside = join(root, "outside.md");
    writeFileSync(outside, specFile({ slug: "outside", title: "Out of tree" }));
    symlinkSync(outside, join(dir, "099-linked.md"));

    const resolution = spec.resolveSpecDir(root);
    const corpus = spec.readSpecCorpus(resolution);

    assert.deepEqual(
      corpus.records.map((r) => [r.id, r.number, r.slug, r.title]),
      [
        ["0012", 12, "b", "Twelfth spec"],
        ["001", 1, "a", "First spec"],
        [null, null, "legacy", "A legacy unnumbered spec"],
      ],
      "three records, number-descending, the unnumbered legacy spec last at number null",
    );
    assert.equal(corpus.malformed.length, 0);
    assert.equal(
      corpus.records.some((r) => r.slug === "outside"),
      false,
      "the symlinked file is skipped, so no out-of-tree content enters the corpus",
    );
    assert.equal(corpus.records[0].path, ".marvin/task/0012-b.md", "paths are project-relative");

    assert.equal(spec.nextSpecNumber(corpus), 13);
    assert.equal(spec.specIdWidth(corpus), 4, "the widest observed prefix wins");
    assert.equal(spec.formatSpecId(13, 4), "0013");

    // A three-digit-only corpus keeps width 3 — the floor ADR-0022 states.
    const narrow = spec.readSpecCorpus(
      spec.resolveSpecDir(root, {
        dir: seed(root, "narrow", { "007-c.md": specFile({ slug: "c" }) }),
      }),
    );
    assert.equal(spec.specIdWidth(narrow), 3);
    assert.equal(spec.formatSpecId(spec.nextSpecNumber(narrow), 3), "008");
  }),
);

test(
  "a file that does not identify itself as a spec is neither a record nor malformed",
  withRoot(async (root) => {
    const corpus = spec.readSpecCorpus(
      spec.resolveSpecDir(root, {
        dir: seed(root, "specs", {
          // The phantom-corpus guard: a host `specs/` directory full of somebody
          // else's markdown must not be enumerated as pipeline specs.
          "README.md": "# API specs\n",
          "template.md": "# Template\n",
          // Front matter this parser cannot use — an unbalanced quote, and a
          // block that is legitimately empty. Neither file is ours, so neither
          // may reach `malformed`: that channel is a claim ABOUT a spec, and the
          // audit rates it `error`.
          "openapi-notes.md": '---\ntitle: "unbalanced\nversion: 3\n---\n\n# Notes\n',
          "index.md": "---\n---\n\n# Index\n",
          "legacy.md": specFile({ slug: "legacy" }),
          "004-numbered.md": "# No frontmatter, but numbered\n",
        }),
      }),
    );
    assert.deepEqual(
      corpus.records.map((r) => r.slug).sort(),
      ["legacy", "numbered"],
      "a numeric prefix OR a frontmatter identity — nothing else is a spec",
    );
    assert.deepEqual(
      corpus.malformed,
      [],
      "a non-spec is skipped silently, not reported malformed",
    );
  }),
);

test(
  "identity outranks the malformed channel, and an empty block is not a defect",
  withRoot(async (root) => {
    const corpus = spec.readSpecCorpus(
      spec.resolveSpecDir(root, {
        dir: seed(root, "mixed", {
          "001-ok.md": specFile({ slug: "ok" }),
          "005-bad.md": "---\nslug: [unclosed\ntype: feature\n---\n\n# Broken\n",
          "006-unterminated.md": "---\nslug: never-closed\n\n# Body\n",
          // Well-formed and carrying nothing. It parses, so it is a record; the
          // audit's per-record check is what names the identity keys it lacks.
          "007-empty.md": "---\n---\n\n# An empty block\n",
        }),
      }),
    );

    assert.deepEqual(
      corpus.records.map((r) => [r.number, r.slug, r.title]),
      [
        [7, "empty", "An empty block"],
        [1, "ok", "A spec"],
      ],
      "an empty frontmatter block leaves an ordinary record, not a defect",
    );
    assert.deepEqual(
      corpus.malformed.map((m) => m.filename),
      ["005-bad.md", "006-unterminated.md"],
      "only a block the parser cannot read at all is malformed",
    );
    assert.match(corpus.malformed[0].reason, /could not be parsed/);
    assert.match(
      corpus.malformed[1].reason,
      /never closed/,
      "the reason distinguishes the two ways a block fails, rather than guessing",
    );
    assert.equal(spec.nextSpecNumber(corpus), 8);
  }),
);

test(
  "an empty corpus, an absent directory, and a malformed file",
  withRoot(async (root) => {
    const empty = spec.readSpecCorpus(spec.resolveSpecDir(root, { dir: seed(root, "empty", {}) }));
    assert.deepEqual(empty, { records: [], malformed: [] });
    assert.equal(spec.nextSpecNumber(empty), 1);
    assert.equal(spec.formatSpecId(spec.nextSpecNumber(empty), spec.specIdWidth(empty)), "001");

    const absent = spec.readSpecCorpus(spec.resolveSpecDir(root, { dir: "docs/nowhere" }));
    assert.deepEqual(absent, { records: [], malformed: [] }, "a missing dir is an empty corpus");
    assert.equal(spec.nextSpecNumber(absent), 1);

    const broken = spec.readSpecCorpus(
      spec.resolveSpecDir(root, {
        dir: seed(root, "broken", {
          "005-bad.md": "---\nslug: [unclosed\ntype: feature\n---\n\n# Broken\n",
          "001-ok.md": specFile({ slug: "ok" }),
        }),
      }),
    );
    assert.deepEqual(
      broken.malformed.map((m) => [m.filename, m.number]),
      [["005-bad.md", 5]],
      "an unparseable spec keeps its number instead of being dropped",
    );
    assert.equal(
      spec.nextSpecNumber(broken),
      6,
      "a malformed file still holds its slot, so allocation never reissues it",
    );
  }),
);

test(
  "directory resolution tiers and order",
  withRoot(async (root) => {
    // Nothing exists yet → the default, which is not required to exist.
    assert.deepEqual(spec.resolveSpecDir(root), {
      abs: join(root, ".marvin/task"),
      rel: ".marvin/task",
      source: "default",
    });

    mkdirSync(join(root, "docs", "specs"), { recursive: true });
    assert.equal(spec.resolveSpecDir(root).rel, "docs/specs", "detection finds a host convention");

    mkdirSync(join(root, ".marvin", "task"), { recursive: true });
    const detected = spec.resolveSpecDir(root);
    assert.equal(detected.source, "detected");
    assert.equal(
      detected.rel,
      ".marvin/task",
      "code order wins: a repo holding both does not silently relocate its specs",
    );

    const configured = spec.resolveSpecDir(root, { dir: "docs/rfcs" });
    assert.deepEqual(configured, {
      abs: join(root, "docs/rfcs"),
      rel: "docs/rfcs",
      source: "config",
      // config wins even when both conventional directories exist
    });

    const searched = spec.specSearchDirs(root, { dir: "docs/rfcs" }, "host/place");
    assert.deepEqual(
      searched.slice(0, 3),
      [join(root, "host/place"), join(root, "docs/rfcs"), join(root, ".marvin/task")],
      "host binding, then the resolved dir, then every convention",
    );
    assert.equal(new Set(searched).size, searched.length, "deduped");
    assert.ok(
      searched.includes(join(root, "rfcs")),
      "reach is unchanged — configuring spec.dir must not orphan a repo's history",
    );
  }),
);

test(
  "the spec tool reads the config of the root it was asked about",
  withRoot(async (root) => {
    // A FOREIGN projectRoot: the server's own project is `elsewhere`, and the
    // spec.dir tier must come from `root`, not from the server's env.configPath.
    const elsewhere = join(root, "elsewhere");
    mkdirSync(join(elsewhere, ".marvin"), { recursive: true });
    writeFileSync(
      join(elsewhere, ".marvin", "config.json"),
      JSON.stringify({ spec: { dir: "wrong/place" } }),
    );
    const project = join(root, "project");
    mkdirSync(join(project, ".marvin"), { recursive: true });
    writeFileSync(
      join(project, ".marvin", "config.json"),
      JSON.stringify({ spec: { dir: "docs/rfcs" } }),
    );
    seed(project, "docs/rfcs", { "042-configured.md": specFile({ slug: "configured" }) });

    const result = await callTool(
      "spec",
      { action: "list", projectRoot: project },
      { env: { CLAUDE_PROJECT_DIR: elsewhere } },
    );
    const payload = corpusBlock(result);
    assert.deepEqual(payload.dir, { rel: "docs/rfcs", source: "config" });
    assert.deepEqual(
      payload.specs.map((s) => s.slug),
      ["configured"],
    );
  }),
);

/** The ```json spec-corpus``` block a corpus read emits (never `spec-result`). */
function corpusBlock(result) {
  const text = result.content.map((c) => c.text).join("\n");
  const m = text.match(/```json spec-corpus\n([\s\S]*?)\n```/);
  assert.ok(m, `no spec-corpus block in output:\n${text}`);
  return JSON.parse(m[1]);
}

test(
  "routed enumerators follow the resolved directory",
  withRoot(async (root) => {
    // The specs live ONLY under the configured directory; .marvin/task exists
    // and holds nothing but the pinned verification artifact.
    seed(root, ".marvin/task", { "verification.md": "# Verification Report\n" });
    seed(root, "docs/rfcs", {
      "002-b.md": specFile({ slug: "b", title: "In flight" }),
      "010-a.md": specFile({ slug: "a", title: "Newest in flight" }),
      "003-done.md": specFile({ slug: "done", status: "shipped", title: "Delivered" }),
      "004-old.md": specFile({ slug: "old", status: "superseded", title: "Replaced" }),
    });
    const specDir = spec.resolveSpecDir(root, { dir: "docs/rfcs" });

    assert.deepEqual(
      lib.specDigest(root, specDir),
      [
        { slug: "a", title: "Newest in flight", id: "010" },
        { slug: "b", title: "In flight", id: "002" },
      ],
      "the digest reads the configured directory and still drops shipped/superseded",
    );
    assert.deepEqual(lib.specDigest(root), [], "detection alone sees no specs under .marvin/task");

    const env = { projectDir: root, memoryDir: join(root, ".marvin", "memory") };
    assert.equal(
      lib.artifactCounts(env, specDir).specs,
      4,
      "the artifact count reads the SAME corpus — the dashboard's two zones cannot disagree",
    );
    assert.equal(
      lib.artifactCounts(env).specs,
      0,
      "and without the resolved directory it would have reported the .marvin/task/ count",
    );

    // ── the slugless summary target, in its own project ──────────────────────
    // Its resolver is module-private, so this half is driven through the live
    // `summary` tool. The corpus is built so the lexicographic last (002-b) and
    // the numeric max (010-a) are different files.
    const project = join(root, "summary-project");
    const specs = seed(project, ".marvin/task", {
      "002-b.md": specFile({ slug: "b", title: "Lexicographically last" }),
      "010-a.md": specFile({ slug: "a", title: "Numerically newest" }),
    });

    const pick = async () => {
      const result = await callTool("summary", {}, { env: { CLAUDE_PROJECT_DIR: project } });
      return result.structuredContent?.slug ?? null;
    };

    assert.equal(await pick(), "a", "highest number wins, not the lexicographic last");

    // A newer draft, and a newer unsealed spec, are both ineligible as the guess.
    writeFileSync(
      join(specs, "011-draft.md"),
      specFile({ slug: "skeleton", status: "draft", title: "An unfinished skeleton" }),
    );
    writeFileSync(
      join(specs, "012-unsealed.md"),
      specFile({ slug: "unsealed", title: "Never sealed", sha: null }),
    );
    assert.equal(await pick(), "a", "a draft or unsealed record cannot become the default target");

    // A repository of nothing but unsealed specs is not told it has none.
    rmSync(join(specs, "002-b.md"));
    rmSync(join(specs, "010-a.md"));
    assert.equal(await pick(), "unsealed", "the unfiltered newest record is the fallback");
  }),
);

test("task-start delegates number allocation to the tool", () => {
  const body = skill("task-start");
  assert.match(body, /action:\s*"next"/, "the ordering number comes from the spec tool");
  assert.equal(
    body.includes("highest leading-integer prefix"),
    false,
    "the arithmetic the tool now owns is gone from the prose",
  );
});

test("the reader skills delegate enumeration to the tool", () => {
  for (const name of ["task-implement", "task-verify", "task-deliver"]) {
    const body = skill(name);
    assert.match(body, /action:\s*"list"/, `${name} names the corpus read`);
    assert.equal(
      body.includes("`docs/specs/`, `docs/rfcs/`, `rfcs/`"),
      false,
      `${name} no longer hand-lists the spec directories`,
    );
  }

  const implement = skill("task-implement");
  assert.equal(
    implement.includes("`shipped` or `superseded`, stop"),
    false,
    "the terminal-status refusal now lives in the seal verdict, not in prose",
  );
  assert.match(
    implement,
    /`draft`/,
    "the draft refusal stays explicit prose — the seal check deliberately does not implement it",
  );
});

test("ADR-0022 is amended, not retired", () => {
  const adr = (file) => readFileSync(join(repoRoot, "docs/adr", file), "utf8");
  const numbered = adr("0022-numbered-spec-files.md");
  assert.match(numbered, /\|\s*Status\s*\|\s*\*\*Accepted\*\*/, "0022 keeps its accepted status");
  assert.match(
    numbered.split("## Context")[0],
    /ADR-0037/,
    "its header links forward to the record that amends it",
  );

  const successor = adr("0037-spec-corpus-mechanics.md");
  assert.match(successor, /\|\s*Status\s*\|\s*\*\*Proposed\*\*/);

  for (const index of ["README.md", "docs/README.md"]) {
    assert.match(
      readFileSync(join(repoRoot, index), "utf8"),
      /0037-spec-corpus-mechanics\.md/,
      `${index} links the new record — check-docs-drift fails the build without it`,
    );
  }
});
