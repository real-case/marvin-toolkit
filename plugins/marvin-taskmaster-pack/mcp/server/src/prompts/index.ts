import type { PromptDef } from "@marvin-toolkit/mcp-shared";

/**
 * Prompts for marvin-taskmaster-pack. Body source: each prompt points
 * to a SKILL.md under `plugins/marvin-taskmaster-pack/skills/`.
 */
export const PROMPTS: PromptDef[] = [
  {
    name: "start",
    description:
      "Start work on a task through structured dialogue — produces immutable, testable specs (features and bug fixes) with solution variants, acceptance criteria, and a Definition-of-Ready gate before dispatch.",
    skill: "mn.start",
  },
  {
    name: "run",
    description:
      "Execute a ready spec interactively in the current session — implements the spec following its Chosen Approach, then auto-chains into verify and deliver.",
    skill: "mn.run",
  },
  {
    name: "verify",
    description:
      "Run project quality gates — tests, lint, type-check, and build — with automatic stack detection (Node, Python, Go, Rust, Ruby, Java). Produces verification.md that gates delivery.",
    skill: "mn.verify",
  },
  {
    name: "deliver",
    description:
      "Final delivery phase — commits changes and opens a PR (delegates to marvin-core:commit and marvin-core:pr). Refuses to proceed unless verification passed.",
    skill: "mn.deliver",
  },
  {
    name: "fix-pr",
    description:
      "Apply pull-request review feedback — fetch comments via gh, classify each as actionable / discussion / out-of-scope, make code changes, commit, push, and reply to each thread.",
    skill: "mn.fix-pr",
  },
];
