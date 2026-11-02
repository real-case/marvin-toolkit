import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { modelFamily } from "./command.js";
import type { Assignment } from "./run-store.js";

/**
 * Sandbox mode: the switches a live sandbox run (Task 20 scenario 2) needs and nothing else may
 * reach. `MARVIN_PIPELINE_SANDBOX=1` turns it on. It then
 *
 * - honours `MARVIN_PIPELINE_MODEL_OVERRIDE`, which replaces every role's model. A subagent
 *   whose definition pins its own model keeps it: the live run of 2026-10-10 saw the planner's
 *   spec critic (`model: opus`) run on Opus under a Haiku planner, and setting
 *   `CLAUDE_CODE_SUBAGENT_MODEL` did not change that, so it is not set (plan F8, still deferred);
 * - puts a `gh` shim first on every child's PATH, which answers the PR commands a child may run
 *   against a fake pull request, so a live executor can deliver to a local bare origin;
 * - requires `MARVIN_PIPELINE_FAKE_CI`, because the shim's pull request does not exist on GitHub
 *   and the engine's own CI look would otherwise poll it until the wait cap.
 *
 * Outside sandbox mode an override is refused rather than ignored: a run someone meant to send
 * out on Haiku must not quietly spend Opus. The Fable rule holds in both modes, because the
 * override goes through `modelFamily` like every rubric model.
 */

export const SANDBOX_VARIABLE = "MARVIN_PIPELINE_SANDBOX";
export const MODEL_OVERRIDE_VARIABLE = "MARVIN_PIPELINE_MODEL_OVERRIDE";

/** The fake pull request every sandbox run delivers to. It fits the executor's `pr_url` rule. */
export const SANDBOX_PR_URL = "https://github.com/sandbox/sandbox/pull/1";

export interface SandboxSettings {
  enabled: boolean;
  /** The model every child runs on, or null to keep the rubric's. */
  modelOverride: string | null;
}

/** Reads and checks the sandbox switches; throws on a combination the pipeline refuses. */
export function sandboxSettings(env: NodeJS.ProcessEnv = process.env): SandboxSettings {
  const raw = env[SANDBOX_VARIABLE];
  if (raw !== undefined && raw !== "" && raw !== "1" && raw !== "0") {
    throw new Error(`${SANDBOX_VARIABLE} must be 1 or 0: ${raw}`);
  }
  const enabled = raw === "1";
  const override = env[MODEL_OVERRIDE_VARIABLE]?.trim() || null;
  if (override !== null) {
    // Fable first, whatever the mode: the user's rule outranks the sandbox.
    modelFamily(override);
    if (!enabled) {
      throw new Error(
        `${MODEL_OVERRIDE_VARIABLE} is honoured only with ${SANDBOX_VARIABLE}=1; unset it, or run in the sandbox`,
      );
    }
  }
  if (enabled && !env.MARVIN_PIPELINE_FAKE_CI) {
    throw new Error(
      `${SANDBOX_VARIABLE}=1 needs MARVIN_PIPELINE_FAKE_CI: the sandbox pull request does not exist on GitHub`,
    );
  }
  return { enabled, modelOverride: override };
}

/**
 * Bench mode (plan Task 21, D5): sandbox mode as the replay benchmark runs it, plus the one seam a
 * benchmark variant needs that the sandbox lacks. `MARVIN_PIPELINE_BENCH=1` is honoured only on
 * top of sandbox mode with `MARVIN_PIPELINE_FAKE_CI=green`, so it adds no delivery mechanism of
 * its own: the sandbox's `gh` shim and local bare origin already keep a run's push and pull
 * request off GitHub, and green fake CI is the plan's "the engine stubs CI to green". What it adds
 * is `MARVIN_PIPELINE_ROLES_DIR`, the role prompts a variant replaces (`bench --roles-dir`); a
 * rubric variant needs no seam, because the bench writes it as the replay repository's own
 * `.marvin/pipeline/rubric.yaml`, which `rubricFor` already merges.
 *
 * Outside bench mode a roles directory is refused rather than ignored, for the reason an override
 * outside sandbox mode is: a production run must never quietly run on prompts nobody reviewed.
 */
export const BENCH_VARIABLE = "MARVIN_PIPELINE_BENCH";
export const ROLES_DIR_VARIABLE = "MARVIN_PIPELINE_ROLES_DIR";

export interface BenchSettings {
  enabled: boolean;
  /** The role prompts directory a variant runs on, or null for the plugin's own. */
  rolesDir: string | null;
}

