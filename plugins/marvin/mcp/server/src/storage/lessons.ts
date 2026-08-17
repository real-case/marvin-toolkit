/**
 * Persistence for the project lessons-learned store (`.marvin/memory`).
 *
 * A lesson is one markdown file with a flat string frontmatter header (the same
 * failsafe codec the board tasks use) plus a prose body. `MEMORY.md` is the
 * human-readable index — one line per lesson — appended on every add. The store
 * is committed to git, so lessons captured during a task or a debug session are
 * shared with the team and recalled at the next task's intake (ADR-0021).
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { LessonsStats } from "@marvin-toolkit/mcp-shared/contracts";
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

/**
 * Aggregate counts for the store — the `stats` action's payload and the
 * dashboard's lessons feed (ADR-0028). Every type of the closed taxonomy is
 * present even at 0 (the ADR-0026 per-key counts doctrine); `by_tag` is an
 * open vocabulary, so only tags that occur appear.
 */
export function lessonsStats(memoryDir: string): LessonsStats {
  const by_type: Record<string, number> = Object.fromEntries(LESSON_TYPES.map((t) => [t, 0]));
  const by_tag: Record<string, number> = {};
  const all = readAllLessons(memoryDir);
  for (const l of all) {
    by_type[l.type] = (by_type[l.type] ?? 0) + 1;
    for (const tag of l.tags) by_tag[tag] = (by_tag[tag] ?? 0) + 1;
  }
  return { total: all.length, by_type, by_tag };
}

/** Title tokens for the near-duplicate heuristic — Unicode-aware, single
 * characters dropped as noise. */
function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1),
  );
}

/** Word-overlap (Jaccard) similarity of two titles ∈ [0, 1] — deterministic
 * and explainable; no embeddings, the store is small by design (ADR-0021). */
function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits += 1;
  return hits / (wa.size + wb.size - hits);
}

/** Two titles are "near duplicates" at this overlap or above — a false
 * positive costs one retry with `force: true` (and the warning doubles as a
 * pointer to related prior art), so moderately aggressive is fine. */
const NEAR_DUPLICATE_THRESHOLD = 0.5;

/**
 * The `add` guard (ADR-0028): the closest existing lesson whose title
 * slug-collides with or heavily overlaps the candidate title, or `null` when
 * nothing comes close enough to warn about.
 */
export function findNearDuplicate(memoryDir: string, title: string): Lesson | null {
  const slug = slugify(title);
  let best: { lesson: Lesson; score: number } | null = null;
  for (const l of readAllLessons(memoryDir)) {
    const score =
      slug !== "" && (l.slug === slug || slugify(l.title) === slug)
        ? 1
        : titleSimilarity(l.title, title);
    if (score >= NEAR_DUPLICATE_THRESHOLD && (!best || score > best.score)) {
      best = { lesson: l, score };
    }
  }
  return best?.lesson ?? null;
}

/** A lesson untouched for this long is a prune candidate (listed, never
 * auto-deleted — a human decides what dies). */
export const STALE_AFTER_DAYS = 180;

export interface PruneCandidates {
  stale: Lesson[];
  duplicates: Array<[Lesson, Lesson]>;
}

/**
 * Candidates for `prune` (ADR-0028): lessons older than {@link STALE_AFTER_DAYS}
 * and near-duplicate title pairs (same heuristic as the `add` guard). Listing
 * only — deletion is a separate, confirmed step.
 */
export function pruneCandidates(memoryDir: string, now: Date = new Date()): PruneCandidates {
  const all = readAllLessons(memoryDir);
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const stale = all.filter((l) => l.created !== "" && l.created < cutoff);
  const duplicates: Array<[Lesson, Lesson]> = [];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (titleSimilarity(all[i]!.title, all[j]!.title) >= NEAR_DUPLICATE_THRESHOLD) {
        duplicates.push([all[i]!, all[j]!]);
      }
    }
  }
  return { stale, duplicates };
}

/**
 * Delete one lesson by slug: the file and its `MEMORY.md` index line go
 * together, so the pair can never drift (ADR-0028). Returns the removed path,
 * or `null` when no lesson with that slug exists (the slug is resolved against
 * the parsed store, never raw input, so the index and foreign files are
 * unreachable).
 */
export function deleteLesson(memoryDir: string, slug: string): { path: string } | null {
  const lesson = readAllLessons(memoryDir).find((l) => l.slug === slug);
  if (!lesson) return null;
  const path = join(memoryDir, `${lesson.slug}.md`);
  unlinkSync(path);
  removeIndexLine(memoryDir, lesson.slug);
  return { path };
}

/** Drop the index line pointing at `<slug>.md` — the exact-link match cannot
 * hit another slug's line (`](foo.md)` never occurs inside `](bar-foo.md)`). */
function removeIndexLine(memoryDir: string, slug: string): void {
  const indexPath = join(memoryDir, INDEX_FILE);
  if (!existsSync(indexPath)) return;
  const kept = readFileSync(indexPath, "utf8")
    .split("\n")
    .filter((line) => !line.includes(`](${slug}.md)`));
  writeFileSync(indexPath, kept.join("\n"));
}
