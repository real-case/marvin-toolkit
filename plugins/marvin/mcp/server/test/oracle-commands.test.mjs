import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

const { resolveOracles, resolveCriteria, parseContractCriteria } =
  await importTs("src/lib/oracles.ts");

const FENCE = "```";
const spec = (criteria, frontmatter = "type: feature\ncontract_sha: 0123456789abcdef\n") =>
  [
    "---",
    frontmatter.trimEnd(),
    "---",
    "",
    "# Demo",
    "",
    `${FENCE}yaml spec-contract`,
    "files:",
    "  - { id: F1, path: src/a.ts, action: new }",
    "criteria:",
    ...criteria,
    FENCE,
    "",
  ].join("\n");

const criterion = (id, oracle) =>
  `  - { id: ${id}, statement: it works, implemented_by: [F1], oracle: ${oracle} }`;

const SPEC = spec([
  criterion("AC1", '{ kind: command, ref: "npm run lint && npm run build" }'),
  criterion("AC2", '{ kind: test, ref: "src/a.test.ts::does a thing" }'),
  criterion("AC3", '{ kind: test, ref: "src/b.test.ts::other", run: "node --test src/b.test.ts" }'),
  criterion("AC4", '{ kind: prose-review, ref: "a reviewer reads it" }'),
  criterion("AC5", '{ kind: prose-review, run: "echo never-run" }'),
  criterion("AC6", "{ kind: command }"),
]);

const ids = (rows) => rows.map((r) => r.criterion);

test("each runnable criterion gets the command a human wrote, and an unresolved one says why", () => {
  assert.deepEqual(resolveOracles(SPEC), [
    { criterion: "AC1", command: "npm run lint && npm run build", reason: null },
    { criterion: "AC2", command: null, reason: "no-single-test-command" },
    { criterion: "AC3", command: "node --test src/b.test.ts", reason: null },
    { criterion: "AC6", command: null, reason: "no-ref" },
  ]);
});

test("a test criterion resolves through the project's single-test template", () => {
  assert.deepEqual(resolveOracles(SPEC, { testOne: "node --test {file} -t '{name}'" }), [
    { criterion: "AC1", command: "npm run lint && npm run build", reason: null },
    { criterion: "AC2", command: "node --test 'src/a.test.ts' -t 'does a thing'", reason: null },
    { criterion: "AC3", command: "node --test src/b.test.ts", reason: null },
    { criterion: "AC6", command: null, reason: "no-ref" },
  ]);
});

test("a test criterion falls back to the detected stack's default row", () => {
  assert.deepEqual(
    resolveOracles(SPEC, { stack: "python" }).map((c) => c.command),
    [
      "npm run lint && npm run build",
      "pytest src/a.test.ts::does a thing",
      "node --test src/b.test.ts",
      null,
    ],
  );
});

test("prose-review criteria never appear, even with a run", () => {
  const only = spec([criterion("AC1", '{ kind: prose-review, run: "echo x" }')]);
  assert.deepEqual(resolveOracles(only), []);
  assert.ok(!ids(resolveOracles(SPEC)).includes("AC4"));
  assert.ok(!ids(resolveOracles(SPEC)).includes("AC5"));
});

test("a spec that cannot be read throws instead of reporting no oracles", () => {
  assert.throws(() => resolveOracles("# no contract here\n"), /no .*spec-contract block/);
  assert.throws(
    () => resolveOracles(`${FENCE}yaml spec-contract\nfiles: [\n${FENCE}\n`),
    /not valid YAML/,
  );
  assert.throws(
    () =>
      resolveOracles(
        `${FENCE}yaml spec-contract\nfiles:\n  - { id: F1, path: a, action: new }\n${FENCE}\n`,
      ),
    /spec-contract block is invalid/,
  );
});

test("the criterion resolver is the one verify and the gate share", () => {
  const criteria = parseContractCriteria(
    SPEC.slice(SPEC.indexOf("files:"), SPEC.lastIndexOf(FENCE)),
  ).criteria;
  const rows = resolveCriteria(criteria, { projectRoot: "/p", call: "make check" });
  assert.deepEqual(
    rows.map((r) => r.criterion.id),
    ["AC1", "AC2", "AC3", "AC6"],
  );
  assert.deepEqual(
    rows.map((r) => [r.resolved.command, r.resolved.source]),
    [
      ["make check", "call"],
      ["make check", "call"],
      ["make check", "call"],
      ["make check", "call"],
    ],
  );
  const bare = resolveCriteria(criteria, { projectRoot: "/p" });
  assert.deepEqual(
    bare.map((r) => r.resolved.source),
    ["oracle.ref", null, "oracle.run", null],
  );
});

test("the contract parser reports the same two refusals verify journals", () => {
  assert.match(
    parseContractCriteria("files: [\n").error,
    /^spec-contract block is not valid YAML: /,
  );
  assert.match(parseContractCriteria("files: []\n").error, /^spec-contract block is invalid: /);
  const ok = parseContractCriteria(
    "files:\n  - { id: F1, path: a, action: new }\ncriteria:\n" +
      `${criterion("AC1", "{ kind: command, ref: x }")}\n`,
  );
  assert.deepEqual(
    ok.criteria.map((c) => c.id),
    ["AC1"],
  );
});
