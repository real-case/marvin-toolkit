// The cross-file consistency suite for the hooks layer (ADR-0040).
//
// It is kept APART from test/hooks.test.mjs so a behavioural change cannot be made
// green by relaxing a documentation assertion, or the reverse.
//
// Three properties, three tests, deliberately separate:
//   1. The hook's SECRET_PATTERNS and the sec-gate skill's fenced block agree in both
//      directions, and no shipped pattern matches this repository's own vocabulary.
//   2. Every disclosure surface and every plugin tree carries the hooks layer.
//   3. The architecture document's counts match a recount of the tree.
//
// (2) and (3) are separate on purpose: a documentation-count drift and an undisclosed
// consent change must fail distinguishably, or the next widget added to the toolkit
// reddens the test that exists to prove marvin discloses that it can block a command.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SECRET_PATTERNS,
  isExemptMatch,
  scanAddedLines,
} from "../plugins/marvin/hooks/secret-guard.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(repoRoot, "plugins", "marvin");

const read = (...parts) => readFileSync(join(repoRoot, ...parts), "utf8");

/** Every file under `dir`, recursively. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The false-positive corpus: every TRACKED file, asked of git rather than of a
 * directory list, so the enumeration covers exactly what a commit can add — which is
 * exactly what the guard scans. The narrower `docs/` + `skills/` walk missed the one
 * real match in the tree (a published AWS example id in a widget fixture, four
 * directories away from either), and a corpus that cannot see the file that fires is
 * not a corpus.
 *
 * It falls back to that walk when git is unavailable — a source tarball has no index,
 * and a smaller corpus is worth more than a skipped test.
 */
function corpusFiles() {
  try {
    const listed = execFileSync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
      .map((relative) => join(repoRoot, relative));
    if (listed.length > 50) return listed;
  } catch {
    // No git, no index, or no checkout: the enumerated walk below still runs.
  }
  return [...walk(join(repoRoot, "docs")), ...walk(join(packDir, "skills"))];
}

// ── AC8 — the pattern list, in both directions and against real prose ───────

test("the hook pattern list and the sec-gate block agree in both directions", () => {
  const skill = read("plugins", "marvin", "skills", "sec-gate", "SKILL.md");
  const fenced = /```json secret-patterns\n([\s\S]*?)\n```/.exec(skill);
  assert.ok(fenced, "sec-gate/SKILL.md carries no fenced `secret-patterns` block");

  let rows;
  assert.doesNotThrow(() => {
    rows = JSON.parse(fenced[1]);
  }, "the secret-patterns block must be valid JSON");

  // Same ids, same regex strings, same order, no extra row on either side. Compared as
  // one deep equality rather than as a set membership in each direction, because a set
  // comparison passes on a duplicated row and on a reordered list.
  assert.deepEqual(
    rows,
    SECRET_PATTERNS.map(({ id, regex }) => ({ id, regex })),
    "the sec-gate block has drifted from the hook's canonical SECRET_PATTERNS",
  );

  // The skill must say which side is canonical, or the next editor picks the wrong one.
  assert.match(skill, /secret-guard\.mjs/);
  assert.match(skill, /canonical/i);

  // The one rule that stays prose is labelled as such and is NOT in the block.
  assert.ok(!rows.some((row) => /generic|credential-assignment/.test(row.id)));
  assert.match(skill, /not machine-enforced|Generic credentials — model judgement/);
});

