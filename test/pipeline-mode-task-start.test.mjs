// The pipeline mode of task-start (autopilot plan, Task 15).
//
// The planner child runs task-start headless with MARVIN_PIPELINE=1 set. Its "user" is the
// orchestrator, reached only by ending a turn with status `needs_input`, so every place the
// interactive workflow asks, confirms or presents carries a `Pipeline mode:` pointer to the
// row of one `## Pipeline mode` section that replaces it. That section is written against
// what the engine and the guards actually do, not against what the plan's snippets assumed.
//
// Four properties, asserted separately so a failure names which one moved:
//   1. One gated section, last, free of anything the three doors or the user rule forbid.
//   2. Every question site of the interactive workflow sits within five lines of a pointer
//      to the row that replaces it, and every pointer names a row the section has.
//   3. The rows state the behaviours the review pinned. Each is read from its own row, so
//      the interactive prose cannot satisfy it by accident.
//   4. What the prose claims about the engine and the guards is what their code does: the
//      question cap and its marker, the planner object's fields, the oracle blocker, and
//      the calls a pipeline child is refused. A change on either side fails here instead
//      of in a headless run nobody watches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(repoRoot, "plugins", "marvin");
const pipelineSrc = join(packDir, "mcp", "server", "src", "pipeline");
const hooksDir = join(packDir, "pipeline", "hooks");

const { childGitViolation } = await import(join(hooksDir, "child-git-guard.mjs"));
const { childMcpViolation } = await import(join(hooksDir, "child-mcp-guard.mjs"));

const HEADING = "## Pipeline mode";
const POINTER = "**Pipeline mode:**";

const read = (...parts) => readFileSync(join(...parts), "utf8");
const skill = read(packDir, "skills", "task-start", "SKILL.md");
const lines = skill.split("\n");

/** Whitespace-normalised, so a phrase is found across a wrapped line. */
const flat = (text) => text.replace(/\s+/g, " ");

/**
 * The level-2 headings with the line each sits on. Fence-aware: a `## Context` inside a
 * template block is an example, not a heading of the skill.
 */
function headings() {
  const out = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith("## ")) out.push({ title: line.trimEnd(), index });
  });
  return out;
}

/** The line the section starts on. */
function sectionStart() {
  const at = headings().find((h) => h.title === HEADING);
  assert.ok(at, `no "${HEADING}" section`);
  return at.index;
}

/** The `## Pipeline mode` section: its heading to the end, since it is the last one. */
const section = () => lines.slice(sectionStart()).join("\n");

/** One table row of the section, by its italic first-column name or its backticked field. */
function row(name) {
  const found = section()
    .split("\n")
    .filter((line) => line.startsWith(`| *${name}* |`) || line.startsWith(`| \`${name}\` |`));
  assert.equal(found.length, 1, `expected one "${name}" row in the pipeline section`);
  return flat(found[0]);
}

/** A bold-led block of the section, through its last bullet, up to the next plain paragraph. */
function block(lead) {
  const text = section();
  const at = text.indexOf(`**${lead}.**`);
  assert.ok(at >= 0, `no "**${lead}.**" block in the pipeline section`);
  const rest = text.slice(at);
  const end = rest.search(/\n\n(?![-\s])/);
  return flat(end === -1 ? rest : rest.slice(0, end));
}

// ── 1. one gated section ─────────────────────────────────────────────────────

test("task-start has exactly one Pipeline mode section, gated and last", () => {
  const all = headings();
  assert.equal(all.filter((h) => h.title === HEADING).length, 1, `expected one "${HEADING}"`);
  // Last, so that "every step above applies" covers the whole interactive workflow.
  assert.equal(all.at(-1).title, HEADING, "the pipeline section is not the last one");
  const s = flat(section());
  assert.match(s, /`MARVIN_PIPELINE=1`/, "the section does not name its switch");
  assert.match(s, /interactive session never sets/i, "interactive use is not said unaffected");
});

