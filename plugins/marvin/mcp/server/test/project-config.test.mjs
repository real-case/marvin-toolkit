// marvin-toolkit's own committed pipeline configuration (plan Task 19): `.marvin/config.json`,
// `.marvin/pipeline/rubric.yaml` and `.marvin/pipeline/checks.yaml`, read through the loaders the
// engine and every marvin tool use.
//
// Each loader forgives on purpose. zod strips an unknown key, so a mistyped `gate_timeout_minute`
// vanishes; a `pipeline` or `gates.extra` subtree that fails its schema is reset to its defaults
// while the rest of the file stands; a check rule's mistyped `path_patern` is dropped and the rule
// then applies to every path. Each of those is a run that behaves as nobody configured it, and the
// engine reports none of them while it runs. These tests fail instead.
//
// The files are committed and are protected paths in a pipeline run, so a run worktree holds them
// exactly as the base commit does: reading them here reads tracked state, never local state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { importTs } from "./_tsload.mjs";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const read = (...parts) => readFileSync(join(repoRoot, ...parts), "utf8");
const CONFIG_PATH = join(repoRoot, ".marvin", "config.json");

const { loadConfig, scopeExemptWarnings } = await importTs("src/storage/config.ts");
const { resolveGatePlan } = await importTs("src/lib/gate-plan.ts");
const { partitionScope } = await importTs("src/lib/scope.ts");
const { formatTestOne } = await importTs("src/pipeline/seal.ts");
const { loadRubric, readSignals, tierFor } = await importTs("src/pipeline/assess.ts");
const { CheckRuleShape } = await importTs("src/pipeline/runtime.ts");
const { scanChecks } = await importTs("src/pipeline/gate.ts");
const { regexHazard } = await importTs("src/pipeline/learning.ts");
const { validatePrefix } = await importTs("src/pipeline/command.ts");
const { routeTestFile } = await import(
  new URL("../../../../../scripts/test-one.mjs", import.meta.url)
);

const raw = JSON.parse(read(".marvin", "config.json"));
const loaded = loadConfig(CONFIG_PATH);
const { config } = loaded;
const pipeline = config.pipeline;

/** git with no inherited GIT_* variable, so an ambient GIT_DIR cannot choose the repository. */
const git = (...args) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  return execFileSync("git", args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
};
const tracked = git("ls-files", "-z").toString("utf8").split("\0").filter(Boolean);

/** Paths `raw` sets whose value the parsed config does not hold: a stripped key or a reset subtree. */
function lost(rawValue, parsed, path = []) {
  const here = path.join(".") || "(root)";
  if (Array.isArray(rawValue)) {
    if (!Array.isArray(parsed) || parsed.length !== rawValue.length) return [here];
    return rawValue.flatMap((v, i) => lost(v, parsed[i], [...path, i]));
  }
  if (rawValue !== null && typeof rawValue === "object") {
    if (parsed === null || typeof parsed !== "object") return [here];
    return Object.keys(rawValue).flatMap((k) =>
      Object.hasOwn(parsed, k)
        ? lost(rawValue[k], parsed[k], [...path, k])
        : [[...path, k].join(".")],
    );
  }
  return Object.is(rawValue, parsed) ? [] : [here];
}

test("the committed config loads whole: no warning, no reset subtree, no ignored pattern", () => {
  assert.equal(loaded.warning, null);
  assert.deepEqual(loaded.settingWarnings, []);
  assert.deepEqual(loaded.pipelineIssues, []);
  assert.equal(loaded.base_branch_source, "config");
  assert.deepEqual(scopeExemptWarnings(config), []);
});

test("every value the committed config sets survives the schema unchanged", () => {
  assert.deepEqual(lost(raw, config), []);
  // The lost() walk is only as good as the keys it is given: these are the ones the engine reads.
  for (const key of [
    "branch_template",
    "tracker_default",
    "bootstrap",
    "github",
    "stall_minutes",
    "gate_timeout_minutes",
    "test_path_pattern",
    "scope_exempt_pattern",
    "format_command",
    "conventions",
    "allowed_commands",
  ]) {
    assert.ok(Object.hasOwn(raw.pipeline, key), `pipeline.${key} is set explicitly`);
  }
  for (const key of ["base_branch", "statuses", "spec", "scope", "merge_obligations", "gates"]) {
    assert.ok(Object.hasOwn(raw, key), `${key} is set explicitly`);
  }
});

