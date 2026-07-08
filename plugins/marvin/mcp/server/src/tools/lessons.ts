import { z } from "zod";
import {
  canElicit,
  defineTool,
  elicit,
  type AnyToolDef,
  type ToolResult,
} from "@marvin-toolkit/mcp-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerEnv } from "../lib/env.js";
import {
  addLesson,
  deleteLesson,
  findNearDuplicate,
  lessonsStats,
  pruneCandidates,
  readAllLessons,
  searchLessons,
  LESSON_TYPES,
  STALE_AFTER_DAYS,
  type Lesson,
  type LessonType,
} from "../storage/lessons.js";

const LessonsInput = z.object({
  action: z.enum(["add", "search", "stats", "prune"]),
  // add
  type: z.enum(LESSON_TYPES).optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  source: z.string().optional(),
  force: z
    .boolean()
    .optional()
    .describe("add: write the lesson even when a near-duplicate title already exists"),
  // search
  query: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
  // prune
  slug: z
    .string()
    .optional()
    .describe("prune: the lesson to delete — a slug from the candidate list"),
  confirm: z
    .boolean()
    .optional()
    .describe("prune: confirm the deletion without an interactive form"),
});

type LessonsInput = z.infer<typeof LessonsInput>;

export function buildLessonsTool(server: McpServer, env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "lessons",
    description:
      "Project lessons-learned memory under .marvin/memory (committed to git, shared with the team). " +
      "action:'add' captures one typed lesson (type, title, body[, tags, source]) from a finished task, " +
      "review pass, or debug session — guarded against near-duplicate titles (override with force:true); " +
      "action:'search' recalls relevant prior lessons (query and/or type) — call it before writing code " +
      "so past mistakes inform new work; action:'stats' counts the store by type and tag; action:'prune' " +
      "lists stale/duplicate candidates and deletes one by slug behind an explicit confirmation.",
    inputSchema: LessonsInput,
    handler: (input) => dispatch(server, env, input),
  });
}

async function dispatch(
  server: McpServer,
  env: ServerEnv,
  input: LessonsInput,
): Promise<ToolResult> {
  switch (input.action) {
    case "add":
      return runAdd(env, input);
    case "search":
      return runSearch(env, input);
    case "stats":
      return runStats(env);
    case "prune":
      return runPrune(server, env, input);
  }
}

function runAdd(env: ServerEnv, input: LessonsInput): ToolResult {
  const missing: string[] = [];
  if (!input.type) missing.push("type");
  if (!input.title?.trim()) missing.push("title");
  if (!input.body?.trim()) missing.push("body");
  if (missing.length > 0) {
    return err(
      `lessons add requires: ${missing.join(", ")}. type ∈ {${LESSON_TYPES.join(" | ")}}.`,
    );
  }

  // Near-duplicate guard (ADR-0028): search before write, warn instead of
  // double-writing. `force: true` is the deliberate override.
  if (!input.force) {
    const dup = findNearDuplicate(env.memoryDir, input.title!.trim());
    if (dup) {
      return err(
        `Near-duplicate of existing lesson **${dup.slug}** — "${dup.title}" (\`${dup.type}\`, ${dup.created}). ` +
          "Nothing written. Extend that lesson instead, or pass `force: true` to add this one anyway.",
      );
    }
  }

  const tags = input.tags
    ? input.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const { slug, path } = addLesson(env.memoryDir, {
    type: input.type as LessonType,
    title: input.title!.trim(),
    body: input.body!,
    tags,
    ...(input.source ? { source: input.source } : {}),
  });

  return ok(
    `Captured lesson **${slug}** (\`${input.type}\`).\n` +
      `File: \`${path}\`\n` +
      "Indexed in `.marvin/memory/MEMORY.md` — commit it to share with the team.",
  );
}