test("no shipped pattern matches this repository's own vocabulary", () => {
  // The corpus is ENUMERATED, never written: a curated list of benign samples can be
  // chosen to pass whatever pattern list it is checked against. It is read from the
  // working tree rather than from `git log -p` so a shallow clone still runs it.
  const files = corpusFiles();
  assert.ok(files.length > 50, `the corpus collapsed to ${files.length} files`);

  let bytes = 0;
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // A NUL byte means this is not text. Decoding a PNG as utf8 yields replacement
    // characters, not matches, but scanning megabytes of them buys nothing.
    if (text.includes("\0")) continue;
    bytes += text.length;
    for (const pattern of SECRET_PATTERNS) {
      for (const match of text.matchAll(new RegExp(pattern.regex, "g"))) {
        // Judged by the guard's OWN exemption, not by a second copy of the rule here:
        // whatever this test tolerates is exactly what a commit would be allowed.
        if (isExemptMatch(match[0])) continue;
        hits.push(`${pattern.id} matched in ${file.slice(repoRoot.length + 1)}`);
      }
    }
  }
  assert.ok(bytes > 500_000, `the corpus collapsed to ${bytes} bytes`);

  // A red here means either a pattern is too loose or a real credential has entered the
  // tree. Both deserve to stop a commit.
  assert.deepEqual(hits, []);

  // The literal that produced the anchoring rule, pinned as a named case beside the
  // derived corpus: `sk-` is a substring of `task-start`, which appears in nearly every
  // commit this project makes.
  for (const pattern of SECRET_PATTERNS) {
    const re = new RegExp(pattern.regex);
    assert.ok(!re.test("task-start"), `${pattern.id} matches the literal task-start`);
    assert.ok(!re.test("/marvin:task-start"), `${pattern.id} matches /marvin:task-start`);
  }

  // Kebab-case identifiers are not key shapes. The anchor alone does not settle this:
  // `sk-workflow-latency-optimization` is inert inside `task-workflow-…`, where the
  // preceding letter defeats `\b`, and live after a bullet or a path separator, where
  // nothing does. Both forms of the same slug are pinned, for every pattern.
  const slug = "workflow-latency-optimization";
  for (const pattern of SECRET_PATTERNS) {
    const re = new RegExp(pattern.regex);
    for (const probe of [
      `task-${slug}`,
      `- sk-${slug}`,
      `docs/sk-${slug}.md`,
      `glpat-${slug}-token`,
      `xoxb-${slug}-token`,
    ]) {
      assert.ok(!re.test(probe), `${pattern.id} matches the kebab-case identifier ${probe}`);
    }
  }

  // And no pattern is satisfiable by a bare prefix. The prefix is DERIVED from the
  // pattern rather than listed: the leading run of literal characters, which is exactly
  // what a bare-substring pattern like `sk-` or `ghp_` would consist of. Neither it nor
  // it plus a short tail may match, so every pattern demands real shape beyond its
  // recognisable head.
  for (const pattern of SECRET_PATTERNS) {
    const head = /^((?:[^[\](){}|*+?.\\^$])*)/.exec(pattern.regex.replace(/^\\b/, ""))[1];
    const re = new RegExp(pattern.regex);
    for (let tail = 0; tail <= 8; tail += 1) {
      const probe = head + "A".repeat(tail);
      assert.ok(
        !re.test(probe),
        `${pattern.id} matches its own ${probe.length}-character prefix "${probe}" — a bare prefix is not acceptable`,
      );
    }
  }
});

test("a published example credential is exempt, and only it", () => {
  // AWS's canonical documented example id, written out on purpose: it is public,
  // non-secret, printed in AWS's own guides, and present in this repository's audit
  // widget fixture — where it was the ONLY match in the whole tracked tree. Denying it
  // would block whoever next edits that fixture, and a guard that blocks routine work
  // gets switched off. A real key of the same shape must still be caught, so it is
  // assembled from parts here rather than written as a literal.
  const example = "AKIAIOSFODNN7EXAMPLE";
  const real = `AKIA${"Q7X2M4B9K1TDLW3Z"}`;
  const aws = new RegExp(SECRET_PATTERNS.find((p) => p.id === "aws-access-key-id").regex);

  // The exemption subtracts from a MATCH, never from the pattern: both still match.
  assert.ok(aws.test(example), "the example id no longer matches — the exemption is moot");
  assert.ok(aws.test(real));
  assert.equal(isExemptMatch(example), true);
  assert.equal(isExemptMatch(real), false);

  const diffFor = (line) =>
    ["diff --git a/f.ts b/f.ts", "--- a/f.ts", "+++ b/f.ts", "@@ -0,0 +1,1 @@", `+${line}`].join(
      "\n",
    );

  // End to end through the scanner the guard runs: the fixture's own line is clean.
  assert.deepEqual(scanAddedLines(diffFor(`AWS_SECRET_ACCESS_KEY=${example}`)), []);
  assert.deepEqual(scanAddedLines(diffFor(`const key = "${real}";`)), [
    { id: "aws-access-key-id", file: "f.ts", line: 1 },
  ]);

  // And an exempt match on a line does not shadow a real one beside it — the scan is
  // per match, not per line.
  assert.deepEqual(scanAddedLines(diffFor(`${example} ${real}`)), [
    { id: "aws-access-key-id", file: "f.ts", line: 1 },
  ]);
});

// ── AC9 — disclosure and the plugin trees ───────────────────────────────────

