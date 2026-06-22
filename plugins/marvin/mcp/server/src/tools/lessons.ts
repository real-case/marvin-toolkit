import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { ServerEnv } from "../lib/env.js";
import {
  addLesson,
  searchLessons,
  LESSON_TYPES,
  type Lesson,
  type LessonType,
} from "../storage/lessons.js";

const LessonsInput = z.object({
  action: z.enum(["add", "search"]),
  // add
  type: z.enum(LESSON_TYPES).optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  source: z.string().optional(),
  // search
  query: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

type LessonsInput = z.infer<typeof LessonsInput>;

export function buildLessonsTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "lessons",
    description:
      "Project lessons-learned memory under .marvin/memory (committed to git, shared with the team). " +
      "action:'add' captures one typed lesson (type, title, body[, tags, source]) from a finished task " +
      "or debug session; action:'search' recalls relevant prior lessons (query and/or type) — call it at " +
      "task intake so past mistakes inform new work.",
    inputSchema: LessonsInput,
    handler: (input) => Promise.resolve(dispatch(env, input)),
  });
}

function dispatch(env: ServerEnv, input: LessonsInput): ToolResult {
  return input.action === "add" ? runAdd(env, input) : runSearch(env, input);
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
