/**
 * secret-guard — Hook B of ADR-0040. A blocking `PreToolUse` guard on the `Bash`
 * matcher that scans the added lines of the commit a `git commit` call is about to
 * create, and refuses on a credential-shaped match.
 *
 * EXIT 0 IS EVERYTHING ELSE, including every internal error. See `lib/hook-io.mjs`
 * for the two reasons that contract is right (noise at the hottest call site, and
 * keeping exit 2 reachable only deliberately).
 *
 * THE DENY PAYLOAD NEVER ECHOES THE MATCHED TEXT. This guard lives near credentials
 * by definition; one that copied a secret into a transcript would be a net loss. It
 * names a pattern id and a `file:line`, and nothing else.
 */

import {
  ALLOW,
  deny,
  gitDir,
  gitSubcommand,
  hasShortFlag,
  hooksEnabled,
  isMain,
  main,
  readPayload,
  runGit,
  splitSegments,
  tokenize,
} from "./lib/hook-io.mjs";

const HOOK_NAME = "secret-guard";

/**
 * The canonical secret-pattern list. `skills/sec-gate/SKILL.md` mirrors it in a fenced
 * `secret-patterns` block, and `test/hook-surface.test.mjs` asserts parity in both
 * directions — the skill and the hook must never report differently on the same diff.
 *
 * EVERY PATTERN IS ANCHORED AND CARRIES A SHAPE OR LENGTH REQUIREMENT. Bare prefixes
 * are not compatible with the low-false-positive constraint this list inherits from
 * the skill, and the proof is in this repository: `sk-` is a substring of the literal
 * `task-start`, which appears in nearly every commit marvin makes. A guard that blocks
 * routine commits gets switched off, and then protects nothing.
 *
 * NO KEY BODY ADMITS `-`. Anchoring alone is not enough, because a word boundary is
 * only as strong as the character before it: `\bsk-[A-Za-z0-9_-]{20,}` does not match
 * inside `task-workflow-latency-optimization` — a real slug in this repository's own
 * ADRs — but does match the same slug after a bullet or a path separator, where the
 * boundary is satisfied. A kebab-case identifier is not a key shape, so the three
 * patterns that admitted `-` (openai, gitlab, slack) now take an alphanumeric body,
 * `_` surviving only in GitLab's, whose issued tokens use it. Each keeps matching a
 * real credential: an OpenAI key is alphanumeric, a GitLab token is twenty
 * base64url-ish characters, and a Slack token's leading segment alone is ten or more
 * digits. Where a real token carries a hyphen the pattern now misses it — a
 * fail-open, the same direction as every other unresolved case here, never a wrong
 * deny.
 *
 * Regexes are stored as strings because the mirrored block in the skill is JSON.
 */
export const SECRET_PATTERNS = [
  {
    id: "aws-access-key-id",
    regex: "\\bAKIA[0-9A-Z]{16}\\b",
    note: "AWS access key id",
  },
  {
    id: "google-api-key",
    regex: "\\bAIza[0-9A-Za-z_-]{35}\\b",
    note: "Google API key",
  },
  {
    id: "github-token",
    regex: "\\bgh[pousr]_[A-Za-z0-9]{36}\\b",
    note: "GitHub personal access, OAuth, server or refresh token",
  },
  {
    id: "gitlab-token",
    regex: "\\bglpat-[A-Za-z0-9_]{20}\\b",
    note: "GitLab personal access token",
  },
  {
    id: "openai-key",
    regex: "\\bsk-[A-Za-z0-9]{20,}\\b",
    note: "OpenAI-style secret key",
  },
  {
    id: "stripe-live-key",
    regex: "\\bsk_live_[A-Za-z0-9]{24,}\\b",
    note: "Stripe live secret key",
  },
  {
    id: "slack-token",
    regex: "\\bxox[abprs]-[A-Za-z0-9]{10,}\\b",
    note: "Slack bot, app, user or refresh token",
  },
  {
    id: "sendgrid-key",
    regex: "\\bSG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}\\b",
    note: "SendGrid API key",
  },
  {
    id: "azure-storage-key",
    regex: "\\bAccountKey=[A-Za-z0-9+/]{64,}={0,2}",
    note: "Azure storage account key",
  },
  {
    id: "private-key-header",
    regex: "-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----",
    note: "PEM private key header",
  },
  {
    id: "credentialed-uri",
    regex:
      "\\b(?:mysql|postgres|postgresql|mongodb|redis|amqp)(?:\\+srv)?://[^\\s:/@]+:[^\\s:/@]+@",
    note: "connection string carrying an inline password",
  },
];

