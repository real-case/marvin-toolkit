import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  Coverage,
  FlowMap,
  HUNT_STATE_VERSION,
  HuntConfig,
  HuntRun,
  LedgerLine,
  type Coverage as CoverageType,
  type FlowMap as FlowMapType,
  type HuntConfig as HuntConfigType,
  type HuntRun as HuntRunType,
  type LedgerLine as LedgerLineType,
} from "@marvin-toolkit/mcp-shared/contracts";

/**
 * Persistence for the bug-hunter state under `.marvin/hunt/` (ADR-0054). Every read validates
 * against the shared contract and every write validates before it touches the disk, so an
 * artefact on disk always parses (PKG-06). A file written by a NEWER marvin is refused with a
 * message that says so instead of being misread or overwritten (PKG-07).
 *
 * Layout:
 *   findings.jsonl        the ledger — append-only, one `LedgerLine` per line
 *   flows.json            the flow map, shared by every check
 *   coverage.json         per-file audit history
 *   runs/<run-id>/        run.json (+ flows.json snapshot)   — local, git-ignored
 *   evidence/<id>/        screenshots, traces, test output    — local, git-ignored
 *   reports/              <stamp>.md + latest.md
 *   .gitignore            written by `ensureHuntDir`: `runs/` and `evidence/`
 *   .gitattributes        written by `ensureHuntDir`: `findings.jsonl merge=union`
 */

export const LEDGER_FILE = "findings.jsonl";
export const FLOWS_FILE = "flows.json";
export const COVERAGE_FILE = "coverage.json";
export const RUNS_DIR = "runs";
export const REPORTS_DIR = "reports";
export const EVIDENCE_DIR = "evidence";

/** Raised for any state the tool must not act on; the message is fit for the user. */
export class HuntStateError extends Error {}

const GITIGNORE = [
  "# Written by marvin's hunt tool (ADR-0054). The ledger, flow map, coverage and reports are",
  "# shared records; run state and raw evidence stay on this machine.",
  `${RUNS_DIR}/`,
  `${EVIDENCE_DIR}/`,
  "",
].join("\n");

/**
 * Two branches that each append to the ledger touch its last line, which git's default text
 * merge reports as a conflict. Every line is an independent event and the fold tolerates any
 * interleaving (an id is derived from the fingerprint, and a repeated finding line folds as a
 * sighting), so a union merge — keep both sides' lines — is the correct resolution.
 */
const GITATTRIBUTES = [
  "# Written by marvin's hunt tool (ADR-0054). The ledger is append-only: keep both sides' lines.",
  `${LEDGER_FILE} merge=union`,
  "",
].join("\n");

/**
 * Create `.marvin/hunt/` with its `.gitignore` and `.gitattributes` if absent. Never overwrites
 * either file once it exists, so an edited one survives.
 */
export function ensureHuntDir(huntDir: string): void {
  mkdirSync(huntDir, { recursive: true });
  const ignore = join(huntDir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, GITIGNORE, "utf8");
  const attributes = join(huntDir, ".gitattributes");
  if (!existsSync(attributes)) writeFileSync(attributes, GITATTRIBUTES, "utf8");
}

function huntAtomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

function huntVersionOf(json: unknown): number | null {
  if (typeof json === "object" && json !== null && "version" in json) {
    const v = (json as { version: unknown }).version;
    return typeof v === "number" ? v : null;
  }
  if (typeof json === "object" && json !== null && "v" in json) {
    const v = (json as { v: unknown }).v;
    return typeof v === "number" ? v : null;
  }
  return null;
}

function huntRefuseNewer(json: unknown, label: string): void {
  const v = huntVersionOf(json);
  if (v !== null && v > HUNT_STATE_VERSION) {
    throw new HuntStateError(
      `${label} was written by a newer marvin (state version ${v}, this one reads ${HUNT_STATE_VERSION}). ` +
        "Upgrade the plugin before running a hunt here; nothing was changed.",
    );
  }
}

