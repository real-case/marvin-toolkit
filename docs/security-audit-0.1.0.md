# Security audit — 0.1.0 release

**Date:** 2026-07-01 · **Branch:** `chore/release-0.1.0` · **Scope:** dependencies, secrets
(tree + full git history), and a static review of the MCP server source
(`plugins/marvin/mcp/server/src/`). This is the pre-release re-audit called for in
[publishing.md §2.4](./publishing.md) (the prior umbrella scan ran 2026-06-16, fixed in
[#33](https://github.com/real-case/marvin-toolkit/pull/33)).

## Result: clean — safe to ship at 0.1.0

| Area | Method | Result |
|------|--------|--------|
| Dependencies | `npm audit` (workspaces) | **0 vulnerabilities** after the fix below |
| Secrets (tree) | pattern sweep for keys/tokens/private keys | none |
| Secrets (history) | scan for ever-committed `.env`/`.pem`/`.key`/… | none |
| Server attack surface | static review of all 20 `src/*.ts` | clean; one documented boundary |

## Dependencies — one transitive advisory, resolved

`npm audit` flagged **1 high** in `hono` (`<=4.12.24`, GHSA-wwfh-h76j-fc44 and siblings).

- **Origin:** transitive — `hono` ← `@hono/node-server` ← `@modelcontextprotocol/sdk@1.29.0`
  (the SDK's HTTP/SSE transport). Not a direct dependency.
- **Reachability:** the marvin server uses the **stdio** transport only. `hono` is
  **tree-shaken out of the shipped bundle** — `grep -c hono dist/server.js` → **0**. The
  vulnerable code paths (serve-static, CORS middleware, Lambda adapters) are never bundled
  or invoked. Not exploitable in marvin.
- **Fix (hygiene):** added an `overrides` pin `"hono": "^4.12.27"` in the root
  `package.json` (consistent with the existing `esbuild` override) and re-resolved. `npm ls
  hono` → `4.12.27`; `npm audit` → **0 vulnerabilities**. Kept clean rather than merely
  documented, because a security toolkit should pass its own scanners.

## Secrets

- Working tree swept for AWS keys, private-key blocks, Slack/GitHub/OpenAI/Google token
  formats — **no matches**.
- Full git history checked for any added `.env` / `.pem` / `.key` / `.p12` / keystore file —
  **none ever committed**.

## Static review of the server (independent reviewer)

Reviewed by the `marvin-auditor` security reviewer against the classes that matter for a
local stdio server that shells out and reads files by path:

- **Command / argument injection — clean.** Every `git` / `gh` call in `lib/git.ts` uses
  `spawnSync` / `execFileSync` with **array args and no shell**; user/spec-controlled strings
  (title, branch, base, tracker id) are discrete argv elements, never a shell string.
- **Path traversal — clean.** All storage paths are `join(<known dir>, <name>)` where `<name>`
  comes from `slugify` (strips to `[a-z0-9-]`) or a regex-validated 3-digit id;
  `resolveSpecBySlug` regex-escapes the slug and only returns paths found by `readdirSync`
  inside the target dir.
- **Unsafe parsing — clean.** All `yaml.parse` uses the library default schema (frontmatter
  uses the stricter `failsafe`) behind zod `safeParse`; no custom tags, `eval`, or `Function`.
  Every `JSON.parse` is on server-authored blocks or wrapped in try/catch with a zod fallback.
- **`verify` shell boundary — as documented.** The single `shell: true` site (`verify.ts`)
  runs only the project's **declared** gates (`.marvin/config.json`, `package.json` scripts,
  `Makefile` targets) — the accepted trust boundary in
  [ADR-0015](./adr/0015-verify-shell-trust-boundary.md) / [SECURITY.md](../SECURITY.md).
  Confirmed **not wider** than documented.

## Residual hardening — post-0.1.0 backlog (non-blocking)

Info/Low items, none reachable by an external attacker against a local stdio server:

- `config.base_branch` is an unconstrained `z.string()` reaching `git`/`gh` as an arg — cannot
  inject a shell command (array arg) and occupies option-value/positional slots; optional:
  constrain to a branch-name charset.
- `verify` buffers gate stdout/stderr without a cap — a runaway user-declared gate could OOM
  the server (self-inflicted, local). Optional: cap the retained tail.
- `spec` / `summary` will read a caller-supplied absolute path (read-only, validated) — same
  trust tier as choosing which repo to run marvin in.
