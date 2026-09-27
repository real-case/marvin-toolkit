import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for `src/lib/scope.ts` (ADR-0045): the `scope.exempt` pattern
 * matcher and `partitionScope`, the one judgement the scope gate and the
 * metrics roll-up both call. The e2e half — a real git repository and the
 * gate's answer — is in `spec.test.mjs`; the roll-up half in
 * `metrics-rollup.test.mjs`.
 */

const { matchesExemptPattern, exemptPatternIssue, compileExemptions, partitionScope } =
  await importTs("src/lib/scope.ts");

const yes = (path, pattern) =>
  assert.equal(matchesExemptPattern(path, pattern), true, `${pattern} should match ${path}`);
const no = (path, pattern) =>
  assert.equal(matchesExemptPattern(path, pattern), false, `${pattern} should not match ${path}`);

test("`**` matches zero or more whole segments, at the start, the middle and the end", () => {
  // leading: zero segments (the root) and any depth
  yes("x.d.mts", "**/*.d.mts");
  yes("scripts/commit-attribution.d.mts", "**/*.d.mts");
  yes("a/b/c/x.d.mts", "**/*.d.mts");
  no("scripts/commit-attribution.mjs", "**/*.d.mts");
  // middle: zero or more segments between two literals
  yes("a/b", "a/**/b");
  yes("a/x/y/b", "a/**/b");
  no("a/xb", "a/**/b");
  no("za/b", "a/**/b");
  // trailing: everything under the directory, at any depth, and not the directory's name alone
  yes(".claude/agent-memory/contract-test-critic/MEMORY.md", ".claude/agent-memory/**");
  yes(".claude/agent-memory/MEMORY.md", ".claude/agent-memory/**");
  no(".claude/agent-memory", ".claude/agent-memory/**");
  no(".claude/agent-memory-local/x/MEMORY.md", ".claude/agent-memory/**");
  no(".claude/settings.json", ".claude/agent-memory/**");
});

test("a single `*` stays inside one segment, and `?` is exactly one character", () => {
  yes("scripts/a.d.mts", "scripts/*.d.mts");
  no("scripts/sub/a.d.mts", "scripts/*.d.mts", "`*` does not cross a slash");
  yes("bun.lock", "*.lock");
  no("packages/x/bun.lock", "*.lock", "anchored at the root: no implicit any-depth");
  yes("packages/x/bun.lock", "**/bun.lock");
  yes("a1.txt", "a?.txt");
  no("a12.txt", "a?.txt");
  no("a/.txt", "a?.txt", "`?` does not match a slash");
  // `**` inside a segment is read as `*`
  yes("foo-bar.lock", "foo**.lock");
  no("foo/bar.lock", "foo**.lock");
});

test("a leading-dot directory or file is matched literally and by wildcards alike", () => {
  yes(".claude/agent-memory/r/MEMORY.md", ".claude/agent-memory/**");
  no("claude/agent-memory/r/MEMORY.md", ".claude/agent-memory/**", "the dot is literal");
  no("xclaude/agent-memory/r/MEMORY.md", ".claude/agent-memory/**", "the dot is not a wildcard");
  // wildcards match a dot-prefixed segment — no shell dotfile rule
  yes(".claude/agent-memory/r/MEMORY.md", "*/agent-memory/**");
  yes(".hidden/x.d.mts", "**/*.d.mts");
  yes("src/.cache/x.d.mts", "**/*.d.mts");
  yes(".eslintcache", "*cache");
});

test("every other character is literal — brackets, braces and regex metacharacters", () => {
  yes("app/[id]/page.tsx", "app/[id]/page.tsx");
  no("app/i/page.tsx", "app/[id]/page.tsx");
  yes("a+b(c)|d$.txt", "a+b(c)|d$.txt");
  no("a.js", "*.{js,ts}", "no brace expansion");
});

