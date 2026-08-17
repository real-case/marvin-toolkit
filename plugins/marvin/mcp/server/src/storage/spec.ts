import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";
import { z } from "zod";
import { parseFrontmatter } from "./frontmatter.js";
import type { SpecConfig } from "./schema.js";

/**
 * Shared spec-contract reader (ADR-0005 → ADR-0024).
 *
 * The typed, fail-closed graph that the `spec` Definition-of-Ready gate
 * validates — the File Change Plan, the Acceptance Criteria, and the interface
 * contract — lives in a `yaml spec-contract` block (ADR-0005). These schemas
 * and extractors are the single source of truth: the `spec` tool imports them
 * for the DoR gate, and the task-summary aggregator (ADR-0024) imports them to
 * read a spec's `criteria` from the *same* authoritative shape rather than
 * re-parsing prose or duplicating the parser (which would silently drift from
 * the gate). Parsing orchestration and the gate checks stay in the `spec` tool.
 */

const ID_FILE = /^F\d+$/i;
const ID_AC = /^AC\d+$/i;
/** A scalar id, an array of ids, or "—"/"none" for an infra row. */
const RefList = z.union([z.array(z.union([z.string(), z.number()])), z.string()]);

const FileRow = z.object({
  id: z.string().regex(ID_FILE, "file id must look like F1, F2, …"),
  path: z.string().min(1),
  action: z.enum(["new", "edit", "delete"]),
  intent: z.string().optional(),
  satisfies: RefList.optional(),
  anchor: z.string().optional(),
});

/**
 * How a criterion is proved. `ref` names the proof (a `path::test name`, a
 * command); `run` is the criterion's own exact command — the most specific rung
 * of oracle resolution, below only a per-call override (ADR-0036).
 *
 * Adding `run` needs **no seal migration**, and the reason is not obvious:
 * `contractHash` below digests the block's raw TEXT, never a parsed or
 * re-serialised structure. Widening what the parser accepts therefore cannot
 * move the digest of a block already on disk, so every `contract_sha` stamped
 * into an existing spec stays valid. A reviewer who assumes the hash covers the
 * parsed shape will look for a migration that must not exist.
 */
const Oracle = z.object({
  kind: z.enum(["test", "command", "prose-review"]),
  ref: z.string().optional(),
  run: z.string().min(1).optional(),
});

const Criterion = z.object({
  id: z.string().regex(ID_AC, "criterion id must look like AC1, AC2, …"),
  statement: z.string().min(1),
  implemented_by: RefList,
  oracle: Oracle,
  failure: z.string().optional(),
  regression: z.boolean().optional(),
});
export type Criterion = z.infer<typeof Criterion>;

const ContractObj = z.object({
  kind: z.enum(["function", "route", "schema", "cli", "event", "none"]),
  signature: z.string().optional(),
});

export const SpecContract = z.object({
  files: z.array(FileRow).min(1),
  build_order: z.array(z.union([z.string(), z.number()])).optional(),
  contract: ContractObj.optional(),
  criteria: z.array(Criterion).min(1),
  depends_on: z.array(z.string()).optional(),
});
export type SpecContract = z.infer<typeof SpecContract>;

/**
 * Discovered, host-specific bindings (ADR-0005 Contract B). Optional and
 * advisory — populated by task-start's pre-draft discovery, not load-bearing
 * for execution. `passthrough` keeps any extra host keys the author records;
 * `spec_location` is what lets depends_on resolve sibling specs, and
 * `decision_record.path` is a link the task summary surfaces.
 */
export const HostBindings = z
  .object({
    spec_location: z.string().optional(),
    decision_record: z
      .object({ style: z.string().optional(), path: z.string().optional() })
      .optional(),
    merge_obligations: z.array(z.string()).optional(),
    gates: z.record(z.string()).optional(),
  })
  .passthrough();
export type HostBindings = z.infer<typeof HostBindings>;

/** Extract the first fenced block whose info string mentions `spec-contract`. */
export function extractContractBlock(body: string): string | null {
  const m = /```[^\n`]*spec-contract[^\n`]*\n([\s\S]*?)\n```/.exec(body);
  return m ? m[1]! : null;
}