/** Reads and checks the bench switches; throws on a combination the pipeline refuses. */
export function benchSettings(env: NodeJS.ProcessEnv = process.env): BenchSettings {
  const raw = env[BENCH_VARIABLE];
  if (raw !== undefined && raw !== "" && raw !== "1" && raw !== "0") {
    throw new Error(`${BENCH_VARIABLE} must be 1 or 0: ${raw}`);
  }
  const enabled = raw === "1";
  const rolesDir = env[ROLES_DIR_VARIABLE]?.trim() || null;
  if (enabled) {
    if (!sandboxSettings(env).enabled) {
      throw new Error(`${BENCH_VARIABLE}=1 is honoured only with ${SANDBOX_VARIABLE}=1`);
    }
    if (env.MARVIN_PIPELINE_FAKE_CI !== "green") {
      throw new Error(`${BENCH_VARIABLE}=1 needs MARVIN_PIPELINE_FAKE_CI=green`);
    }
  }
  if (rolesDir !== null) {
    if (!enabled) {
      throw new Error(`${ROLES_DIR_VARIABLE} is honoured only with ${BENCH_VARIABLE}=1`);
    }
    if (!isAbsolute(rolesDir) || !existsSync(join(rolesDir, "common.md"))) {
      throw new Error(
        `${ROLES_DIR_VARIABLE} must be an absolute directory holding common.md: ${rolesDir}`,
      );
    }
  }
  return { enabled, rolesDir };
}

/** The assignment a child actually runs with: the override's model, the rubric's effort. */
export function effectiveAssignment(a: Assignment, s: SandboxSettings): Assignment {
  return s.enabled && s.modelOverride !== null ? { ...a, model: s.modelOverride } : a;
}

/**
 * The `gh` shim, run by node. Its state is one JSON file beside it, so the PR an executor opened
 * is the PR the next executor and the verifier find. It answers the REST calls the pipeline's
 * children make through `gh api` (`github.ts` says why REST only): the open-PR lookup by head
 * (`pulls?head=…`), which lists nothing until a PR exists; `POST …/pulls`, which records the PR,
 * prints it and refuses a second one; `GET …/pulls/<n>`, as JSON or, with the diff media type, as
 * the branch's diff; and empty workflow runs and check runs. `--jq` takes `.a.b`, `.[0].a` and a
 * trailing `// empty`. `pr ready` flips the draft. Everything else fails, as the child guard would
 * refuse it.
 */
