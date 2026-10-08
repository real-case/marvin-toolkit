// The pipeline mode of the four delivery skills (autopilot plan, Task 16).
//
// A pipeline child runs task-implement, task-deliver, commit and pr-create headless, with
// MARVIN_PIPELINE=1 set and nobody to answer a question. Each skill carries one
// `## Pipeline mode` section that overrides only the steps that would wait on a human or
// that the pipeline does itself; the interactive workflow above it is untouched.
//
// Four properties, asserted separately so a failure names which one moved:
//   1. Each skill has exactly one such section, gated on the variable, appended after the
//      interactive workflow, and free of anything the three doors or the user rule forbid.
//   2. Each section states the behaviours the plan lists, by stable phrases. They are read
//      from the section alone, so the interactive prose cannot satisfy them by accident.
//   3. The names the prose hands to tools are the names the code declares: the `verify`
//      inputs, and the executor object's fields the engine reads. A rename on either side
//      fails here instead of in a headless run nobody watches.
//   4. The reasons the rules give still hold in the code. Each rule here exists because of
//      one code fact (a guard, a digest exclusion, a required argument); the test pins the
//      fact beside the rule, so a change to the code fails here and names the prose to revisit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(repoRoot, "plugins", "marvin");
const serverSrc = join(packDir, "mcp", "server", "src");

const SKILLS = ["task-implement", "task-deliver", "commit", "pr-create"];
const HEADING = "## Pipeline mode";

const skillText = (name) => readFileSync(join(packDir, "skills", name, "SKILL.md"), "utf8");

/**
 * The level-2 headings of a markdown body, with the line each sits on. Fence-aware: a
 * `## Summary` inside a PR-body template is an example, not a heading of the skill.
 */
function headings(text) {
  const out = [];
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith("## ")) out.push({ title: line.trimEnd(), index });
  });
  return out;
}

/** The `## Pipeline mode` section: its heading up to the next level-2 heading or the end. */
function pipelineSection(name) {
  const text = skillText(name);
  const all = headings(text);
  const at = all.findIndex((h) => h.title === HEADING);
  assert.ok(at >= 0, `${name}: no "${HEADING}" section`);
  const lines = text.split("\n");
  const end = all[at + 1]?.index ?? lines.length;
  return lines.slice(all[at].index, end).join("\n");
}

/** Whitespace-normalised, so a phrase is found across a wrapped line. */
const flat = (text) => text.replace(/\s+/g, " ");

/**
 * One top-level bullet of a flattened section, from its bold lead-in up to the next
 * top-level bullet. A rule asserted on its own bullet cannot be satisfied by a phrase
 * another rule happens to use.
 */
function bullet(flatSection, lead) {
  const start = flatSection.indexOf(`- **${lead}`);
  assert.ok(start >= 0, `no bullet starting "${lead}"`);
  const next = flatSection.indexOf(" - **", start + 1);
  return flatSection.slice(start, next < 0 ? undefined : next);
}

const serverFile = (...parts) => readFileSync(join(serverSrc, ...parts), "utf8");

// ── 1. one gated section per skill ───────────────────────────────────────────

test("each delivery skill has exactly one Pipeline mode section, gated and last", () => {
  for (const name of SKILLS) {
    const all = headings(skillText(name));
    const found = all.filter((h) => h.title === HEADING);
    assert.equal(found.length, 1, `${name}: expected one "${HEADING}" heading`);
    // Last, so that "every step above applies" covers the whole interactive workflow and
    // no anchor another test pins (a step heading, the first receipt mention) moves.
    assert.equal(all.at(-1).title, HEADING, `${name}: the pipeline section is not the last one`);

    const section = pipelineSection(name);
    assert.match(section, /`MARVIN_PIPELINE=1`/, `${name}: the section does not name its switch`);
    assert.match(
      flat(section),
      /interactive session never sets/i,
      `${name}: the section does not say interactive use is unaffected`,
    );
  }
});

