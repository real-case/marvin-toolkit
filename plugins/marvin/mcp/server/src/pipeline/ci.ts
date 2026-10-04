import { execFileSync, execSync } from "node:child_process";

export type CiState = "green" | "red" | "pending" | "conflict" | "no_ci" | "closed";
interface Pr {
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
  const pr = JSON.parse(
    gh("pr", "view", o.prUrl, "--json", "state,mergeable,mergeStateStatus,headRefOid,headRefName"),
  ) as Pr & { headRefName: string };
  const runs = JSON.parse(
    gh(
      "api",
      `repos/{owner}/{repo}/actions/runs?branch=${encodeURIComponent(pr.headRefName)}&per_page=50`,
      "--jq",
      ".workflow_runs",
    ),
  ) as WorkflowRun[];
  return { pr, runs };
}