function readHuntJson(path: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new HuntStateError(`${label} could not be read: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new HuntStateError(`${label} is not valid JSON: ${(err as Error).message}`);
  }
}

function huntIssues(err: { issues: { path: (string | number)[]; message: string }[] }): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

// ── configuration ─────────────────────────────────────────────────────────

export interface HuntConfigRead {
  config: HuntConfigType;
  /** Whether `.marvin/config.json` carries a `hunt` key at all. */
  present: boolean;
}

/**
 * The `hunt` key of `.marvin/config.json`, validated on its own. It is read here rather than
 * through the shared `Config` schema so a typo in it cannot reset `statuses`, `gates` or
 * `base_branch` for every other tool — the reason `isolatePipelineSettings` gives — and the
 * reverse: an invalid `hunt` block is an error for the hunt tool alone.
 */
export function readHuntConfig(configPath: string): HuntConfigRead {
  if (!existsSync(configPath)) return { config: HuntConfig.parse({}), present: false };
  const json = readHuntJson(configPath, ".marvin/config.json");
  const raw =
    typeof json === "object" && json !== null ? (json as Record<string, unknown>).hunt : undefined;
  if (raw === undefined) return { config: HuntConfig.parse({}), present: false };
  huntRefuseNewer(raw, "The `hunt` block of .marvin/config.json");
  const parsed = HuntConfig.safeParse(raw);
  if (!parsed.success) {
    throw new HuntStateError(
      `The \`hunt\` block of .marvin/config.json is invalid: ${huntIssues(parsed.error)}. ` +
        "Fix it, or rerun /marvin:hunt-init.",
    );
  }
  return { config: parsed.data, present: true };
}

/**
 * Write the `hunt` key, keeping every other key of the file exactly as it was (the read-modify-
 * write `updateConfigFile` uses for its own keys). Refuses a file that is not a JSON object.
 */
export function writeHuntConfig(configPath: string, config: HuntConfigType): void {
  const validated = HuntConfig.parse(config);
  let json: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const current = readHuntJson(configPath, ".marvin/config.json");
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      throw new HuntStateError(".marvin/config.json is not a JSON object; refusing to edit it.");
    }
    json = current as Record<string, unknown>;
  }
  json.hunt = validated;
  huntAtomicWrite(configPath, `${JSON.stringify(json, null, 2)}\n`);
}

// ── ledger ────────────────────────────────────────────────────────────────

export interface LedgerRead {
  lines: LedgerLineType[];
  /** One entry per line that did not parse; the fold skips them and the tool reports them. */
  malformed: { line: number; reason: string }[];
  /**
   * Line numbers of git conflict markers: the ledger was merged without `merge=union`. The
   * lines between the markers still parse and are folded; the markers themselves are reported.
   */
  conflictMarkers: number[];
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7}|\|{7})( |$)/;

export function readLedger(huntDir: string): LedgerRead {
  const path = join(huntDir, LEDGER_FILE);
  if (!existsSync(path)) return { lines: [], malformed: [], conflictMarkers: [] };
  const text = readFileSync(path, "utf8");
  const lines: LedgerLineType[] = [];
  const malformed: { line: number; reason: string }[] = [];
  const conflictMarkers: number[] = [];
  text.split("\n").forEach((raw, i) => {
    if (raw.trim() === "") return;
    if (CONFLICT_MARKER.test(raw)) {
      conflictMarkers.push(i + 1);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      malformed.push({ line: i + 1, reason: "not JSON" });
      return;
    }
    huntRefuseNewer(json, `.marvin/hunt/${LEDGER_FILE} line ${i + 1}`);
    const parsed = LedgerLine.safeParse(json);
    if (parsed.success) lines.push(parsed.data);
    else malformed.push({ line: i + 1, reason: huntIssues(parsed.error) });
  });
  return { lines, malformed, conflictMarkers };
}