test("the gate plan is test, lint, build and the declared extras, with no detected typecheck", () => {
  const plan = resolveGatePlan({ projectRoot: repoRoot, gates: config.gates });
  assert.deepEqual(
    plan.gates.map((g) => g.name),
    ["test", "lint", "build", ...raw.gates.extra.map((g) => g.name)],
  );
  assert.deepEqual(
    plan.gates.map((g) => g.command),
    [raw.gates.test, raw.gates.lint, raw.gates.build, ...raw.gates.extra.map((g) => g.command)],
  );
  // The drift guards compare against HEAD, so before a commit they fail on a correct rebuild:
  // as gates they would fail every interactive verify and the executor's self-check. CI runs them.
  for (const guard of ["verify-dist", "verify-widgets"]) {
    assert.ok(
      plan.gates.every((g) => !g.command.includes(guard)),
      `${guard} is not a gate: it judges the commit, and verify runs before one`,
    );
  }
});

test("gates.test_one is a template the seal stage accepts, and the verifier's probe is allowed", () => {
  const template = config.gates.test_one;
  assert.equal(
    formatTestOne(template, "plugins/marvin/mcp/server/test/a b.test.mjs"),
    "node scripts/test-one.mjs 'plugins/marvin/mcp/server/test/a b.test.mjs'",
  );
  const probe = template.slice(0, template.indexOf("{file}")).trim();
  validatePrefix(probe);
  assert.ok(pipeline.allowed_commands.includes(probe), "the writing roles may run one test too");
});

test("test_path_pattern selects exactly the files test_one can run, in every workspace", () => {
  const sealable = new RegExp(pipeline.test_path_pattern);
  const disagree = tracked.filter((f) => sealable.test(f) !== !routeTestFile(f).refused);
  assert.deepEqual(disagree, []);
  for (const dir of [
    "test/",
    "plugins/marvin/mcp/server/test/",
    "packages/marvin-mcp-shared/test/",
    "packages/site/test/",
    "packages/marvin-widgets/src/",
  ]) {
    assert.ok(
      tracked.some((f) => f.startsWith(dir) && sealable.test(f)),
      `a test-author can write under ${dir}`,
    );
  }
  for (const outside of [
    "packages/site/e2e/home.spec.ts",
    "test/fixtures/autopilot-sandbox/project/test/math.test.mjs",
    "plugins/marvin/mcp/server/test/_driver.mjs",
    "plugins/marvin/mcp/server/test/nested/a.test.mjs",
    "evals/autopilot/replay/sandbox/project/test/clamp.test.mjs",
  ]) {
    assert.equal(sealable.test(outside), false, outside);
  }
});

test("the pipeline's scope regex and scope.exempt exempt the same files", () => {
  const regex = new RegExp(pipeline.scope_exempt_pattern);
  const glob = (f) =>
    partitionScope([f], { allowlist: [], specPath: null, exempt: config.scope.exempt }).exempt
      .length === 1;
  const byProducts = [
    "plugins/marvin/mcp/server/dist/server.js",
    "plugins/marvin/mcp/server/dist/marvin-pipe.js",
    "plugins/marvin/widgets/help.html",
    "packages/site/src/data/catalog.json",
    "package.json",
    "packages/marvin-mcp-shared/package.json",
    "packages/marvin-widgets/package.json",
    "packages/site/package.json",
    "plugins/marvin/mcp/server/package.json",
    "plugins/marvin/.claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
  ];
  const planned = [
    "plugins/marvin/CHANGELOG.md",
    "package-lock.json",
    "packages/site/src/data/casts.json",
    "packages/site/src/data/og.json",
    "packages/site/src/data/pages.json",
    "plugins/marvin/mcp/server/src/server.ts",
    "test/fixtures/autopilot-sandbox/project/package.json",
  ];
  for (const f of byProducts) assert.ok(regex.test(f) && glob(f), `${f} is a by-product`);
  for (const f of planned) assert.ok(!regex.test(f) && !glob(f), `${f} is planned work`);
  assert.deepEqual(
    tracked.filter((f) => regex.test(f) !== glob(f)),
    [],
  );
});

