#!/usr/bin/env node
// Validate that:
//   1. .claude-plugin/marketplace.json is valid JSON
//   2. Every plugin listed in it has a plugin.json with matching name
//   3. Every plugin has .mcp.json registering a server with key marvin-<suffix>
//   4. Every pack with mcp/server has a dist/server.js committed (existence only;
//      drift checked by verify-dist.mjs)
//   5. All agent .md files start with YAML frontmatter containing description
//   6. Every workspace package.json version matches the plugin version — one source
//      of truth, propagated by scripts/sync-version.mjs
//   7. Every skill has a trigger-eval dataset, its disable_model_invocation field
//      agrees with the skill frontmatter, and the frontmatter value is canonical
//      (scripts/lib/skill-datasets.mjs; the harness's own invariants are checked by
//      evals/trigger/self-test.mjs instead)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { skillDatasetFailures } from "./lib/skill-datasets.mjs";

// MARVIN_LINT_ROOT lets a test run this linter against a synthetic root. It is a
// test affordance in the same family as MARVIN_TASKS_DIR, unset in CI and in normal
// use, and test/ci-workflow.test.mjs asserts no workflow step, job or workflow env
// block sets it — otherwise it would be a way to make a blocking gate pass.
// `||` rather than `??`: an empty value is a mistake, not a request to lint `/`.
const repoRoot =
  process.env.MARVIN_LINT_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

// 1. Marketplace manifest
const marketplacePath = join(repoRoot, ".claude-plugin", "marketplace.json");
const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
if (!Array.isArray(marketplace.plugins)) {
  failures.push("marketplace.json: 'plugins' must be an array");
}

// 2 + 3 + 4. Per-pack checks
for (const entry of marketplace.plugins) {
  const packDir = join(repoRoot, "plugins", entry.name);
  const pluginJsonPath = join(packDir, ".claude-plugin", "plugin.json");
  if (!existsSync(pluginJsonPath)) {
    failures.push(`${entry.name}: missing ${pluginJsonPath}`);
    continue;
  }
  const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
  if (pluginJson.name !== entry.name) {
    failures.push(
      `${entry.name}: plugin.json name="${pluginJson.name}" does not match marketplace entry name="${entry.name}"`,
    );
  }
  if (pluginJson.version !== entry.version) {
    failures.push(
      `${entry.name}: plugin.json version="${pluginJson.version}" does not match marketplace entry version="${entry.version}"`,
    );
  }

  const mcpJsonPath = join(packDir, ".mcp.json");
  if (existsSync(mcpJsonPath)) {
    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
    const keys = Object.keys(mcpJson);
    const ownServer = keys.find((k) => k === "marvin" || k.startsWith("marvin-"));
    if (!ownServer) {
      failures.push(
        `${entry.name}: .mcp.json does not register a server with key 'marvin' or 'marvin-<suffix>'`,
      );
    }
  }

  const distFile = join(packDir, "mcp", "server", "dist", "server.js");
  const serverPkg = join(packDir, "mcp", "server", "package.json");
  if (existsSync(serverPkg) && !existsSync(distFile)) {
    failures.push(`${entry.name}: dist/server.js missing — pack server is not built`);
  }
}

// 5. Agent frontmatter + SKILL.md frontmatter
function checkFrontmatter(label, fullPath) {
  const text = readFileSync(fullPath, "utf8");
  if (!text.startsWith("---\n")) {
    failures.push(`${label}: missing YAML frontmatter`);
    return;
  }
  const endIdx = text.indexOf("\n---", 4);
  if (endIdx === -1) {
    failures.push(`${label}: unterminated frontmatter`);
    return;
  }
  const frontmatter = text.slice(4, endIdx);
  if (!/^description:\s*\S/m.test(frontmatter)) {
    failures.push(`${label}: missing 'description' field in frontmatter`);
  }
}

for (const entry of marketplace.plugins) {
  const agentsDir = join(repoRoot, "plugins", entry.name, "agents");
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir)) {
      if (!file.endsWith(".md")) continue;
      checkFrontmatter(`${entry.name}/agents/${file}`, join(agentsDir, file));
    }
  }
  const skillsDir = join(repoRoot, "plugins", entry.name, "skills");
  if (existsSync(skillsDir)) {
    for (const skill of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, skill, "SKILL.md");
      if (!existsSync(skillFile)) {
        failures.push(`${entry.name}/skills/${skill}: missing SKILL.md`);
        continue;
      }
      checkFrontmatter(`${entry.name}/skills/${skill}/SKILL.md`, skillFile);
    }
  }
  const commandsDir = join(repoRoot, "plugins", entry.name, "commands");
  if (!existsSync(commandsDir)) continue;
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith(".md")) continue;
    checkFrontmatter(`${entry.name}/commands/${file}`, join(commandsDir, file));
  }
}

// 6. Repo-wide version coherence. No external client needs the workspace packages to
//    move independently, so all track one version — the marvin plugin.json is the
//    source of truth. scripts/sync-version.mjs propagates it; this guard fails on drift
//    so a partial bump can never ship. The marketplace `metadata.version` is excluded on
//    purpose: it tracks the manifest schema, not the plugin.
const marvinVersion = JSON.parse(
  readFileSync(join(repoRoot, "plugins", "marvin", ".claude-plugin", "plugin.json"), "utf8"),
).version;
const lockedVersionFiles = [
  "package.json",
  "packages/marvin-mcp-shared/package.json",
  "packages/marvin-widgets/package.json",
  "packages/site/package.json",
  "plugins/marvin/mcp/server/package.json",
];
for (const rel of lockedVersionFiles) {
  const version = JSON.parse(readFileSync(join(repoRoot, rel), "utf8")).version;
  if (version !== marvinVersion) {
    failures.push(
      `${rel}: version "${version}" does not match the plugin version "${marvinVersion}" — run \`npm run sync-version\``,
    );
  }
}

// 7. Skill surface vs trigger-eval datasets. Called ONCE here rather than inside the
//    marketplace loop above: the datasets tree is repo-global and describes the marvin
//    plugin alone, so a per-plugin call would report every skill of a second plugin as
//    missing a dataset. This sits beside the version check, which makes the same
//    single-plugin assumption two lines up.
//
//    Only the three categories that are shipping obligations of the skill surface are
//    reported here. orphanDatasets, unknownWinners, missingNotes and missingMockRate are
//    invariants of the eval harness and are asserted by evals/trigger/self-test.mjs.
//
//    An absent directory is a FAILURE, not a reason to skip: a guard of the form
//    `if (existsSync(a) && existsSync(b))` would turn this blocking gate green over
//    a skill surface with zero datasets, which is the same "guard that cannot fail"
//    defect a32a288 repaired in the drift guards.
const skillsDir = join(repoRoot, "plugins", "marvin", "skills");
const datasetsDir = join(repoRoot, "evals", "trigger", "datasets");
for (const [label, dir] of [
  ["plugins/marvin/skills", skillsDir],
  ["evals/trigger/datasets", datasetsDir],
]) {
  if (!existsSync(dir))
    failures.push(`${label}: directory is missing — the dataset rules cannot run`);
}
if (existsSync(skillsDir) && existsSync(datasetsDir)) {
  failures.push(
    ...skillDatasetFailures({
      skillsDir,
      datasetsDir,
      keys: ["missingDatasets", "parityViolations", "nonCanonicalFlags"],
    }),
  );
}

if (failures.length > 0) {
  console.error("lint-manifests: FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`lint-manifests: OK (${marketplace.plugins.length} packs validated)`);
