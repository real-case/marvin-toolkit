import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/** The assignment a child actually runs with: the override's model, the rubric's effort. */
export function effectiveAssignment(a: Assignment, s: SandboxSettings): Assignment {
  return s.enabled && s.modelOverride !== null ? { ...a, model: s.modelOverride } : a;
}

/**
 * The `gh` shim, run by node. Its state is one JSON file beside it, so the PR an executor opened
 * is the PR the next executor and the verifier find. It mimics the shapes the pipeline's skills
 * and roles rely on: `pr view` fails with "no pull requests found" until `pr create` succeeds,
 * `pr create` prints the URL and refuses a second PR, and `--json` / `--jq .field` answer from
 * the recorded PR and the worktree's git. Everything else fails, as the child guard would refuse it.
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
const value = (long, short) => {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === long || (short && a === short)) return args[i + 1] ?? "";
    if (a.startsWith(long + "=")) return a.slice(long.length + 1);
  }
  return null;
};
const has = (name) => args.includes(name);
const body = () => {
  const file = value("--body-file", "-F");
  if (file !== null) return file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  return value("--body", "-b");
};
const branch = () => git("rev-parse", "--abbrev-ref", "HEAD");
const fields = (pr) => ({
  url: pr.url,
  number: 1,
  state: pr.state,
  isDraft: pr.isDraft,
  title: pr.title,
  body: pr.body,
  baseRefName: pr.base,
  headRefName: pr.head,
  headRefOid: git("rev-parse", "HEAD"),
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "",
  statusCheckRollup: [],
  comments: [],
  reviews: [],
});
const emit = (pr) => {
  const json = value("--json");
  if (json === null) {
    process.stdout.write(pr.title + "\n" + pr.url + "\n" + (pr.isDraft ? "draft" : "open") + "\n");
    return;
  }
  const all = fields(pr);
  const picked = Object.fromEntries(json.split(",").map((k) => [k.trim(), all[k.trim()] ?? null]));
  const jq = value("--jq", "-q");
  if (jq !== null) {
    const m = /^\.(\w+)$/.exec(jq.trim());
    if (!m) fail("gh (autopilot sandbox): only --jq .<field> is supported, not " + jq);
    const v = picked[m[1]];
    process.stdout.write((typeof v === "string" ? v : JSON.stringify(v)) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(picked) + "\n");
};
const current = () => {
  const pr = load();
  if (!pr || pr.head !== branch()) fail('no pull requests found for branch "' + branch() + '"');
  return pr;
};

const sub = (args[0] ?? "") + " " + (args[1] ?? "");
switch (sub) {
  case "pr create": {
    const existing = load();
    if (existing && existing.head === branch()) {
      fail('a pull request for branch "' + branch() + '" into branch "' + existing.base + '" already exists:\n' + existing.url);
    }
    const base = value("--base", "-B");
    if (!base) fail("gh (autopilot sandbox): pr create needs --base");
    const pr = {
      url: URL,
      state: "OPEN",
      isDraft: has("--draft") || has("-d"),
      title: value("--title", "-t") ?? git("log", "-1", "--format=%s"),
      body: body() ?? "",
      base,
      head: value("--head", "-H") ?? branch(),
    };
    save(pr);
    process.stdout.write(pr.url + "\n");
    break;
  }
  case "pr view":
    emit(current());
    break;
  case "pr list": {
    const pr = load();
    const mine = pr && pr.head === branch() ? [pr] : [];
    if (value("--json") === null) {
      for (const p of mine) process.stdout.write("1\t" + p.title + "\t" + p.head + "\n");
    } else {
      const keys = value("--json").split(",").map((k) => k.trim());
      const rows = mine.map((p) => Object.fromEntries(keys.map((k) => [k, fields(p)[k] ?? null])));
      process.stdout.write(JSON.stringify(rows) + "\n");
    }
    break;
  }
  case "pr edit": {
    const pr = current();
    const title = value("--title", "-t");
    const text = body();
    if (title !== null) pr.title = title;
    if (text !== null) pr.body = text;
    save(pr);
    process.stdout.write(pr.url + "\n");
    break;
  }
  case "pr ready": {
    const pr = current();
    pr.isDraft = false;
    save(pr);
    break;
  }
  case "pr diff": {
    const pr = current();
    process.stdout.write(git("diff", "origin/" + pr.base + "...HEAD") + "\n");
    break;
  }
  case "pr checks":
    current();
    fail('no checks reported on the "' + branch() + '" branch');
    break;
  case "run list":
    process.stdout.write(value("--json") === null ? "" : "[]\n");
    break;
  default:
    fail("gh " + sub.trim() + ": not available in the autopilot sandbox");
}
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
