import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * Drive the live stdio server: initialize, then a single tools/call for
 * `verify`, and return the parsed `verify-result` JSON block embedded in the
 * tool's text output. Gates are passed explicitly (fake sleep commands) so the
 * concurrency behaviour is tested deterministically without any toolchain.
 */
function callVerify(args) {
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
            const m = text.match(/```json verify-result\n([\s\S]*?)\n```/);
            assert.ok(m, `no verify-result block in output:\n${text}`);
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
