// The fake executor's work, by spawn number (argv[2]): the first implements `clamp` and commits
// it with the spec; the second answers the verifier's major finding with a guard and commits.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const spawn = Number(process.argv[2]);
const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "ignore", "inherit"] });
const source = readFileSync("src/math.mjs", "utf8");

if (spawn === 1) {
  writeFileSync(
    "src/math.mjs",
    `${source}\n/** Bounds x to [lo, hi]. */\nexport function clamp(x, lo, hi) {\n  return Math.min(hi, Math.max(lo, x));\n}\n`,
  );
  // The spec sits under the ignored .marvin/, as in a host project, so it is added with -f.
  git("add", "-f", "--", "src/math.mjs", ".marvin/task/001-clamp.md");
  git("commit", "-q", "-m", "feat(clamp): add clamp");
} else {
  writeFileSync(
    "src/math.mjs",
    source.replace(
      "export function clamp(x, lo, hi) {\n",
      'export function clamp(x, lo, hi) {\n  if (lo > hi) throw new RangeError("lo must not exceed hi");\n',
    ),
  );
  git("add", "--", "src/math.mjs");
  git("commit", "-q", "-m", "fix(clamp): reject an inverted range");
}