function runSearch(env: ServerEnv, input: LessonsInput): ToolResult {
  const lessons = searchLessons(env.memoryDir, {
    ...(input.query ? { query: input.query } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  });

  if (lessons.length === 0) {
    const filtered = input.query || input.type;
    return ok(
      filtered
        ? `No matching lessons in \`.marvin/memory\`${input.query ? ` for "${input.query}"` : ""}${input.type ? ` [type:${input.type}]` : ""}.`
        : "No lessons captured yet in `.marvin/memory`.",
    );
  }

  return ok(renderLessons(lessons));
}

/** Counts by type and tag — a dashboard feed (ADR-0028), so the payload is
 * also emitted as `structuredContent` conforming to the `LessonsStats`
 * contract (ADR-0024). */
function runStats(env: ServerEnv): ToolResult {
  const stats = lessonsStats(env.memoryDir);
  if (stats.total === 0) {
    return {
      content: [{ type: "text", text: "No lessons captured yet in `.marvin/memory`." }],
      structuredContent: stats,
    };
  }

  const types = Object.entries(stats.by_type)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `- \`${t}\` — ${n}`);
  const tags = Object.entries(stats.by_tag)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => `- ${t} — ${n}`);

  const out = [
    `# Lessons store — ${stats.total} lesson(s)`,
    "",
    "## By type",
    ...types,
    "",
    "## By tag",
    ...(tags.length > 0 ? tags : ["_no tags_"]),
  ];
  return {
    content: [{ type: "text", text: out.join("\n") }],
    structuredContent: stats,
  };
}

/**
 * Maintenance surface (ADR-0028). With no `slug` it only *lists* candidates —
 * stale lessons and near-duplicate pairs — and deletes nothing. With a `slug`
 * it deletes that lesson behind an explicit confirmation: an elicitation form
 * on capable hosts, `confirm: true` elsewhere (the archive-action pattern).
 * Deletion removes the file and its MEMORY.md index line together.
 */
async function runPrune(
  server: McpServer,
  env: ServerEnv,
  input: LessonsInput,
): Promise<ToolResult> {
  if (!input.slug) {
    const total = readAllLessons(env.memoryDir).length;
    if (total === 0) {
      return ok("No lessons captured yet in `.marvin/memory` — nothing to prune.");
    }
    const { stale, duplicates } = pruneCandidates(env.memoryDir);
    if (stale.length === 0 && duplicates.length === 0) {
      return ok(
        `No prune candidates — none of the ${total} lesson(s) look stale (older than ${STALE_AFTER_DAYS} days) or duplicated.`,
      );
    }
    const out: string[] = [`# Prune candidates (${stale.length + duplicates.length})`, ""];
    if (stale.length > 0) {
      out.push(`## Stale — created more than ${STALE_AFTER_DAYS} days ago`);
      for (const l of stale) out.push(`- **${l.slug}** — ${l.title} (\`${l.type}\`, ${l.created})`);
      out.push("");
    }
    if (duplicates.length > 0) {
      out.push("## Possible duplicates — near-identical titles");
      for (const [a, b] of duplicates) {
        out.push(`- **${a.slug}** ("${a.title}") ↔ **${b.slug}** ("${b.title}")`);
      }
      out.push("");
    }
    out.push(
      'Delete one with `action: "prune", slug: "<slug>"` — deletion asks for confirmation ' +
        "(or pass `confirm: true`) and removes the lesson file together with its " +
        "`.marvin/memory/MEMORY.md` index line.",
    );
    return ok(out.join("\n").trimEnd());
  }

  const target = readAllLessons(env.memoryDir).find((l) => l.slug === input.slug);
  if (!target) {
    return err(
      `No lesson with slug \`${input.slug}\` under \`.marvin/memory\`. ` +
        'Call `action: "prune"` with no slug to list the candidates.',
    );
  }

  if (!input.confirm) {
    if (!canElicit(server)) {
      return err(
        "Deleting a lesson is destructive and needs explicit confirmation. This host does not " +
          `support interactive forms — re-run with \`confirm: true\` to delete **${target.slug}** ("${target.title}").`,
      );
    }
    const answer = await elicit(
      server,
      `Delete lesson \`${target.slug}\` — "${target.title}"? This removes the file and its MEMORY.md index line.`,
      z.object({ delete: z.enum(["yes", "no"]) }),
    );
    if (answer?.delete !== "yes") return ok("Cancelled — no changes made.");
  }

  const deleted = deleteLesson(env.memoryDir, target.slug);
  if (!deleted) return err(`Lesson \`${target.slug}\` disappeared before deletion — nothing done.`);
  return ok(
    `Deleted lesson **${target.slug}** ("${target.title}").\n` +
      `Removed \`${deleted.path}\` and its index line from \`.marvin/memory/MEMORY.md\` — ` +
      "commit the removal to share it.",
  );
}

function renderLessons(lessons: Lesson[]): string {
  const out: string[] = [`# Relevant lessons (${lessons.length})`, ""];
  for (const l of lessons) {
    const tags = l.tags.length > 0 ? ` · _${l.tags.join(", ")}_` : "";
    out.push(`## ${l.title}`);
    out.push(`\`${l.type}\` · ${l.created} · source: ${l.source}${tags}`);
    out.push("");
    out.push(l.body);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
