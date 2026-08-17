import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Shared stdio test driver for the marvin MCP server.
 *
 * Every stdio test used to inline ~50 lines of spawn + JSON-RPC handshake +
 * timeout + cleanup, each with its own hard-coded 15s timeout. Under
 * `node --test`'s default concurrency (= CPU count) enough servers spawn at once
 * to blow that timeout on an arbitrary test — the e2e flake. This centralises
 * the plumbing so the timeout is one configurable knob (`MARVIN_TEST_TIMEOUT_MS`,
 * default 60s) and the suite caps concurrency at 4 in the `test` script.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** Committed server bundle every test drives (ADR-0013). */
export const SERVER_PATH = join(here, "..", "dist", "server.js");

/**
 * One knob for every stdio timeout — bump via env on slow CI without edits.
 * Default is generous (60s): a healthy server initialises in well under a second,
 * so this only bites on genuine starvation (a badly oversubscribed machine),
 * where a short timeout is exactly what turned contention into a spurious failure.
 */
export const TIMEOUT_MS = Number(process.env.MARVIN_TEST_TIMEOUT_MS) || 60000;

const PROTOCOL_VERSION = "2025-03-26";

/**
 * Environment names the child server must NEVER inherit from the ambient process.
 *
 * WHY THIS EXISTS. `src/lib/env.ts` resolves every storage path as
 * `env.MARVIN_<X> ?? join(projectDir, ".marvin", "<x>")`, and `projectDir` itself is
 * `env.CLAUDE_PROJECT_DIR ?? process.cwd()`. So an ambient value does not merely influence the
 * server — it OUTRANKS the fixture a test set up, silently, and the test then asserts against the
 * real repository's `.marvin/` instead of its own temp directory.
 *
 * That is not hypothetical. `plugins/marvin/.mcp.json` sets `MARVIN_TASKS_DIR` and
 * `MARVIN_TASKS_CONFIG` for the marvin MCP server, so anything the server spawns inherits them —
 * including `npm run test` when it is launched by the `verify` tool. The suite passed from a
 * developer's shell (where nothing is set) and failed under `verify` with 42 failures across the
 * adr and config tests, which made the failure look like a flake or like whatever branch happened
 * to be checked out. It blocked the pipeline's delivery gate and forced at least one PR to be
 * opened over an explicit BLOCK.
 *
 * A PREFIX RULE, NOT A LIST OF THE TWO THAT BIT US. `loadEnv` reads six `MARVIN_*` names today;
 * stripping the whole prefix means the seventh is hermetic the day it is added, with no matching
 * edit here that someone has to remember. `MARVIN_TEST_TIMEOUT_MS` is swept up too and that costs
 * nothing: it is read by THIS file, in the parent process, and the server never looks at it.
 *
 * A test that genuinely wants one of these passes it explicitly via `opts.env`, which is applied
 * after the sweep and therefore always wins. Being explicit is the point — the value then comes
 * from the test, not from whoever happened to launch it.
 */
export const HERMETIC_PREFIX = "MARVIN_";
export const HERMETIC_NAMES = ["CLAUDE_PROJECT_DIR"];

/**
 * The ambient environment with every storage-locating variable removed, then `overrides` applied.
 *
 * Pure and exported so the guard can assert on it directly without spawning anything.
 */
export function hermeticEnv(base = process.env, overrides = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith(HERMETIC_PREFIX) || HERMETIC_NAMES.includes(key)) continue;
    clean[key] = value;
  }
  return { ...clean, ...overrides };
}

/**
 * Spawn the server and open a JSON-RPC session over stdio. Low-level: handles
 * framing, correlates responses to client→server requests by id, and dispatches
 * server→client requests (e.g. `elicitation/create`) to `onServerRequest`.
 * A single timeout guards the whole session; on fire it kills the child and
 * rejects every in-flight request.
 *
 * @param {object}  [opts]
 * @param {Record<string,string>} [opts.env]              extra env for the child
 * @param {(method:string, params:any)=>any} [opts.onServerRequest]  reply to server→client requests
 * @param {number}  [opts.timeoutMs]
 * @returns {{ request(method:string, params?:any):Promise<any>, notify(method:string, params?:any):void, close():void, child:import('node:child_process').ChildProcess }}
 */
export function connect({ env = {}, onServerRequest, timeoutMs = TIMEOUT_MS } = {}) {
  const child = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    // Hermetic: the ambient MARVIN_*/CLAUDE_PROJECT_DIR values are dropped before `env` is applied,
    // so a test's fixture paths cannot be outranked by whatever launched the suite. See
    // hermeticEnv above for why this is not just `{ ...process.env, ...env }`.
    env: hermeticEnv(process.env, env),
  });

  let nextId = 1;
  let buf = "";
  let closed = false;
  const pending = new Map();

  const fail = (err) => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };

  const timer = setTimeout(() => {
    fail(new Error(`stdio session timeout after ${timeoutMs}ms`));
    close();
  }, timeoutMs);

  const send = (obj) => {
    if (!closed) child.stdin.write(JSON.stringify(obj) + "\n");
  };

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    child.kill();
  }

  // Decode stdout as UTF-8 through the stream's own StringDecoder so a multibyte
  // character split across two chunks is reassembled correctly. Per-chunk
  // `d.toString()` corrupts such a split (→ U+FFFD), which surfaces on large
  // payloads like the ~283 KB widget HTML whose bundled zod locale strings land a
  // multibyte char on a 64 KB chunk boundary.
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      // response to one of our requests
      if (
        msg.id !== undefined &&
        (msg.result !== undefined || msg.error !== undefined) &&
        pending.has(msg.id)
      ) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
        continue;
      }

      // server→client request (e.g. elicitation/create) — reply with the handler's result
      if (msg.id !== undefined && typeof msg.method === "string") {
        Promise.resolve(
          onServerRequest ? onServerRequest(msg.method, msg.params) : { action: "decline" },
        )
          .then((result) => send({ jsonrpc: "2.0", id: msg.id, result }))
          .catch(() => send({ jsonrpc: "2.0", id: msg.id, result: { action: "decline" } }));
        continue;
      }
      // server notifications: ignored
    }
  });
  child.stderr.on("data", () => {});
  child.on("error", (e) => {
    fail(e);
    close();
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("session closed"));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
    });

  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

  return { request, notify, close, child };
}

/**
 * Open a session, perform the initialize handshake, run `fn(session)`, and always
 * close the child. This is the entry point almost every test wants.
 */
export async function withSession(opts, fn) {
  const session = connect(opts);
  try {
    await session.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: opts?.capabilities ?? {},
      clientInfo: { name: "marvin-test", version: "0" },
    });
    session.notify("notifications/initialized");
    return await fn(session);
  } finally {
    session.close();
  }
}

/** Convenience for the common case: initialize, then a single `tools/call`. */
export function callTool(name, args = {}, opts = {}) {
  return withSession(opts, (s) => s.request("tools/call", { name, arguments: args }));
}

/** Convenience: initialize, then a single `prompts/get`. */
export function getPrompt(name, args = {}, opts = {}) {
  return withSession(opts, (s) => s.request("prompts/get", { name, arguments: args }));
}

/** Convenience: initialize, then `tools/list`. */
export function listTools(opts = {}) {
  return withSession(opts, (s) => s.request("tools/list", {}));
}
