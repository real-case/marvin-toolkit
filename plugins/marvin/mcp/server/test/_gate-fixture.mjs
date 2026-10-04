import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { importTs } from "./_tsload.mjs";
import { repoWithOrigin, sh } from "./_pipeline-git.mjs";

export const g = await importTs("src/pipeline/gate.ts");
const wt = await importTs("src/pipeline/worktree.ts");

const pipelineDir = fileURLToPath(new URL("../../../pipeline/", import.meta.url));
export const protectedDefaults = JSON.parse(
  readFileSync(join(pipelineDir, "protected.default.json"), "utf8"),
);
export const defaultChecks = parseYaml(
  readFileSync(join(pipelineDir, "checks.default.yaml"), "utf8"),
);

/**
 * A run worktree the way the engine makes one (`createRunWorktree`), with `baseFiles` already
 * on origin/dev, plus the protected baseline taken right after creation.
 */
export function runWorktree(baseFiles = {}) {
  const repo = repoWithOrigin();
  const w = { repo };
  w.write = (rel, body, root = w.path) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  if (Object.keys(baseFiles).length > 0) {
    for (const [rel, body] of Object.entries(baseFiles)) w.write(rel, body, repo);
    sh(repo, "add", "-A");
    sh(repo, "commit", "-m", "base files");
    sh(repo, "push", "origin", "HEAD:dev");
  }
  Object.assign(
    w,
    wt.createRunWorktree({
      repoRoot: repo,
      base: "dev",
      runId: "r1",
      worktreesRoot: mkdtempSync(join(tmpdir(), "pipe-wts-")),
    }),
  );
  w.git = (...args) => sh(w.path, ...args);
  w.commit = (message = "work") => {
    w.git("add", "-A");
    w.git("commit", "-m", message);
  };
  w.snapshot = () => g.snapshotProtected(w.path, w.gitDir, protectedDefaults);
  w.baseline = w.snapshot();
  return w;
}

/** `runGateStage` on a run worktree with sensible defaults; `over` replaces any option. */
export const gateStage = (w, over = {}) =>
  g.runGateStage({
    worktree: w.path,
    baseSha: w.baseSha,
    gitDir: w.gitDir,
    gates: [{ name: "true", command: "true" }],
    oracles: [],
    contractFiles: [],
    sealed: [],
    checks: defaultChecks,
    exemptPattern: null,
    protectedPatterns: protectedDefaults,
    protectedBaseline: w.baseline,
    run: g.shellRunner,
    timeoutMs: 10_000,
    ...over,
  });

export const claims = (report) => report.blockers.map((b) => b.claim).sort();
