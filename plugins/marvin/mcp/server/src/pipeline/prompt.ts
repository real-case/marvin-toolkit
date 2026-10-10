import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "./run-store.js";

/*
 * How a child's two prompts are made (D13). The system prompt is `roles/common.md` followed by
 * `roles/<role>.md`, two static files: every run of a role sends the same bytes, which is what
 * lets a later spawn read its first request from the prompt cache (S7). Everything a run varies
 * goes into the user prompt, rendered from `roles/<role>.context.md`.
 *
 * The context variables come from two places. The engine's `decide` puts the run's own facts into
 * each spawn's context (the spec, the findings, the gate report); the runtime adds the ones only
 * it can supply, listed in `RUNTIME_VARS`. Rendering is strict in both directions, because the
 * templates and both lists are static: a variable a template names and nobody supplies, or one
 * supplied and never used, is a drift between files that would otherwise ship a prompt with a
 * hole in it or a fact nobody reads.
 */

/**
 * The context variables the runtime supplies on a fresh spawn of each role, beside the ones the
 * engine's context carries. Every role is told the orchestrator its progress reports go to, its
 * own name to sign them with, and the lessons ranked for it. The test-author also gets the test
 * path pattern its guard enforces, the verifier the project's conventions, and the retro the
 * run's aggregate, the efficacy report and the lessons index. The planner and the executor, which
 * run marvin's skills, get the plugin root: a command wrapper says "Read `skills/<name>/SKILL.md`",
 * a path relative to the plugin that the child, sitting in a foreign worktree, cannot resolve. A resumed spawn gets none of
 * them: its user prompt is the engine's `message` alone.
 */
export const RUNTIME_VARS = {
  planner: ["orchestrator", "child", "lessons", "plugin"],
  "test-author": ["orchestrator", "child", "lessons", "test_path_pattern"],
  executor: ["orchestrator", "child", "lessons", "plugin"],
  verifier: ["orchestrator", "child", "lessons", "conventions"],
  retro: ["orchestrator", "child", "lessons", "aggregate", "efficacy", "lessons_index"],
} as const satisfies Record<Role, readonly string[]>;

export type RuntimeVar = (typeof RUNTIME_VARS)[Role][number];

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * Replaces every `{{name}}` in `text` with its value, once: a value is inserted as it is, so a
 * placeholder or a `$&` inside a task text stays literal. A placeholder with no value throws, and
 * so does a value no placeholder names.
 */
export function renderTemplate(text: string, vars: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_, name: string) => {
    const value = Object.hasOwn(vars, name) ? vars[name] : undefined;
    if (value === undefined) throw new Error(`missing template var: ${name}`);
    used.add(name);
    return value;
  });
  const unused = Object.keys(vars).filter((name) => !used.has(name));
  if (unused.length > 0) throw new Error(`unused template var: ${unused.join(", ")}`);
  return out;
}

/**
 * The system and user prompt of one spawn. A fresh spawn renders the role's context template
 * with `vars`; a resume sends `vars.message` alone, the answers or the requested changes that
 * continue the session, and takes no other variable.
 */
export function composePrompts(
  rolesDir: string,
  role: Role,
  vars: Readonly<Record<string, string>>,
  resume: boolean,
): { system: string; user: string } {
  const read = (name: string) => readFileSync(join(rolesDir, name), "utf8");
  const system = `${read("common.md")}\n${read(`${role}.md`)}`;
  if (resume) return { system, user: renderTemplate("{{message}}", vars) };
  return { system, user: renderTemplate(read(`${role}.context.md`), vars) };
}
