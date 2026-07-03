// Skill catalog loader.
//
// Triggering depends ONLY on what Claude Code loads at startup: each skill's
// `name` + `description` (and whether it opts out of model invocation). This
// module reads exactly that surface from every SKILL.md — never the body — so a
// decider sees the same metadata the real auto-discovery step sees.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const SKILLS_DIR = join(REPO_ROOT, "plugins", "marvin", "skills");

/**
 * @typedef {Object} Skill
 * @property {string} name
 * @property {string} description
 * @property {boolean} disableModelInvocation  // true → never auto-triggers (human-run)
 */

/** Extract the frontmatter block (between the first two `---` fences). */
function frontmatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  return text.slice(3, end);
}

/** Read a single scalar field from a frontmatter block (single-line values). */
function field(fm, key) {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * Load every skill's discovery metadata.
 * @param {string} [skillsDir]
 * @returns {Skill[]} sorted by name
 */
export function loadCatalog(skillsDir = SKILLS_DIR) {
  if (!existsSync(skillsDir)) {
    throw new Error(`skills dir not found: ${skillsDir}`);
  }
  const skills = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const fm = frontmatter(readFileSync(file, "utf8"));
    if (!fm) throw new Error(`${entry.name}/SKILL.md: no frontmatter`);
    const name = field(fm, "name");
    const description = field(fm, "description");
    if (!name || !description) {
      throw new Error(`${entry.name}/SKILL.md: missing name or description`);
    }
    if (name !== entry.name) {
      throw new Error(`${entry.name}/SKILL.md: name "${name}" != dir`);
    }
    const dmi = field(fm, "disable-model-invocation");
    skills.push({
      name,
      description,
      disableModelInvocation: dmi === "true",
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Render the catalog the way a discovery decider consumes it: the exact
 * name + description surface, one skill per line, nothing else.
 * @param {Skill[]} catalog
 */
export function catalogText(catalog) {
  return catalog
    .filter((s) => !s.disableModelInvocation)
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");
}