test("allowed_commands leaves out the prefixes that would get round the guards", () => {
  for (const prefix of pipeline.allowed_commands) validatePrefix(prefix);
  for (const broad of [
    "node",
    "npx",
    "npm run",
    "npm exec",
    "npm install",
    "npm run eval",
    "npm run eval:trigger",
    "npm run dev",
    "node scripts/mcp-call.mjs",
  ]) {
    assert.ok(!pipeline.allowed_commands.includes(broad), `${broad} is not allowed`);
  }
  // npm 11 reads options that follow `npx --no <tool>` as its own, so `--write` would never reach
  // prettier and finalize would format nothing; `--` ends npm's options.
  assert.match(pipeline.format_command, /^npx --no -- prettier --write --ignore-unknown$/);
});

const DEFAULT_RUBRIC = read("plugins", "marvin", "pipeline", "rubric.default.yaml");
const PROJECT_RUBRIC = read(".marvin", "pipeline", "rubric.yaml");

test("the project rubric merges over the default and leaves its bounds and roles alone", () => {
  const rubric = loadRubric(DEFAULT_RUBRIC, PROJECT_RUBRIC);
  const plain = loadRubric(DEFAULT_RUBRIC, null);
  for (const key of ["tiers", "assignments", "escalation", "caps", "slicing"]) {
    assert.deepEqual(rubric[key], plain[key], key);
  }
  assert.deepEqual(Object.keys(parse(PROJECT_RUBRIC)).sort(), [
    "cross_repo_markers",
    "sensitive_paths",
    "version",
  ]);
  // A pattern that matches no tracked file is a typo or a moved path, and protects nothing.
  for (const pattern of rubric.sensitive_paths) {
    const re = new RegExp(pattern);
    assert.ok(
      tracked.some((f) => re.test(f)),
      `sensitive path ${pattern} matches a tracked file`,
    );
  }
});

test("the project rubric makes the engine and its judges heavy, and routine work not", () => {
  const rubric = loadRubric(DEFAULT_RUBRIC, PROJECT_RUBRIC);
  const tierOf = (paths, { risk = "low", extra = "" } = {}) => {
    const spec =
      `---\nslug: x\ntype: feature\nrisk: ${risk}\n${extra}---\n# X\n\n` +
      "```yaml spec-contract\nfiles:\n" +
      paths.map((p) => `  - path: ${p}\n    action: edit`).join("\n") +
      "\ncriteria:\n  - id: AC1\n```\n";
    return tierFor(readSignals(spec, rubric), rubric).tier;
  };
  for (const engine of [
    "plugins/marvin/mcp/server/src/pipeline/gate.ts",
    "plugins/marvin/skills/task-start/SKILL.md",
    "plugins/marvin/mcp/server/src/storage/spec.ts",
    "scripts/test-one.mjs",
    "plugins/marvin/mcp/server/test/_driver.mjs",
    ".github/workflows/validate-plugins.yml",
  ]) {
    assert.equal(tierOf([engine]), "heavy", engine);
  }
  for (const routine of [
    "plugins/marvin/mcp/server/src/tools/dashboard.ts",
    "plugins/marvin/skills/changelog/SKILL.md",
    "scripts/smoke-commands.mjs",
    "packages/site/src/pages/index.astro",
    "plugins/marvin/.claude-plugin/plugin.json",
  ]) {
    assert.equal(tierOf([routine]), "light", routine);
  }
  assert.equal(tierOf(["src/a.ts"], { extra: "breaking: true\n" }), "heavy");
  assert.equal(tierOf(["src/a.ts"], { extra: "breaking: false\n" }), "light");
});

const RULES = parse(read(".marvin", "pipeline", "checks.yaml"));
const DEFAULT_RULES = parse(read("plugins", "marvin", "pipeline", "checks.default.yaml"));