test("a leading ./ and a trailing / are normalised; paths are normalised the same way", () => {
  yes("bun.lock", "./bun.lock");
  yes(".claude/agent-memory/r/MEMORY.md", ".claude/agent-memory/");
  yes("./bun.lock", "bun.lock");
});

test("unusable patterns are refused with a reason, and never match", () => {
  const refused = [
    "",
    "   ",
    "/bun.lock",
    "a\\b",
    "!bun.lock",
    "a/../b",
    "./",
    "a//b",
    "**",
    "*",
    "**/*",
    "*/?",
  ];
  for (const p of refused) {
    assert.ok(exemptPatternIssue(p), `${JSON.stringify(p)} should be refused`);
    assert.equal(matchesExemptPattern("bun.lock", p), false);
  }
  for (const p of ["bun.lock", "**/*.d.mts", ".claude/agent-memory/**", "a?.txt", "app/[id]/x"]) {
    assert.equal(exemptPatternIssue(p), null, `${p} should be accepted`);
  }
  const { matchers, rejected } = compileExemptions(["bun.lock", "/abs", "**"]);
  assert.deepEqual(
    matchers.map((m) => m.pattern),
    ["bun.lock"],
  );
  assert.deepEqual(
    rejected.map((r) => r.pattern),
    ["/abs", "**"],
  );
  assert.match(rejected[1].issue, /every changed file/);
});

test("partitionScope: marvin's files, then the allowlist, then the exemptions — in that order", () => {
  const part = partitionScope(
    [
      "src/a.ts", // declared
      "./src/b.ts", // undeclared, normalised
      ".marvin/task/runs/x.mutations.py", // marvin's own — never judged
      "specs/001-demo.md", // the spec itself — never judged
      ".claude/agent-memory/r/MEMORY.md", // exempt
      "bun.lock", // declared AND matching a pattern — declared wins
      "scripts/x.d.mts", // exempt by the second pattern
      "",
    ],
    {
      allowlist: ["src/a.ts", "./bun.lock"],
      specPath: "./specs/001-demo.md",
      exempt: [".claude/agent-memory/**", "**/*.d.mts", "bun.lock", "/bad"],
    },
  );
  assert.deepEqual(part.judged, [
    "src/a.ts",
    "src/b.ts",
    ".claude/agent-memory/r/MEMORY.md",
    "bun.lock",
    "scripts/x.d.mts",
  ]);
  assert.deepEqual(part.outside, ["src/b.ts"]);
  assert.deepEqual(part.exempt, [
    { path: ".claude/agent-memory/r/MEMORY.md", pattern: ".claude/agent-memory/**" },
    { path: "scripts/x.d.mts", pattern: "**/*.d.mts" },
  ]);
  assert.deepEqual(
    part.rejected.map((r) => r.pattern),
    ["/bad"],
  );
});

test("partitionScope with no exemptions is today's rule: .marvin/ and the spec out, everything undeclared outside", () => {
  for (const exempt of [undefined, null, []]) {
    const part = partitionScope([".claude/agent-memory/r/MEMORY.md", "src/a.ts", ".marvin/x.md"], {
      allowlist: ["src/a.ts"],
      specPath: null,
      exempt,
    });
    assert.deepEqual(part.judged, [".claude/agent-memory/r/MEMORY.md", "src/a.ts"]);
    assert.deepEqual(part.outside, [".claude/agent-memory/r/MEMORY.md"]);
    assert.deepEqual(part.exempt, []);
    assert.deepEqual(part.rejected, []);
  }
});

test("the first matching pattern, in configured order, is the one reported", () => {
  const part = partitionScope([".claude/agent-memory/r/x.d.mts"], {
    allowlist: [],
    specPath: null,
    exempt: ["**/*.d.mts", ".claude/agent-memory/**"],
  });
  assert.deepEqual(part.exempt, [
    { path: ".claude/agent-memory/r/x.d.mts", pattern: "**/*.d.mts" },
  ]);
});