/**
 * A short, stable fingerprint of the spec-contract block — stamped into the
 * spec's frontmatter at write, so later tampering of the immutable contract is
 * detectable by re-hashing.
 *
 * **One algorithm, one home, two callers.** The `spec` tool stamps and verifies
 * the seal with it (`mode: seal`, `mode: dor`); `verify`'s `action: "oracles"`
 * recomputes it to refuse running a tampered or unsealed contract (ADR-0036).
 * It lives here, in the layer both tools may import, because the alternative —
 * a second `createHash("sha256")…slice(0, 16)` inside `verify.ts` — is two
 * copies of the seal that drift the first time either is touched, leaving a
 * spec that reads sealed to one caller and tampered to the other.
 *
 * The input is the block's raw text. That is what makes a schema addition
 * (`Oracle.run` above) compatible without a migration.
 */
export function contractHash(blockText: string): string {
  return createHash("sha256").update(blockText.trim()).digest("hex").slice(0, 16);
}

/** Extract the first fenced block whose info string mentions `host-bindings`. */
export function extractHostBindings(body: string): string | null {
  const m = /```[^\n`]*host-bindings[^\n`]*\n([\s\S]*?)\n```/.exec(body);
  return m ? m[1]! : null;
}

/**
 * Host-adaptive spec directories searched, in order, after any host
 * `spec_location` (ADR-0005): `.marvin/task` is the default, but an existing
 * host convention is preferred when present.
 */
export const SPEC_DIRS = [".marvin/task", "specs", "docs/specs", "docs/rfcs", "rfcs"] as const;

/**
 * Resolve a spec filename from its slug within one directory, tolerating the
 * numeric ordering prefix that `task-start` stamps onto spec files
 * (`NNN-<slug>.md`). Returns the absolute path, or null if no file in the
 * directory matches. An exact `<slug>.md` (legacy, unnumbered) is preferred;
 * otherwise the first `<digits>-<slug>.md` match wins.
 */
export function resolveSpecBySlug(dir: string, slug: string, projectRoot: string): string | null {
  const abs = isAbsolute(dir) ? dir : join(projectRoot, dir);
  if (!existsSync(abs)) return null;
  const exact = `${slug}.md`;
  const numbered = new RegExp(`^\\d+-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`);
  let fallback: string | null = null;
  for (const entry of readdirSync(abs).sort()) {
    if (entry === exact) return join(abs, entry);
    if (!fallback && numbered.test(entry)) fallback = join(abs, entry);
  }
  return fallback;
}

// ── corpus mechanics (ADR-0037) ───────────────────────────────────────────
//
// The primitives below mirror `storage/adr.ts` — resolution, corpus read,
// number allocation, id formatting — for the spec domain, which is older than
// the ADR domain and until now described all four in prose across four skills.
// ADR-0022 §1 stated the allocation rule ("highest prefix + 1, zero-padded to at
// least 3 digits, matching a wider width the directory already uses") and
// nothing ever implemented it: the number was produced by a model reading a
// directory listing. Two of that record's three items — identity is the slug,
// resolution is prefix-tolerant — still govern and are implemented by
// `resolveSpecBySlug` above.

export type SpecDirSource = "config" | "detected" | "default";

export interface SpecDirResolution {
  /** Absolute spec directory. */
  abs: string;
  /** Project-root-relative form (POSIX separators) used in output and payloads. */
  rel: string;
  source: SpecDirSource;
}

const DEFAULT_SPEC_DIR = SPEC_DIRS[0];

/**
 * Resolve where this project's specs live: config `spec.dir` wins when set
 * (absolute or project-relative), else the first EXISTING entry of
 * {@link SPEC_DIRS}, else `.marvin/task`.
 *
 * The candidate order is `SPEC_DIRS` unchanged — `.marvin/task` first. That is
 * both the order every current reader already uses and the shape
 * `resolveAdrDir` has, where the house default (`docs/adr`) also leads
 * detection. Preferring a host convention over `.marvin/task` would read better
 * against ADR-0005's prose and would silently relocate the resolved directory
 * for any repository holding both — a resolver whose answer changes because an
 * unrelated directory was added is worse than a mildly arbitrary order. The
 * host-convention preference survives where it is load-bearing: as the `config`
 * tier for an explicit answer, and as the per-spec `spec_location` binding when
 * resolving a spec that already exists.
 *
 * The directory is not required to exist — a read treats a missing dir as an
 * empty corpus.
 */
export function resolveSpecDir(projectDir: string, specConfig?: SpecConfig): SpecDirResolution {
  if (specConfig?.dir) {
    const abs = isAbsolute(specConfig.dir) ? specConfig.dir : join(projectDir, specConfig.dir);
    return { abs, rel: toPosixPath(relative(projectDir, abs)) || specConfig.dir, source: "config" };
  }
  for (const rel of SPEC_DIRS) {
    const abs = join(projectDir, rel);
    try {
      if (existsSync(abs) && statSync(abs).isDirectory()) return { abs, rel, source: "detected" };
    } catch {
      continue; // an unstat-able candidate is not a corpus
    }
  }
  return { abs: join(projectDir, DEFAULT_SPEC_DIR), rel: DEFAULT_SPEC_DIR, source: "default" };
}

