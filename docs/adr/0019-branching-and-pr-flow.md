# ADR 0019 — Branching model: release `main`, integration `dev`, changes via PRs

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-21                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0014](0014-distribution-release-model.md) (release = tag on `main`), `CONTRIBUTING.md`, `CLAUDE.md`, `.github/workflows/release.yml`, `.github/workflows/validate-plugins.yml` |

> Formalizes the branch topology and the PR-only rule. Day-to-day work already happens on
> short-lived topic branches (`feat/*`, `fix/*`, `chore/*`); this records `dev` as the
> integration base they branch from and `main` as a release-only branch.

## Context

Today `main` is the only long-lived branch (`origin/HEAD → main`). Topic branches open PRs
directly into `main`, and release tags ([ADR-0014](0014-distribution-release-model.md):
`git tag vX.Y.Z && git push`) are cut from it. That conflates two roles in one ref:

- **"latest integrated work"** — where in-progress features land and are validated together, and
- **"the released, tagged state"** — what `.github/workflows/release.yml` turns into a GitHub Release.

With both on `main`, every merged feature sits on the same branch a release tag is cut from, there
is no buffer to accumulate and validate a batch of changes before it becomes a release candidate,
and nothing structural guarantees `main` only ever moves through a reviewed, CI-passing change.

## Decision

**Run two long-lived branches — `main` (release) and `dev` (integration) — and move either one
only through a merged pull request.**

- **`main` — release branch.** Updated *only* by merging a `dev → main` pull request (a release
  promotion). Protected: no direct pushes, no force-pushes. Each release is a `vX.Y.Z` tag cut on
  `main`, which triggers `.github/workflows/release.yml` ([ADR-0014](0014-distribution-release-model.md)).
  `main` therefore always reflects the most recently released state.
- **`dev` — integration branch.** The repository's default branch and the base for all topic PRs.
  Kept green (CI passes) and never behind `main`.
- **Topic branches.** Short-lived `feat/*`, `fix/*`, `chore/*`, `docs/*`, `sec/*` branches cut from
  `dev`, merged back into `dev` through a reviewed PR. No direct commits to `dev` or `main`.
- **Releasing.** Open a `dev → main` PR, merge it, then tag `vX.Y.Z` on `main`. Hotfixes branch
  from `main`, PR into `main`, and are immediately back-merged into `dev` so the fix is not lost on
  the next promotion.
- **Everything is a PR.** There is no path to advance either long-lived branch except a merged,
  CI-passing pull request. The PR is the single enforcement point for review, the marvin
  verify / scope / delivery gates, and the security checks.

## Consequences

### Positive

- `main` is always a clean, releasable, tagged history: `git log main` reads as the release
  timeline, and ADR-0014's tag trigger fires only on intentional promotions, not on every feature.
- `dev` provides an integration buffer — features accumulate and are validated together before
  becoming a release candidate; a risky merge never lands directly on the release branch.
- PR-only movement makes review, CI (`validate-plugins.yml`), and the marvin gates a hard
  precondition for every change to either branch; nothing reaches `main` unreviewed.
- Minimal disruption: the topic-branch habit already in the repo (`feat/*`, `fix/*`, `chore/*`) is
  unchanged — only the base branch (`dev`) and the explicit release-promotion step are new.

### Negative / accepted trade-offs

- Two long-lived branches cost more than trunk-based development: each release is an extra
  `dev → main` PR, and the branches diverge if promotion lags. Mitigate by promoting often and
  keeping releases small.
- Hotfixes require a back-merge into `dev`, an explicit and easy-to-forget step; skipping it
  regresses the fix on the next promotion.
- Adopting the model needs repo/remote settings this ADR does not apply itself: the repository's
  **default branch** must move to `dev`, and both long-lived branches need protection (no direct
  pushes; a merged, green-CI PR required). The in-repo docs that this change ships — `CONTRIBUTING.md`
  and `CLAUDE.md` — already direct contributors to branch off `dev` and target it. (The marvin tool's
  own `base_branch` default is already `dev` —
  `plugins/marvin/mcp/server/src/storage/schema.ts` — so projects that adopt marvin get dev-based PR
  creation consistent with this model.)
