// The fake executor's work, by spawn number (argv[2]): the first implements `clamp` and commits
// it; the second answers the verifier's major finding with a guard and commits. Neither commits
// the spec or its metrics record: the engine committed both at approval. After each commit it
// does what the real delivery gate (`verify action: "gate"`) does on ALLOW: it appends a
// terminal `task-metrics` block naming the commit to the record, and leaves that append for the
// engine to carry into its finalize commit.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const spawn = Number(process.argv[2]);
const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "ignore", "inherit"] });
const source = readFileSync("src/math.mjs", "utf8");

if (spawn === 1) {
  writeFileSync(
    "src/math.mjs",
    `${source}\n/** Bounds x to [lo, hi]. */\nexport function clamp(x, lo, hi) {\n  return Math.min(hi, Math.max(lo, x));\n}\n`,
  );
  git("add", "--", "src/math.mjs");
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

// The shape `storage/metrics.ts` writes, byte for byte: the fence, one JSON line, the closing
// fence and a blank line, with the envelope its reader checks.
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const block = {
  slug: "clamp",
  rolled_up_at: new Date().toISOString(),
  base_branch: "dev",
  head_sha: head,
  sources: { spec: "present", git: "present" },
  time: {},
  quality: {},
  rework: {},
  notes: [],
};
appendFileSync(
  ".marvin/metrics/001-clamp.md",
  `\`\`\`json task-metrics\n${JSON.stringify(block)}\n\`\`\`\n\n`,
);