test("checks.yaml parses into rules the gate stage keeps whole", () => {
  assert.ok(Array.isArray(RULES) && RULES.length > 0);
  const known = Object.keys(CheckRuleShape.shape);
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const id of DEFAULT_RULES.map((r) => r.id))
    assert.ok(!ids.includes(id), `${id} is a default id`);
  for (const rule of RULES) {
    assert.deepEqual(
      Object.keys(rule).filter((k) => !known.includes(k)),
      [],
      `${rule.id} has only keys the gate reads`,
    );
    assert.ok(CheckRuleShape.safeParse(rule).success, rule.id);
    for (const field of ["pattern", "path_pattern", "exclude_pattern"]) {
      if (rule[field] !== undefined) {
        assert.equal(regexHazard(rule[field]), null, `${rule.id}.${field}`);
      }
    }
  }
});

test("the checks let a version bump through and catch what they exist for", () => {
  const hits = (file, text) =>
    scanChecks([{ file, line: 1, text }], RULES).map((h) => `${h.id}:${h.severity}`);
  // A version bump, as sync-version writes it.
  assert.deepEqual(hits("package.json", '  "version": "0.30.0",'), []);
  assert.deepEqual(hits("packages/site/package.json", '  "version": "0.30.0",'), []);
  assert.deepEqual(hits("plugins/marvin/.claude-plugin/plugin.json", '  "version": "0.30.0",'), []);
  assert.deepEqual(hits(".claude-plugin/marketplace.json", '      "version": "0.30.0",'), []);
  // A gate script redefined, a lifecycle hook added, a new script, a dependency.
  assert.deepEqual(hits("packages/site/package.json", '    "test": "true",'), [
    "gate-script:major",
    "package-manifest-edit:minor",
  ]);
  assert.deepEqual(hits("package.json", '    "postinstall": "node x.mjs",'), [
    "gate-script:major",
    "package-manifest-edit:minor",
  ]);
  assert.deepEqual(hits("package.json", '    "dev:watch": "node scripts/dev-watch.mjs",'), [
    "package-manifest-edit:minor",
  ]);
  assert.deepEqual(
    hits("test/fixtures/autopilot-sandbox/project/package.json", '  "test": "x"'),
    [],
  );
  assert.deepEqual(hits("plugins/marvin/.claude-plugin/plugin.json", '  "description": "x",'), [
    "manifest-edit:major",
  ]);
  // Skipped and todo tests, and the forms that are not.
  for (const line of [
    'test("x", { skip: true }, () => {});',
    'describe("x", { todo: "later" }, () => {});',
    'test("x", { skip: process.platform === "win32" }, () => {});',
    't.test("x", { timeout: 5000, todo: true }, () => {});',
    "test(name, { skip: !hasGit }, async () => {",
    // A wrapped call puts its options alone on a line, as Prettier does.
    '  { skip: process.platform !== "darwin" },',
    '  { skip: canWrite ? false : "cannot simulate an unwritable dir here" },',
    't.skip("flaky");',
    'it.todo("later");',
  ]) {
    assert.deepEqual(hits("test/a.test.mjs", line), ["test-skip-option:major"], line);
  }
  // `todo` is a status role in marvin's board, dashboard and task-list domain, so its roll-ups
  // (`counts`, `role_counts`, `board_counts`, `board_role_counts`) are written `{ todo: N, ... }`
  // throughout the tests, and so are other role-keyed maps. None is a test option.
  for (const line of [
    'test("x", { skip: false }, () => {});',
    "board_counts: { todo: 1, wip: 0, done: 2 },",
    "assert.deepEqual(res.structuredContent.role_counts, { todo: 2, wip: 1 });",
    "const payload = { tasks: [], counts: { todo: 0, wip: 1 } };",
    "  { todo: 2, wip: 1 },",
    'const tones = { todo: "neutral", wip: "info" };',
    "const byRole = { todo: TOKENS.bd2, wip: TOKENS.acc };",
    'test("counts", () => assert.deepEqual(c, { todo: 2 }));',
    "const page = list(all, { skip: 10, limit: 5 });",
  ]) {
    assert.deepEqual(hits("test/a.test.mjs", line), [], line);
  }
  // Server stdout and browser SDKs, and the pipeline CLI that prints JSON by design.
  assert.deepEqual(hits("plugins/marvin/mcp/server/src/tools/x.ts", 'console.log("x");'), [
    "server-stdout:major",
  ]);
  assert.deepEqual(hits("plugins/marvin/mcp/server/src/tools/x.ts", 'console.error("x");'), []);
  assert.deepEqual(
    hits("plugins/marvin/mcp/server/src/pipeline/cli.ts", "process.stdout.write(x);"),
    [],
  );
  assert.deepEqual(
    hits(
      "plugins/marvin/mcp/server/src/resources/w.ts",
      'import { App } from "@modelcontextprotocol/ext-apps";',
    ),
    ["server-browser-sdk:major"],
  );
  assert.deepEqual(
    hits("packages/marvin-mcp-shared/src/x.ts", "import { h } from 'preact/hooks';"),
    ["server-browser-sdk:major"],
  );
  // innerHTML in JSX, and the word in a comment.
  assert.deepEqual(
    hits(
      "packages/marvin-widgets/src/widgets/x/X.tsx",
      "<div dangerouslySetInnerHTML={{ __html: s }} />",
    ),
    ["widget-inner-html:major"],
  );
  assert.deepEqual(
    hits("packages/marvin-widgets/src/primitives/M.tsx", " * never `dangerouslySetInnerHTML`"),
    [],
  );
  // A file that decides what a gate sees is flagged for the verifier, never rejected.
  assert.deepEqual(hits(".prettierignore", "packages/"), ["gate-definition-edit:minor"]);
  assert.deepEqual(hits("packages/site/.gitignore", "dist/"), ["gate-definition-edit:minor"]);
});

