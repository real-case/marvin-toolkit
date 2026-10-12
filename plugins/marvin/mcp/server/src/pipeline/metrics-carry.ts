import { lstatSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { recordPathFor, recordSlugForSpec } from "../lib/metrics-record.js";
import { parseFrontmatter } from "../storage/frontmatter.js";
import {
  METRIC_EVENT_TAG,
  MetricEventSchema,
  recordBlock,
  recordHeader,
  TASK_METRICS_TAG,
  TaskMetricsEnvelope,
} from "../storage/metrics.js";
import type { IsolatedGit } from "./gate.js";
import { assertNotHardLinked, isCanonicalPath, physicalProblem } from "./plain-path.js";

/**
 * The run's metrics record, carried by the engine (ADR-0043/0044).
 *
 * Under the autopilot the executor commits its work and then calls the delivery gate, which on
 * ALLOW appends the terminal `task-metrics` block to the record. That block carries the
 * delivered commit's `head_sha`, so by construction it cannot be inside the commit it describes:
 * the append always lands after the executor's last commit, and before this module the engine's
 * own gate counted it as uncommitted work and spent a whole executor iteration on committing it.
 * Committing it is the engine's job. The gate tolerates the record when, and only when, its
 * change is an append this module recognises, and finalize commits the appended bytes.
 *
 * "Recognises" is narrow on purpose. The record is append-only and tool-written
 * (`storage/metrics.ts`), so a legitimate change is the committed bytes followed by blocks in
 * exactly the shape `recordBlock` writes, each a valid entry for this record's slug. Anything
 * else (an earlier block rewritten, foreign prose, an entry for another task, a link or a hard
 * link in the record's place) is a change the engine does not make its own, and the gate goes on
 * reporting it as uncommitted work exactly as it did before.
 */

/** Where every writer keeps the records, relative to the project; the child's project is the worktree. */
export const METRICS_DIR = ".marvin/metrics";

/** The run's record: its repo-relative POSIX path and the slug its entries must carry. */
export interface RunRecord {
  path: string;
  slug: string;
}

/**
 * The run's record, by the rule every writer of a record follows (`recordPathFor`): an existing
 * record for the slug first, else one named after the spec's own file. Null where the spec yields
 * no slug the seal anchor would file a record under (`recordSlugForSpec`), or where the path is
 * not one git could name. The spec commit, the gate and finalize all ask this one function, so
 * the record the engine committed with the approved spec is the record it later carries.
 */
export function runRecord(worktree: string, specPath: string, specText: string): RunRecord | null {
  const { frontmatter } = parseFrontmatter(specText.replace(/\r\n?/g, "\n"));
  const slug = recordSlugForSpec(frontmatter.slug, specPath);
  if (slug === null) return null;
  const abs = recordPathFor(
    join(worktree, METRICS_DIR),
    slug,
    worktree,
    undefined,
    join(worktree, specPath),
  );
  const path = relative(worktree, abs).split(sep).join("/");
  return isCanonicalPath(path) ? { path, slug } : null;
}

/** `runRecord`'s path alone, for a caller that needs no slug. */
export function runRecordPath(worktree: string, specPath: string, specText: string): string | null {
  return runRecord(worktree, specPath, specText)?.path ?? null;
}

/**
 * The working-tree record judged against a commit:
 *
 * - `absent`: nothing is there;
 * - `unchanged`: the bytes are the committed blob's;
 * - `ignored`: the commit has no such path and git's ignore rules exclude it, so the host keeps
 *   its records out of git (ADR-0043) and there is nothing to commit;
 * - `appended`: a legitimate append, with the bytes read, once, which are the bytes to commit;
 * - `refused`: anything else, with the reason.
 */
export type RecordState =
  | { state: "absent" }
  | { state: "unchanged" }
  | { state: "ignored" }
  | { state: "appended"; bytes: Buffer }
  | { state: "refused"; reason: string };

/** The block `recordBlock` writes, read back: the tag and the one JSON line between the fences. */
const BLOCK = /```json ([a-z-]+)\n([^\n]*)\n```\n\n/y;

const refused = (reason: string): RecordState => ({ state: "refused", reason });

/**
 * Why `text` is not zero or more blocks of this record, each exactly as `recordBlock` writes it
 * and each a valid entry for `slug`, or null when it is. A block is compared with what
 * `recordBlock` makes of its own parsed payload, so a hand-edited line (spacing, key order, a
 * duplicate key) is refused even where it parses to the same value.
 */
function blocksProblem(text: string, slug: string): string | null {
  let at = 0;
  let n = 0;
  while (at < text.length) {
    BLOCK.lastIndex = at;
    const m = BLOCK.exec(text);
    if (m === null) return `the text after block ${n} is not a record block`;
    n += 1;
    const [whole, tag, line] = m as unknown as [string, string, string];
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      return `block ${n} does not hold one JSON line`;
    }
    if (recordBlock(tag, payload) !== whole) {
      return `block ${n} is not in the shape the metrics tool writes`;
    }
    const schema =
      tag === METRIC_EVENT_TAG
        ? MetricEventSchema
        : tag === TASK_METRICS_TAG
          ? TaskMetricsEnvelope
          : null;
    if (schema === null) return `block ${n} is tagged ${tag}, not a metrics block`;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return `block ${n} is not a valid ${tag} entry`;
    if ((parsed.data as { slug: string }).slug !== slug) {
      return `block ${n} is an entry for ${(parsed.data as { slug: string }).slug}, not ${slug}`;
    }
    at += whole.length;
  }
  return null;
}

