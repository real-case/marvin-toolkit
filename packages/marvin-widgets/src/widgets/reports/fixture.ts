import type { ReportListPayload } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * Representative `ReportListPayload` fixtures shared by the tests and stories,
 * mirroring the approved mockup's content: three security reports (one stale),
 * a refactor register + plan, a green verification, and a spec + handoff
 * document — every body kind, every group, truncation, deep-link and the
 * degraded/positive empty shapes. Timestamps are fixed literals against
 * {@link REPORTS_NOW} (no `Date.now()`), so ages ("5h", "2d", "9d") and visual
 * snapshots are deterministic.
 *
 * Note the summary counts deliberately EXCEED the embedded findings where
 * `truncated` is set — the summary covers the whole source file, the body only
 * carries its head. `computeKpis` must therefore trust summaries, not bodies.
 */

/** The pinned clock every test/story passes as the view's `now`. */
export const REPORTS_NOW = Date.parse("2026-07-16T12:00:00.000Z");

export const reportsFixture: ReportListPayload = {
  reports: [
    {
      id: ".marvin/task/verification.md",
      group: "task",
      kind: "checks",
      title: "Verification",
      path: ".marvin/task/verification.md",
      generatedBy: "task-verify",
      generatedAt: "2026-07-16T07:00:00.000Z", // 5h
      stale: false,
      summary: { kind: "checks", done: 4, total: 4, failed: 0 },
      body: {
        checks: [
          { name: "test", status: "pass", note: "186 passed · 41s" },
          { name: "lint", status: "pass", note: "0 warnings · 12s" },
          { name: "typecheck", status: "pass", note: "9s" },
          { name: "build", status: "pass", note: "dist in sync · 18s" },
        ],
      },
      links: [],
      rerunCommand: "/marvin:task-verify",
    },
    {
      id: ".marvin/security/scan-report.md",
      group: "security",
      kind: "findings",
      title: "Security scan",
      path: ".marvin/security/scan-report.md",
      generatedBy: "sec-scan",
      generatedAt: "2026-07-14T12:00:00.000Z", // 2d
      stale: false,
      // 19 findings in the file: the 6 below + 13 truncated.
      summary: { kind: "findings", counts: { critical: 2, high: 5, medium: 8, low: 4 } },
      body: {
        findings: [
          {
            id: "F1",
            severity: "critical",
            title: "Command injection in exec wrapper",
            category: "CWE-78",
            file: "lib/exec.ts",
            line: 42,
            evidence:
              "execSync(`git ${userArg}`) — an elicitation-supplied argument reaches the shell unescaped.",
            fixCommand: "/marvin:sec-fix scan F1",
            links: [
              {
                kind: "external",
                label: "CWE-78",
                url: "https://cwe.mitre.org/data/definitions/78.html",
              },
            ],
          },
          {
            id: "F2",
            severity: "critical",
            title: "Hardcoded token in test fixture",
            category: "CWE-798",
            file: "tests/fixtures/env.ts",
            line: 7,
            evidence: 'GH_TOKEN="ghp_…" committed in a fixture; rotation is unconfirmed.',
            fixCommand: "/marvin:sec-fix scan F2",
          },
          {
            id: "F3",
            severity: "high",
            title: "Path traversal in file resolver",
            category: "CWE-22",
            file: "storage/resolve.ts",
            line: 118,
            evidence: "join(root, slug) — the slug is never normalized.",
            fixCommand: "/marvin:sec-fix scan F3",
          },
          {
            id: "F4",
            severity: "high",
            title: "Unvalidated redirect in PR flow",
            category: "CWE-601",
            file: "flows/pr.ts",
            line: 64,
            evidence: "tracker_url_template accepts any scheme — no allowlist.",
            fixCommand: "/marvin:sec-fix scan F4",
            links: [{ kind: "adr", label: "ADR-0023 pr-* family", ref: "0023-pr-command-family" }],
          },
          {
            id: "F5",
            severity: "high",
            title: "zod schema passes unknown keys",
            category: "CWE-20",
            file: "tools/task.ts",
            line: 33,
            evidence: ".passthrough() on the config-write path.",
            fixCommand: "/marvin:sec-fix scan F5",
          },
          {
            id: "F6",
            severity: "medium",
            title: "No size cap on rotated usage log",
            category: "CWE-400",
            file: "lib/usage.ts",
            line: 51,
            evidence: "events.jsonl.1 grows without a size cap.",
            fixCommand: "/marvin:sec-fix scan F6",
          },
        ],
        truncated: 13,
      },
      links: [],
      rerunCommand: "/marvin:sec-scan",
    },
    {
      id: ".marvin/security/secrets-report.md",
      group: "security",
      kind: "findings",
      title: "Secrets scan",
      path: ".marvin/security/secrets-report.md",
      generatedBy: "sec-secrets",
      generatedAt: "2026-07-14T10:00:00.000Z", // 2d
      stale: false,
      summary: { kind: "findings", counts: { critical: 0, high: 1, medium: 2, low: 0 } },
      body: {
        findings: [
          {
            id: "F1",
            severity: "high",
            title: "AWS key pattern in git history",
            category: "CWE-540",
            file: ".env.bak",
            evidence: "AKIA… in a deleted .env.bak; the file is gone, the history is not.",
            fixCommand: "/marvin:sec-fix secrets F1",
          },
          {
            id: "F2",
            severity: "medium",
            title: "Slack webhook in docs example",
            category: "CWE-540",
            file: "docs/hooks.md",
            line: 88,
            evidence: "hooks.slack.com/services/T… pasted into an example block.",
            fixCommand: "/marvin:sec-fix secrets F2",
          },
          {
            id: "F3",
            severity: "medium",
            title: "Entropy string in e2e seed",
            category: "CWE-540",
            file: "tests/e2e/seed.ts",
            line: 14,
            evidence: "A 32-char base64 string; probably a test value, unconfirmed.",
            fixCommand: "/marvin:sec-fix secrets F3",
          },
        ],
      },
      links: [],
      rerunCommand: "/marvin:sec-secrets",
    },
    {
      id: ".marvin/refactor/003-smells-api.md",
      group: "refactor",
      kind: "findings",
      title: "Smells: api layer",
      path: ".marvin/refactor/003-smells-api.md",
      generatedBy: "refactor-smells",
      generatedAt: "2026-07-13T12:00:00.000Z", // 3d
      stale: false,
      // 11 findings in the register: the 4 below + 7 truncated.
      summary: { kind: "findings", counts: { critical: 0, high: 4, medium: 5, low: 2 } },
      body: {
        findings: [
          {
            id: "F1",
            severity: "high",
            title: "God module: server.ts",
            file: "src/server.ts",
            line: 1,
            effort: "L",
            evidence: "1,200 lines carrying nine responsibilities.",
            direction: "extract registry/ and io/ modules",
          },
          {
            id: "F2",
            severity: "high",
            title: "Duplicated status roll-up",
            file: "tools/task.ts",
            line: 210,
            effort: "M",
            evidence: "The same roll-up lives in tracker.ts:88 and state.ts:31.",
            direction: "lift into contracts/ as a pure function",
          },
          {
            id: "F3",
            severity: "medium",
            title: "Boolean trap in elicit()",
            file: "lib/elicit.ts",
            line: 19,
            effort: "S",
            evidence: "A third positional boolean flips the call's semantics.",
            direction: "replace with an options object",
          },
          {
            id: "F4",
            severity: "medium",
            title: "Stringly-typed gate keys",
            file: "flows/verify.ts",
            line: 44,
            effort: "S",
            evidence: '"lint" | "test" appear as raw strings in six call sites.',
            direction: "union type plus a const map",
          },
        ],
        truncated: 7,
      },
      links: [],
      rerunCommand: "/marvin:refactor-smells",
    },
    {
      id: ".marvin/refactor/002-plan-storage.md",
      group: "refactor",
      kind: "checks",
      title: "Plan: storage split",
      path: ".marvin/refactor/002-plan-storage.md",
      generatedBy: "refactor-plan",
      generatedAt: "2026-07-10T12:00:00.000Z", // 6d
      stale: false,
      summary: { kind: "checks", done: 2, total: 6, failed: 0 },
      body: {
        checks: [
          { name: "Extract storage interface", status: "pass", note: "S · verified green" },
          { name: "Pin-down tests for task CRUD", status: "pass", note: "S · 14 tests" },
          { name: "Split file IO from board logic", status: "pending", note: "M · next" },
          { name: "Move config read to contracts", status: "pending", note: "S" },
          { name: "Kill circular import flows→storage", status: "pending", note: "M" },
          { name: "Delete legacy path aliases", status: "pending", note: "S · task pipeline" },
        ],
      },
      links: [],
      rerunCommand: "/marvin:refactor-plan",
    },
    {
      id: ".marvin/task/014-widget-family.md",
      group: "task",
      kind: "document",
      title: "Spec: widget family",
      path: ".marvin/task/014-widget-family.md",
      generatedBy: "task-start",
      generatedAt: "2026-07-08T12:00:00.000Z", // 8d
      stale: false,
      summary: { kind: "document", tag: "spec" },
      body: {
        markdown: [
          "## Goal",
          "",
          "One viewer for every document marvin generates: one envelope, three body kinds — findings, checks, document.",
          "",
          "## Acceptance criteria",
          "",
          "- AC1 — every `.marvin/` report opens in a single widget",
          "- AC2 — deep-link: a command pre-selects the report it produced",
          "- AC3 — the terminal fallback stays unchanged",
          "",
          "## Files",
          "",
          "`packages/marvin-widgets/src/widgets/reports/`, `contracts/report.ts`, `tools/report.ts`",
        ].join("\n"),
      },
      links: [],
    },
    {
      id: ".marvin/security/deps-report.md",
      group: "security",
      kind: "findings",
      title: "Dependency audit",
      path: ".marvin/security/deps-report.md",
      generatedBy: "sec-deps",
      generatedAt: "2026-07-07T12:00:00.000Z", // 9d — the one stale report
      stale: true,
      // 10 findings in the file: the 4 below + 6 truncated.
      summary: { kind: "findings", counts: { critical: 1, high: 5, medium: 3, low: 1 } },
      body: {
        findings: [
          {
            id: "F1",
            severity: "critical",
            title: "Prototype pollution in transitive lodash",
            category: "CVE-2024-3721",
            file: "package-lock.json",
            evidence: "lodash 4.17.19 via the storybook chain; fixed in 4.17.21.",
            fixCommand: "/marvin:sec-fix deps F1",
          },
          {
            id: "F2",
            severity: "high",
            title: "ReDoS in semver range parser",
            category: "CVE-2023-2588",
            file: "package-lock.json",
            evidence: "semver 7.3.x transitively; fixed in 7.5.2.",
            fixCommand: "/marvin:sec-fix deps F2",
          },
          {
            id: "F3",
            severity: "high",
            title: "Unpinned build plugin range",
            category: "supply chain",
            file: "packages/marvin-widgets/package.json",
            evidence: "A ^ range on a vite plugin — the build is not deterministic.",
            fixCommand: "/marvin:sec-fix deps F3",
          },
          {
            id: "F4",
            severity: "high",
            title: "Unmaintained transitive parser",
            category: "maintenance",
            file: "package-lock.json",
            evidence: "No release for three years; two open security issues.",
            fixCommand: "/marvin:sec-fix deps F4",
          },
        ],
        truncated: 6,
      },
      links: [],
      rerunCommand: "/marvin:sec-deps",
    },
    {
      id: ".marvin/handoff/007-release-prep.md",
      group: "handoff",
      kind: "document",
      title: "Handoff: release prep",
      path: ".marvin/handoff/007-release-prep.md",
      generatedBy: "handoff",
      generatedAt: "2026-07-04T12:00:00.000Z", // 12d — documents never go stale
      stale: false,
      summary: { kind: "document", tag: "handoff" },
      body: {
        markdown: [
          "## Context",
          "",
          "The release is held until ordered; dev accumulates. The widget family is complete.",
          "",
          "## Next steps",
          "",
          "- wait for the major-release order",
          "- dev→main strictly as a merge commit",
          "- tag vX.Y.Z → release.yml",
        ].join("\n"),
      },
      links: [],
    },
  ],
};

