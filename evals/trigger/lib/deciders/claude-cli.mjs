// claude-cli decider — GROUND TRUTH. Runs the query through a real headless
// Claude Code session (`claude -p`) in a workspace where the marvin plugin is
// installed, then inspects the JSON transcript to see which skill actually got
// loaded (a Skill/SKILL.md read or a /marvin:<skill> invocation).
//
// This is the only decider that observes real auto-discovery rather than
// simulating the decision. It is also the most environment-sensitive: it needs
// the `claude` CLI on PATH and the plugin installed/linked in --workspace.
// Treat a failure to launch as an environment problem, not a skill defect.

import { spawn } from "node:child_process";

/**
 * @param {Object} [opts]
 * @param {string} [opts.workspace]  cwd for the headless run (plugin must be installed here)
 * @param {string} [opts.model]
 * @param {number} [opts.timeoutMs]  default 120000
 * @returns {import("./index.mjs").Decider}
 */
export function createClaudeCliDecider(opts = {}) {
  const workspace = opts.workspace || process.env.MARVIN_EVAL_WORKSPACE || process.cwd();
  const timeoutMs = opts.timeoutMs ?? 120000;

  return async ({ target, query }) => {
    const args = ["-p", query.text, "--output-format", "json"];
    if (opts.model) args.push("--model", opts.model);
    const raw = await run("claude", args, { cwd: workspace, timeoutMs });
    const skill = detectSkill(raw, target);
    return { skill, reason: skill ? "observed in transcript" : "no skill load observed" };
  };
}

/**
 * Detect which marvin skill (if any) a headless transcript loaded. Heuristic and
 * intentionally conservative: it looks for the skill name next to a Skill tool
 * use, a SKILL.md read, or a /marvin:<skill> prompt.
 */
export function detectSkill(transcriptText, target) {
  const hay = transcriptText;
  const named = new Set();
  const patterns = [
    /"skill"\s*:\s*"([a-z0-9-]+)"/gi,
    /skills\/([a-z0-9-]+)\/SKILL\.md/gi,
    /\/marvin:([a-z0-9-]+)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(hay))) named.add(m[1]);
  }
  if (named.has(target)) return target;
  // Return the first observed skill so competition (wrong-skill) is measurable.
  return named.size ? [...named][0] : null;
}

function run(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`failed to launch ${cmd}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });
  });
}
