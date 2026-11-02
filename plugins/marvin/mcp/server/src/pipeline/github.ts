/**
 * GitHub through its REST API only. A Claude Code cloud session refuses GraphQL ("GitHub GraphQL
 * is not available from Claude Code sessions; use the REST API", probe of 2026-11-02), and every
 * `gh pr view|create|checks|diff` is a GraphQL call, so the engine reads and writes pull requests
 * through `gh api` everywhere, local runs included, to keep one code path. The one action with no
 * REST form is marking a draft ready (`gh pr ready`); `runtime.ts` tries it and reports a refusal.
 */

/** Runs `gh` with `args` and returns its stdout; throws when it fails. */
export type Gh = (...args: string[]) => string;

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** The repository and number of a pull request URL as `gh` and GitHub print it, or null. */
export function parsePrUrl(url: string): PrRef | null {
  const m = /^https?:\/\/[^/]+\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(url.trim());
  if (!m) return null;
  const number = Number(m[3]);
  return Number.isInteger(number) && number > 0 ? { owner: m[1]!, repo: m[2]!, number } : null;
}

/** `parsePrUrl`, or a throw naming the URL. */
export function prRef(url: string): PrRef {
  const ref = parsePrUrl(url);
  if (ref === null) throw new Error(`not a pull request URL: ${url}`);
  return ref;
}

/** The `repos/<owner>/<repo>` prefix of every REST path about that pull request's repository. */
export function repoPath(ref: PrRef): string {
  return `repos/${ref.owner}/${ref.repo}`;
}

/** The pull request as `GET repos/{owner}/{repo}/pulls/{n}` returns it, the fields used here. */
export interface RestPull {
  state: string;
  merged: boolean;
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  head: { sha: string; ref: string };
  base: { ref: string };
  changed_files?: number;
  additions?: number;
  deletions?: number;
}

export function fetchPull(gh: Gh, ref: PrRef): RestPull {
  return JSON.parse(gh("api", `${repoPath(ref)}/pulls/${ref.number}`)) as RestPull;
}