/**
 * Matched strings that are PUBLISHED example credentials, and so are not secrets.
 *
 * AWS suffixes every example credential in its own documentation with `EXAMPLE`, and
 * `AKIAIOSFODNN7EXAMPLE` is the canonical one — it appears in AWS's guides, in every
 * tutorial that copies them, in test fixtures, and in this repository's own audit
 * widget fixture, which was the only match in the whole tracked tree. Denying it
 * blocks whoever next edits such a fixture, with the kill switch as their only way
 * through, which is exactly how a guard gets switched off for good.
 *
 * It is a SHAPE rather than a list of literals because the convention is the suffix,
 * not the individual id: `AKIAI44QH8DHBEXAMPLE` and every other example AWS prints is
 * covered without an edit. It costs nothing — an issued key ends in those seven
 * characters roughly once in 36^7 — and it stays narrow, since only this one pattern
 * has a documented example convention to honour.
 *
 * The exemption is deliberately per-MATCH rather than per-line: a line that carries
 * an example id AND a real key is still denied, on the real one.
 */
export const EXEMPT_MATCHES = [/^AKIA[0-9A-Z]{9}EXAMPLE$/];

/**
 * True when a matched string is a published example rather than a credential.
 *
 * @param {string} matched The pattern's matched text, never the whole line.
 * @returns {boolean}
 */
export function isExemptMatch(matched) {
  return EXEMPT_MATCHES.some((re) => re.test(matched));
}

/** The flags every diff runs with, whichever branch resolved the pending set. */
const DIFF_FLAGS = ["--unified=0", "--no-color", "--no-ext-diff"];

/**
 * The commit flags that mean "simulate": `--dry-run`, plus the three output formats
 * git documents as implying it. Each creates no commit and writes nothing.
 */
const DRY_RUN_FLAGS = new Set(["--dry-run", "--short", "--porcelain", "--long"]);

/**
 * Resolve WHAT "pending" means for this invocation, as the git argv to run.
 *
 * Three branches, one git call each:
 *   `-a` / `--all` / a bundle containing `a` → `git diff HEAD`, which is tracked files
 *      with index and worktree together — precisely what that flag commits, and it
 *      also covers a staged new file, since a staged file is tracked.
 *   tokens after a bare `--`                 → `git diff HEAD -- <paths>`
 *   everything else                          → `git diff --cached`
 *
 * WHY ONLY A BARE `--` MARKS A PATHSPEC. The obvious rule — "positional tokens after
 * the subcommand are paths" — is wrong on the product's own commit form. In
 * `git commit -m "fix auth"` the token `fix auth` is positional, so that rule yields
 * `git diff HEAD -- "fix auth"`, git fails on an unknown path, the call returns null,
 * and the guard fails open on the most common commit in the product. An
 * option-argument table would close that case and rot on the next flag added to git;
 * `--` is a property of git's own grammar and cannot rot.
 *
 * Its cost is a named false NEGATIVE: `git commit src/foo.ts` scans the index rather
 * than that path. That is a fail-open under the same contract as every other
 * unresolved case, never a wrong deny. `existsSync` as the pathspec test would close
 * it without a table, but misreads `git commit -F msg.txt` and `git commit -t
 * template.txt`, whose values are real existing files — trading a fail-open for a
 * scan of the wrong set is not an improvement.
 *
 * `--amend` changes nothing here: the lines a commit ADDS are the same set either way.
 *
 * A DRY RUN IS NOT SCANNED AT ALL. `git commit --dry-run` — and `--short`,
 * `--porcelain` and `--long`, each of which git documents as implying it — creates no
 * commit and writes nothing, so there is no pending set to guard and nothing a deny
 * could prevent. It is the same exemption Hook A makes for `git push --dry-run`, and
 * it matters more here: inspecting what a commit WOULD contain is the first thing a
 * user reaches for after this guard blocks them, and a guard that also blocks the
 * inspection leaves them with the kill switch as their only move.
 *
 * @param {Array<{text: string, quoted: boolean}>} tokens One segment's tokens.
 * @returns {string[] | null} The git argv, or null when the segment is not a commit.
 */