test("the section names no plugin resource path and the skill no Fable model", () => {
  // A `skills/…` path resolves differently through each of the three doors (ADR-0008).
  assert.doesNotMatch(section(), /skills\//, "the section names a skills/ path");
  assert.doesNotMatch(skill, /fable/i, "the skill names Fable");
});

// ── 2. every question site points at its row ─────────────────────────────────

/**
 * Each place the interactive workflow asks, confirms, presents or parks an unknown, by a
 * phrase unique to it, with the row that replaces it in pipeline mode. Anchored on text,
 * not on line numbers, so a pointer added above does not move every later site.
 */
const SITES = [
  ["If no arguments, ask the user", "Input"],
  ["| `shipped`, `superseded` | Fall through", "Path A"],
  ["Path B is **one-way**", "Path B"],
  ["get a one-line confirmation from the user", "Path C and D"],
  ["get explicit confirmation of the split", "Path C and D"],
  ["ask the user to paste content for other trackers", "Tracker"],
  ["Ask the user directly if unclear", "Task type"],
  ["**propose the missing ones once**", "Host conventions"],
  ["**The intake has a budget", "Questions"],
  ["**Batch up to three questions per turn**", "Questions"],
  ["needs *investigation* sets `spike_required: true`", "Unknowns"],
  ["and confirm it; if the user wants a different one", "Spec directory and slug"],
  ["ask whether this **supersedes** the existing spec", "Spec directory and slug"],
  ["**ask the user** for the test command", "Test harness"],
  ["Present the context map to the user", "Context map"],
  ["Present the variants and wait for the user's decision", "Variants"],
  ["let the user pick one of exactly two options", "Size gate"],
  ["Present the draft to the user. Iterate until they approve.", "Draft approval"],
  ["The user decides which to keep", "Follow-ups"],
  ["If the `spec` tool is unavailable, self-check", "Spec tool"],
  ["**Verdict `PASS WITH WARNINGS`**", "Critic"],
  ["**Verdict `UNABLE`**", "Critic"],
  ["**Second dispatch → `BLOCK`.**", "Critic"],
  ['Append a final `kind: "step"` journal entry and confirm the path', "Finalize"],
  ["Help the user establish a reliable reproduction path", "Reproduction"],
  ["Dispatch the **`marvin-debugger`** agent", "Root cause"],
  ["**UNCONFIRMED** →", "Unknowns"],
  ["If multiple valid approaches exist, present variants", "Variants"],
  ["items 1–3 taken together", "Size gate"],
  ["Present to user. Iterate until approved.", "Draft approval"],
  ["Tool unavailable → self-check manually", "Spec tool"],
  ["`PASS WITH WARNINGS` → user decides", "Critic"],
  ["**Ask within the budget.**", "Questions"],
  ["A genuine unknown that needs *investigation*", "Unknowns"],
  ["**The user decides.**", "Variants"],
];

test("every question site sits within five lines of a pointer to its row", () => {
  const end = sectionStart();
  for (const [anchor, name] of SITES) {
    const hits = lines.flatMap((line, i) => (i < end && line.includes(anchor) ? [i] : []));
    assert.equal(hits.length, 1, `anchor not found exactly once above the section: ${anchor}`);
    const near = lines.slice(Math.max(0, hits[0] - 5), hits[0] + 6);
    assert.ok(
      near.some((line) => line.includes(POINTER) && line.includes(`*${name}*`)),
      `no "${POINTER} … *${name}*" within five lines of: ${anchor}`,
    );
  }
});

test("every pointer names a row or a block the section has", () => {
  const s = section();
  const pointers = lines.slice(0, sectionStart()).filter((line) => line.includes(POINTER));
  assert.ok(pointers.length > 0, "the pointers are missing");
  for (const line of pointers) {
    const names = [...line.slice(line.indexOf(POINTER)).matchAll(/ \*([A-Z][^*]+)\*/g)].map(
      (m) => m[1],
    );
    assert.ok(names.length > 0, `a pointer names no row: ${line}`);
    for (const name of names) {
      assert.ok(
        s.includes(`| *${name}* |`) || s.includes(`**${name}.**`),
        `a pointer names "${name}", which the section does not have`,
      );
    }
  }
});

// ── 3. the behaviours ────────────────────────────────────────────────────────

test("questions: one cap counts every question, and past it the planner stops asking", () => {
  const q = block("Questions");
  assert.match(q, /`caps\.planner_questions`/, "the cap is not named");
  assert.match(q, /whoever answers/i, "the cap is not said to count every question");
  assert.doesNotMatch(flat(section()), /caps (how many|what) reach/i, "the cap is user-only");
  assert.match(q, /`recommendation accepted: question cap reached`/, "the marker is not quoted");
  assert.match(q, /never end a turn with `needs_input` again/i, "the rule past the cap is missing");
  assert.match(q, /retried a halt/i, "the retried halt is not covered");
  assert.match(q, /stand as the answer/i, "a recommendation is not written to be accepted");
  // Every row that routes to a question names the cap that turns it into a self-decision.
  for (const name of ["Variants", "Size gate", "Critic", "Test harness", "Path A", "Tracker"]) {
    assert.match(row(name), /question cap/i, `the ${name} row asks without the cap's condition`);
  }
});

test("writes: only the spec and its records, checked before every turn ends", () => {
  const w = block("What this session writes");
  assert.match(w, /`git status --short`/, "the end-of-turn check is missing");
  assert.match(w, /delete/i, "a stray file is not deleted");
  assert.match(w, /reproducer/i, "a throwaway reproducer is not named");
  const r = row("Reproduction");
  assert.doesNotMatch(r, /a failing test is best/i, "the planner is told to write a test");
  assert.match(r, /Regression Test Specification/, "the test is not handed to the spec");
  assert.match(r, /delete/i, "a scratch test is not deleted");
  const c = row("Root cause");
  assert.match(c, /reproducer/i, "the debugger's reproducer is not addressed");
  assert.match(c, /`lessons` `action: "add"`/, "the refused lesson call is not addressed");
});

test("host conventions: an unresolvable oracle is a gate blocker, never not-run", () => {
  const h = row("Host conventions");
  assert.match(h, /`oracle\.run`/, "the oracle.run fallback is not named");
  assert.match(h, /`gates\.test_one`/, "the single-test template is not named");
  assert.match(h, /blocker/i, "an unresolved oracle is not called a blocker");
  assert.match(h, /`\.marvin\/config\.json`/, "the config is not ruled out");
  assert.doesNotMatch(section(), /`not-run`/, "the section describes the interactive verify");
});

test("the planner object lists every assumption of the session on spec_ready", () => {
  const a = row("assumptions");
  assert.match(a, /whole session/i, "the list is not the whole session's");
  assert.match(a, /`spec_ready`/, "the turn the engine reads is not named");
  assert.match(a, /`needs_input`/, "the dropped turns are not named");
});

test("tracker, unknowns and Path A cover what a pipeline child cannot do", () => {
  const t = row("Tracker");
  assert.match(t, /always a question/i, "a tracker reference is not always a question");
  assert.match(t, /`gh issue view`/, "the refused fetch is not named");

  const u = row("Unknowns");
  assert.match(u, /never set `spike_required: true`/i, "spike_required is not ruled out");
  assert.match(u, /spike card/i, "the spike card is not ruled out");

  const p = row("Path A");
  for (const state of ["`ready`", "`in-progress`", "`draft`", "TAMPERED", "unsealed"]) {
    assert.ok(p.includes(state), `the Path A row does not cover ${state}`);
  }
  assert.match(p, /never hand(ed)? over/i, "the hand-over is not ruled out");
});

test("the remaining rows state the plan's behaviours", () => {
  assert.match(row("Path C and D"), /Assumptions/, "the router's default is not recorded");
  assert.match(row("Path C and D"), /no board card/i, "Path D still creates cards");
  assert.match(row("Path B"), /Path C/, "Path B does not fall to authoring");
  assert.match(row("Task type"), /task text/i, "the type is not decided from the task");
  assert.match(row("Spec directory and slug"), /distinct slug/i, "a collision is not renamed");
  assert.match(row("Context map"), /not presented/i, "the context map is still presented");
  assert.match(row("Size gate"), /only when/i, "the size gate always asks");
  assert.match(row("Draft approval"), /`CHANGES REQUESTED:`/, "approval is not the orchestrator's");
  assert.match(row("Follow-ups"), /follow-up \(not implemented\)/, "follow-ups are not kept");
  assert.match(row("Critic"), /TASK CONTEXT/, "the critic cap is not the context's");
  assert.match(row("Critic"), /`PASS WITH WARNINGS`/, "PASS WITH WARNINGS is not routed");
  assert.match(row("Critic"), /`UNABLE`/, "UNABLE is not routed");
  assert.match(row("Criteria"), /automatable oracle/i, "criteria are not written for tests");
  assert.match(row("Never"), /`slices`/, "the reserved slices field is not addressed");
  assert.match(row("Never"), /`task`/, "the board tool is not ruled out");
  assert.match(row("Spec tool"), /`failed`/, "a missing spec tool is not a failure");
  assert.match(row("Changes requested"), /`contract_sha`/, "a change does not re-seal");
});

// ── 4. the prose matches the code ────────────────────────────────────────────

test("the question cap and its marker are the engine's", () => {
  const engine = read(pipelineSrc, "engine.ts");
  assert.match(engine, /rubric\.caps\.planner_questions/, "the engine no longer reads the cap");
  const marker = /\(recommendation accepted: ([^)]+)\)/.exec(engine);
  assert.ok(marker, "the engine no longer marks an answer it accepted at the cap");
  assert.ok(
    section().includes(`\`recommendation accepted: ${marker[1]}\``),
    `the prose does not quote the engine's marker "${marker[1]}"`,
  );
  // The halt that follows the first accepted turn, which is why the prose forbids asking again.
  assert.match(engine, /planner kept asking past the question cap/, "the cap's halt moved");
  const rubric = read(packDir, "pipeline", "rubric.default.yaml");
  assert.match(rubric, /\n\s+planner_questions: \d+/, "the rubric no longer sets the cap");
});

