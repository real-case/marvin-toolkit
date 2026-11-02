import { execFileSync, execSync } from "node:child_process";
import { fetchPull, prRef, repoPath, type RestPull } from "./github.js";

export type CiState = "green" | "red" | "pending" | "conflict" | "no_ci" | "closed";
export interface Pr {
  state: string;
  mergeable: string;
  mergeStateStatus: string;
  headRefOid: string;
}
interface WorkflowRun {
  head_sha: string;
  status: string;
  conclusion: string | null;
  name: string;
}

const PASSING = new Set(["success", "skipped", "neutral"]);

export function classifyCi(i: {
  pr: Pr;
  runs: WorkflowRun[];
  minutesSincePush: number;
  noCiAfterMinutes: number;
}): { state: CiState; failing: string[] } {
  if (i.pr.state !== "OPEN") return { state: "closed", failing: [] };
  if (i.pr.mergeable === "CONFLICTING" || i.pr.mergeStateStatus === "DIRTY")
    return { state: "conflict", failing: [] };
  const mine = i.runs.filter((r) => r.head_sha === i.pr.headRefOid);
  if (mine.length === 0)
    return {
      state: i.minutesSincePush >= i.noCiAfterMinutes ? "no_ci" : "pending",
      failing: [],
    };
  if (mine.some((r) => r.status !== "completed")) return { state: "pending", failing: [] };
  const failing = mine.filter((r) => !PASSING.has(r.conclusion ?? "")).map((r) => r.name);
  return { state: failing.length ? "red" : "green", failing };
}

export function fetchCi(o: { worktree: string; prUrl: string; tokenCommand: string | null }): {
  pr: Pr;
  runs: WorkflowRun[];
} {
  const env = {
    ...process.env,
    ...(o.tokenCommand
      ? {
          GH_TOKEN: execSync(o.tokenCommand, { encoding: "utf8" }).trim(),
        }
      : {}),
  };
  const gh = (...args: string[]) =>
    execFileSync("gh", args, { cwd: o.worktree, env, encoding: "utf8" });
  const ref = prRef(o.prUrl);
  const rest = fetchPull(gh, ref);
  const runs = JSON.parse(
    gh(
      "api",
      `${repoPath(ref)}/actions/runs?branch=${encodeURIComponent(rest.head.ref)}&per_page=50`,
      "--jq",
      ".workflow_runs",
    ),
  ) as WorkflowRun[];
  return { pr: prFromRest(rest), runs };
}

/**
 * A REST pull request in the shape `classifyCi` reads, which is the shape `gh pr view --json`
 * printed before the engine moved to REST: upper-case state, a merged PR as `MERGED`, and
 * `mergeable` as `MERGEABLE`, `CONFLICTING` or, while GitHub is still computing it, `UNKNOWN`.
 */
export function prFromRest(rest: RestPull): Pr {
  return {
    state: rest.merged ? "MERGED" : rest.state.toUpperCase(),
    mergeable:
      rest.mergeable === true ? "MERGEABLE" : rest.mergeable === false ? "CONFLICTING" : "UNKNOWN",
    mergeStateStatus: (rest.mergeable_state ?? "unknown").toUpperCase(),
    headRefOid: rest.head.sha,
  };
}
