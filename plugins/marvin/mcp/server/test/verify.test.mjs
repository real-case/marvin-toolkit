import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * Drive the live stdio server: initialize, then a single tools/call for
 * `verify`, and return the parsed `verify-result` JSON block embedded in the
 * tool's text output. Gates are passed explicitly (fake sleep commands) so the
 * concurrency behaviour is tested deterministically without any toolchain.
 */
function callVerify(args, blockTag = "verify-result") {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let initialized = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "verify", arguments: args },
          });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          try {
            const text = msg.result.content.map((c) => c.text).join("\n");
            const m = text.match(new RegExp("```json " + blockTag + "\\n([\\s\\S]*?)\\n```"));
            assert.ok(m, `no ${blockTag} block in output:\n${text}`);
            resolve({ parsed: JSON.parse(m[1]), isError: msg.result.isError, text });
          } catch (err) {
            reject(err);
          }
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "verify-test", version: "0" },
      },
    });
  });
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

// ── config-first gate resolution: .marvin/config.json `gates` (ADR-0011) ──

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

// ── delivery gate (action: "gate") — reads the verification.md verdict, ADR-0014 ──

function writeVerification(dir, verdict) {
  mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
  const block = JSON.stringify({ verdict, gates: [] });
  writeFileSync(
    join(dir, ".marvin", "task", "verification.md"),
    `# Verification Report\n**Verdict:** ${verdict}\n\n\`\`\`json verify-result\n${block}\n\`\`\`\n`,
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

// Raw variant for dryRun (no verify-result block expected).
function callVerifyRaw(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let initialized = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "verify", arguments: args },
          });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result.content.map((c) => c.text).join("\n"));
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "verify-test", version: "0" },
      },
    });
  });
}
