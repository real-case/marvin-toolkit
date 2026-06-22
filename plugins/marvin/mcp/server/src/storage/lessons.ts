/**
 * Persistence for the project lessons-learned store (`.marvin/memory`).
 *
 * A lesson is one markdown file with a flat string frontmatter header (the same
 * failsafe codec the kanban tasks use) plus a prose body. `MEMORY.md` is the
 * human-readable index — one line per lesson — appended on every add. The store
 * is committed to git, so lessons captured during a task or a debug session are
 * shared with the team and recalled at the next task's intake (ADR-0021).
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { slugify } from "./slug.js";

/** Lesson taxonomy — kept small on purpose so the index stays scannable. */
export const LESSON_TYPES = ["bug-pattern", "gotcha", "convention", "pitfall", "process"] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export interface Lesson {
  slug: string;
  type: string;
  title: string;
  created: string;
  tags: string[];
  source: string;
  body: string;
}

const INDEX_FILE = "MEMORY.md";
const INDEX_HEADER = [
  "# Marvin lessons",
  "",
  "Project memory — lessons learned during task execution and debugging, captured by the",
  "`lessons` MCP tool and shared with the team via git. One line per lesson; the body lives",
  "in the linked file. Recalled at task intake.",
  "",
].join("\n");

export interface AddLessonInput {
  type: LessonType;
  title: string;
  body: string;
  tags?: string[];
  source?: string;
}

export interface AddedLesson {
  slug: string;
  path: string;
}

/** Derive a collision-free slug under `memoryDir` (`foo`, then `foo-2`, …). */
function uniqueSlug(memoryDir: string, base: string): string {
  const root = base || "lesson";
  let slug = root;
  let n = 2;
  while (existsSync(join(memoryDir, `${slug}.md`))) {
    slug = `${root}-${n}`;
    n += 1;
  }
  return slug;
}

export function addLesson(memoryDir: string, input: AddLessonInput): AddedLesson {
  mkdirSync(memoryDir, { recursive: true });
  const slug = uniqueSlug(memoryDir, slugify(input.title));
  const created = new Date().toISOString().slice(0, 10);
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  const frontmatter: Record<string, string | undefined> = {
    id: slug,
    type: input.type,
    title: input.title,
    created,
    tags: tags.length ? tags.join(", ") : undefined,
    source: input.source?.trim() || "manual",
  };
  const body = input.body.trim() ? `\n${input.body.trim()}\n` : "\n";
  const path = join(memoryDir, `${slug}.md`);
  writeFileSync(path, stringifyFrontmatter(frontmatter, body));

  appendIndex(memoryDir, { slug, type: input.type, title: input.title, created, tags });
  return { slug, path };
}

function appendIndex(
  memoryDir: string,
  entry: { slug: string; type: string; title: string; created: string; tags: string[] },
): void {
  const indexPath = join(memoryDir, INDEX_FILE);
  const tagsSuffix = entry.tags.length ? ` · ${entry.tags.join(", ")}` : "";
  const line = `- [${entry.title}](${entry.slug}.md) — ${entry.type} · ${entry.created}${tagsSuffix}`;
  let content = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : INDEX_HEADER;
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(indexPath, `${content}${line}\n`);
}

export function readAllLessons(memoryDir: string): Lesson[] {
  if (!existsSync(memoryDir)) return [];
  const lessons: Lesson[] = [];
  for (const filename of readdirSync(memoryDir).sort()) {
    if (!filename.endsWith(".md") || filename === INDEX_FILE) continue;
    const raw = readFileSync(join(memoryDir, filename), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!frontmatter.title) continue;
    lessons.push({
      slug: filename.replace(/\.md$/, ""),
      type: frontmatter.type ?? "process",
      title: frontmatter.title,
      created: frontmatter.created ?? "",
      tags: frontmatter.tags
        ? frontmatter.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      source: frontmatter.source ?? "manual",
      body: body.trim(),
    });
  }
  return lessons;
}

export interface SearchLessonsInput {
  query?: string;
  type?: string;
  limit?: number;
}

/**
 * Keyword search over the store. With no query and no type filter it returns
 * the most recent lessons — the shape task-start uses to surface prior lessons
 * at intake. Scoring is a simple term-hit count; the store is small by design.
 */
export function searchLessons(memoryDir: string, input: SearchLessonsInput): Lesson[] {
  const all = readAllLessons(memoryDir);
  const terms = (input.query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const scored = all
    .filter((l) => !input.type || l.type === input.type)
    .map((l) => {
      const haystack = `${l.title} ${l.tags.join(" ")} ${l.body}`.toLowerCase();
      const score =
        terms.length === 0 ? 1 : terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      return { lesson: l, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.lesson.created.localeCompare(a.lesson.created));

  return scored.slice(0, input.limit ?? 10).map((s) => s.lesson);
}
