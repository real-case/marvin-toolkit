// A synthetic repository root, complete enough for either linter to REACH its rules.
//
// Shared by test/skill-datasets.test.mjs and test/lint-skills.test.mjs. The
// underscore prefix keeps it out of the root suite's `test/*.test.mjs` glob — it is
// a helper, not a suite.
//
// A minimal root is not enough and fails misleadingly: lint-manifests has no
// try/catch and reads the marketplace manifest, plugins/marvin/.claude-plugin/
// plugin.json and five package.json files with unguarded readFileSync calls, all
// AFTER its skills block but BEFORE the failure print. An absent one throws ENOENT
// and also exits 1, which a status-only assertion would happily accept. The plugin
// must be named `marvin` because that path segment is hard-coded.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Build a synthetic root under `root` and return writers for each surface plus a
 * spawner for the linter under test.
 *
 * `skills` / `datasets` / `agents` / `commands` control whether those directories
 * exist, which is what lets a missing-directory regression witness each branch of a
 * fail-closed guard separately.
 *
 * `script` is the linter to spawn, repo-relative. It DEFAULTS to lint-manifests so
 * the call sites that predate the second linter stay byte-identical.
 *
 * @param {string} root
 * @param {{ skills?: boolean, datasets?: boolean, agents?: boolean, commands?: boolean, script?: string }} options
 */
export function scaffoldLintRoot(
  root,
  {
    skills = true,
    datasets = true,
    agents = true,
    commands = true,
    script = "scripts/lint-manifests.mjs",
  } = {},
) {
  const packDir = join(root, "plugins", "marvin");
  const skillsDir = join(packDir, "skills");
  const agentsDir = join(packDir, "agents");
  const commandsDir = join(packDir, "commands");
  const datasetsDir = join(root, "evals", "trigger", "datasets");
  const promptsDir = join(packDir, "mcp", "server", "src", "prompts");

  if (skills) mkdirSync(skillsDir, { recursive: true });
  if (datasets) mkdirSync(datasetsDir, { recursive: true });
  if (agents) mkdirSync(agentsDir, { recursive: true });
  if (commands) mkdirSync(commandsDir, { recursive: true });
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(packDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ plugins: [{ name: "marvin", version: "0.0.1" }] }),
  );
  writeFileSync(
    join(packDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "marvin", version: "0.0.1" }),
  );
  for (const rel of [
    "package.json",
    "packages/marvin-mcp-shared/package.json",
    "packages/marvin-widgets/package.json",
    "packages/site/package.json",
    "plugins/marvin/mcp/server/package.json",
  ]) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify({ name: "x", version: "0.0.1" }));
  }
  mkdirSync(join(packDir, "mcp", "server", "dist"), { recursive: true });
  writeFileSync(join(packDir, "mcp", "server", "dist", "server.js"), "//\n");
  mkdirSync(promptsDir, { recursive: true });

  const api = {
    root,
    packDir,
    skillsDir,
    datasetsDir,
    agentsDir,
    commandsDir,
    // Every fixture SKILL.md needs a description, or checkFrontmatter adds its own
    // failure and a "clean" variant exits 1 for an unrelated reason.
    writeSkill(name, flag) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      const line = flag === undefined ? "" : `disable-model-invocation: ${flag}\n`;
      writeFileSync(
        join(skillsDir, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} fixture\n${line}---\n\nbody\n`,
      );
    },
    writeDataset(name, extra = {}) {
      writeFileSync(
        join(datasetsDir, `${name}.json`),
        JSON.stringify({ skill: name, target: name, queries: [], ...extra }),
      );
    },
    /** Write an agent. `frontmatter` replaces the default block wholesale. */
    writeAgent(name, frontmatter = `name: ${name}\ndescription: ${name} fixture\ntools: Read`) {
      writeFileSync(join(agentsDir, `${name}.md`), `---\n${frontmatter}\n---\n\nbody\n`);
    },
    /** Write a command wrapper. `frontmatter` and `body` are both replaceable. */
    writeCommand(name, frontmatter = `description: ${name} fixture`, body = "body") {
      writeFileSync(join(commandsDir, `${name}.md`), `---\n${frontmatter}\n---\n\n${body}\n`);
    },
    /** Write the prompt registry this root's `PROMPTS` should contain. */
    writePrompts(names) {
      const entries = names
        .map((n) => `  { name: ${JSON.stringify(n)}, description: "d", body: "b" },`)
        .join("\n");
      writeFileSync(join(promptsDir, "index.ts"), `export const PROMPTS = [\n${entries}\n];\n`);
    },
    /** Spawn the linter under test against this root; returns { failed, output }. */
    runLinter() {
      try {
        return {
          failed: false,
          output: execFileSync("node", [join(repoRoot, script)], {
            env: { ...process.env, MARVIN_LINT_ROOT: root },
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }),
        };
      } catch (e) {
        return { failed: true, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
      }
    },
  };

  api.writePrompts([]);
  return api;
}