/** `bytes` as UTF-8 text with LF line ends, or null where they are not that. */
function strictText(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\r") ? null : text;
  } catch {
    return null;
  }
}

/**
 * Classify the record at `rel` (repo-relative, POSIX) in `worktree` against `commit`. Every path
 * component must be plain (no link) and the record a regular file with one link, read once; the
 * committed blob, when the commit has one, must be a regular file and a byte prefix of what is
 * read, and the rest must be record blocks for `slug`. A record the commit lacks must be the
 * header `recordHeader` writes for `slug` followed by zero or more such blocks: the seal anchor
 * creates a record with the header alone, which an engine that commits nothing else would
 * otherwise never carry.
 *
 * Nothing is written, and nothing throws but a git call that fails outright.
 */
export function classifyRecord(
  git: IsolatedGit,
  commit: string,
  worktree: string,
  rel: string,
  slug: string,
): RecordState {
  if (!isCanonicalPath(rel)) return refused(`${String(rel)} is not a repo-relative path`);
  const problem = physicalProblem(worktree, rel);
  if (problem !== null) return refused(problem);
  let stat;
  try {
    stat = lstatSync(join(worktree, rel));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { state: "absent" };
    return refused(`it cannot be inspected (${code ?? String(error)})`);
  }
  if (!stat.isFile()) return refused("it is not a regular file");
  try {
    assertNotHardLinked(worktree, rel);
  } catch (error) {
    return refused(error instanceof Error ? error.message : String(error));
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(worktree, rel));
  } catch (error) {
    return refused(`it cannot be read (${error instanceof Error ? error.message : String(error)})`);
  }

  const entry = git
    .text("ls-tree", "-z", "--full-tree", commit, "--", rel)
    .split("\0")
    .map((record) => /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record))
    .find((m) => m?.[4] === rel);
  let prefix: Buffer;
  if (entry) {
    const [, mode, type, oid] = entry as unknown as [string, string, string, string];
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) {
      return refused(`it is not a regular file in ${commit}`);
    }
    prefix = git.bytes("cat-file", "blob", oid);
    if (bytes.equals(prefix)) return { state: "unchanged" };
  } else {
    // Literal, so a record name holding a glob character is not read as a pattern.
    const ignored = git.text(
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      `:(literal)${rel}`,
    );
    if (ignored !== "") return { state: "ignored" };
    prefix = Buffer.from(recordHeader(slug), "utf8");
  }
  if (bytes.length < prefix.length || !bytes.subarray(0, prefix.length).equals(prefix)) {
    return refused(
      entry
        ? `it does not begin with the record as ${commit} holds it: an earlier entry was changed`
        : "it does not begin with the record header the metrics tool writes",
    );
  }
  const added = strictText(bytes.subarray(prefix.length));
  if (added === null) return refused("what was added is not UTF-8 text with LF line ends");
  const why = blocksProblem(added, slug);
  return why === null ? { state: "appended", bytes } : refused(why);
}