test("the planner fields the prose fills are the ones the engine reads", () => {
  const engine = read(pipelineSrc, "engine.ts");
  const out = engine.slice(
    engine.indexOf("export const PlannerOutput"),
    engine.indexOf("export const TestAuthorOutput"),
  );
  const question = engine.slice(
    engine.indexOf("const Question = z"),
    engine.indexOf("const FindingShape"),
  );
  assert.ok(out.length > 0 && question.length > 0, "PlannerOutput moved; re-anchor this test");
  for (const field of ["status", "summary", "questions", "spec", "assumptions"]) {
    assert.match(out, new RegExp(`\\b${field}:`), `the engine no longer reads "${field}"`);
    row(field);
  }
  const q = row("questions");
  for (const field of ["id", "text", "recommendation", "why_blocking"]) {
    assert.match(question, new RegExp(`\\b${field}:`), `a question no longer has "${field}"`);
    assert.ok(q.includes(`\`${field}\``), `the questions row does not fill "${field}"`);
  }
  for (const status of ["needs_input", "spec_ready"]) {
    assert.ok(out.includes(`"${status}"`), `the engine no longer accepts "${status}"`);
    assert.ok(row("status").includes(`\`${status}\``), `the status row omits "${status}"`);
  }
  // `failed` is not a PlannerOutput status: wait.ts classifies it as a child fault before the
  // engine parses anything, which is why the prose calls it a crash the engine repeats once.
  assert.match(read(pipelineSrc, "wait.ts"), /STRUCTURED = new Set\(\[[^\]]*"failed"/);
  assert.match(row("status"), /repeats the turn once/i, "failed is not described as a crash");
});

test("an oracle the engine cannot resolve is a gate blocker", () => {
  const gate = read(pipelineSrc, "gate.ts");
  assert.match(gate, /has no runnable oracle/, "the gate no longer blocks an unresolved oracle");
  assert.match(gate, /a null command is a blocker/, "the gate's oracle contract moved");
});

test("the calls the rows rule out are the ones the guards refuse", () => {
  const run = { base: "dev", branch: "feature/x" };
  assert.notEqual(childGitViolation("gh issue view 42", run), null, "gh issue view is allowed");
  const tool = (name) => `mcp__plugin_marvin_marvin__${name}`;
  for (const action of ["create", "start", "config"]) {
    assert.notEqual(childMcpViolation(tool("task"), { action }, "planner"), null, `task ${action}`);
  }
  assert.notEqual(childMcpViolation(tool("lessons"), { action: "add" }, "planner"), null);
  assert.equal(childMcpViolation(tool("lessons"), { action: "search" }, "planner"), null);
  assert.equal(childMcpViolation(tool("spec"), { action: "seal" }, "planner"), null);
  const protectedPaths = JSON.parse(read(packDir, "pipeline", "protected.default.json"));
  assert.ok(
    protectedPaths.some((p) => new RegExp(p, "i").test(".marvin/config.json")),
    "the config is no longer a protected path",
  );
});