test("every disclosure surface and every plugin tree carries the hooks layer", () => {
  // The instrument table in the architecture tour.
  const architecture = read("docs", "architecture.md");
  assert.match(
    architecture,
    /^\| Hook \| .*hooks\/hooks\.json.* \| .*PreToolUse.* \|$/m,
    "docs/architecture.md's instrument table has no Hook row",
  );

  // The System-at-a-glance subgraph — the third artifact enumerating the plugin's
  // components, ADR-0001's copy of the tree being history that is never edited.
  const subgraph = /```mermaid\n([\s\S]*?)\n```/.exec(architecture);
  assert.ok(subgraph, "docs/architecture.md has no System-at-a-glance diagram");
  assert.match(subgraph[1], /HOOKS\[/, "the System-at-a-glance subgraph has no hooks node");
  assert.match(
    subgraph[1],
    /CC -->\|[^|]*\| HOOKS/,
    "the hooks edge must come from Claude Code: a hook is the one component invoked with neither a user nor a model asking for it",
  );

  // BOTH living-doc plugin trees. These two are the only ones in the tree.
  for (const file of ["CLAUDE.md", "CONTRIBUTING.md"]) {
    const text = read(file);
    const tree = /```\nplugins\/marvin\/\n([\s\S]*?)```/.exec(text);
    assert.ok(tree, `${file} no longer carries the plugin tree this test pins`);
    assert.match(tree[1], /hooks\//, `${file}'s plugin tree does not show hooks/`);
  }

  // The three disclosure surfaces ADR-0040 §2 names. Each must state that marvin can
  // block a shell command AND how to turn it off — a statement without an escape is
  // not a disclosure.
  const configuration = read("docs", "configuration.md");
  assert.match(configuration, /^### `hooks`$/m);
  assert.match(configuration, /block a shell command/i);
  assert.match(configuration, /hooks\.enabled/);
  assert.match(configuration, /MARVIN_HOOKS_DISABLED/);
  assert.match(
    configuration,
    /MARVIN_TASKS_CONFIG/,
    "the divergence must be named where the kill switch is documented",
  );
  assert.match(configuration, /^\| `MARVIN_HOOKS_DISABLED` \|/m);

  // BOTH READMEs. The plugin's own is the copy a marketplace listing renders and the
  // page an installer reads next to the install command, so silence there is silence on
  // the surface where consent is actually given. It was the one install-facing surface
  // left out, which is why it is enumerated here rather than asserted once.
  for (const path of [["README.md"], ["plugins", "marvin", "README.md"]]) {
    const readme = read(...path);
    const where = path.join("/");
    assert.match(readme, /block a shell command/i, `${where} does not disclose the blocking`);
    assert.match(readme, /MARVIN_HOOKS_DISABLED=1/, `${where} does not carry the env kill switch`);
    assert.match(
      readme,
      /hooks.*enabled.*false|"hooks": \{ "enabled": false \}/,
      `${where} does not carry the config kill switch`,
    );
  }

  // The plugin description, in both manifests — the copy a marketplace listing shows.
  const pluginJson = JSON.parse(read("plugins", "marvin", ".claude-plugin", "plugin.json"));
  const marketplace = JSON.parse(read(".claude-plugin", "marketplace.json"));
  const entry = marketplace.plugins.find((p) => p.name === "marvin");
  assert.ok(entry, "the marketplace manifest no longer lists the marvin plugin");
  for (const [label, description] of [
    ["plugin.json", pluginJson.description],
    ["marketplace.json", entry.description],
  ]) {
    assert.match(description, /block/i, `${label}'s description does not disclose the blocking`);
    assert.match(
      description,
      /disabl/i,
      `${label}'s description does not say the guards can be disabled`,
    );
  }

  // The manifest key stays absent: the loader auto-discovers hooks/hooks.json and a
  // manifest key naming the same path is a loader error, not a duplicate.
  assert.equal("hooks" in pluginJson, false);
});

// ── AC13 — the architecture counts, recounted from the tree ─────────────────

test("the architecture counts match a recount of the tree", () => {
  const architecture = read("docs", "architecture.md");
  const toolsDir = join(packDir, "mcp", "server", "src", "tools");

  const toolFiles = readdirSync(toolsDir).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
  const widgetFiles = readdirSync(join(packDir, "widgets")).filter((file) =>
    file.endsWith(".html"),
  );
  const boundTools = toolFiles.filter((file) =>
    readFileSync(join(toolsDir, file), "utf8").includes("resourceUri"),
  );

  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ];
  const word = (n) => {
    assert.ok(n < words.length, `recount ${n} is past this test's number vocabulary`);
    return words[n];
  };
  const capitalised = (n) => word(n).replace(/^./, (c) => c.toUpperCase());

  assert.ok(
    architecture.includes(`${capitalised(toolFiles.length)} MCP tools sit behind the prompts`),
    `docs/architecture.md does not say "${capitalised(toolFiles.length)} MCP tools" — there are ${toolFiles.length} files under src/tools/`,
  );
  assert.ok(
    architecture.includes(`Marvin ships ${word(widgetFiles.length)} such widgets`),
    `docs/architecture.md does not say "${word(widgetFiles.length)} such widgets" — there are ${widgetFiles.length} committed widget documents`,
  );
  assert.ok(
    architecture.includes(
      `${capitalised(boundTools.length)} of the ${word(toolFiles.length)} tools bind a widget`,
    ),
    `docs/architecture.md does not say "${capitalised(boundTools.length)} of the ${word(toolFiles.length)} tools bind a widget" — ${boundTools.length} of ${toolFiles.length} tool modules carry a resourceUri`,
  );
});
