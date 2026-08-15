import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for finding identity and the triage baseline (ADR-0038):
 * `fingerprintFinding` in `src/lib/reports.ts` and the whole of
 * `src/lib/triage.ts`. Both are pure over their inputs plus one small JSON
 * file, so the suite drives synthetic envelopes and tmp-dir fixtures with a
 * pinned clock — compiled via `_tsload.mjs`, no server build, the same
 * convention `report-parse.test.mjs` follows.
 */
const reports = await importTs("src/lib/reports.ts");
const triage = await importTs("src/lib/triage.ts");
const envmod = await importTs("src/lib/env.ts");
// The published contract itself, so "the payload validates" is asserted against
// the schema the widget is handed rather than against a restatement of it.
const { ReportFinding } = await import("@marvin-toolkit/mcp-shared/contracts");

const NOW = Date.parse("2026-07-16T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const withDir = (fn) => async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-triage-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A findings-bodied envelope — the only shape the reconciliation looks at. */
function envelope({ id, group = "security", path = id, generatedAt, findings }) {
  return {
    id,
    group,
    kind: "findings",
    title: id,
    path,
    generatedBy: group === "security" ? "sec-scan" : "refactor-audit",
    generatedAt,
    stale: false,
    summary: { kind: "findings", counts: { critical: 0, high: 0, medium: 0, low: 0 } },
    body: { findings },
    links: [],
  };
}

/** A finding carrying only what the reconciliation reads. */
const finding = (fingerprint, extra = {}) => ({
  id: `F-${fingerprint.slice(0, 4)}`,
  severity: "high",
  title: `finding ${fingerprint}`,
  fingerprint,
  ...extra,
});

const entry = (fingerprint, { firstSeen, lastSeen, present }) => ({
  fingerprint,
  firstSeen,
  lastSeen,
  present,
});

/** Build an ADR-0029 register body whose single row points at `file:line`. */
const register = (title, file, line) =>
  [
    "# Refactoring audit — core",
    "",
    "| ID | Title | Severity | Effort | Evidence | Direction |",
    "|----|-------|----------|--------|----------|-----------|",
    `| F1 | ${title} | high | medium | \`${file}:${line}\` | Split it |`,
    "",
  ].join("\n");

/** A `.marvin/security/` report: prose plus the typed `audit-report` block. */
const secReport = (kind, findings) =>
  [
    "# Security report",
    "",
    "Prose.",
    "",
    "```json audit-report",
    JSON.stringify({ kind, scanned_at: "2026-07-14T10:00:00Z", summary: { high: 1 }, findings }),
    "```",
    "",
  ].join("\n");

/** Write a report and pin its mtime — an envelope's `generatedAt` is the mtime. */
function writeAt(dir, filename, content, mtimeMs) {
  const path = join(dir, filename);
  writeFileSync(path, content);
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

// ── AC1: identity ────────────────────────────────────────────────────────────

test("a fingerprint survives a line-number change and discriminates on each of its four inputs", () => {
  // The real parser, not a hand-built finding: an unrelated insertion above the
  // finding moves its evidence from :12 to :40 and nothing else changes.
  const [before] = reports.parseRegisterFindings(
    register("God module", "src/core.ts", 12),
    "audit",
  );
  const [after] = reports.parseRegisterFindings(register("God module", "src/core.ts", 40), "audit");
  assert.equal(before.line, 12);
  assert.equal(after.line, 40, "the row really did move");
  assert.equal(
    after.fingerprint,
    before.fingerprint,
    "a line-number change must not mint a new identity",
  );
  assert.match(before.fingerprint, /^[0-9a-f]{16}$/, "16 hex chars");

  // …and each of the four inputs does discriminate.
  const base = {
    kind: "scan",
    file: "src/auth/login.ts",
    category: "OWASP A05:2025",
    title: "SQL injection in login handler",
  };
  const fp = reports.fingerprintFinding(base);
  assert.equal(reports.fingerprintFinding({ ...base }), fp, "stable for equal input");
  for (const [field, value] of [
    ["kind", "secrets"],
    ["file", "src/auth/logout.ts"],
    ["category", "OWASP A01:2025"],
    ["title", "SQL injection in signup handler"],
  ]) {
    assert.notEqual(
      reports.fingerprintFinding({ ...base, [field]: value }),
      fp,
      `${field} must discriminate`,
    );
  }

  // Path normalisation is part of the identity, not of the caller's discipline.
  assert.equal(reports.fingerprintFinding({ ...base, file: "./src/auth/login.ts" }), fp);
});

// ── AC3: the three states plus the resolved roll-up ─────────────────────────

test("reconciliation classifies new, persisting and regressed and reports resolved as a roll-up", () => {
  const baseline = [
    entry("aaaa", { firstSeen: iso(NOW - 9 * DAY_MS), lastSeen: iso(NOW - DAY_MS), present: true }),
    entry("bbbb", {
      firstSeen: iso(NOW - 30 * DAY_MS),
      lastSeen: iso(NOW - 10 * DAY_MS),
      present: false,
    }),
    entry("cccc", {
      firstSeen: iso(NOW - 20 * DAY_MS),
      lastSeen: iso(NOW - 2 * DAY_MS),
      present: true,
    }),
  ];
  const live = [
    envelope({
      id: ".marvin/security/scan-report.md",
      generatedAt: iso(NOW - 2 * DAY_MS),
      findings: [finding("aaaa"), finding("bbbb"), finding("dddd")],
    }),
  ];

  const { envelopes, resolved } = triage.reconcile(live, baseline, NOW);
  const byFp = Object.fromEntries(envelopes[0].body.findings.map((f) => [f.fingerprint, f]));

  assert.equal(byFp.aaaa.state, "persisting");
  assert.equal(byFp.bbbb.state, "regressed", "present:false in the baseline means it came back");
  assert.equal(byFp.dddd.state, "new");
  assert.equal(byFp.dddd.firstSeen, iso(NOW - 2 * DAY_MS), "firstSeen is the report's generatedAt");
  assert.equal(byFp.aaaa.firstSeen, iso(NOW - 9 * DAY_MS), "a known finding keeps its firstSeen");

  // `resolved` is a roll-up only: no finding carries it, because no row is left.
  assert.deepEqual(
    resolved.map((e) => e.fingerprint),
    ["cccc"],
  );
  for (const f of envelopes[0].body.findings) {
    assert.notEqual(f.state, "resolved");
  }
  assert.deepEqual(
    [...triage.liveFingerprints(live)].sort(),
    ["aaaa", "bbbb", "dddd"],
    "the live set is what the roll-up is computed against",
  );
});

// ── AC10: the round trip that makes `regressed` reachable ───────────────────

test(
  "a fingerprint that disappears and returns round-trips through the written baseline as regressed",
  withDir((dir) => {
    const path = join(dir, "triage.json");
    const present = [
      envelope({
        id: ".marvin/security/scan-report.md",
        generatedAt: iso(NOW - 5 * DAY_MS),
        findings: [finding("f00d")],
      }),
    ];
    const absent = [
      envelope({ id: ".marvin/security/scan-report.md", generatedAt: iso(NOW), findings: [] }),
    ];

    // 1. first snapshot — the finding is new, stamped from the report's mtime
    triage.ensureTriageDir(dir);
    triage.writeBaseline(path, triage.nextBaseline(present, triage.readBaseline(path), NOW), NOW);
    const first = triage.readBaseline(path);
    assert.deepEqual(
      first.map((e) => [e.fingerprint, e.present]),
      [["f00d", true]],
    );
    const stampedFirstSeen = first[0].firstSeen;
    assert.equal(stampedFirstSeen, iso(NOW - 5 * DAY_MS));

    // 2. it is fixed and disappears — RETAINED, not dropped
    const later = NOW + DAY_MS;
    triage.writeBaseline(path, triage.nextBaseline(absent, first, later), later);
    const second = triage.readBaseline(path);
    assert.deepEqual(
      second.map((e) => [e.fingerprint, e.present]),
      [["f00d", false]],
      "dropping the absent entry here is what makes `regressed` unreachable",
    );
    assert.equal(second[0].firstSeen, stampedFirstSeen, "firstSeen survives the disappearance");

    // 3. it comes back — and the state is `regressed`, not `new`
    const laterStill = NOW + 2 * DAY_MS;
    const returned = [
      envelope({
        id: ".marvin/security/scan-report.md",
        generatedAt: iso(laterStill),
        findings: [finding("f00d")],
      }),
    ];
    const { envelopes, resolved } = triage.reconcile(returned, second, laterStill);
    const [back] = envelopes[0].body.findings;
    assert.equal(back.state, "regressed");
    assert.equal(back.firstSeen, stampedFirstSeen, "still the FIRST snapshot's value");
    assert.deepEqual(resolved, []);
  }),
);

// ── AC13: the refactor live set ─────────────────────────────────────────────

test("only the newest refactor register per kind and slug is live and duplicate fingerprints collapse", () => {
  const older = envelope({
    id: ".marvin/refactor/001-audit-core.md",
    path: ".marvin/refactor/001-audit-core.md",
    group: "refactor",
    generatedAt: iso(NOW - 10 * DAY_MS),
    findings: [finding("keep"), finding("gone")],
  });
  const newer = envelope({
    id: ".marvin/refactor/004-audit-core.md",
    path: ".marvin/refactor/004-audit-core.md",
    group: "refactor",
    generatedAt: iso(NOW - DAY_MS),
    findings: [finding("keep")],
  });
  // A different (kind, slug) is a different lineage and stays live on its own.
  const smells = envelope({
    id: ".marvin/refactor/002-smells-api.md",
    path: ".marvin/refactor/002-smells-api.md",
    group: "refactor",
    generatedAt: iso(NOW - 8 * DAY_MS),
    findings: [finding("smel")],
  });

  const envelopes = [newer, smells, older];
  // `gone` is absent: it lives only in the superseded register, which is not
  // current state. `smel` is present: a different (kind, slug) is its own
  // lineage and is not superseded by a higher number under another slug.
  assert.deepEqual([...triage.liveFingerprints(envelopes)].sort(), ["keep", "smel"]);

  const baseline = [
    entry("keep", {
      firstSeen: iso(NOW - 20 * DAY_MS),
      lastSeen: iso(NOW - DAY_MS),
      present: true,
    }),
    entry("gone", {
      firstSeen: iso(NOW - 20 * DAY_MS),
      lastSeen: iso(NOW - 10 * DAY_MS),
      present: true,
    }),
  ];
  const reconciled = triage.reconcile(envelopes, baseline, NOW);

  const byId = Object.fromEntries(reconciled.envelopes.map((e) => [e.id, e]));
  assert.equal(byId[".marvin/refactor/004-audit-core.md"].body.findings[0].state, "persisting");
  assert.equal(
    byId[".marvin/refactor/002-smells-api.md"].body.findings[0].state,
    "new",
    "the other lineage is live and reconciled on its own",
  );
  for (const f of byId[".marvin/refactor/001-audit-core.md"].body.findings) {
    assert.equal(f.state, undefined, "a superseded register is left unreconciled, not relabelled");
    assert.equal(f.firstSeen, undefined);
  }
  assert.deepEqual(
    reconciled.resolved.map((e) => e.fingerprint),
    ["gone"],
    "a finding the newest register dropped is resolved, not persisting forever",
  );

  // …and one identity present in two registers enters the baseline exactly once.
  const next = triage.nextBaseline(envelopes, [], NOW);
  assert.deepEqual(
    next.map((e) => e.fingerprint).sort(),
    ["keep", "smel"],
    "no duplicate row for a fingerprint carried by two registers",
  );
  assert.equal(
    next.find((e) => e.fingerprint === "keep").firstSeen,
    iso(NOW - DAY_MS),
    "the newest-first winner supplies the attestation",
  );
});

// ── the security live set: a `fix` record is not current state ──────────────

test(
  "a sec-fix record never enters the live set, so a closed vulnerability is not re-reported forever",
  withDir((dir) => {
    // Real files through the real assembly, not hand-built envelopes: the
    // exclusion keys off `generatedBy`, which only `scanSecurityReports`
    // writes, so a synthetic envelope would prove the comparison and not the
    // coupling it depends on.
    writeAt(
      dir,
      "scan-report.md",
      secReport("scan", [
        {
          id: "SCAN-1",
          severity: "high",
          title: "SQL injection in login handler",
          category: "OWASP A05:2025",
          file: "src/auth/login.ts",
        },
      ]),
      NOW - 3 * DAY_MS,
    );
    // Two of them, both NEWER than the scan: `sec-fix` writes one accumulating
    // `fix-<slug>.md` per vulnerability and no run supersedes an earlier one,
    // which is why the exclusion is by kind and filename scoping would not help.
    writeAt(
      dir,
      "fix-sqli.md",
      secReport("fix", [
        {
          id: "FIX-1",
          severity: "critical",
          title: "SQL injection in user lookup",
          category: "OWASP A05:2025",
          file: "src/db/users.ts",
        },
      ]),
      NOW - 2 * DAY_MS,
    );
    writeAt(
      dir,
      "fix-xss.md",
      secReport("fix", [
        {
          id: "FIX-1",
          severity: "high",
          title: "Reflected XSS in search",
          category: "OWASP A03:2025",
          file: "src/web/search.ts",
        },
      ]),
      NOW - DAY_MS,
    );

    const { reports: envelopes, notes } = reports.scanSecurityReports(dir, { now: NOW });
    assert.deepEqual(notes, [], "all three parse");
    assert.equal(envelopes.length, 3, "and all three stay listed — the exclusion is triage-only");

    const scan = envelopes.find((e) => e.id.endsWith("scan-report.md"));
    const fixes = envelopes.filter((e) => e.generatedBy === "sec-fix");
    assert.equal(fixes.length, 2, "the assembly marks a fix record on generatedBy");
    const open = scan.body.findings[0].fingerprint;

    assert.deepEqual(
      [...triage.liveFingerprints(envelopes)],
      [open],
      "only the scan's open finding is live — a record of what was CLOSED is not current state",
    );

    const baseline = [
      entry(open, {
        firstSeen: iso(NOW - 20 * DAY_MS),
        lastSeen: iso(NOW - 3 * DAY_MS),
        present: true,
      }),
    ];
    const { envelopes: annotated, resolved } = triage.reconcile(envelopes, baseline, NOW);
    const byId = Object.fromEntries(annotated.map((e) => [e.id, e]));

    assert.equal(
      byId[scan.id].body.findings[0].state,
      "persisting",
      "the real finding still reconciles — two newer fix records do not displace it",
    );
    assert.deepEqual(resolved, [], "and nothing is falsely declared resolved");

    for (const fix of fixes) {
      for (const f of byId[fix.id].body.findings) {
        assert.equal(f.state, undefined, `${fix.id} is left unreconciled, not relabelled`);
        assert.equal(f.firstSeen, undefined, `${fix.id} carries no firstSeen`);
      }
    }

    // The baseline is the reason this matters twice over: a fix fingerprint
    // recorded once would report `new` on that pass and `persisting` on every
    // pass after it, with `resolved` unreachable for a vulnerability that is
    // already closed.
    assert.deepEqual(
      triage.nextBaseline(envelopes, baseline, NOW).map((e) => e.fingerprint),
      [open],
      "no fix-record identity is ever remembered",
    );
  }),
);

// ── AC5: the directory, the env override and the untouched .gitignore ───────

test(
  "the baseline directory ignores itself, honours MARVIN_REPORT_DIR and never overwrites a customised gitignore",
  withDir((root) => {
    const reportDir = join(root, "elsewhere");
    assert.equal(
      envmod.loadEnv({ CLAUDE_PROJECT_DIR: root, MARVIN_REPORT_DIR: reportDir }).reportDir,
      reportDir,
      "the override wins",
    );
    assert.equal(
      envmod.loadEnv({ CLAUDE_PROJECT_DIR: root }).reportDir,
      join(root, ".marvin", "report"),
      "and the default is <projectDir>/.marvin/report",
    );

    const path = join(reportDir, "triage.json");
    const live = [
      envelope({
        id: ".marvin/security/scan-report.md",
        generatedAt: iso(NOW - DAY_MS),
        findings: [finding("beef")],
      }),
    ];

    triage.ensureTriageDir(reportDir);
    triage.writeBaseline(path, triage.nextBaseline(live, [], NOW), NOW);
    assert.equal(readFileSync(join(reportDir, ".gitignore"), "utf8"), "*\n");
    assert.equal(triage.readBaseline(path).length, 1);

    // a host customised the ignore file — the second run must leave it alone
    writeFileSync(join(reportDir, ".gitignore"), "# mine\n*\n!keep-me\n");
    const later = NOW + DAY_MS;
    triage.ensureTriageDir(reportDir);
    triage.writeBaseline(path, triage.nextBaseline(live, triage.readBaseline(path), later), later);

    assert.equal(
      readFileSync(join(reportDir, ".gitignore"), "utf8"),
      "# mine\n*\n!keep-me\n",
      "a customised .gitignore is byte-identical after a second write",
    );
    const rewritten = triage.readBaseline(path);
    assert.equal(rewritten.length, 1, "the baseline was rewritten, not appended to");
    assert.equal(rewritten[0].lastSeen, iso(later));
    assert.equal(rewritten[0].firstSeen, iso(NOW - DAY_MS), "firstSeen is not refreshed");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 1, "always stamped version 1");
  }),
);

// ── the zero-state doctrine on read ─────────────────────────────────────────

test(
  "a missing, corrupt, symlinked or unrecognised-version baseline reads empty, never throws",
  withDir((dir) => {
    assert.deepEqual(triage.readBaseline(join(dir, "nope.json")), [], "missing");

    const path = join(dir, "triage.json");
    writeFileSync(path, "{ not json");
    assert.deepEqual(triage.readBaseline(path), [], "not JSON");

    writeFileSync(path, JSON.stringify({ version: 1, findings: [{ fingerprint: "x" }] }));
    assert.deepEqual(triage.readBaseline(path), [], "schema-invalid entry");

    // A stamp that is a non-empty string but NOT a datetime. `reconcile` copies
    // `firstSeen` verbatim onto a finding and `ReportFinding.firstSeen` is
    // declared `z.string().datetime()`, so a baseline validated as free text
    // would let a hand-edited file put `"yesterday"` into `structuredContent` —
    // a payload failing the tool's OWN published schema, with nothing
    // re-validating it on the way out. It reads as empty instead, the same
    // answer every other corruption gets.
    for (const bad of [
      { firstSeen: "yesterday", lastSeen: iso(NOW) },
      { firstSeen: iso(NOW), lastSeen: "2026-07-16" },
    ]) {
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          updatedAt: iso(NOW),
          findings: [entry("aaaa", { ...bad, present: true })],
        }),
      );
      assert.deepEqual(
        triage.readBaseline(path),
        [],
        `a non-datetime stamp reads empty: ${JSON.stringify(bad)}`,
      );
    }

    // …and the reconciliation therefore cannot emit one: the finding is `new`
    // with a contract-shaped `firstSeen` taken from the report itself.
    const { envelopes } = triage.reconcile(
      [
        envelope({
          id: ".marvin/security/scan-report.md",
          generatedAt: iso(NOW - DAY_MS),
          findings: [finding("aaaa")],
        }),
      ],
      triage.readBaseline(path),
      NOW,
    );
    const [emitted] = envelopes[0].body.findings;
    assert.equal(emitted.state, "new");
    assert.ok(
      ReportFinding.safeParse(emitted).success,
      "what the tool emits validates against the published contract",
    );

    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        updatedAt: iso(NOW),
        findings: [entry("aaaa", { firstSeen: iso(NOW), lastSeen: iso(NOW), present: true })],
      }),
    );
    assert.deepEqual(
      triage.readBaseline(path),
      [],
      "an unrecognised version is a deliberate reset, not a parse error",
    );

    // and the version that IS recognised round-trips
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        updatedAt: iso(NOW),
        findings: [entry("aaaa", { firstSeen: iso(NOW), lastSeen: iso(NOW), present: true })],
      }),
    );
    assert.equal(triage.readBaseline(path).length, 1);

    // a planted symlink is skipped outright, exactly as `readMdFiles` skips one:
    // an out-of-tree file must not become this project's triage history.
    const planted = join(dir, "planted.json");
    symlinkSync(path, planted);
    assert.deepEqual(triage.readBaseline(planted), []);
  }),
);

test(
  "ensureTriageDir is idempotent and creates nothing until it is called",
  withDir((root) => {
    const dir = join(root, "report");
    assert.equal(existsSync(dir), false);
    triage.ensureTriageDir(dir);
    triage.ensureTriageDir(dir);
    assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "*\n");
  }),
);