test("no section names a plugin resource path or a Fable model", () => {
  for (const name of SKILLS) {
    const section = pipelineSection(name);
    // A `skills/…` path is resolved differently by each of the three doors (ADR-0008), and
    // the commit skill is pinned to carry none at all (skill-resolution.test.mjs).
    assert.doesNotMatch(section, /skills\//, `${name}: the section names a skills/ path`);
    assert.doesNotMatch(section, /fable/i, `${name}: the section names Fable`);
  }
});

// ── 2. the behaviours ────────────────────────────────────────────────────────

test("task-implement: argument only, no handshake, no diff critic, sequential self-check", () => {
  const s = flat(pipelineSection("task-implement"));
  assert.match(s, /`\$ARGUMENTS` alone/, "the spec is not resolved from the argument only");
  assert.match(s, /no handshake/i, "the Step 3 handshake is not skipped");
  assert.match(s, /`marvin-tm-diff-critic`/, "the diff critic is not addressed");
  assert.match(s, /skip the critic dispatch/i, "the diff critic is not skipped");
  assert.match(s, /`action: "oracles"`/, "the oracle run is missing");
  assert.match(s, /`expect: "pass"`/, "the oracle run does not name its green phase");
  assert.match(s, /for either spec type/i, "the oracle run is not extended to features");
  assert.match(s, /`execution: "sequential"`/, "the gates are not run sequentially");
  assert.match(s, /pass neither `gates` nor `only`/, "the full pass may drop the declared gates");
  assert.match(s, /self-check/i, "the section does not say the engine re-runs everything");
});

test("task-implement: sealed tests read-only, fix cycle kept, executor object out", () => {
  const s = flat(pipelineSection("task-implement"));
  assert.match(s, /sealed acceptance tests are read-only/i, "sealed tests are not read-only");
  assert.match(s, /three rounds/i, "the fix cycle's budget is not kept");
  assert.match(s, /`marvin-debugger`/, "the debugger escalation is not kept");
  assert.match(s, /executor object/i, "the final output is not the executor object");
  for (const status of ["done", "needs_input", "failed"]) {
    assert.match(s, new RegExp(`\`${status}\``), `the executor status "${status}" is not covered`);
  }
  assert.match(s, /`ANSWERS:`/, "the resume-with-answers rule is missing");
});

test("task-deliver: no allowStale, artifacts before the final verify, in-progress, no lesson", () => {
  const raw = pipelineSection("task-deliver");
  const s = flat(raw);
  assert.match(s, /never `allowStale`/i, "allowStale is not forbidden");
  assert.doesNotMatch(raw, /allowStale:\s*true/, "the section instructs a waiver");
  assert.match(s, /before the (last|final) full `verify` run/i, "write-before-verify is missing");
  assert.match(s, /`in-progress`/, "the spec status is not kept in-progress");
  assert.match(s, /`lessons` `action: "add"`/, "the lesson capture is not addressed");
  assert.match(s, /Step 5 — skipped/, "the lesson capture is not skipped");
  assert.match(s, /\*\*draft\*\*/, "the PR is not opened as a draft");
  // Two lines carry the critic verdicts and critique-protocol.test.mjs counts exactly two.
  assert.doesNotMatch(raw, /\*\*(Spec|Diff) critic:\*\*/, "a third critic line was added");
});

test("commit: no confirmation, the project's conventional message, no AI attribution", () => {
  const s = flat(pipelineSection("commit"));
  assert.match(s, /no confirmation/i, "the confirmation is not skipped");
  assert.match(s, /skip step 5/i, "the skipped step is not named");
  assert.match(s, /Conventional Commits/, "the message format is not stated");
  assert.match(s, /project's own commit rules/i, "the project's rules do not lead");
  assert.match(s, /no AI attribution/i, "the attribution rule is not restated");
});

test("pr-create: config base, draft once, Pipeline body section, no issue question", () => {
  const raw = pipelineSection("pr-create");
  const s = flat(raw);
  assert.match(s, /no confirmation/i, "the confirmation is not skipped");
  assert.match(s, /`base_branch`/, "the base is not the configured one");
  assert.match(s, /`--base`/, "--base is not named");
  assert.match(s, /`--draft`/, "--draft is not named");
  assert.match(s, /`gh pr view`/, "an existing PR is not looked for first");
  assert.match(raw, /^\s*## Pipeline$/m, "the body's Pipeline section is missing");
  for (const field of ["Run:", "Tier:", "Iteration:"]) {
    assert.ok(raw.includes(`- ${field}`), `the Pipeline section lacks "${field}"`);
  }
  assert.ok(
    raw.includes("Review: pipeline gate stage and external verifier"),
    "the review line is missing",
  );
  assert.match(s, /no issue-reference question/i, "the issue question is not skipped");
  assert.match(s, /`pipeline\.tracker_default`/, "the tracker fallback is not named");
});

// ── 3. the names match the code ──────────────────────────────────────────────

test("the verify inputs the prose names are the ones the tool declares", () => {
  const verify = readFileSync(join(serverSrc, "tools", "verify.ts"), "utf8");
  const schema = verify.slice(
    verify.indexOf("const VerifyInput = z.object({"),
    verify.indexOf("type VerifyInput"),
  );
  assert.ok(schema.length > 0, "VerifyInput moved; re-anchor this test");
  for (const key of ["action", "execution", "expect", "specSlug", "allowStale", "gates", "only"]) {
    assert.match(schema, new RegExp(`\\n  ${key}: z`), `verify declares no "${key}" input`);
  }
  assert.match(schema, /"oracles"/, "verify has no oracles action");
  assert.match(schema, /"sequential"/, "verify has no sequential execution");

  const prose = flat(pipelineSection("task-implement") + pipelineSection("task-deliver"));
  for (const key of ["execution", "expect", "specSlug", "action"]) {
    assert.match(prose, new RegExp(`\`${key}`), `the prose does not pass "${key}"`);
  }
});

test("the executor fields the prose fills are the ones the engine reads", () => {
  const engine = readFileSync(join(serverSrc, "pipeline", "engine.ts"), "utf8");
  const block = engine.slice(
    engine.indexOf("export const ExecutorOutput"),
    engine.indexOf("export const VerifierOutput"),
  );
  assert.ok(block.length > 0, "ExecutorOutput moved; re-anchor this test");
  const prose = flat(pipelineSection("task-implement"));
  for (const field of ["status", "claims", "questions", "dispute", "pr_url"]) {
    assert.match(block, new RegExp(`\\b${field}:`), `the engine no longer reads "${field}"`);
    assert.match(prose, new RegExp(`\`${field}\``), `the prose does not fill "${field}"`);
  }
  for (const status of ["done", "needs_input"]) {
    assert.ok(block.includes(`"${status}"`), `the engine no longer accepts "${status}"`);
  }
  // `failed` is not an ExecutorOutput status: wait.ts classifies it as a child fault before
  // the engine parses anything, which is why the prose reserves it for the Blocker protocol.
  const wait = readFileSync(join(serverSrc, "pipeline", "wait.ts"), "utf8");
  assert.match(wait, /STRUCTURED = new Set\(\[[^\]]*"failed"/, "wait.ts no longer reads failed");
});

// ── 4. the reasons hold in the code ──────────────────────────────────────────

test("commit: a sensitive-name match is judged on its content, not dropped on its name", () => {
  // Step 2's grep matches `token`, `secret` and `credentials` anywhere in a path. In a
  // pipeline an unstaged work file is a gate blocker on every later attempt, since each
  // executor commits through this same skill, so dropping every match on its name alone
  // halts any run whose contract touches a file like `tokens.css`.
  const grep = /grep -iE '([^']+)'/.exec(skillText("commit"))?.[1];
  assert.ok(grep, "step 2's sensitive-name grep moved; re-anchor this test");
  const sensitive = new RegExp(grep, "i");
  for (const path of ["src/app/_theme/tokens.css", "plugins/marvin/hooks/secret-guard.mjs"]) {
    assert.match(path, sensitive, `the premise no longer holds: the grep misses ${path}`);
  }

  const rule = bullet(flat(pipelineSection("commit")), "A sensitive-name match");
  assert.match(rule, /contract `files`/, "a contract file is not committed through a name match");
  assert.match(rule, /sealed test/i, "a sealed test is not committed through a name match");
  assert.match(rule, /added lines/i, "any other match is not judged on its content");
  assert.match(rule, /`secret-guard`/, "the commit-time secret scan is not named");
  assert.doesNotMatch(rule, /never committed/i, "a name match is still dropped unconditionally");

  // The scan the rule leans on runs on every Bash call, `git commit` included.
  const manifest = JSON.parse(readFileSync(join(packDir, "hooks", "hooks.json"), "utf8"));
  const onBash = manifest.hooks.PreToolUse.filter((entry) => entry.matcher === "Bash");
  assert.ok(
    onBash.some((entry) => entry.hooks.some((h) => /secret-guard\.mjs/.test(h.command))),
    "secret-guard is no longer a PreToolUse hook on Bash; revisit the commit rule",
  );
});

test("task-implement: a loop's limit still opens the draft PR, and every done carries it", () => {
  const s = flat(pipelineSection("task-implement"));
  const limit = bullet(s, "At a loop's limit");
  assert.match(limit, /`\/marvin:commit`/, "the limit path does not commit");
  assert.match(limit, /`\/marvin:pr-create`/, "the limit path opens no pull request");
  assert.match(limit, /\*\*draft\*\*/, "the limit path's pull request is not a draft");
  assert.match(limit, /`action: "gate"`/, "the limit path does not say it skips the delivery gate");
  assert.match(limit, /`pr_url`/, "the limit path's result carries no PR URL");
  assert.match(s, /every `done` carries a `pr_url`/i, "a done may still come back without a PR");
  assert.doesNotMatch(s, /`pr_url` when a pull request exists/, "a PR is still optional on done");

  const handBack = bullet(flat(pipelineSection("task-deliver")), "Step 1 — never `allowStale`");
  assert.match(handBack, /loop's limit/i, "a red delivery gate does not route to the limit path");

  // Why the PR cannot be optional: the CI stage takes its URL as a required string, and the
  // gate stage can pass a tree this session saw red, because it re-runs a failing gate once.
  assert.match(
    serverFile("pipeline", "ci.ts"),
    /export function fetchCi\(o: \{[^}]*\bprUrl: string;/,
    "fetchCi no longer requires a PR URL; revisit the limit rule",
  );
  assert.match(
    serverFile("pipeline", "gate.ts"),
    /result: "flaky"/,
    "the gate stage no longer records a re-run pass as flaky; revisit the limit rule",
  );
});

test("pr-create: the Pipeline section takes run, tier and iteration from the TASK CONTEXT", () => {
  const s = flat(pipelineSection("pr-create"));
  assert.match(
    s,
    /Take Run, Tier and Iteration from the TASK CONTEXT/,
    "the fields have no source",
  );
  assert.doesNotMatch(s, /working directory/, "Run is still derived from the cwd");
  assert.doesNotMatch(s, /`not stated`/, "a fallback survives for a value the context carries");

  // The engine puts all three into the executor's context, and its template renders them.
  const engine = serverFile("pipeline", "engine.ts");
  const executorCtx = engine.slice(
    engine.indexOf("const executorCtx"),
    engine.indexOf("const verifierCtx"),
  );
  for (const key of [
    /iteration: String\(r\.iteration\)/,
    /run: r\.id/,
    /tier: r\.tier \?\? r\.stageA/,
  ]) {
    assert.match(executorCtx, key, `the executor context lost ${key}`);
  }
  const template = readFileSync(join(packDir, "pipeline", "roles", "executor.context.md"), "utf8");
  for (const name of ["iteration", "run", "tier"]) {
    assert.ok(template.includes(`{{${name}}}`), `executor.context.md does not render ${name}`);
  }
});

test("task-implement: the pipeline executor never hands the spec to marvin-tm-executor", () => {
  // The interactive Guidelines offer that agent for hands-off work. It opens a ready pull
  // request and runs the diff critic, which the pipeline replaces (plan D4, D7).
  const s = flat(pipelineSection("task-implement"));
  const rule = bullet(s, "No hands-off dispatch");
  assert.match(rule, /never dispatch `marvin-tm-executor`/, "the dispatch is not forbidden");
  assert.match(rule, /draft/, "the reason, the draft PR, is not stated");
  assert.match(
    flat(skillText("task-implement")),
    /dispatch the spec to the `marvin-tm-executor` agent/,
    "the interactive offer moved; revisit the rule",
  );
});

test("task-implement: the full self-check states how its plan relates to the gate stage's", () => {
  const rule = bullet(flat(pipelineSection("task-implement")), "Step 6F / 9B — the self-check");
  assert.doesNotMatch(
    rule,
    /which is the plan the pipeline's gate stage runs/,
    "the two plans are still claimed identical",
  );
  assert.match(rule, /by name/i, "the per-name override is not stated");
  assert.match(rule, /`gates\.extra`/, "the extras are not stated");
  assert.match(rule, /config leaves out/i, "a standard gate only detection supplies is not stated");

  // `verify` overlays config gates on detection one name at a time, keeps a detected gate
  // the config omits, and adds the extras only when neither `gates` nor `only` is passed.
  const verify = serverFile("tools", "verify.ts");
  assert.match(verify, /const override = configGates\.find\(\(g\) => g\.name === name\);/);
  assert.match(
    verify,
    /else gates\.push\(\.\.\.base\.gates\.filter\(\(g\) => g\.name === name\)\);/,
  );
  assert.match(verify, /const usesExtras = !\(input\.gates\?\.length \|\| input\.only\);/);
});

test("the write-before-verify rules state what the freshness digest actually counts", () => {
  assert.match(
    serverFile("lib", "provenance.ts"),
    /const DIGEST_EXCLUDE = \["\.marvin"\];/,
    "the digest no longer excludes .marvin/; revisit both rules",
  );
  const rules = {
    "task-deliver": bullet(
      flat(pipelineSection("task-deliver")),
      "Write everything before the final verify",
    ),
    "task-implement": bullet(
      flat(pipelineSection("task-implement")),
      "The journal comes before the final verify",
    ),
  };
  for (const [name, rule] of Object.entries(rules)) {
    assert.match(
      rule,
      /outside `\.marvin\/`/,
      `${name}: the case where the journal counts is unstated`,
    );
    assert.match(rule, /Nothing under `\.marvin\/` counts/, `${name}: the exclusion is unstated`);
    assert.doesNotMatch(
      rule,
      /counts (those files|the journal)\b/,
      `${name}: the old reason survives`,
    );
  }
});

test("task-implement: the executor makes no seal call, which the guard always refuses it", () => {
  const rule = bullet(flat(pipelineSection("task-implement")), "Steps 1–2");
  assert.match(rule, /Skip the `spec` seal call/, "the executor still calls seal");
  assert.doesNotMatch(
    rule,
    /refuses the seal call itself/,
    "the rule is still built on the denial",
  );
  assert.match(rule, /`action: "oracles"`/, "the contract check that replaces the seal is unnamed");

  assert.match(
    readFileSync(join(packDir, "pipeline", "hooks", "child-mcp-guard.mjs"), "utf8"),
    /\(args\.action === "seal" \|\| args\.mode === "seal"\) && role !== "planner"/,
    "the guard lets another role seal now; revisit the rule",
  );
  // The oracle run refuses an unsealed or a tampered contract before it runs anything.
  const verify = serverFile("tools", "verify.ts");
  assert.match(verify, /is UNSEALED/);
  assert.match(verify, /has been edited since it was sealed/);
});

test("task-implement: the scope gate's allow covers exactly what the gate stage declares", () => {
  // Step 6F resolves a scope FAIL by revert or `allow`. Forbidding `allow` outright leaves a
  // headless executor only `needs_input` for a path the gate stage itself accepts: a sealed
  // test, or a by-product such as a host-directory progress journal that the pipeline's
  // regex exempts and `scope.exempt` does not.
  const section = flat(pipelineSection("task-implement"));
  assert.doesNotMatch(section, /Scope has no `allow`/, "allow is still forbidden outright");
  const rule = bullet(section, "Step 6F / 9B — the scope gate");
  assert.match(rule, /sealed tests? the TASK CONTEXT lists/i, "the sealed paths are not allowed");
  assert.match(rule, /`pipeline\.scope_exempt_pattern`/, "the exempt pattern has no named source");
  assert.match(rule, /`\.marvin\/config\.json`/, "the exempt pattern's file is not named");
  assert.match(rule, /`allow` set to exactly those paths/, "allow is not bounded to those paths");
  assert.match(rule, /No other path goes into `allow`/, "allow may still absorb scope creep");
  assert.match(rule, /`needs_input`/, "a path still outside has no exit");

  // The gate stage declares the sealed tests beside the contract files and exempts by the
  // pipeline's own regex; the executor's TASK CONTEXT carries the sealed list.
  assert.match(
    serverFile("pipeline", "gate.ts"),
    /undeclaredFiles\(\s*changed,\s*\[\.\.\.o\.contractFiles, \.\.\.o\.sealed\.map\(\(s\) => s\.path\)\],\s*o\.exemptPattern,?\s*\)/,
    "the gate stage's declared set moved; revisit the scope rule",
  );
  assert.match(
    serverFile("storage", "schema.ts"),
    /export const PipelineConfig = z\.object\(\{[\s\S]*?\n {2}scope_exempt_pattern: regexField\("scope_exempt_pattern"\)/,
    "the exempt pattern is no longer pipeline.scope_exempt_pattern; revisit the scope rule",
  );
  const engine = serverFile("pipeline", "engine.ts");
  const executorCtx = engine.slice(
    engine.indexOf("const executorCtx"),
    engine.indexOf("const verifierCtx"),
  );
  assert.match(
    executorCtx,
    /sealed: sealedList\(r\),/,
    "the executor no longer sees the sealed list",
  );

  // The executor's own gate knows only the contract files, `allow` and `scope.exempt`, which
  // is why the two sets the gate stage adds have to reach it through `allow`.
  const spec = serverFile("tools", "spec.ts");
  assert.match(
    spec,
    /allowlist: \[\.\.\.parsed\.data\.files\.map\(\(f\) => f\.path\), \.\.\.allow\],/,
  );
  assert.match(spec, /exempt: loaded\.config\.scope\?\.exempt,/);
});