function toPosixPath(p: string): string {
  return p.split(sep).join(posix.sep);
}

/**
 * The ordered, deduped, absolute directory list a slug lookup searches:
 * the host binding first, then the resolved directory, then every conventional
 * candidate.
 *
 * The resolver answers "where do NEW specs go"; a slug lookup must keep finding
 * a spec that already lives elsewhere, or configuring `spec.dir` would orphan a
 * repository's history. Resolution order changes; reach does not — and a
 * configured directory outside the five candidates becomes reachable at all.
 */
export function specSearchDirs(
  projectDir: string,
  specConfig?: SpecConfig,
  hostSpecLocation?: string,
): string[] {
  const resolved = resolveSpecDir(projectDir, specConfig);
  const candidates = [
    ...(hostSpecLocation ? [hostSpecLocation] : []),
    resolved.abs,
    ...SPEC_DIRS,
  ].map((d) => (isAbsolute(d) ? d : join(projectDir, d)));
  return [...new Set(candidates)];
}

export interface SpecRecord {
  /** Filename ordering prefix as a number, or null for a legacy unnumbered spec. */
  number: number | null;
  /** The prefix exactly as written (`"0012"`), or null when there is none. */
  id: string | null;
  /** The spec's identity: frontmatter `slug`, else the filename slug (ADR-0022 §2). */
  slug: string;
  /** First `# ` heading, else the slug. */
  title: string;
  status: string | null;
  contract_sha: string | null;
  filename: string;
  /** Project-root-relative path, POSIX separators (stable across hosts). */
  path: string;
}

export interface MalformedSpec {
  filename: string;
  /** Filename number when the prefix was still parseable. */
  number: number | null;
  reason: string;
}

export interface SpecCorpus {
  records: SpecRecord[];
  malformed: MalformedSpec[];
}

/** `NNN-<slug>.md` — any width; the width rule below is what pads new ones. */
const SPEC_PREFIX_RE = /^(\d+)-(.+)$/;

/**
 * Read every spec under the resolved directory.
 *
 * Unlike `readAdrCorpus` this cannot require a numeric prefix: ADR-0022's own
 * Consequences guarantee that a legacy unnumbered `<slug>.md` keeps working, so
 * an unnumbered file is a record with `number: null`. But it is a record only
 * when it **also identifies itself as a spec** — frontmatter carrying `slug` or
 * `type`. Without that clause, dropping the filename requirement composes with
 * detection into a false positive: a host repository with no `.marvin/task/` but
 * a `specs/` directory (a very common name for API or test specs) would have its
 * `README.md`, templates and unrelated markdown enumerated as pipeline specs in
 * flight. A numeric prefix or a frontmatter identity is the cheapest predicate
 * that keeps the guarantee and refuses the phantom corpus.
 *
 * `verification.md` is the gate artifact, not a spec. Anything that is not a
 * regular file is skipped — which excludes the `runs/` subdirectory explicitly
 * rather than by relying on its name not ending in `.md`, because the moment a
 * journal file lands there under an `.md` name an enumerator resting on that
 * coincidence reads run journals as specs. Symlinked entries are skipped
 * outright: a planted link must not pull out-of-tree content into a payload.
 *
 * A missing directory is an empty corpus, never an error. A file that is OURS
 * and cannot be read, or that opens a frontmatter block the parser cannot make
 * sense of, lands in `malformed` with its number intact, so the count is never
 * silently short. Ownership is decided first: `malformed` is a claim about a
 * spec, and a file that never identified itself as one cannot be a broken spec.
 * An empty block is not a defect either — see {@link frontmatterDefect}.
 * Records sort by number descending with `null` last, then filename.
 */
