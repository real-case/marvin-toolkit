import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

/**
 * Drive the live stdio server: initialize, then a single tools/call for
 * `verify`, and return the parsed `verify-result` JSON block embedded in the
 * tool's text output. Gates are passed explicitly (fake sleep commands) so the
 * concurrency behaviour is tested deterministically without any toolchain.
 */
async function callVerify(args, blockTag = "verify-result") {
  const result = await callTool("verify", args);
  const text = result.content.map((c) => c.text).join("\n");
  const m = text.match(new RegExp("```json " + blockTag + "\\n([\\s\\S]*?)\\n```"));
  assert.ok(m, `no ${blockTag} block in output:\n${text}`);
  return { parsed: JSON.parse(m[1]), isError: result.isError, text };
}

const PASS = (name) => ({ name, command: "sleep 0.2" });
const FAIL = (name) => ({ name, command: "sleep 0.2; exit 1" });

// AC-1: concurrent gates — every gate recorded; wall-clock < sum-of-gates.
test("AC-1: parallel runs all gates; wall-clock < sum-of-gates", async () => {
  const { parsed } = await callVerify({
    gates: [PASS("test"), PASS("lint"), PASS("build")],
    execution: "parallel",
    write: false,
  });
  assert.equal(parsed.gates.length, 3, "all three gates present");
  assert.ok(
    parsed.wallClockMs < parsed.sumOfGatesMs,
    `wall-clock ${parsed.wallClockMs}ms should be < sum ${parsed.sumOfGatesMs}ms`,
  );
  assert.equal(parsed.verdict, "PASS");
});

// AC-2: verdict parity — parallel and sequential yield the same verdict and findings.
test("AC-2: parallel and sequential agree on verdict and per-gate findings", async () => {
  const gates = [PASS("test"), FAIL("lint"), PASS("build")];
  const par = (await callVerify({ gates, execution: "parallel", write: false })).parsed;
  const seq = (await callVerify({ gates, execution: "sequential", write: false })).parsed;
  assert.equal(par.verdict, seq.verdict, "same verdict");
  const statuses = (r) => Object.fromEntries(r.gates.map((g) => [g.name, g.status]));
  assert.deepEqual(statuses(par), statuses(seq), "same per-gate statuses");
});

// AC-3: no loss on failure — one gate fails, the others' results are still present.
test("AC-3: a failing gate does not discard sibling results", async () => {
  const { parsed, isError } = await callVerify({
    gates: [PASS("test"), FAIL("lint"), PASS("build")],
    execution: "parallel",
    write: false,
  });
  assert.equal(parsed.gates.length, 3, "all three gates still reported");
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(isError, true, "tool flags FAIL as isError");
  const lint = parsed.gates.find((g) => g.name === "lint");
  assert.equal(lint.status, "fail");
  assert.ok(parsed.gates.filter((g) => g.status === "pass").length === 2);
});

// AC-6: fail-fast selectable — stops at first failure, correct (FAIL) verdict.
test("AC-6: fail-fast stops at first failure and reports FAIL", async () => {
  const { parsed } = await callVerify({
    // first gate fails fast; the others would sleep — must not all run.
    gates: [{ name: "test", command: "exit 1" }, PASS("lint"), PASS("build")],
    execution: "fail-fast",
    write: false,
  });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(parsed.gates.length, 1, "fail-fast stops after the first failing gate");
});

// AC-7: latency non-regression — parallel wall-clock strictly < sequential.
test("AC-7: parallel wall-clock is well below sequential", async () => {
  const gates = [PASS("test"), PASS("lint"), PASS("build")];
  const par = (await callVerify({ gates, execution: "parallel", write: false })).parsed;
  const seq = (await callVerify({ gates, execution: "sequential", write: false })).parsed;
  assert.ok(
    par.wallClockMs < seq.wallClockMs,
    `parallel ${par.wallClockMs}ms should be < sequential ${seq.wallClockMs}ms`,
  );
});

// dryRun: reports a plan without executing.
test("dryRun reports a plan and runs nothing", async () => {
  // dryRun returns no verify-result block (nothing executed); assert via tools/call text.
  const res = await callVerifyRaw({
    gates: [PASS("test")],
    dryRun: true,
    write: false,
  });
  assert.match(res, /Verify Plan \(dry run\)/);
  assert.doesNotMatch(res, /verify-result/);
});

// ── open stack detection: declared-command fallback for untabled ecosystems ──

