import type { AuditListPayload } from "@marvin-toolkit/mcp-shared/contracts";

// The fence marker as a const so the fixture's markdown can nest code blocks
// without backtick-escaping gymnastics inside template strings.
const FENCE = "```";

/**
 * A representative AuditListPayload (ADR-0024 #7) shared by the tests and the
 * story. Three reports across scanner kinds carry six findings spanning all five
 * severities in scrambled order — so the severity sort is a real assertion, not a
 * tautology (the critical finding lives in the second report; the two highs are in
 * different reports so the scanned_at tie-break is exercised). Findings carry
 * evidence/remediation markdown (inline + fenced code, bold) and external + ref
 * LinkRefs. Timestamps are fixed literals (no Date.now()) so snapshots stay
 * deterministic. `summary` is carried verbatim; the widget counts findings itself.
 */
export const auditListFixture: AuditListPayload = {
  reports: [
    {
      kind: "scan",
      scanned_at: "2026-07-05T09:00:00.000Z",
      target: "acme-api",
      summary: { critical: 0, high: 1, medium: 0, low: 1, info: 1 },
      findings: [
        {
          id: "SCAN-1",
          severity: "high",
          title: "SQL injection in the login handler",
          category: "OWASP A03:2025",
          file: "src/auth/login.ts",
          line: 42,
          evidence: [
            "The handler interpolates the request body straight into SQL:",
            "",
            FENCE + "ts",
            "db.query(`SELECT * FROM users WHERE email = '${email}'`);",
            FENCE,
          ].join("\n"),
          remediation: "Use a **parameterized query** — `db.query(sql, [email])`.",
          links: [
            {
              kind: "external",
              label: "OWASP A03:2025 — Injection",
              url: "https://owasp.org/Top10/A03_2021-Injection/",
            },
          ],
        },
        {
          id: "SCAN-2",
          severity: "low",
          title: "Session cookie missing SameSite",
          category: "OWASP A05:2025",
          file: "src/server.ts",
          line: 88,
          remediation: "Set `SameSite=Lax` on the session cookie.",
        },
        {
          id: "SCAN-3",
          severity: "info",
          title: "Unused dependency left-pad",
          category: "CWE-1104",
          remediation: "Remove the unused dependency.",
        },
      ],
    },
    {
      kind: "secrets",
      scanned_at: "2026-07-06T14:30:00.000Z",
      target: "acme-api",
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      findings: [
        {
          id: "SEC-1",
          severity: "critical",
          title: "AWS secret key committed to the repo",
          category: "CWE-798",
          file: ".env.example",
          line: 3,
          evidence: [
            "A tracked file exposes a long-lived key:",
            "",
            FENCE,
            "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE",
            FENCE,
          ].join("\n"),
          remediation:
            "**Rotate** the key immediately and purge it from history with `git filter-repo`.",
          links: [
            {
              kind: "external",
              label: "CWE-798 — Hard-coded Credentials",
              url: "https://cwe.mitre.org/data/definitions/798.html",
            },
            {
              kind: "adr",
              label: "ADR-0002 verification gate",
              ref: "0002-tool-backed-verification",
            },
          ],
        },
      ],
    },
    {
      kind: "deps",
      scanned_at: "2026-07-04T08:15:00.000Z",
      target: "acme-web",
      summary: { critical: 0, high: 1, medium: 1, low: 0, info: 0 },
      findings: [
        {
          id: "DEP-1",
          severity: "medium",
          title: "lodash 4.17.15 has a prototype-pollution CVE",
          category: "CVE-2020-8203",
          file: "package.json",
          line: 21,
          evidence: "`lodash` is pinned to 4.17.15; the fix landed in 4.17.19.",
          remediation: "Bump `lodash` to `>=4.17.21`.",
          links: [
            {
              kind: "external",
              label: "CVE-2020-8203",
              url: "https://nvd.nist.gov/vuln/detail/CVE-2020-8203",
            },
          ],
        },
        {
          id: "DEP-2",
          severity: "high",
          title: "minimist ReDoS reachable through a transitive dep",
          category: "CVE-2021-44906",
          remediation: "Add a resolutions override pinning `minimist` to `>=1.2.6`.",
        },
      ],
    },
  ],
};

