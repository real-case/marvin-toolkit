import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { git } from "./git.js";

/**
 * Who imports a file, read from the tracked tree: the decidable half of "a caller found in Step 2F"
 * (task-start), which the DoR gate's `risk-callers` warning stands on.
 *
 * Only what can be resolved without a build is counted: a relative JavaScript or TypeScript module
 * specifier (`import`, `export … from`, `import()`, `require()`), resolved against the importing
 * file, and a Python `import a.b` / `from a.b import` whose dotted name ends the target's path. A
 * package name, a path alias or a bundler-resolved import is not followed, so the answer can miss a
 * caller but does not invent one. Test files neither are callers nor have them here: a test of
 * the module is not existing behaviour another part of the program depends on.
 */

/** A path that holds tests, by the conventions the stacks marvin meets use. */
const TEST_PATH = [
  /(^|\/)(tests?|__tests__|spec|specs)\//,
  /\.(test|spec)\.[^/]+$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go)$/,
];

export function isTestPath(path: string): boolean {
  return TEST_PATH.some((re) => re.test(path));
}

const JS_SPECIFIER =
  /(?:\b(?:import|export)\b[^'"`;]*?\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
const PY_IMPORT =
  /^[ \t]*(?:from[ \t]+([A-Za-z_][\w.]*)[ \t]+import\b|import[ \t]+([A-Za-z_][\w.]*))/gm;
const CODE_EXT = /\.(?:[cm]?[jt]sx?|py)$/;

/** The path without its last extension; `.js` written for a `.ts` source resolves to the same. */
const stem = (path: string) => path.replace(/\.[^./]+$/, "");

/** Whether the module `spec`, written in `from`, names `target`. */
function jsNames(from: string, spec: string, target: string): boolean {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return false;
  const resolved = posix.normalize(posix.join(posix.dirname(from), spec));
  const want = stem(target);
  return (
    resolved === target ||
    stem(resolved) === want ||
    resolved === want ||
    `${resolved}/index` === want
  );
}

/** Whether the dotted Python module `name` names `target`. */
function pyNames(name: string, target: string): boolean {
  if (!target.endsWith(".py")) return false;
  const path = name.split(".").join("/");
  const want = stem(target).replace(/\/__init__$/, "");
  return want === path || want.endsWith(`/${path}`);
}

/**
 * The tracked, non-test files under `projectRoot` that import `target` (repo-relative, POSIX),
 * sorted, at most `limit`. Empty for a test file, a non-code file, or a git failure:
 * the warning this feeds must never be the thing that breaks a gate.
 */
export function importersOf(projectRoot: string, target: string, limit = 5): string[] {
  if (isTestPath(target) || !CODE_EXT.test(target)) return [];
  const base = stem(posix.basename(target));
  const name =
    base === "index" || base === "__init__" ? posix.basename(posix.dirname(target)) : base;
  if (name === "" || name === ".") return [];
  const listed = git(["grep", "-l", "-F", "-z", "-e", name, "--"], projectRoot, {
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!listed.ok) return [];
  const callers: string[] = [];
  for (const file of listed.value.split("\0").filter(Boolean).sort()) {
    if (file === target || isTestPath(file) || !CODE_EXT.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(join(projectRoot, file), "utf8");
    } catch {
      continue;
    }
    const imports = file.endsWith(".py")
      ? [...text.matchAll(PY_IMPORT)].some((m) => pyNames((m[1] ?? m[2])!, target))
      : [...text.matchAll(JS_SPECIFIER)].some((m) => jsNames(file, m[2]!, target));
    if (imports) callers.push(file);
    if (callers.length >= limit) break;
  }
  return callers;
}