/** Deep-link variant — the payload pre-selects the spec document's row. */
export const deepLinkReportsFixture: ReportListPayload = {
  ...reportsFixture,
  selected: ".marvin/task/014-widget-family.md",
};

/** Degraded empty — nothing has been generated yet; the CTA offers the first scan. */
export const emptyReportsFixture: ReportListPayload = { reports: [] };

/** Positive empty — one clean findings report: the "All clear" detail state. */
export const cleanReportsFixture: ReportListPayload = {
  reports: [
    {
      id: ".marvin/security/secrets-report.md",
      group: "security",
      kind: "findings",
      title: "Secrets scan",
      path: ".marvin/security/secrets-report.md",
      generatedBy: "sec-secrets",
      generatedAt: "2026-07-16T10:00:00.000Z", // 2h
      stale: false,
      summary: { kind: "findings", counts: { critical: 0, high: 0, medium: 0, low: 0 } },
      body: { findings: [] },
      links: [],
      rerunCommand: "/marvin:sec-secrets",
    },
  ],
};

/** Red verification — the gates-failed state (fail pill, red rows, failure notes). */
export const gatesFailedFixture: ReportListPayload = {
  reports: [
    {
      id: ".marvin/task/verification.md",
      group: "task",
      kind: "checks",
      title: "Verification",
      path: ".marvin/task/verification.md",
      generatedBy: "task-verify",
      generatedAt: "2026-07-16T11:00:00.000Z", // 1h
      stale: false,
      summary: { kind: "checks", done: 2, total: 4, failed: 2 },
      body: {
        checks: [
          { name: "test", status: "pass", note: "186 passed · 41s" },
          { name: "lint", status: "fail", note: "7 errors" },
          { name: "typecheck", status: "pass", note: "9s" },
          { name: "build", status: "fail", note: "dist drift" },
        ],
      },
      links: [],
      rerunCommand: "/marvin:task-verify",
    },
  ],
};