/** Degraded empty — nothing has been scanned yet; the widget prompts a sec-* run. */
export const emptyAuditFixture: AuditListPayload = { reports: [] };

/**
 * Positive empty — two reports (different scanners, different days) with zero
 * findings each: the "all clear" state, distinct from "never scanned".
 */
export const cleanAuditFixture: AuditListPayload = {
  reports: [
    {
      kind: "secrets",
      scanned_at: "2026-07-06T10:00:00.000Z",
      target: "acme-api",
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
    },
    {
      kind: "ci",
      scanned_at: "2026-07-07T16:45:00.000Z",
      target: "acme-api",
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
    },
  ],
};

/**
 * A finding carrying ONLY the required fields — no file/line/evidence/
 * remediation/links, and no report `target` — so the detail pane degrades to
 * just Category/Scanner/Scanned rows with no empty sections or dangling labels.
 */
export const minimalFindingFixture: AuditListPayload = {
  reports: [
    {
      kind: "threat-model",
      scanned_at: "2026-07-03T11:20:00.000Z",
      summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
      findings: [
        {
          id: "TM-1",
          severity: "medium",
          title: "Kanban board files are world-readable on shared checkouts",
          category: "STRIDE — Information Disclosure",
        },
      ],
    },
  ],
};

/**
 * One finding whose evidence and remediation exercise the heavy end of the
 * `<Markdown>` GFM subset — fenced code, nested prose, ordered + bullet lists
 * and a table — so the detail pane's long-form layout is a real screenshot.
 */
export const longEvidenceFixture: AuditListPayload = {
  reports: [
    {
      kind: "pentest",
      scanned_at: "2026-07-08T18:05:00.000Z",
      target: "acme-api",
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      findings: [
        {
          id: "PEN-1",
          severity: "critical",
          title: "IDOR on /api/tasks/:id lets any user read any board task",
          category: "OWASP A01:2025",
          file: "src/routes/tasks.ts",
          line: 57,
          evidence: [
            "The handler loads the task by id without an ownership check:",
            "",
            FENCE + "ts",
            'router.get("/api/tasks/:id", async (req, res) => {',
            "  const task = await db.tasks.findById(req.params.id);",
            "  res.json(task); // no owner / team scoping",
            "});",
            FENCE,
            "",
            "Reproduced against staging with two accounts:",
            "",
            "1. Log in as `alice@acme.dev` and create task `1042`.",
            "2. Log in as `mallory@acme.dev` (no shared team).",
            "3. `GET /api/tasks/1042` returns Alice's task body — **200**, not 403/404.",
            "",
            "Observed responses:",
            "",
            "| Requester | Task | Expected | Actual |",
            "| --- | --- | --- | --- |",
            "| alice | 1042 | 200 | 200 |",
            "| mallory | 1042 | 403 | 200 |",
            "| anonymous | 1042 | 401 | 401 |",
          ].join("\n"),
          remediation: [
            "Scope every task read to the requesting principal:",
            "",
            "- Add `owner_id` (or `team_id`) to the `tasks` query predicate.",
            "- Return **404** (not 403) for foreign ids so existence does not leak.",
            "- Backfill a regression test per row of the table above.",
            "",
            FENCE + "ts",
            "const task = await db.tasks.findOne({ id: req.params.id, team_id: req.user.team_id });",
            "if (!task) return res.status(404).end();",
            FENCE,
          ].join("\n"),
          links: [
            {
              kind: "external",
              label: "OWASP A01:2025 — Broken Access Control",
              url: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
            },
          ],
        },
      ],
    },
  ],
};