test("over the tracked tests, the skip rule finds the skipped tests and no role roll-up", () => {
  // The added-line form of every tracked test file: what the rule meets when a run rewrites one.
  const rule = RULES.filter((r) => r.id === "test-skip-option");
  const only = new RegExp(rule[0].path_pattern);
  const lines = tracked
    .filter((f) => only.test(f) && f !== "plugins/marvin/mcp/server/test/project-config.test.mjs")
    .flatMap((file) =>
      read(file)
        .split("\n")
        .map((text, i) => ({ file, line: i + 1, text })),
    );
  const found = scanChecks(lines, rule, 10_000);
  assert.ok(
    found.every((h) => !h.timedOut),
    "the rule scans the whole corpus within its budget",
  );
  const roleRollUp = /\btodo\s*:\s*\d/;
  assert.deepEqual(
    found.filter((h) => roleRollUp.test(h.text)).map((h) => `${h.file}:${h.line}`),
    [],
  );
  // The corpus's own conditional skips sit on the options line of a wrapped call.
  for (const file of [
    "plugins/marvin/mcp/server/test/pipeline-seal.test.mjs",
    "plugins/marvin/mcp/server/test/pipeline-worktree.test.mjs",
    "plugins/marvin/mcp/server/test/usage-log.test.mjs",
  ]) {
    assert.ok(
      found.some((h) => h.file === file),
      `${file} holds a conditional skip the rule sees`,
    );
  }
});

test("git versions the project settings, keeps the local spec corpus out, and unions the legacy calibration log", () => {
  const ignored = (path) => {
    try {
      git("check-ignore", "-q", "--no-index", path);
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };
  for (const path of [
    ".marvin/config.json",
    ".marvin/pipeline/rubric.yaml",
    ".marvin/pipeline/checks.yaml",
    ".marvin/pipeline/calibration.jsonl",
    ".marvin/pipeline/calibration/r20261018-0000-abcd.json",
    ".marvin/memory/MEMORY.md",
    ".marvin/metrics/001-x.md",
  ]) {
    assert.equal(ignored(path), false, `${path} is versioned`);
  }
  for (const path of [
    ".marvin/task/001-x.md",
    ".marvin/task/runs/x.progress.md",
    ".marvin/usage/events.jsonl",
  ]) {
    assert.equal(ignored(path), true, `${path} stays local`);
  }
  for (const path of [
    ".marvin/config.json",
    ".marvin/pipeline/rubric.yaml",
    ".marvin/pipeline/checks.yaml",
  ]) {
    assert.ok(tracked.includes(path), `${path} is committed`);
  }
  // The legacy calibration log (before ADR-0050) is appended to by run branches an earlier
  // engine finalized; a local merge of two such branches keeps both records. The per-run files
  // need no attribute: two runs write two files.
  assert.match(
    git("check-attr", "merge", "--", ".marvin/pipeline/calibration.jsonl").toString("utf8"),
    /: merge: union$/m,
  );
});
