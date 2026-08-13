#!/usr/bin/env node
// Validate the three authored surfaces of the plugin — skills/, agents/, commands/.
// Six structural pins that no other gate checks:
//   1. Closed frontmatter allowlists per surface: skills admit name / description /
//      disable-model-invocation, agents admit name / description / model / color /
//      tools, commands admit description alone
//   2. Every description is non-empty and within the budget
//   3. A skill's `name` equals its directory; an agent's equals its filename stem
//      (commands carry no `name` — a `name` key there is a rule-1 violation)
//   4. Every `skills/…` path written in a body resolves under the plugin root
//   5. An agent that omits `tools:` inherits every tool, so it must be whitelisted
//   6. The set of prompts with no commands/<name>.md is exactly the track-* set
//
// Rules 1-3 and 5-6 live in scripts/lib/skill-datasets.mjs beside the seven dataset
// rules — one place a rule about the skill surface is added. This file is the
// runner: it resolves the inputs, fails CLOSED on them, and prints.
//
// ESCAPE NOTE, rule 1. A closed allowlist blocks the day Claude Code adds a
// legitimate frontmatter key — an `allowed-tools:` on skills, a `model:` on skills.
// The remedy is to widen FRONTMATTER_KEYS in scripts/lib/skill-datasets.mjs in the
// SAME commit as the upgrade, not to delete the rule. It is worth that cost only
// because an unknown key is silently ignored by the host rather than reported, so
// nothing else would ever catch a typo in one.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { skillDatasetFailures, SURFACE_CATEGORIES } from "./lib/skill-datasets.mjs";

// MARVIN_LINT_ROOT lets a test run this linter against a synthetic root. It is a
// test affordance in the same family as MARVIN_TASKS_DIR, unset in CI and in normal
// use, and test/ci-workflow.test.mjs asserts no workflow step, job or workflow env
// block sets it — otherwise it would be a way to make a blocking gate pass.
// `||` rather than `??`: an empty value is a mistake, not a request to lint `/`.
const repoRoot =
  process.env.MARVIN_LINT_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const packDir = join(repoRoot, "plugins", "marvin");
const dirs = {
  skillsDir: join(packDir, "skills"),
  agentsDir: join(packDir, "agents"),
  commandsDir: join(packDir, "commands"),
};
const PROMPTS_TS = join(packDir, "mcp", "server", "src", "prompts", "index.ts");

// Fail CLOSED on every input, the stance lint-manifests takes in its rule 7: an
// absent directory or an unreadable registry is a FAILURE, never a skipped check.
// The module is fail-open by design — a check whose input was not supplied is
// silent — so a guard here of the form "check only if it exists" would report OK on
// an empty tree.
for (const [key, label] of [
  ["skillsDir", "plugins/marvin/skills"],
  ["agentsDir", "plugins/marvin/agents"],
  ["commandsDir", "plugins/marvin/commands"],
]) {
  if (existsSync(dirs[key])) continue;
  failures.push(`${label}: directory is missing — the surface rules cannot run`);
  dirs[key] = undefined;
}

/**
 * The prompt registry, read from SOURCE.
 *
 * A local, root-parameterised copy of the in-memory transpile
 * packages/site/scripts/gen-catalog.mjs uses, deliberately not an import of its
 * `loadRegistry()`: that reader derives its paths from a module-relative ROOT, so
 * under MARVIN_LINT_ROOT it would read the real repository while linting a
 * synthetic tree — the wrapper check would be untestable and, worse, wrong.
 * Driving dist/server.js over stdio is rejected for a different reason: a linter
 * must judge source, not a build artefact.
 *
 * `prompts/index.ts` is pure data with a single type-only import, which is what
 * makes the transpile work. If a future edit gives it a runtime import the data:
 * import throws a bare-specifier error, and that must FAIL rather than skip — a
 * registry the runner could not read is exactly the shape of a guard that quietly
 * stops guarding.
 */
async function loadPromptNames() {
  const source = readFileSync(PROMPTS_TS, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  });
  const url = "data:text/javascript;base64," + Buffer.from(outputText, "utf8").toString("base64");
  const mod = await import(url);
  if (!Array.isArray(mod.PROMPTS)) throw new Error("PROMPTS is not an array");
  return mod.PROMPTS.map((p) => p.name);
}

/** Count the authored units under `dir` — only ever called on the success path. */
function countUnits(dir, nested) {
  return readdirSync(dir, { withFileTypes: true }).filter((e) =>
    nested ? e.isDirectory() && existsSync(join(dir, e.name, nested)) : e.name.endsWith(".md"),
  ).length;
}

let promptNames;
try {
  promptNames = await loadPromptNames();
} catch (e) {
  failures.push(
    `plugins/marvin/mcp/server/src/prompts/index.ts: the prompt registry could not be read — ${e.message}`,
  );
}

if (dirs.skillsDir) {
  failures.push(
    ...skillDatasetFailures({
      ...dirs,
      packDir,
      promptNames,
      keys: SURFACE_CATEGORIES,
    }),
  );
}

if (failures.length > 0) {
  console.error("lint-skills: FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `lint-skills: OK (${promptNames.length} prompts, ` +
    `${countUnits(dirs.skillsDir, "SKILL.md")} skills, ` +
    `${countUnits(dirs.agentsDir)} agents, ${countUnits(dirs.commandsDir)} commands)`,
);
