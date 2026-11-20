import { oracleTestFile } from "../storage/oracles.js";
import type { SpecContract } from "../storage/spec.js";

/**
 * The contract-surface check (ADR-0052): are the names a spec's `contract.signature` declares
 * present in the files the contract lets the implementation change?
 *
 * Before this check the signature was validated once, at the Definition of Ready, and only for
 * being non-empty. Nothing compared it with the delivered code, so a task could reach its pull
 * request with a renamed or missing entry point and every gate would stay green.
 *
 * The signature is free text: real ones mix declarations, `// path` comments, prose, indented
 * parameter lists, and lists of names the task removes. This module reads only the decidable half
 * of it. A name counts as declared when it starts a line at column 0 in one of the shapes below,
 * and as present when it occurs as a whole word in an implementation file. That is weaker than
 * comparing signatures (a declaration with the right name and the wrong parameters passes), and it
 * is why the delivery gate reports the answer beside its decision and never inside it.
 *
 * Measured on 110 specs from five projects on 2026-11-08 against their current trees (ADR-0052):
 * every marvin spec read `matched`; the one pattern that produced false warnings (`name:` field
 * lines, which caught prose labels such as `body:` and `responses:` in route signatures) is
 * restricted here to upper-case constants; and every `missing` answer named something removed or
 * moved after its spec shipped, which is real drift rather than a misreading.
 *
 * Pure: the caller supplies the file reader, so nothing here touches the filesystem.
 */

/** `matched`: every declared name was found. `missing`: at least one was not. */
export type SurfaceStatus = "matched" | "missing" | "unknown";

export interface SurfaceNames {
  /** Names declared at column 0, in first-seen order. */
  declared: string[];
  /** Names declared under a comment that says the task removes them; never looked for. */
  removed: string[];
}

export interface SurfaceCheck {
  status: SurfaceStatus;
  /** Declared names found in no implementation file, in declaration order; empty unless `missing`. */
  missing: string[];
  /** Why the answer is `unknown`; null when it is not. */
  reason: string | null;
}

const ID = "[A-Za-z_$][\\w$]*";

/**
 * The declaration shapes, tried in order on a column-0 line with its trailing comment removed.
 * The first capture group is the name.
 */
const DECLARATIONS: readonly RegExp[] = [
  // export default async function* name
  new RegExp(
    `^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\*?\\s+(${ID})`,
  ),
  // export const|let|var|class|interface|type|enum name
  new RegExp(
    `^(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:const|let|var|class|interface|type|enum)\\s+(${ID})`,
  ),
  // def name, fn name, pub(crate) async fn name, func (r *T) name, struct name, trait name
  new RegExp(
    `^(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:def|fn|func|struct|trait)\\s+(?:\\([^)]*\\)\\s*)?(${ID})`,
  ),
  // name(args) and name<T>(args): the call-shaped declaration most signatures use
  new RegExp(`^(${ID})\\s*(?:<[^>]*>)?\\s*\\(`),
  // Name = …, the alias form schema signatures use
  new RegExp(`^(${ID})\\s*=(?!=)`),
  // CONSTANT: Type. Upper case only: a lower-case `name:` line is a prose label as often as a field.
  /^([A-Z][A-Z0-9_]*)\??\s*:(?!:)/,
];

/** Words a column-0 line can start with that are never a declared name. */
const NOT_A_NAME = new Set([
  "if",
  "for",
  "while",
  "switch",
  "return",
  "catch",
  "new",
  "await",
  "import",
  "export",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/** A comment that marks the declarations after it (or beside it) as removed by the task. */
const REMOVAL = /\b(removed|deleted|dropped)\b/i;

/** A line comment: `//` or `#` at the start of the line or after whitespace. */
const LINE_COMMENT = /(^|\s)(\/\/|#)(.*)$/;

/**
 * The names `signature` declares, split into those the task adds or keeps and those it removes.
 *
 * A comment-only line that says "removed", "deleted" or "dropped" opens a removal section, which a
 * blank line or the next comment-only line closes; a declaration whose own trailing comment says so
 * is removed on its own. Indented lines are never read: they are parameters, members and
 * continuations, not top-level declarations.
 */
export function surfaceNames(signature: string): SurfaceNames {
  const text = signature.replace(/\/\*[\s\S]*?\*\//g, "");
  const declared: string[] = [];
  const removed: string[] = [];
  let removing = false;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") {
      removing = false;
      continue;
    }
    if (/^\s*(\/\/|#)/.test(raw)) {
      removing = REMOVAL.test(raw);
      continue;
    }
    if (/^\s/.test(raw)) continue;
    const comment = LINE_COMMENT.exec(raw);
    const line = (comment ? raw.slice(0, comment.index) : raw).trimEnd();
    const name = declaredName(line);
    if (name === null) continue;
    const target =
      removing || (comment !== null && REMOVAL.test(comment[3] ?? "")) ? removed : declared;
    if (!target.includes(name)) target.push(name);
  }
  return { declared: declared.filter((n) => !removed.includes(n)), removed };
}

function declaredName(line: string): string | null {
  for (const re of DECLARATIONS) {
    const m = re.exec(line);
    if (m && m[1] !== undefined) return NOT_A_NAME.has(m[1]) ? null : m[1];
  }
  return null;
}

const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const TEST_FILE =
  /(^|\/)(test|tests|__tests__|e2e|spec)\/|(^|\/)test_[^/]+$|[._-](test|spec)\.[^/]+$/i;

/**
 * The contract's `files` that can hold the declared surface: every row the task does not delete,
 * minus documentation, test files by path, and every file a `kind: test` oracle names. A name
 * found only in a test or a changelog has not been implemented.
 */
export function implementationFiles(contract: SpecContract): string[] {
  const tests = new Set(
    contract.criteria.map((c) => oracleTestFile(c)).filter((f): f is string => f !== null),
  );
  return contract.files
    .filter((f) => f.action !== "delete")
    .map((f) => f.path)
    .filter((p) => !DOC_FILE.test(p) && !TEST_FILE.test(p) && !tests.has(p));
}

const unknown = (reason: string): SurfaceCheck => ({ status: "unknown", missing: [], reason });

/** Whole-word occurrence: `foo` is not found in `foobar` or `$foo`. */
function occurs(name: string, text: string): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

/**
 * Judge one contract. `readFile` takes a contract path and returns its text, or null when it cannot
 * be read; an unreadable file is searched as if it were not listed.
 */
export function checkContractSurface(
  contract: SpecContract,
  readFile: (path: string) => string | null,
): SurfaceCheck {
  if (!contract.contract || contract.contract.kind === "none") {
    return unknown("the contract declares no callable surface");
  }
  const { declared } = surfaceNames(contract.contract.signature ?? "");
  if (declared.length === 0) {
    return unknown("no declaration could be read from contract.signature");
  }
  const texts = implementationFiles(contract)
    .map((p) => readFile(p))
    .filter((t): t is string => t !== null);
  if (texts.length === 0) {
    return unknown("none of the contract's implementation files could be read");
  }
  const missing = declared.filter((name) => !texts.some((t) => occurs(name, t)));
  return missing.length === 0
    ? { status: "matched", missing: [], reason: null }
    : { status: "missing", missing, reason: null };
}