test("an untabled project gets gates from its package.json scripts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-npm-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "jest", lint: "eslint .", build: "tsup" } }),
    );
    const res = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
    assert.match(res, /package\.json scripts/);
    assert.match(res, /npm run test/);
    assert.match(res, /npm run lint/);
    assert.match(res, /npm run build/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an untabled project gets gates from its Makefile targets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-make-"));
  try {
    // VERSION:=1 is a variable, not a target — it must not become a gate.
    writeFileSync(
      join(dir, "Makefile"),
      "VERSION:=1\n\ntest:\n\tgo test ./...\nbuild:\n\tgo build\n",
    );
    const res = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
    assert.match(res, /Makefile/);
    assert.match(res, /make test/);
    assert.match(res, /make build/);
    assert.doesNotMatch(res, /make version/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a truly unknown stack is surfaced, not silently empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-unknown-"));
  try {
    writeFileSync(join(dir, "README.md"), "# just docs\n");
    const res = await callVerifyRaw({ projectRoot: dir, write: false });
    assert.match(res, /No quality gates detected/);
    assert.match(res, /Declare them in/); // now points at .marvin/config.json too
    assert.match(res, /pass an explicit/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── config-first gate resolution: .marvin/config.json `gates` (ADR-0009) ──

function writeConfig(dir, contents) {
  mkdirSync(join(dir, ".marvin"), { recursive: true });
  writeFileSync(join(dir, ".marvin", "config.json"), contents);
}

test("config gates override the detected stack defaults, per gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-cfg-"));
  try {
    writeFileSync(join(dir, "tsconfig.json"), "{}"); // detects TypeScript
    writeConfig(dir, JSON.stringify({ gates: { test: "vitest run", lint: "biome check ." } }));
    const res = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
    // config wins for the gates it declares ...
    assert.match(res, /vitest run/);
    assert.match(res, /biome check \./);
    // ... while the detected stack still supplies the rest (per-gate merge, not replace-all)
    assert.match(res, /npx tsc --noEmit/);
    assert.match(res, /npm run build/);
    assert.doesNotMatch(res, /npm test/); // the table's `test` default was overridden
    // the report shows config participated, alongside the detected stack
    assert.match(res, /TypeScript, \.marvin\/config\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config supplies gates for a stack the detector does not recognise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-cfg-unknown-"));
  try {
    writeFileSync(join(dir, "README.md"), "# docs only\n"); // untabled, no declared commands
    writeConfig(dir, JSON.stringify({ gates: { test: "bats test/" } }));
    const res = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
    assert.match(res, /bats test\//);
    assert.match(res, /\.marvin\/config\.json/);
    assert.doesNotMatch(res, /No quality gates detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit per-call gates outrank config gates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-cfg-prec-"));
  try {
    writeConfig(dir, JSON.stringify({ gates: { test: "from-config" } }));
    const res = await callVerifyRaw({
      gates: [{ name: "test", command: "from-input" }],
      dryRun: true,
      projectRoot: dir,
      write: false,
    });
    assert.match(res, /from-input/);
    assert.doesNotMatch(res, /from-config/);
    assert.match(res, /\*\*Stacks:\*\* explicit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tabled stack with no config behaves exactly as before (parity)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-cfg-parity-"));
  try {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const res = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
    assert.match(res, /npm test/);
    assert.match(res, /npx eslint \./);
    assert.match(res, /npx tsc --noEmit/);
    assert.match(res, /npm run build/);
    assert.match(res, /\*\*Stacks:\*\* TypeScript/);
    assert.doesNotMatch(res, /\.marvin\/config\.json/); // no config → never mentioned
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed .marvin/config.json warns and falls back to detection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-cfg-bad-"));
  try {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeConfig(dir, "{ not valid json");
    const res = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
    assert.match(res, /\.marvin\/config\.json/);
    assert.match(res, /not valid JSON/i);
    assert.match(res, /npm test/); // fell back to the TypeScript defaults
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── built-in stack detection: top-10 ecosystems emit canonical gates ──

const STACK_DETECTION_CASES = [
  {
    name: "Go",
    file: "go.mod",
    expect: [/go test \.\/\.\.\./, /golangci-lint run/, /go build \.\/\.\.\./],
  },
  { name: "Rust", file: "Cargo.toml", expect: [/cargo test/, /cargo clippy/, /cargo build/] },
  { name: "Python (setup.py)", file: "setup.py", expect: [/pytest/, /ruff check \./, /mypy \./] },
  { name: "Java (Maven)", file: "pom.xml", expect: [/mvn test/, /mvn package/] },
  {
    name: "JVM (Gradle)",
    file: "build.gradle.kts",
    expect: [/\.\/gradlew test/, /\.\/gradlew build/],
  },
  {
    name: "C#/.NET (.csproj glob)",
    file: "App.csproj",
    expect: [/dotnet test/, /dotnet build/, /dotnet format/],
  },
  { name: "Swift", file: "Package.swift", expect: [/swift test/, /swift build/] },
  { name: "Ruby", file: "Gemfile", expect: [/bundle exec rspec/, /bundle exec rubocop/] },
  { name: "PHP", file: "composer.json", body: "{}", expect: [/composer test/] },
  { name: "C/C++ (CMake)", file: "CMakeLists.txt", expect: [/cmake --build build/] },
];

for (const c of STACK_DETECTION_CASES) {
  test(`detects ${c.name} and emits its canonical gates`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "marvin-verify-stack-"));
    try {
      writeFileSync(join(dir, c.file), c.body ?? "");
      const res = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
      assert.doesNotMatch(res, /No quality gates detected/, `${c.name} should be detected`);
      for (const re of c.expect) assert.match(res, re, `${c.name}: expected ${re}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ── delivery gate (action: "gate") — reads the verification.md verdict, ADR-0012 ──

function writeVerification(dir, verdict) {
  writeVerificationBlock(dir, JSON.stringify({ verdict, gates: [] }), `**Verdict:** ${verdict}`);
}

/** Same artifact, arbitrary block body — for the unreadable-block cases. */
function writeVerificationBlock(dir, body, prose = "") {
  mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
  writeFileSync(
    join(dir, ".marvin", "task", "verification.md"),
    `# Verification Report\n${prose}\n\n\`\`\`json verify-result\n${body}\n\`\`\`\n`,
  );
}

test("deliver gate: ALLOW on a PASS verification", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-gate-"));
  try {
    writeVerification(dir, "PASS");
    const { parsed, isError } = await callVerify(
      { action: "gate", projectRoot: dir, write: false },
      "deliver-gate",
    );
    assert.equal(parsed.decision, "ALLOW");
    assert.equal(parsed.verdict, "PASS");
    assert.ok(!isError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver gate: BLOCK on a FAIL verification", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-gate-"));
  try {
    writeVerification(dir, "FAIL");
    const { parsed, isError } = await callVerify(
      { action: "gate", projectRoot: dir },
      "deliver-gate",
    );
    assert.equal(parsed.decision, "BLOCK");
    assert.equal(parsed.verdict, "FAIL");
    assert.equal(isError, true, "a BLOCK is flagged as an error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver gate: BLOCK when verification.md is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-gate-"));
  try {
    const { parsed } = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(parsed.decision, "BLOCK");
    assert.match(parsed.reason, /no verification\.md/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver gate: ALLOW on PASS WITH WARNINGS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-gate-"));
  try {
    writeVerification(dir, "PASS WITH WARNINGS");
    const { parsed } = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(parsed.decision, "ALLOW");
    assert.equal(parsed.verdict, "PASS WITH WARNINGS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The gate distinguishes three BLOCK reasons, because they call for three
// different user actions. Missing artifact is covered above; these are the two
// that come from an artifact that exists but cannot be trusted.
test("deliver gate: BLOCK with a distinct reason when the block is unreadable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-gate-"));
  try {
    writeVerificationBlock(dir, "{not json");
    const bad = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(bad.parsed.decision, "BLOCK");
    assert.equal(bad.parsed.verdict, null);
    assert.match(bad.parsed.reason, /not valid JSON/);

    writeVerificationBlock(dir, '"PASS"');
    const malformed = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(malformed.parsed.decision, "BLOCK");
    assert.match(malformed.parsed.reason, /malformed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver gate: BLOCK on a verdict the gate does not recognise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-gate-"));
  try {
    writeVerification(dir, "MOSTLY FINE");
    const { parsed } = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(parsed.decision, "BLOCK");
    assert.equal(parsed.verdict, "MOSTLY FINE", "an unrecognised verdict is still reported back");
    assert.match(parsed.reason, /unrecognised verdict/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver gate: a readable verdict survives a corrupt sibling field", async () => {
  // This gate reads the verdict and nothing else, so nonsense under `gates`
  // must not turn a recorded PASS into a refusal to deliver.
  const dir = mkdtempSync(join(tmpdir(), "marvin-gate-"));
  try {
    writeVerificationBlock(dir, '{"verdict":"PASS","gates":null,"warnings":7}');
    const { parsed } = await callVerify(
      { action: "gate", projectRoot: dir, write: false },
      "deliver-gate",
    );
    assert.equal(parsed.decision, "ALLOW");
    assert.equal(parsed.verdict, "PASS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a real verify (write) persists the verify-result block, and its deliver gate ALLOWs", async () => {
  // Regression for the latent bug: verify used to write only prose to
  // verification.md, so the delivery gate (which reads the block back from the
  // file) never found it on a real run — the gate tests above only passed
  // because they hand-write a fixture. This drives the real chain end-to-end.
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-write-"));
  try {
    const run = await callVerify({
      projectRoot: dir,
      gates: [{ name: "test", command: "true" }],
      write: true,
    });
    assert.equal(run.parsed.verdict, "PASS");

    // the on-disk artifact is itself machine-readable, not prose-only
    const onDisk = readFileSync(join(dir, ".marvin", "task", "verification.md"), "utf8");
    assert.match(onDisk, /```json verify-result/);
    assert.match(onDisk, /"verdict":"PASS"/);

    // the delivery gate, reading that REAL artifact (no fixture), ALLOWs
    const gate = await callVerify(
      { action: "gate", projectRoot: dir, write: false },
      "deliver-gate",
    );
    assert.equal(gate.parsed.decision, "ALLOW");
    assert.equal(gate.parsed.verdict, "PASS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── not-run: a gate whose binary is absent (ADR-0035) ───────────────────────

/** A token no PATH can resolve, used where "missing" must be genuine. */
const ABSENT = "marvin-absent-binary-xyz";

/** An executable in `dir` that exits with `code` — a command that EXISTS and fails. */
function writeExecutable(dir, name, code) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 });
  return path;
}

test("not-run is decided by a pre-flight probe, never by exit code 127", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-notrun-"));
  try {
    // (1) a single simple command whose binary is absent — probed, not spawned.
    const missing = await callVerify({
      projectRoot: dir,
      gates: [
        { name: "test", command: "true" },
        { name: "lint", command: `${ABSENT} --check` },
      ],
      write: false,
    });
    const lint = missing.parsed.gates.find((g) => g.name === "lint");
    assert.equal(lint.status, "not-run");
    assert.equal(lint.code, null, "nothing ran, so there is no exit code");
    assert.equal(lint.durationMs, 0, "a probed gate spawns nothing and takes no time");
    // Had it been spawned, the shell would have reported `exit 127` here.
    assert.match(missing.text, new RegExp(`not run — .?${ABSENT}`));
    assert.doesNotMatch(missing.text, /exit 127/);

    // (2) a command that EXISTS and exits 127 is still a failure. This is the
    // distinction the whole design turns on: npm, make and most test runners
    // propagate a child's 127 as their own, so classifying after the fact would
    // downgrade real failures to warnings.
    writeExecutable(dir, "exits127.sh", 127);
    const real = await callVerify({
      projectRoot: dir,
      gates: [{ name: "test", command: "./exits127.sh" }],
      write: false,
    });
    const test127 = real.parsed.gates.find((g) => g.name === "test");
    assert.equal(test127.status, "fail", "an existing command's 127 is a failure, not a not-run");
    assert.equal(test127.code, 127);
    assert.equal(real.parsed.verdict, "FAIL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a not-run non-test gate degrades PASS to PASS WITH WARNINGS and still ALLOWs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-notrun-warn-"));
  try {
    const run = await callVerify({
      projectRoot: dir,
      gates: [
        { name: "test", command: "true" },
        { name: "lint", command: ABSENT },
      ],
      write: true,
    });
    assert.equal(run.parsed.verdict, "PASS WITH WARNINGS", "never a silent PASS");
    const warning = run.parsed.warnings.find((w) => w.includes(ABSENT));
    assert.ok(warning, "a warning names the missing token");
    assert.match(warning, /`lint`/, "and the gate it belongs to");

    // A missing optional tool is visible, and does not veto.
    const gate = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(gate.parsed.decision, "ALLOW");
    assert.equal(gate.parsed.verdict, "PASS WITH WARNINGS");
    assert.match(gate.parsed.reason, new RegExp(ABSENT), "the warning is quoted at the decision");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the not-run pre-flight abstains on a chained command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-notrun-chain-"));
  try {
    // The documented chained scanner form. `command -v` cannot answer for a
    // chain, and a mis-parse would produce a FALSE not-run — strictly worse than
    // a missed one, because it downgrades a real failure to a warning. So the
    // probe abstains and the gate behaves byte-identically to today.
    const { parsed } = await callVerify({
      projectRoot: dir,
      gates: [{ name: "lint", command: `echo ok && ${ABSENT}` }],
      write: false,
    });
    const lint = parsed.gates.find((g) => g.name === "lint");
    assert.equal(lint.status, "fail", "a chain whose later binary is missing still FAILs");
    assert.equal(lint.code, 127, "with the shell's own exit code");
    assert.equal(parsed.verdict, "FAIL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the delivery gate refuses a run with no test evidence and no input waives it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-noevidence-"));
  const block = (gates) =>
    writeVerificationBlock(dir, JSON.stringify({ verdict: "PASS WITH WARNINGS", gates }));
  try {
    // (1) every recorded `test` gate is not-run — no proof was produced.
    block([
      { name: "test", status: "not-run", code: null },
      { name: "lint", status: "pass", code: 0 },
    ]);
    const noTest = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(noTest.parsed.decision, "BLOCK");
    assert.equal(noTest.isError, true, "a refusal is flagged as an error");
    assert.match(noTest.parsed.reason, /no test evidence/i);

    // ... and allowStale does not reach it. There is no input that waives this.
    const waived = await callVerify(
      { action: "gate", projectRoot: dir, allowStale: true },
      "deliver-gate",
    );
    assert.equal(waived.parsed.decision, "BLOCK", "allowStale is about freshness only");

    // (2) every recorded gate is not-run — the limit case: a machine with none
    // of the binaries installed must not deliver green with zero gates executed.
    block([
      { name: "lint", status: "not-run", code: null },
      { name: "build", status: "not-run", code: null },
    ]);
    const nothing = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(nothing.parsed.decision, "BLOCK");
    assert.match(nothing.parsed.reason, /no evidence/i);

    // (3) the asymmetry this criterion exists to pin: a passing test gate beside
    // a not-run scanner still ships.
    block([
      { name: "test", status: "pass", code: 0 },
      { name: "lint", status: "not-run", code: null },
    ]);
    const ok = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(ok.parsed.decision, "ALLOW");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── provenance and the freshness gate (ADR-0035) ────────────────────────────

/** A tmp-dir git repository with one commit, on branch `dev`. */
function seedGitRepo(prefix, files = { "src.txt": "one\ntwo\n" }) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const g = (...args) => execFileSync("git", args, { cwd: repo });
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "Test");
  g("checkout", "-q", "-b", "dev");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(repo, name), body);
  g("add", "-A");
  g("commit", "-q", "-m", "init");
  return repo;
}

test("delivery gate — staleness is a sibling field and allowStale waives only freshness", async () => {
  const repo = seedGitRepo("marvin-fresh-");
  try {
    const run = await callVerify({
      projectRoot: repo,
      gates: [{ name: "test", command: "true" }],
      write: true,
    });
    const prov = run.parsed.provenance;
    assert.ok(prov, "a run inside a worktree records provenance");
    assert.match(prov.head_sha, /^[0-9a-f]{40}$/);
    assert.equal(prov.branch, "dev");
    assert.match(prov.worktree_digest, /^[0-9a-f]{16}$/);

    // unchanged tree → fresh → ALLOW, with the sibling fields on the block
    const fresh = await callVerify({ action: "gate", projectRoot: repo }, "deliver-gate");
    assert.equal(fresh.parsed.decision, "ALLOW");
    assert.equal(fresh.parsed.staleness, "fresh");
    assert.equal(fresh.parsed.allowStale, false);
    assert.match(fresh.parsed.artifactPath, /\.marvin\/task\/verification\.md$/);

    // a tracked edit since the run → stale → BLOCK, naming what was verified
    writeFileSync(join(repo, "src.txt"), "one\nCHANGED\n");
    const stale = await callVerify({ action: "gate", projectRoot: repo }, "deliver-gate");
    assert.equal(stale.parsed.decision, "BLOCK");
    assert.equal(stale.parsed.staleness, "stale");
    assert.match(stale.parsed.reason, new RegExp(prov.head_sha), "names the recorded head_sha");
    assert.match(stale.parsed.reason, /dev/, "and the branch it was verified on");

    // the same call with the explicit override → ALLOW, override named
    const waived = await callVerify(
      { action: "gate", projectRoot: repo, allowStale: true },
      "deliver-gate",
    );
    assert.equal(waived.parsed.decision, "ALLOW");
    assert.equal(waived.parsed.staleness, "stale", "the override records what it waived");
    assert.equal(waived.parsed.allowStale, true);
    assert.match(waived.parsed.reason, /allowStale/);

    // a FAIL verdict is not freshness, so the override never reaches it
    writeVerification(repo, "FAIL");
    const failed = await callVerify(
      { action: "gate", projectRoot: repo, allowStale: true },
      "deliver-gate",
    );
    assert.equal(failed.parsed.decision, "BLOCK");
    assert.equal(failed.parsed.verdict, "FAIL");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  // An artifact with no provenance — every one written before ADR-0035 — is
  // `unknown`, which ALLOWs. An old artifact must never become undeliverable.
  const plain = mkdtempSync(join(tmpdir(), "marvin-fresh-none-"));
  try {
    writeVerification(plain, "PASS");
    const { parsed } = await callVerify({ action: "gate", projectRoot: plain }, "deliver-gate");
    assert.equal(parsed.decision, "ALLOW");
    assert.equal(parsed.staleness, "unknown");
    assert.match(parsed.reason, /freshness not checked/);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

test("provenance describes the tree the gates left behind, not the one they started from", async () => {
  // This repository's own build gate rewrites tracked files (dist/server.js,
  // widgets/*.html). Provenance collected BEFORE the gates would describe a tree
  // the run itself then changed, and every post-build delivery would read stale.
  const repo = seedGitRepo("marvin-order-", {
    "tracked.txt": "before\n",
    "mutate.sh": "#!/bin/sh\necho after >> tracked.txt\n",
  });
  try {
    execFileSync("chmod", ["+x", join(repo, "mutate.sh")]);
    mkdirSync(join(repo, ".marvin"), { recursive: true });
    writeFileSync(
      join(repo, ".marvin", "config.json"),
      JSON.stringify({ gates: { test: "./mutate.sh" } }),
    );

    const run = await callVerify({ projectRoot: repo, write: true });
    assert.equal(run.parsed.verdict, "PASS");
    assert.match(
      readFileSync(join(repo, "tracked.txt"), "utf8"),
      /after/,
      "the gate really did rewrite a tracked file — otherwise this proves nothing",
    );

    const gate = await callVerify({ action: "gate", projectRoot: repo }, "deliver-gate");
    assert.equal(gate.parsed.staleness, "fresh", "collected after the gates settled");
    assert.equal(gate.parsed.decision, "ALLOW");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── per-spec runs under .marvin/task/runs/ (ADR-0035) ───────────────────────

const FIXTURE_SPEC = [
  "---",
  "slug: demo-slug",
  "type: feature",
  "status: ready",
  "---",
  "",
  "# Demo spec",
  "",
].join("\n");

test("runs — a per-spec run is written beside the global artifact and stays invisible to the corpus enumerators", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-runs-"));
  try {
    mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
    // At least one REAL spec, so the count assertions below are not 0 == 0.
    writeFileSync(join(dir, ".marvin", "task", "001-demo-slug.md"), FIXTURE_SPEC);

    const before = await countCorpus(dir);
    assert.equal(before.specs, 1, "the fixture has one spec to begin with");
    assert.equal(before.taskReports, 1, "and one task-group report (the spec document)");

    await callVerify({
      projectRoot: dir,
      specSlug: "demo-slug",
      gates: [{ name: "test", command: "true" }],
      write: true,
    });

    const runPath = join(dir, ".marvin", "task", "runs", "demo-slug.md");
    const globalPath = join(dir, ".marvin", "task", "verification.md");
    assert.ok(existsSync(runPath), "the per-spec run is written");
    assert.equal(
      readFileSync(runPath, "utf8"),
      readFileSync(globalPath, "utf8"),
      "byte-identical to the global artifact",
    );

    // A directory carries no `.md` extension, so the three non-recursive
    // enumerators cannot see it — invisible by construction, not by an exclusion
    // list that rots the next time an enumerator is added.
    const after = await countCorpus(dir);
    assert.equal(after.specs, 1, "artifactCounts.specs did not grow by one per verification");
    assert.deepEqual(after.digestSlugs, before.digestSlugs, "specDigest is unchanged");
    assert.equal(after.taskReports, 2, "only verification.md joined the report's task group");

    // The gate reads THIS task's proof when the slug names one.
    const gate = await callVerify(
      { action: "gate", projectRoot: dir, specSlug: "demo-slug" },
      "deliver-gate",
    );
    assert.match(gate.parsed.artifactPath, /runs\/demo-slug\.md$/);
    assert.equal(gate.parsed.decision, "ALLOW");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runs — a slug that is not kebab-case is rejected, never sanitised", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-runs-bad-"));
  try {
    const { parsed } = await callVerify({
      projectRoot: dir,
      specSlug: "../escape/Demo Slug",
      gates: [{ name: "test", command: "true" }],
      write: true,
    });
    assert.ok(existsSync(join(dir, ".marvin", "task", "verification.md")), "global artifact still");
    assert.ok(!existsSync(join(dir, ".marvin", "task", "runs")), "no per-spec file at all");
    assert.ok(
      parsed.warnings.some((w) => /not kebab-case/.test(w)),
      "and the caller is told, rather than silently getting no run file",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The two corpus enumerators that would be fooled by a run file, read through a
 * second driver session: `dashboard` and `report` resolve their paths from
 * `env.projectDir`, which only `CLAUDE_PROJECT_DIR` can point at a fixture.
 */
async function countCorpus(projectDir) {
  const opts = { env: { CLAUDE_PROJECT_DIR: projectDir } };
  const dash = await callTool("dashboard", {}, opts);
  const rep = await callTool("report", {}, opts);
  return {
    specs: dash.structuredContent.artifacts.specs,
    digestSlugs: dash.structuredContent.current_tasks.specs.map((s) => s.slug),
    taskReports: (rep.structuredContent.reports ?? []).filter((r) => r.group === "task").length,
  };
}

// Raw variant for dryRun (no verify-result block expected).
async function callVerifyRaw(args) {
  const result = await callTool("verify", args);
  return result.content.map((c) => c.text).join("\n");
}

// ── acceptance oracles (action: "oracles", ADR-0036) ─────────────────────────

/** The seal, recomputed exactly as `storage/spec.ts` computes it. The algorithm
 * itself is pinned to a literal digest in `oracles.test.mjs`; here it only has to
 * agree with the server, so a fixture spec reads as sealed rather than tampered. */
const contractSeal = (block) =>
  createHash("sha256").update(block.trim()).digest("hex").slice(0, 16);

/**
 * Write `<dir>/<specDir>/001-<slug>.md` carrying `block` as its spec-contract
 * and, unless `seal` says otherwise, the `contract_sha` that block hashes to.
 * `seal: null` writes an UNSEALED spec; any string writes that string verbatim,
 * which is how a tampered contract is staged.
 *
 * `specDir` defaults to `.marvin/task`; the configured-directory case passes a
 * path deliberately outside the five conventional candidates.
 */
function writeSpec(dir, { slug, type, block, seal, specDir = join(".marvin", "task") }) {
  mkdirSync(join(dir, specDir), { recursive: true });
  const sha = seal === undefined ? contractSeal(block) : seal;
  const path = join(dir, specDir, `001-${slug}.md`);
  writeFileSync(
    path,
    [
      "---",
      `slug: ${slug}`,
      `type: ${type}`,
      "status: ready",
      ...(sha === null ? [] : [`contract_sha: ${sha}`]),
      "---",
      "",
      `# ${slug}`,
      "",
      "```yaml spec-contract",
      block,
      "```",
      "",
    ].join("\n"),
  );
  return path;
}

/** The `.md` files at the TOP LEVEL of the spec dir — what the four corpus
 * enumerators see, and what the journal must never join. */
const topLevelSpecs = (dir) =>
  readdirSync(join(dir, ".marvin", "task"))
    .filter((f) => f.endsWith(".md"))
    .sort();

/** A three-criterion feature contract: a test oracle, a command oracle, and a
 * prose-review one that has no command by construction. */
const FEATURE_BLOCK = [
  "files:",
  "  - id: F1",
  "    path: thing.txt",
  "    action: edit",
  "    satisfies: [AC1, AC2, AC3]",
  "criteria:",
  "  - id: AC1",
  "    statement: the first thing works",
  "    implemented_by: [F1]",
  "    oracle:",
  "      kind: test",
  "      ref: thing.test.sh::the first thing works",
  "      run: sh thing.test.sh",
  "  - id: AC2",
  "    statement: the second thing works",
  "    implemented_by: [F1]",
  "    oracle:",
  "      kind: command",
  "      ref: sh thing.test.sh",
  "  - id: AC3",
  "    statement: the prose reads well",
  "    implemented_by: [F1]",
  "    oracle:",
  "      kind: prose-review",
].join("\n");

/**
 * A bugfix contract whose regression criterion names a test file that is NEVER
 * rewritten — the red and the green differ because the implementation under it
 * changed, which is what makes their identical `test_sha` mean something.
 */
const BUGFIX_BLOCK = [
  "files:",
  "  - id: F1",
  "    path: impl.txt",
  "    action: edit",
  "    satisfies: [AC1]",
  "criteria:",
  "  - id: AC1",
  "    statement: the bug does not recur",
  "    implemented_by: [F1]",
  "    regression: true",
  "    oracle:",
  "      kind: test",
  "      ref: regress.test.sh::the bug does not recur",
  "      run: sh regress.test.sh",
].join("\n");

/** Stage the bugfix fixture; `impl.txt` is the code, `regress.test.sh` the test. */
function bugfixFixture(dir, { slug = "demo-bug", seal } = {}) {
  writeSpec(dir, { slug, type: "bugfix", block: BUGFIX_BLOCK, seal });
  writeFileSync(join(dir, "regress.test.sh"), "grep -q fixed impl.txt\n");
  writeFileSync(join(dir, "impl.txt"), "broken\n");
  writeVerification(dir, "PASS");
  return slug;
}

const runsOf = (res) =>
  JSON.parse(res.text.match(/```json oracle-result\n([\s\S]*?)\n```/)[1]).runs;

test("oracles appends to runs and leaves the spec dir top level untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-oracles-"));
  try {
    writeSpec(dir, { slug: "demo-feature", type: "feature", block: FEATURE_BLOCK });
    writeFileSync(join(dir, "thing.test.sh"), "exit 0\n");
    const before = topLevelSpecs(dir);

    const first = await callVerify(
      { action: "oracles", projectRoot: dir, specSlug: "demo-feature", criteria: ["AC1"] },
      "oracle-result",
    );
    const journal = join(dir, ".marvin", "task", "runs", "demo-feature.oracles.md");
    assert.ok(existsSync(journal), "the journal lands under runs/");
    assert.equal(runsOf(first).length, 1, "one block per selected criterion");
    assert.equal(runsOf(first)[0].criterion, "AC1");
    assert.equal(runsOf(first)[0].source, "oracle.run", "the criterion's own command won");
    const afterFirst = readFileSync(journal, "utf8");

    // A second, differently-scoped call APPENDS: the earlier run survives it,
    // which is the property verification.md's whole-file rewrite lacks.
    const second = await callVerify(
      { action: "oracles", projectRoot: dir, specSlug: "demo-feature", criteria: ["AC2", "AC3"] },
      "oracle-result",
    );
    const text = readFileSync(journal, "utf8");
    assert.ok(text.startsWith(afterFirst), "the first run's blocks are still present, verbatim");
    assert.equal((text.match(/```json oracle-run/g) ?? []).length, 2, "two blocks now");
    // AC3 is prose-review: skipped rather than journalled, so the file never
    // carries a row nothing could ever prove.
    assert.deepEqual(
      runsOf(second).map((r) => r.criterion),
      ["AC2"],
    );
    assert.match(second.text, /Skipped \(prose-review\): AC3/);

    assert.deepEqual(
      topLevelSpecs(dir),
      before,
      "the spec directory's top level gained no .md — `findLatestSpec` takes the LAST name there",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The `spec.dir` config tier reaches the oracle runner (ADR-0037).
 *
 * The fixture directory is `product/specs`, deliberately outside the five
 * conventional candidates: no other tier can reach it, so resolution here proves
 * the config tier was consulted rather than that detection got lucky. The
 * negative control in the same test is what pins the regression — before the
 * config was threaded into `findSpec`, this runner was the one reader on the
 * ADR-0037 list that answered "No spec found" for a spec `/marvin:task-summary`
 * and `/marvin:dashboard` resolved from the same config.
 */
test("oracles resolves a spec from the configured spec.dir, and not without it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-oracles-configdir-"));
  try {
    const specDir = join("product", "specs");
    writeSpec(dir, { slug: "demo-feature", type: "feature", block: FEATURE_BLOCK, specDir });
    writeFileSync(join(dir, "thing.test.sh"), "exit 0\n");
    const call = {
      action: "oracles",
      projectRoot: dir,
      specSlug: "demo-feature",
      criteria: ["AC1"],
    };

    // Negative control FIRST, with no config: the spec exists on disk and is
    // unreachable, and the refusal names the directories actually searched.
    const unconfigured = await callTool("verify", call);
    const unconfiguredText = unconfigured.content.map((c) => c.text).join("\n");
    assert.equal(unconfigured.isError, true, "an unresolvable spec is an error, not an empty run");
    assert.match(unconfiguredText, /No spec found for slug `demo-feature`/);
    assert.doesNotMatch(unconfiguredText, /product\/specs/, "the searched list cannot name it yet");

    mkdirSync(join(dir, ".marvin"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ spec: { dir: "product/specs" } }),
    );

    const res = await callVerify(call, "oracle-result");
    assert.equal(runsOf(res).length, 1, "the configured directory resolved the spec");
    assert.equal(runsOf(res)[0].criterion, "AC1");
    assert.equal(runsOf(res)[0].status, "pass");

    // The artifact-location split (ADR-0007 vs ADR-0037): the SPEC followed the
    // config, the journal marvin generates about the run did not.
    assert.ok(
      existsSync(join(dir, ".marvin", "task", "runs", "demo-feature.oracles.md")),
      "the journal stays .marvin-pinned, where `summary` reads it",
    );
    assert.equal(
      existsSync(join(dir, "product", "specs", "runs")),
      false,
      "and did not follow the spec out of .marvin/",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a signal-killed or unlaunchable oracle is not-run and never a proven red", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-oracles-notrun-"));
  try {
    const slug = bugfixFixture(dir);
    const base = { action: "oracles", projectRoot: dir, specSlug: slug, expect: "fail" };

    // A signal kill: exit code null, `signal` names the killer. Not a verdict
    // about the code, so not a red.
    const killed = runsOf(
      await callVerify({ ...base, command: "kill -TERM $$" }, "oracle-result"),
    )[0];
    assert.equal(killed.status, "not-run");
    assert.equal(killed.code, null);
    assert.match(killed.reason, /signal-killed/);

    // A launch failure: the child could not be started at all.
    const unlaunchable = runsOf(
      await callVerify({ ...base, command: `true${String.fromCharCode(0)}` }, "oracle-result"),
    )[0];
    assert.equal(unlaunchable.status, "not-run");
    assert.match(unlaunchable.reason, /launch-failed/);

    // Follow both with a real green. Neither non-red is READABLE as a red, so
    // the pair the gate is looking for is still not on the record.
    writeFileSync(join(dir, "impl.txt"), "fixed\n");
    const green = runsOf(
      await callVerify({ action: "oracles", projectRoot: dir, specSlug: slug }, "oracle-result"),
    )[0];
    assert.equal(green.status, "pass");
    assert.equal(green.code, 0);
    const afterNotRuns = await callVerify(
      { action: "gate", projectRoot: dir, specSlug: slug },
      "deliver-gate",
    );
    assert.equal(afterNotRuns.parsed.red_green, "missing", "a not-run is not a red");

    // The contrast that makes that verdict mean something: a MISSING BINARY
    // exits 127 CLEANLY, and 127 is a real red. A copy of the trichotomy that
    // lumped "non-zero or null" together would have read all three of these
    // alike — and this last pair proves the gate is not simply refusing
    // everything, because with a genuine red in front of it, it says proven.
    const real = runsOf(
      await callVerify({ ...base, command: "definitely-not-a-real-binary-xyz" }, "oracle-result"),
    )[0];
    assert.equal(real.status, "fail");
    assert.equal(real.code, 127);
    const second = runsOf(
      await callVerify({ action: "oracles", projectRoot: dir, specSlug: slug }, "oracle-result"),
    )[0];
    assert.equal(second.test_sha, real.test_sha, "the test file never changed between phases");
    const afterRealRed = await callVerify(
      { action: "gate", projectRoot: dir, specSlug: slug },
      "deliver-gate",
    );
    assert.equal(afterRealRed.parsed.red_green, "proven");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver gate reports a missing red-green pair and still allows delivery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-redgreen-missing-"));
  try {
    const slug = bugfixFixture(dir);

    // A green with no red before it: the test passes, but nothing on the record
    // shows it ever failed, so it proves the suite and not the fix.
    writeFileSync(join(dir, "impl.txt"), "fixed\n");
    await callVerify({ action: "oracles", projectRoot: dir, specSlug: slug }, "oracle-result");

    const gate = await callVerify(
      { action: "gate", projectRoot: dir, specSlug: slug },
      "deliver-gate",
    );
    assert.equal(gate.parsed.red_green, "missing");
    assert.equal(gate.parsed.decision, "ALLOW", "a warning contributes a reason, never a veto");
    assert.match(gate.parsed.reason, /red→green pair/);
    assert.match(gate.parsed.reason, /AC1/);

    // With no slug the field is `unknown` and the reason says nothing about it —
    // strictly additive against every existing caller.
    const slugless = await callVerify({ action: "gate", projectRoot: dir }, "deliver-gate");
    assert.equal(slugless.parsed.red_green, "unknown");
    assert.equal(slugless.parsed.decision, "ALLOW");
    assert.doesNotMatch(slugless.parsed.reason, /red→green/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver gate reports a proven red-green pair for a recorded red-then-green", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-redgreen-proven-"));
  try {
    // Nothing in the spec corpus produces one of these — 28 specs, all
    // `type: feature`, zero `regression: true` criteria — so the pair is BUILT
    // here. Without it every other assertion about `redGreenProof` is a negative
    // that a `() => "missing"` stub would satisfy, on a field that flips no
    // decision and therefore has no symptom when it is inert.
    const slug = bugfixFixture(dir);

    // Red: the fix is not in, the regression test fails cleanly.
    const red = runsOf(
      await callVerify(
        { action: "oracles", projectRoot: dir, specSlug: slug, expect: "fail" },
        "oracle-result",
      ),
    )[0];
    assert.equal(red.status, "fail");
    assert.equal(red.expect, "fail");
    assert.ok(red.code > 0, "a clean non-zero exit");

    // Green: the implementation changes, the TEST FILE does not.
    writeFileSync(join(dir, "impl.txt"), "fixed\n");
    const green = runsOf(
      await callVerify({ action: "oracles", projectRoot: dir, specSlug: slug }, "oracle-result"),
    )[0];
    assert.equal(green.status, "pass");
    assert.equal(green.test_sha, red.test_sha);
    assert.equal(green.contract_sha, red.contract_sha);

    const gate = await callVerify(
      { action: "gate", projectRoot: dir, specSlug: slug },
      "deliver-gate",
    );
    assert.equal(gate.parsed.red_green, "proven");
    assert.equal(gate.parsed.decision, "ALLOW");
    assert.doesNotMatch(gate.parsed.reason, /red→green pair/, "nothing to warn about");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("oracles refuses a tampered contract and an unsealed spec without spawning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-oracles-seal-"));
  try {
    writeFileSync(join(dir, "thing.test.sh"), "exit 0\n");
    const marker = join(dir, "SPAWNED");
    const runsDir = join(dir, ".marvin", "task", "runs");
    // A per-call command whose only job is to leave a trace if it ever runs.
    const call = { action: "oracles", projectRoot: dir, command: `touch ${marker}` };

    // 1. Sealed to a digest the block no longer hashes to.
    writeSpec(dir, {
      slug: "tampered",
      type: "feature",
      block: FEATURE_BLOCK,
      seal: "0000000000000000",
    });
    const tampered = await callTool("verify", { ...call, specSlug: "tampered" });
    assert.equal(tampered.isError, true);
    const tamperedText = tampered.content.map((c) => c.text).join("\n");
    assert.match(tamperedText, /edited since it was sealed/);
    assert.match(tamperedText, /0000000000000000/, "names the stamped digest");
    assert.match(tamperedText, /task-start/, "and the seal step that would fix it");

    // 2. No `contract_sha` at all — no key to journal a run against, so every
    //    unsealed spec would otherwise share one proof namespace.
    writeSpec(dir, { slug: "unsealed", type: "feature", block: FEATURE_BLOCK, seal: null });
    const unsealed = await callTool("verify", { ...call, specSlug: "unsealed" });
    assert.equal(unsealed.isError, true);
    assert.match(unsealed.content.map((c) => c.text).join("\n"), /UNSEALED/);

    assert.ok(!existsSync(marker), "no child process was spawned by either refusal");
    assert.ok(!existsSync(runsDir), "and nothing was journalled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * REGRESSION FENCE. `gates.test_one` is a sibling key of the four gate names,
 * never a fifth `GATE_NAME`: promoting it would make a single-test command
 * schedulable on every verify, and its exit code would enter the verdict that
 * gates delivery. A unit assertion cannot fail here — all three gate paths
 * iterate the `GATE_NAMES` tuple — so the fence is the dry-run PLAN, which is
 * where a widened tuple would actually show up.
 */
test("test_one is a config key and never a schedulable gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-test-one-"));
  try {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeConfig(
      dir,
      JSON.stringify({ gates: { test: "npm test", test_one: "npx vitest run -t '{name}'" } }),
    );
    const plan = await callVerifyRaw({ dryRun: true, projectRoot: dir, write: false });
    const scheduled = [...plan.matchAll(/^- \*\*(\w+)\*\*:/gm)].map((m) => m[1]).sort();
    assert.deepEqual(scheduled, ["build", "lint", "test", "typecheck"]);
    assert.doesNotMatch(plan, /test_one/);
    assert.doesNotMatch(plan, /vitest/, "the single-test template reached no plan line");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The `Details` body a failing gate rendered, or null when it rendered none. */
function details(text) {
  const m = text.match(/- \*\*Details:\*\*\n\n```\n([\s\S]*?)\n```/);
  return m ? m[1] : null;
}

/**
 * A failing gate's excerpt must show what FAILED. ESLint prints its errors
 * before a longer tail of pre-existing warnings, so a naive tail of stdout
 * reliably renders the wrong file: one measured run pointed the reader at a
 * warning in a file the task had never touched while all five real errors
 * scrolled past above it.
 */
test("a failing gate's excerpt shows the error lines, not the warning tail", async () => {
  const command = [
    "echo 'src/new.ts:1:1  error  boom  no-undef'",
    'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do echo "src/old$i.tsx:9:9  warning  pre-existing  react-hooks"; done',
    "exit 1",
  ].join("; ");
  const { text } = await callVerify({
    gates: [{ name: "lint", command }],
    execution: "sequential",
    write: false,
  });
  const body = details(text);
  assert.ok(body, "a failing gate rendered no Details block");
  assert.match(
    body,
    /^1 error line\(s\):\nsrc\/new\.ts:1:1 {2}error {2}boom/,
    "the error does not lead the excerpt",
  );
  // The retained tail is three lines and no more: without a bound the fourteen
  // warnings would be back, which is the defect this excerpt exists to fix.
  assert.equal(
    (body.match(/pre-existing/g) ?? []).length,
    3,
    "the warning tail is not bounded to the retained lines",
  );
});

/**
 * The counter-case, and the reason the tail is retained unconditionally. A test
 * runner names its passing tests, and a name may contain the word "error"; the
 * assertion that actually failed carries `Error` mid-token (`AssertionError
 * [ERR_ASSERTION]`) and matches no pattern at all. Leading with matched lines
 * alone put twelve passing tests in the excerpt and dropped the assertion —
 * exactly the defect the excerpt was written to prevent, in the gate that fails
 * most often.
 */
test("a passing test's name never displaces the assertion that failed", async () => {
  const command = [
    'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do echo "  ✓ returns an error when the token is missing ($i)"; done',
    "echo '  1) auth handler:'",
    "echo 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:'",
    "echo '  actual:   401'",
    "echo '  expected: 403'",
    "exit 1",
  ].join("; ");
  const { text } = await callVerify({
    gates: [{ name: "test", command }],
    execution: "sequential",
    write: false,
  });
  const body = details(text);
  assert.ok(body, "a failing gate rendered no Details block");
  assert.match(body, /AssertionError \[ERR_ASSERTION\]/, "the assertion was dropped");
  assert.match(body, /expected: 403/, "the expected value was dropped");
  // The pass marker emptied the error set, so this is the plain tail — which is
  // the right answer here and names no count. Passing tests appearing IN that
  // tail is the tail being the tail; what must not happen is the excerpt leading
  // with them as though they were the failure.
  assert.doesNotMatch(body, /error line\(s\)/, "the excerpt led with passing test names");
});

/** With no error line to find, the tail is still the right answer — it is where
 * a test runner puts its summary. */
test("a failing gate with no error line keeps the tail", async () => {
  const command = 'for i in $(seq 1 20); do echo "line$i"; done; exit 1';
  const { text } = await callVerify({
    gates: [{ name: "test", command }],
    execution: "sequential",
    write: false,
  });
  const body = details(text);
  assert.ok(body, "a failing gate rendered no Details block");
  assert.match(body, /line20$/);
  assert.match(body, /^line9$/m);
  assert.doesNotMatch(body, /^line8$/m, "the tail is not the last twelve lines");
});
