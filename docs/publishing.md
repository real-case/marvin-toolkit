# Publishing & promotion readiness

The working checklist and step-by-step plan for shipping **Marvin** beyond this
repository — to Anthropic's official plugin directory and the community
marketplaces — without compromising the quality and security bar the toolkit
itself preaches.

**Distribution model.** Marvin installs through the Claude Code _plugin
marketplace_ mechanism (a git repo + `marketplace.json`), **not** npm. A release
is a git tag → GitHub Release (see [.github/workflows/release.yml](../.github/workflows/release.yml)).
The bundled MCP server is an implementation detail of the plugin — it is **not**
published as a standalone package, which is why the official MCP registry is out
of scope (see §1).

> Status legend: `[x]` done (verified in repo), `[ ]` to do, `[~]` partly done or
> decision needed. Snapshot last refreshed 2026-07-08, right after the release was cut.

> **✅ v0.1.0 released 2026-07-08.** `dev` was promoted to `main` as merge-commit
> `541b53a` (promotion PR #95), tagged `v0.1.0`, and `release.yml` published the GitHub
> Release [marvin v0.1.0](https://github.com/real-case/marvin-toolkit/releases/tag/v0.1.0)
> with notes from the plugin changelog. What remains is **publication**: making the repo
> public, then the official-directory submission (§2.7) and the community listings and
> announcement (§2.8) — all gated on Admin access the release account does not have.

---

## 1. Where to publish (channels, prioritized)

| Tier | Channel | Why | Effort |
| ---- | ------- | --- | ------ |
| Canonical | **This repo** (`real-case/marvin-toolkit`) | Source of truth; everything below points back here. Install: `/plugin marketplace add real-case/marvin-toolkit`. | already live |
| **1 — primary** | **Anthropic official directory** — [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) | Built into Claude Code (`/plugin → Discover`) and claude.com/plugins. Highest legitimate reach **and** the strongest portfolio/credibility signal. Has a quality + security approval bar. Submit via the [plugin directory submission form](https://clau.de/plugin-directory-submission); approved plugins land in `/external_plugins` and install as `/plugin install marvin@claude-plugins-official`. | one form, gated on §2 |
| **2 — near-free** | Community aggregators — [claudemarketplaces.com](https://claudemarketplaces.com/), [claudepluginhub.com](https://www.claudepluginhub.com/marketplaces), [aitmpl.com/plugins](https://www.aitmpl.com/plugins/); PR to [ananddtyagi/cc-marketplace](https://github.com/ananddtyagi/cc-marketplace) and any `awesome-claude-code` list | Most **auto-index GitHub daily** and rank by stars / install count / votes. The lever is not "where to submit" but **repo discoverability** (topics, README, demo). | mostly metadata (§2.5) |
| **Skip** | Official **MCP registry** ([modelcontextprotocol.io](https://modelcontextprotocol.io/registry/about)) | Catalogs _standalone-published_ servers (npm/PyPI/Docker). Marvin's server is bundled inside the plugin and intentionally not on npm → the registry model does not fit. Revisit only if the server is ever split into an independently installable artifact. | n/a |

**Multi-homing is correct and cheap** because the repo stays the single source and
every listing merely points to it. Do not fork or duplicate `marketplace.json`
across sites — publish once, list everywhere.

---

## 2. Requirements checklist

### 2.1 Repository hygiene & legal

- [x] `LICENSE` (MIT) at repo root
- [x] License declared in `plugin.json`, `marketplace.json`, and `package.json`
- [x] No secrets or build artifacts tracked — `.env*`, `node_modules/`, `.idea/`, `.vscode/`, `coverage/` are gitignored; the only committed `dist/` is the required `plugins/*/mcp/server/dist/` (verified clean)
- [ ] Repository is **public** — currently **private**; making it public is Admin-only (the release account has WRITE) and is required before the official-directory submission
- [x] `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md` present
- [x] Issue templates (bug / feature / config) + PR template
- [x] Dependabot configured (`.github/dependabot.yml`)

### 2.2 Manifest & plugin correctness

- [x] `marketplace.json` valid — single `marvin` plugin, `category: productivity`, rich `keywords`
- [x] `plugin.json` — `name`, `description`, `homepage`, `repository`, `license` all set
- [x] `dist/server.js` committed (Claude Code install does not run `npm install`)
- [ ] `claude plugin validate .` passes **locally** (CI runs it `continue-on-error`; make it a hard pre-submit check)
- [x] **Release line decision** — **`0.1.0`**, the first public release. Reset from the internal `2.0.0-alpha` line (which tracked the four-pack → single-plugin consolidation, never a shipped 1.x) to an honest pre-1.0 start — see [ADR-0001](./adr/0001-single-plugin-consolidation.md).
- [x] Version parity at `0.1.0` across `plugin.json`, `marketplace.json` (`plugins[0].version` **and** `metadata.version`), `mcp/server/package.json`, the server `VERSION` constant, and the root `package.json`

### 2.3 Quality gates / CI

- [x] CI (`validate-plugins.yml`) on Node 20 + 22: manifests, docs-drift, ESLint, Prettier, build, test, coverage, `verify-dist`, MCP stdio smoke-test
- [x] Release workflow (`release.yml`) — tag `v*` → GitHub Release with notes from `plugins/marvin/CHANGELOG.md`
- [x] CI **green on `main`** at the release commit — `validate-plugins.yml` passed on `main` at `541b53a` (Node 20 + 22)
- [x] All gates pass before tagging — verified in CI on promotion PR #95 and again on `main` at `541b53a`; the equivalent local run is:
  ```shell
  npm run lint && npm run format:check && npm run lint:manifests \
    && npm run lint:docs && npm run build && npm run test \
    && node scripts/verify-dist.mjs
  ```

### 2.4 Security self-audit — _eat your own dog food_

The official directory has a security bar, and a security toolkit that fails its
own scanners is the worst possible first impression. Ran Marvin against Marvin on
2026-06-16 (`sec-scan` umbrella) — **0 critical / 0 high**; findings were
supply-chain hardening, fixed in [#33](https://github.com/real-case/marvin-toolkit/pull/33).
**Re-audited for the 0.1.0 cut (2026-07-01):** `npm audit` **0 vulnerabilities** (a
non-shipped transitive `hono` advisory pinned out via an override), secrets clean (tree +
history), server static-review clean — full record in
[security-audit-0.1.0.md](./security-audit-0.1.0.md). The 2026-06-16 detail:

- [x] `/marvin:sec-secrets` — full git history + tracked files: **no secrets**
- [x] `/marvin:sec-scan` — OWASP pass over the MCP server: clean (safe `yaml.parse` / `JSON.parse`, git via arg-arrays, no `eval`); the only exec is `verify`'s `shell:true` gate runner — a documented trust boundary (`SECURITY.md`)
- [x] `/marvin:sec-deps` (`npm audit`) — **0 vulnerabilities**
- [x] `/marvin:sec-ci` — workflows audited; **Actions SHA-pinned** (`checkout` / `setup-node` @v4, `action-gh-release` @v2) — #33
- [x] Least-privilege `permissions: contents: read` added to `validate-plugins.yml` (`release.yml` already scoped `contents: write`) — #33
- [x] Bonus finding: the bundled **context7** MCP pinned to `@upstash/context7-mcp@3.2.1` (was an unpinned `npx -y`) — #33

### 2.5 Discoverability metadata — the promotion lever for auto-indexers

- [x] **GitHub topics** — 13 set (drives the community aggregators):
      `claude`, `claude-code`, `claude-code-plugin`, `claude-plugin`, `claude-code-marketplace`, `mcp`, `model-context-protocol`, `anthropic`, `ai`, `developer-tools`, `devsecops`, `security`, `devops`
- [x] **Homepage URL** — set to the repo URL as a placeholder; upgrade to a GitHub Pages / docs site when one exists
- [x] GitHub repo description set
- [ ] **Demo asset** — a short GIF / asciinema / screenshot in the README. None today; high-leverage for both humans and aggregator ranking. Show one flow end-to-end (e.g. `/marvin:task-start` or `/marvin:commit`)
- [x] README has badges, copy-paste install, command tables, security + contributing links

### 2.6 Release artifact

- [x] `plugins/marvin/CHANGELOG.md` has a `## [0.1.0]` section for the release version (the workflow extracts notes from it)
- [x] Tag pushed → GitHub Release auto-created — `v0.1.0` on `541b53a`; `release.yml` ran green (17s)
- [x] **`v0.1.0` is the first tag/release** (the earlier v0.3.0 / v0.6.0 were deleted and no longer exist); the [Release page](https://github.com/real-case/marvin-toolkit/releases/tag/v0.1.0) renders its notes correctly from the plugin changelog, and it is neither a draft nor a prerelease

### 2.7 Official directory submission

- [ ] Quality + security bar met (§2.1–§2.6)
- [ ] Submit the [plugin directory submission form](https://clau.de/plugin-directory-submission)
- [ ] Have ready: plugin name (`marvin`), repo URL, install command, category (`productivity`), short + long description, maintainer contact
- [ ] After approval: confirm `/plugin install marvin@claude-plugins-official` works and the Discover entry looks right

### 2.8 Community listings & announcement

- [ ] Confirm/seed listings on claudemarketplaces.com, claudepluginhub.com, aitmpl.com (auto-index — topics from §2.5 do most of the work)
- [ ] PR to `ananddtyagi/cc-marketplace` and any `awesome-claude-code` list
- [ ] Announce: Anthropic / Claude Developers Discord, r/ClaudeAI, X/Twitter, a dev.to or blog write-up; optionally Show HN

---

## 3. Exhaustive preparation plan (ordered)

### Phase 0 — Decide the release line _(decision, do first)_

**Decided: `0.1.0`** — the first public release (reset from the internal `2.0.0-alpha`
line; see ADR-0001). Everything downstream (version bump, changelog, tag, form) keys off
this number.

### Phase 1 — Green build + security self-audit

1. Run the full local gate (§2.3 block). Fix anything red.
2. Run the four `sec-*` self-scans (§2.4). Triage findings; rotate anything real.
3. Pin GitHub Actions by SHA and add least-privilege `permissions:` (§2.4).
4. `claude plugin validate .` → must pass.

### Phase 2 — Discoverability polish

```shell
# Topics (the aggregator lever)
gh repo edit real-case/marvin-toolkit \
  --add-topic claude --add-topic claude-code --add-topic claude-code-plugin \
  --add-topic claude-plugin --add-topic claude-code-marketplace \
  --add-topic mcp --add-topic model-context-protocol --add-topic anthropic \
  --add-topic ai --add-topic developer-tools --add-topic devsecops \
  --add-topic security --add-topic devops

# Homepage
gh repo edit real-case/marvin-toolkit \
  --homepage "https://github.com/real-case/marvin-toolkit"
```

5. Record a short demo (asciinema/GIF) of one flow; embed it near the top of the README.

### Phase 3 — Cut the release ✅ _(done 2026-07-08)_

**Done:** the docs rewrite merged (PR #94, `076622a`), then promotion PR #95 (`dev → main`)
merged as merge-commit `541b53a`, the `v0.1.0` tag was pushed, and the GitHub Release went
live. The numbered steps below record the process that was followed.

6. Add a `## [0.1.0]` section to `plugins/marvin/CHANGELOG.md` (the release workflow reads it).
7. Bump to `0.1.0` in `plugins/marvin/.claude-plugin/plugin.json`,
   `.claude-plugin/marketplace.json` (`plugins[0].version` + `metadata.version`), `plugins/marvin/mcp/server/package.json`, the server `VERSION` constant, and the root `package.json`.
8. Rebuild + re-verify the committed artifact:
   ```shell
   npm run build && node scripts/verify-dist.mjs
   ```
9. Merge to `main`, then tag from `main`:
   ```shell
   git tag v0.1.0 && git push origin v0.1.0
   ```
10. Confirm the GitHub Release was created with correct notes.

### Phase 4 — Submit to the official directory

11. Submit the [form](https://clau.de/plugin-directory-submission) with the §2.7 details.
12. Respond to any review feedback; on approval, verify the `@claude-plugins-official` install path.

### Phase 5 — Community listings

13. PR `ananddtyagi/cc-marketplace` + relevant `awesome-*` lists; verify the auto-indexers picked up the topics.

### Phase 6 — Announce

14. Post to the channels in §2.8. Lead with the demo and the one-line hook
    ("Claude Code toolkit for those who don't panic").

### Phase 7 — Post-publish operations

- Keep `dist/server.js` in sync on **every** server change — CI `verify-dist` enforces it; a drifted artifact ships broken.
- Semver discipline: patch = prompt/body tweaks, minor = new prompt/tool/agent, major = breaking (server key / prompt rename / schema break).
- Each release = changelog section → version bump (×3) → tag. The workflow does the rest.
- Watch issues/Discussions; the trust disclaimer means users scrutinize what the MCP server does — keep it auditable.

---

## 4. Definition of done (published)

_The release milestone was reached on 2026-07-08; full publication still depends on the
Admin-gated public-repo flip and the directory and community steps below._

- [x] Stable `v0.1.0` tag + GitHub Release live; CI green on that commit (`541b53a`).
- [x] All `sec-*` self-scans clean; Actions pinned by SHA; workflow permissions least-privilege.
- [~] GitHub topics + homepage set (done); README still needs a demo.
- [ ] `claude plugin validate .` passes as a hard pre-submit check.
- [ ] Official-directory form submitted (and, once approved, `@claude-plugins-official` install verified).
- [ ] At least the community-aggregator listings confirmed and one announcement posted.

---

## References

- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) — official directory + `external_plugins` mechanism
- [Plugin directory submission form](https://clau.de/plugin-directory-submission)
- [Discover and install plugins — Claude Code Docs](https://code.claude.com/docs/en/discover-plugins)
- [Create and distribute a marketplace — Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces)
- [The MCP Registry](https://modelcontextprotocol.io/registry/about)
- Internal: [ADR-0001 single-plugin consolidation](./adr/0001-single-plugin-consolidation.md), [release workflow](../.github/workflows/release.yml), [CONTRIBUTING](../CONTRIBUTING.md)