/** Append lines to the ledger after validating every one; nothing is written if one is invalid. */
export function appendLedger(huntDir: string, lines: LedgerLineType[]): void {
  if (lines.length === 0) return;
  const text = lines
    .map((l) => {
      const parsed = LedgerLine.safeParse(l);
      if (!parsed.success) {
        throw new HuntStateError(
          `refusing to write an invalid ledger line: ${huntIssues(parsed.error)}`,
        );
      }
      return JSON.stringify(parsed.data);
    })
    .join("\n");
  ensureHuntDir(huntDir);
  appendFileSync(join(huntDir, LEDGER_FILE), `${text}\n`, "utf8");
}

// ── flow map / coverage ───────────────────────────────────────────────────

export function readFlows(huntDir: string): FlowMapType | null {
  const path = join(huntDir, FLOWS_FILE);
  if (!existsSync(path)) return null;
  const json = readHuntJson(path, `.marvin/hunt/${FLOWS_FILE}`);
  huntRefuseNewer(json, `.marvin/hunt/${FLOWS_FILE}`);
  const parsed = FlowMap.safeParse(json);
  if (!parsed.success) {
    throw new HuntStateError(`.marvin/hunt/${FLOWS_FILE} is invalid: ${huntIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function writeFlows(path: string, map: FlowMapType): void {
  huntAtomicWrite(path, `${JSON.stringify(FlowMap.parse(map), null, 2)}\n`);
}

export function readCoverage(huntDir: string): CoverageType {
  const path = join(huntDir, COVERAGE_FILE);
  if (!existsSync(path)) return { version: HUNT_STATE_VERSION, files: [] };
  const json = readHuntJson(path, `.marvin/hunt/${COVERAGE_FILE}`);
  huntRefuseNewer(json, `.marvin/hunt/${COVERAGE_FILE}`);
  const parsed = Coverage.safeParse(json);
  if (!parsed.success) {
    throw new HuntStateError(
      `.marvin/hunt/${COVERAGE_FILE} is invalid: ${huntIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function writeCoverage(huntDir: string, coverage: CoverageType): void {
  const sorted = {
    ...coverage,
    files: [...coverage.files].sort((a, b) => a.path.localeCompare(b.path)),
  };
  huntAtomicWrite(
    join(huntDir, COVERAGE_FILE),
    `${JSON.stringify(Coverage.parse(sorted), null, 2)}\n`,
  );
}

// ── runs ──────────────────────────────────────────────────────────────────

const RUN_ID = /^\d{8}-\d{6}-[a-z-]+$/;

export function runDir(huntDir: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new HuntStateError(`"${runId}" is not a hunt run id.`);
  return join(huntDir, RUNS_DIR, runId);
}

export function readRun(huntDir: string, runId: string): HuntRunType {
  const path = join(runDir(huntDir, runId), "run.json");
  if (!existsSync(path)) throw new HuntStateError(`No hunt run ${runId} under .marvin/hunt/runs/.`);
  const json = readHuntJson(path, `run ${runId}`);
  huntRefuseNewer(json, `run ${runId}`);
  const parsed = HuntRun.safeParse(json);
  if (!parsed.success)
    throw new HuntStateError(`run ${runId} is invalid: ${huntIssues(parsed.error)}`);
  return parsed.data;
}

export function writeRun(huntDir: string, run: HuntRunType): void {
  ensureHuntDir(huntDir);
  huntAtomicWrite(
    join(runDir(huntDir, run.id), "run.json"),
    `${JSON.stringify(HuntRun.parse(run), null, 2)}\n`,
  );
}

/** Run ids, newest first. Ids sort by their timestamp prefix. */
export function listRunIds(huntDir: string): string[] {
  const dir = join(huntDir, RUNS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && RUN_ID.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
}

// ── reports ───────────────────────────────────────────────────────────────

/** Write `reports/<name>.md` and `reports/latest.md`; returns both repository-relative names. */
export function writeReport(huntDir: string, name: string, markdown: string): string[] {
  const dir = join(huntDir, REPORTS_DIR);
  huntAtomicWrite(join(dir, `${name}.md`), markdown);
  huntAtomicWrite(join(dir, "latest.md"), markdown);
  return [`${REPORTS_DIR}/${name}.md`, `${REPORTS_DIR}/latest.md`];
}