const SHIM = String.raw`
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STATE = process.env.MARVIN_SANDBOX_GH_STATE;
const URL = process.env.MARVIN_SANDBOX_GH_URL;
const args = process.argv.slice(2);
const git = (...a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const fail = (text) => {
  process.stderr.write(text + "\n");
  process.exit(1);
};
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null);
const save = (pr) => writeFileSync(STATE, JSON.stringify(pr, null, 2) + "\n");
const branch = () => git("rev-parse", "--abbrev-ref", "HEAD");
const rest = (pr) => ({
  html_url: pr.url,
  number: 1,
  state: pr.state === "OPEN" ? "open" : "closed",
  merged: false,
  draft: pr.isDraft,
  title: pr.title,
  body: pr.body,
  mergeable: true,
  mergeable_state: "clean",
  base: { ref: pr.base },
  head: { ref: pr.head, sha: git("rev-parse", "HEAD") },
});
const current = () => {
  const pr = load();
  if (!pr || pr.head !== branch()) fail("gh: Not Found (HTTP 404)");
  return pr;
};
const jq = (value, filter) => {
  let f = filter.trim();
  let orEmpty = false;
  if (f.endsWith("// empty")) {
    orEmpty = true;
    f = f.slice(0, -"// empty".length).trim();
  }
  if (!/^(\.[A-Za-z_]\w*|\.\[\d+\])+$|^\.$/.test(f)) {
    fail("gh (autopilot sandbox): --jq takes .a.b, .[0].a and // empty only, not " + filter);
  }
  let v = value;
  for (const step of f.match(/\.[A-Za-z_]\w*|\.\[\d+\]/g) ?? []) {
    if (v === null || v === undefined) break;
    v = step.startsWith(".[") ? v[Number(step.slice(2, -1))] : v[step.slice(1)];
  }
  if (v === null || v === undefined) return orEmpty ? "" : "null\n";
  return (typeof v === "string" ? v : JSON.stringify(v)) + "\n";
};

const api = () => {
  let method = null;
  let filter = null;
  let diff = false;
  const fields = {};
  const positional = [];
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    const next = () => args[++i] ?? "";
    if (a === "-X" || a === "--method") method = next().toUpperCase();
    else if (a === "-q" || a === "--jq") filter = next();
    else if (a === "-H" || a === "--header") diff ||= /vnd\.github(\.v3)?\.diff/.test(next());
    else if (a === "-f" || a === "--raw-field" || a === "-F" || a === "--field") {
      const typed = a === "-F" || a === "--field";
      const kv = next();
      const at = kv.indexOf("=");
      let v = kv.slice(at + 1);
      if (typed && v.startsWith("@")) v = readFileSync(v === "@-" ? 0 : v.slice(1), "utf8");
      else if (typed && (v === "true" || v === "false")) v = v === "true";
      fields[kv.slice(0, at)] = v;
    } else if (a.startsWith("-")) fail("gh (autopilot sandbox): gh api " + a + " is not supported");
    else positional.push(a);
  }
  const endpoint = (positional[0] ?? "").replace(/^\//, "");
  const m = /^repos\/\{owner\}\/\{repo\}\/([^?]*)(?:\?(.*))?$/.exec(endpoint);
  if (!m) fail("gh (autopilot sandbox): only repos/{owner}/{repo}/… is supported, not " + endpoint);
  const [, path, query = ""] = m;
  method ??= Object.keys(fields).length ? "POST" : "GET";
  const out = (value) => {
    process.stdout.write(filter === null ? JSON.stringify(value) + "\n" : jq(value, filter));
  };
  if (method === "POST" && path === "pulls") {
    const existing = load();
    if (existing && existing.head === fields.head) {
      fail("gh: Validation Failed (HTTP 422): A pull request already exists for " + fields.head + ".");
    }
    if (!fields.base || !fields.head) fail("gh: Validation Failed (HTTP 422): base and head are required");
    const pr = {
      url: URL,
      state: "OPEN",
      isDraft: fields.draft === true,
      title: fields.title ?? git("log", "-1", "--format=%s"),
      body: fields.body ?? "",
      base: fields.base,
      head: fields.head,
    };
    save(pr);
    return out(rest(pr));
  }
  if (method !== "GET") fail("gh (autopilot sandbox): gh api " + method + " " + endpoint + " is not supported");
  if (path === "pulls") {
    const head = new URLSearchParams(query).get("head");
    const pr = load();
    const name = head === null ? branch() : head.slice(head.indexOf(":") + 1).replace("{branch}", branch());
    return out(pr && pr.head === name && pr.state === "OPEN" ? [rest(pr)] : []);
  }
  if (/^pulls\/\d+$/.test(path)) {
    const pr = current();
    if (diff) return process.stdout.write(git("diff", "origin/" + pr.base + "...HEAD") + "\n");
    return out(rest(pr));
  }
  if (path === "actions/runs") return out({ total_count: 0, workflow_runs: [] });
  if (/^commits\/[^/]+\/check-runs$/.test(path)) return out({ total_count: 0, check_runs: [] });
  if (/^commits\/[^/]+\/status$/.test(path)) return out({ state: "pending", statuses: [] });
  fail("gh (autopilot sandbox): gh api GET " + endpoint + " is not supported");
};

const sub = (args[0] ?? "") + " " + (args[1] ?? "");
if (args[0] === "api") api();
else if (sub === "pr ready") {
  const pr = load();
  if (!pr) fail("gh: no pull request");
  pr.isDraft = false;
  save(pr);
} else if (sub === "run list") process.stdout.write(args.includes("--json") ? "[]\n" : "");
else fail("gh " + sub.trim() + ": not available in the autopilot sandbox");
`;

/**
 * Writes the shim into `<runDir>/sandbox-bin/` and returns the environment a child needs to find
 * it first: PATH, the shim's state file and URL. Called only in sandbox mode, so the shim is never
 * written, let alone on a PATH, outside it.
 */
export function installSandboxGh(
  runDir: string,
  nodePath = process.execPath,
): Record<string, string> {
  const bin = join(runDir, "sandbox-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "gh-shim.mjs");
  writeFileSync(script, SHIM.trimStart());
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\nexec ${quote(nodePath)} ${quote(script)} "$@"\n`);
  chmodSync(gh, 0o755);
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    MARVIN_SANDBOX_GH_STATE: join(runDir, "sandbox-gh.json"),
    MARVIN_SANDBOX_GH_URL: SANDBOX_PR_URL,
  };
}

/** The environment a sandbox child gets on top of its role's: the `gh` shim, first on PATH. */
export function sandboxChildEnv(runDir: string, s: SandboxSettings): Record<string, string> {
  return s.enabled ? installSandboxGh(runDir) : {};
}