export function pendingDiffArgs(tokens) {
  const sub = gitSubcommand(tokens);
  if (sub === null || sub.name !== "commit") return null;

  const after = tokens.slice(sub.index + 1);
  const flags = after.filter((t) => !t.quoted).map((t) => t.text);

  // Quoted tokens are excluded above, so `git commit -m "--dry-run"` is still scanned.
  if (flags.some((f) => DRY_RUN_FLAGS.has(f))) return null;

  // `-a` is read through the SHARED bundle helper, never a second copy of the rule:
  // what `-am` means must be one decision, or the two guards drift on it. The helper
  // also stops at an attached value, so `git commit -Cabc` is not read as `-a`.
  if (flags.includes("--all") || hasShortFlag(flags, "commit", "a")) {
    return ["diff", "HEAD", ...DIFF_FLAGS];
  }

  // The separator itself must be an UNQUOTED token: a quoted `--` is message text.
  const separator = after.findIndex((t) => !t.quoted && t.text === "--");
  if (separator !== -1) {
    const paths = after.slice(separator + 1).map((t) => t.text);
    if (paths.length > 0) return ["diff", "HEAD", ...DIFF_FLAGS, "--", ...paths];
  }

  return ["diff", "--cached", ...DIFF_FLAGS];
}

/**
 * Scan a unified diff's ADDED lines and return every pattern match with its file and
 * new-side line number, taken from the `+++ b/` and `@@` headers so a deny can be
 * precise. Deleted lines are not a new risk and are not scanned.
 *
 * Total by construction: a malformed or truncated header costs its hunk, never a
 * throw. `main` would catch a throw and allow, but a guard that silently stops
 * scanning on the first odd header is a worse failure than one that skips a hunk.
 *
 * Each pattern is compiled global and every match on a line is examined, so a
 * published example (`isExemptMatch`) is skipped rather than ending the line's scan:
 * one exempt match must not hide a real credential beside it.
 *
 * @param {string} diffText
 * @returns {Array<{id: string, file: string, line: number}>}
 */
export function scanAddedLines(diffText) {
  if (typeof diffText !== "string" || diffText === "") return [];
  const compiled = SECRET_PATTERNS.map((pattern) => {
    try {
      return { id: pattern.id, re: new RegExp(pattern.regex, "g") };
    } catch {
      return null;
    }
  }).filter(Boolean);

  const findings = [];
  let file = "(unknown)";
  let lineNumber = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      file = path === "/dev/null" ? "(deleted)" : path.replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("diff --git ")) continue;
    if (line.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      lineNumber = match ? Number(match[1]) : 0;
      continue;
    }
    if (line.startsWith("+")) {
      const added = line.slice(1);
      for (const { id, re } of compiled) {
        for (const match of added.matchAll(re)) {
          if (isExemptMatch(match[0])) continue;
          findings.push({ id, file, line: lineNumber });
          break;
        }
      }
      lineNumber += 1;
      continue;
    }
    // A context line advances the new-side counter; a deletion does not. With
    // `--unified=0` there are no context lines, but a caller may pass any diff.
    if (line.startsWith(" ")) lineNumber += 1;
  }
  return findings;
}

// ── the guard ───────────────────────────────────────────────────────────────

function run() {
  const payload = readPayload();
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || command === "") return ALLOW;

  // The substring gate, before any tokenizing. `Bash` is the hottest tool call in the
  // product and this hook is on that path unconditionally.
  if (!command.includes("git") || !command.includes("commit")) return ALLOW;

  const projectDir = gitDir(payload, null);
  if (!hooksEnabled(projectDir)) return ALLOW;

  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    const args = pendingDiffArgs(tokens);
    if (args === null) continue;

    // Every git call runs in the directory the commit would land in, so
    // `git -C sub commit -a` scans the repository it would actually commit to.
    const cwd = gitDir(payload, gitSubcommand(tokens).chdir);
    const diff = runGit(args, cwd);
    if (diff === null) continue;

    const findings = scanAddedLines(diff);
    if (findings.length === 0) continue;

    const seen = new Set();
    const detail = [];
    for (const finding of findings) {
      const key = `${finding.id}\u0000${finding.file}\u0000${finding.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      detail.push(`${finding.id} at ${finding.file}:${finding.line}`);
    }
    // The FIRST line is the payload contract, so it carries a pattern id and a
    // file:line rather than a count. Any further sites follow it.
    return deny(HOOK_NAME, [
      `credential-shaped string in the lines this commit would add — ${detail[0]}`,
      ...detail.slice(1).map((site) => `  also ${site}`),
      "The matched values are deliberately not printed. Remove them, then rotate the credential.",
    ]);
  }

  return ALLOW;
}

if (isMain(import.meta.url)) main(HOOK_NAME, run);