export function readSpecCorpus(dir: SpecDirResolution): SpecCorpus {
  if (!existsSync(dir.abs)) return { records: [], malformed: [] };

  let filenames: string[];
  try {
    filenames = readdirSync(dir.abs).sort();
  } catch {
    return { records: [], malformed: [] }; // an unreadable directory counts as empty
  }

  const records: SpecRecord[] = [];
  const malformed: MalformedSpec[] = [];
  for (const filename of filenames) {
    if (!filename.endsWith(".md") || filename === "verification.md") continue;
    const base = filename.slice(0, -3);
    const prefix = SPEC_PREFIX_RE.exec(base);
    const id = prefix?.[1] ?? null;
    const number = id === null ? null : Number(id);
    const path = join(dir.abs, filename);

    let raw: string;
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      raw = readFileSync(path, "utf8");
    } catch (err) {
      malformed.push({ filename, number, reason: `could not read the file: ${errText(err)}` });
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(raw);

    // A prefix or a frontmatter identity — otherwise this is somebody else's
    // markdown that happens to share a directory with the specs. This runs
    // BEFORE the malformed channel, and the order is the whole guard: a file
    // this pipeline does not own must be skipped whatever state its frontmatter
    // is in, or the phantom corpus returns through the one channel the audit
    // rates `error` — a host `specs/README.md` opening a `---` block it never
    // closes would be reported as a broken spec rather than passed over.
    if (id === null && !frontmatter.slug && !frontmatter.type) continue;

    if (Object.keys(frontmatter).length === 0) {
      const defect = frontmatterDefect(raw);
      if (defect !== null) {
        malformed.push({ filename, number, reason: defect });
        continue;
      }
    }

    const slug = frontmatter.slug?.trim() || prefix?.[2] || base;
    records.push({
      number,
      id,
      slug,
      title: firstHeading(body) ?? slug,
      status: frontmatter.status?.trim() || null,
      contract_sha: frontmatter.contract_sha?.trim() || null,
      filename,
      path: posix.join(dir.rel, filename),
    });
  }

  // Number descending, `null` last (an unnumbered legacy spec sorts below every
  // numbered one), ties broken by filename so the order is deterministic.
  records.sort(
    (a, b) => (b.number ?? -1) - (a.number ?? -1) || a.filename.localeCompare(b.filename),
  );
  return { records, malformed };
}

/** A frontmatter block that opens `---` and closes `---`; group 1 is its text. */
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/;

/**
 * Why a file's frontmatter is unusable, or null when it is merely empty.
 *
 * Called only when `parseFrontmatter` produced no keys, which it does for four
 * different files: one with no block at all, one whose block is EMPTY, one whose
 * block is never closed, and one whose YAML threw. Treating the empty map as a
 * single condition reports the wrong reason for three of them. An empty block is
 * not a defect — `---\n---` is well-formed and simply carries nothing — so such
 * a file stays a record and the audit's per-record check names the identity keys
 * it is missing, which is both true and actionable. Only a block that cannot be
 * read as YAML at all is `malformed`, and it now says which way it failed.
 */
function frontmatterDefect(raw: string): string | null {
  if (!raw.startsWith("---\n")) return null; // no block claimed
  const block = FRONTMATTER_BLOCK_RE.exec(raw);
  if (block === null) return "frontmatter block opens with `---` but is never closed";
  return block[1]!.trim() === "" ? null : "frontmatter block is present but could not be parsed";
}

/** First `# ` heading of a markdown body, or null. */
function firstHeading(text: string): string | null {
  const m = /^#\s+(.+?)\s*$/m.exec(text);
  return m ? m[1]! : null;
}

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 120);
}

/**
 * Highest number anywhere in the corpus + 1, or 1 on an empty one. Malformed
 * files hold their numbers too — a file the parser cannot read still occupies
 * its slot, so allocation never hands out a number that is already taken.
 */
export function nextSpecNumber(corpus: SpecCorpus): number {
  const numbers = [
    ...corpus.records.map((r) => r.number),
    ...corpus.malformed.map((m) => m.number),
  ].filter((n): n is number => n !== null);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/**
 * The zero-padding width ADR-0022 §1 states and nothing had ever implemented:
 * at least 3 digits, matching a wider width when the directory already uses one
 * (a 4-digit host RFC convention). Padding widens naturally past the observed
 * width — `String(1000).padStart(3, "0")` is already `"1000"` — the same
 * tolerance `formatAdrId` documents.
 */
export function specIdWidth(corpus: SpecCorpus): number {
  const observed = (filename: string): number =>
    SPEC_PREFIX_RE.exec(filename.replace(/\.md$/, ""))?.[1]?.length ?? 0;
  const widths = [
    ...corpus.records.map((r) => r.id?.length ?? 0),
    ...corpus.malformed.map((m) => observed(m.filename)),
  ];
  return Math.max(3, ...widths);
}

/** Zero-pad an allocated number to the corpus's own width. */
export function formatSpecId(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
