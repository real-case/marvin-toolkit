import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the `DashboardState` v2 digest readers (`src/lib/state.ts`)
 * that feed the dashboard's current-work, handoff and audit zones. The readers
 * are exercised directly (compiled via `_tsload.mjs`, the `report-parse.test.mjs`
 * precedent) against tmp-dir fixtures with a fixed `now`, so ages are exact
 * rather than clock-dependent; the registered stdio surface is covered
 * separately by `dashboard-structured.test.mjs`.
 */
const lib = await importTs("src/lib/state.ts");
const { Config } = await importTs("src/storage/schema.ts");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-16T12:00:00.000Z");
/** ISO timestamp `days` before {@link NOW}. */
const daysAgo = (days) => new Date(NOW - days * DAY_MS).toISOString();

/** The default status vocabulary (key == role, ADR-0026). */
const config = Config.parse({});

const withDir = (fn) => async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-digest-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Write a file and pin its mtime (audit ordering + ages are mtime-driven). */
function writeAt(dir, filename, content, mtimeMs) {
  const path = join(dir, filename);
  writeFileSync(path, content);
  if (mtimeMs !== undefined) utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
  return path;
}

/** One board task file (`readAllTasks` requires the `NNN-` filename prefix). */
function writeTask(dir, { id, status, title, updated }) {
  writeFileSync(
    join(dir, `${id}--task.md`),
    [
      "---",
      `id: '${id}'`,
      "type: feature",
      `status: ${status}`,
      `title: ${title}`,
      `branch: feat/${id}--task`,
      `created: ${daysAgo(30)}`,
      `updated: ${updated}`,
      "---",
      "Body.",
      "",
    ].join("\n"),
  );
}

/** One handoff document (`readAllHandoffs` validates the full frontmatter). */
function writeHandoff(dir, { id, slug, objective, created }) {
  writeFileSync(
    join(dir, `${id}-${slug}.md`),
    [
      "---",
      `id: '${id}'`,
      `slug: ${slug}`,
      `objective: ${objective}`,
      `branch: feat/${slug}`,
      `created: ${created}`,
      "---",
      "Body.",
      "",
    ].join("\n"),
  );
}

// ── AC1: boardDigest ────────────────────────────────────────────────────────

test(
  "boardDigest returns only wip and review cards, newest-updated first, capped at three",
  withDir(async (root) => {
    // five tasks across all four roles — updated order deliberately disagrees
    // with id order, so the sort key is provable
    const board = join(root, "board");
    mkdirSync(board, { recursive: true });
    writeTask(board, { id: "001", status: "todo", title: "Not started", updated: daysAgo(1) });
    writeTask(board, { id: "002", status: "wip", title: "In progress", updated: daysAgo(5) });
    writeTask(board, { id: "003", status: "done", title: "Finished", updated: daysAgo(0) });
    writeTask(board, { id: "004", status: "review", title: "In review", updated: daysAgo(2) });
    writeTask(board, { id: "005", status: "wip", title: "Also in progress", updated: daysAgo(9) });

    const cards = lib.boardDigest({ tasksDir: board }, config);
    assert.deepEqual(
      cards.map((c) => c.id),
      ["004", "002", "005"],
      "only the wip/review cards, newest `updated` first",
    );
    assert.deepEqual(
      cards.map((c) => c.status),
      [
        { key: "review", role: "review" },
        { key: "wip", role: "wip" },
        { key: "wip", role: "wip" },
      ],
      "cards carry the configured status key plus its role",
    );
    assert.equal(cards[0].title, "In review", "full TaskCards, not bare ids");

    // a fourth active card is dropped by the cap — the oldest `updated` loses
    const busy = join(root, "busy");
    mkdirSync(busy, { recursive: true });
    writeTask(busy, { id: "001", status: "wip", title: "Oldest active", updated: daysAgo(12) });
    writeTask(busy, { id: "002", status: "wip", title: "Third newest", updated: daysAgo(6) });
    writeTask(busy, { id: "003", status: "review", title: "Second newest", updated: daysAgo(3) });
    writeTask(busy, { id: "004", status: "review", title: "Newest", updated: daysAgo(1) });

    const capped = lib.boardDigest({ tasksDir: busy }, config);
    assert.equal(capped.length, lib.DIGEST_LIMIT, "capped at DIGEST_LIMIT");
    assert.deepEqual(
      capped.map((c) => c.id),
      ["004", "003", "002"],
      "the oldest active card is the one dropped",
    );

    // a missing board directory is an empty digest, never a throw
    assert.deepEqual(lib.boardDigest({ tasksDir: join(root, "nope") }, config), []);
  }),
);

// ── AC2: specDigest ─────────────────────────────────────────────────────────

test(
  "specDigest lists unshipped specs newest-first and skips verification.md and symlinks",
  withDir(async (root) => {
    const specs = join(root, ".marvin", "task");
    mkdirSync(specs, { recursive: true });
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });

    const spec = (slug, status, heading) =>
      ["---", `slug: ${slug}`, `status: ${status}`, "---", `# ${heading}`, "", "Body.", ""].join(
        "\n",
      );

    writeFileSync(join(specs, "001-first-shipped.md"), spec("first", "shipped", "First shipped"));
    writeFileSync(
      join(specs, "002-second-shipped.md"),
      spec("second", "shipped", "Second shipped"),
    );
    // frontmatter `slug` deliberately differs from the filename slug, so the
    // identity rule (frontmatter wins) is pinned rather than coincidental
    writeFileSync(
      join(specs, "003-in-flight.md"),
      spec("in-flight-spec", "ready", "An unshipped spec"),
    );
    // no frontmatter at all — a missing `status` counts as in flight, and the
    // filename slug is the fallback identity
    writeFileSync(join(specs, "004-no-status.md"), "# A status-less spec\n\nBody.\n");
    writeFileSync(join(specs, "verification.md"), "# Verification\n");
    // a planted symlink whose id would otherwise sort it first
    writeFileSync(join(outside, "secret.md"), spec("secret", "ready", "Out of tree"));
    symlinkSync(join(outside, "secret.md"), join(specs, "005-linked.md"));

    assert.deepEqual(lib.specDigest(root), [
      { slug: "no-status", title: "A status-less spec", id: "004" },
      { slug: "in-flight-spec", title: "An unshipped spec", id: "003" },
    ]);

    // a fourth in-flight spec is dropped by the cap — the lowest id loses
    const many = join(root, "many", ".marvin", "task");
    mkdirSync(many, { recursive: true });
    for (const id of ["001", "002", "003", "004"]) {
      writeFileSync(join(many, `${id}-s.md`), spec(`s${id}`, "ready", `Spec ${id}`));
    }
    assert.deepEqual(
      lib.specDigest(join(root, "many")).map((s) => s.id),
      ["004", "003", "002"],
      "capped at DIGEST_LIMIT, newest id first",
    );

    // a project with no .marvin/task directory is an empty digest
    assert.deepEqual(lib.specDigest(join(root, "elsewhere")), []);
  }),
);

// ── AC3: handoffDigest ──────────────────────────────────────────────────────

test(
  "handoffDigest orders by id and computes age_days from the frontmatter created date",
  withDir(async (root) => {
    const handoffs = join(root, "handoff");
    mkdirSync(handoffs, { recursive: true });
    // id order and `created` order deliberately disagree: the digest orders by
    // id, while each row's age comes from its own `created` date
    writeHandoff(handoffs, {
      id: "001",
      slug: "alpha",
      objective: "Nine days old",
      created: daysAgo(9),
    });
    writeHandoff(handoffs, {
      id: "002",
      slug: "beta",
      objective: "Two days old",
      created: daysAgo(2),
    });
    writeHandoff(handoffs, {
      id: "003",
      slug: "gamma",
      objective: "Fifteen days old",
      created: daysAgo(15),
    });

    assert.deepEqual(lib.handoffDigest(handoffs, NOW), [
      { slug: "gamma", objective: "Fifteen days old", age_days: 15 },
      { slug: "beta", objective: "Two days old", age_days: 2 },
      { slug: "alpha", objective: "Nine days old", age_days: 9 },
    ]);

    // a fourth handoff is dropped by the cap — the lowest id loses
    const many = join(root, "many");
    mkdirSync(many, { recursive: true });
    for (const id of ["001", "002", "003", "004"]) {
      writeHandoff(many, { id, slug: `h${id}`, objective: `Handoff ${id}`, created: daysAgo(1) });
    }
    assert.deepEqual(
      lib.handoffDigest(many, NOW).map((h) => h.slug),
      ["h004", "h003", "h002"],
      "capped at DIGEST_LIMIT, newest id first",
    );

    // a missing handoff directory is an empty digest, never a throw
    assert.deepEqual(lib.handoffDigest(join(root, "nope"), NOW), []);
  }),
);

// ── AC4: auditDigest ────────────────────────────────────────────────────────

const AUDIT_BLOCK = JSON.stringify({
  kind: "scan",
  scanned_at: "2026-07-13T10:00:00Z",
  summary: { critical: 1, high: 2, medium: 1 },
  findings: [
    { id: "S-1", severity: "critical", title: "Hardcoded admin token", category: "A07:2025" },
    { id: "S-2", severity: "high", title: "SQL injection in login", category: "A03:2025" },
    { id: "S-3", severity: "high", title: "Missing authz check", category: "A01:2025" },
    { id: "S-4", severity: "medium", title: "Missing CSP header", category: "A05:2025" },
  ],
});

/** An ADR-0029 findings register — deliberately the OLDER refactor fixture. */
const REGISTER_WITH_FINDINGS = [
  "# Refactoring audit — core",
  "",
  "| ID | Title | Severity | Effort | Evidence | Direction |",
  "|----|-------|----------|--------|----------|-----------|",
  "| F1 | God module | high | medium | `src/core.ts:1` | Split it |",
  "",
].join("\n");

test(
  "auditDigest buckets the newest report per area and returns null for an empty area",
  withDir(async (root) => {
    const security = join(root, "security");
    const refactor = join(root, "refactor");
    mkdirSync(security, { recursive: true });
    mkdirSync(refactor, { recursive: true });

    writeAt(
      security,
      "001-scan.md",
      `# Security scan\n\nProse.\n\n\`\`\`json audit-report\n${AUDIT_BLOCK}\n\`\`\`\n`,
      NOW - 3 * DAY_MS,
    );
    // the refactor area holds a plan but no register — plans carry steps, not
    // findings, so the area reads as never scanned
    writeAt(
      refactor,
      "003-plan-core.md",
      "# Refactoring plan\n\n### Step 1 — Do it\n",
      NOW - DAY_MS,
    );

    const digest = lib.auditDigest({ security, refactor }, NOW);
    assert.deepEqual(digest.security, {
      scanned_age_days: 3,
      total: 4,
      // partial by design: only the severities actually present appear
      by_severity: { critical: 1, high: 2, medium: 1 },
      newest_report: "001-scan.md",
    });
    assert.equal(digest.refactor, null, "an area with no register is null, not zero findings");

    // the refactor rule is "newest register REGARDLESS of finding count": a
    // heading-only newest register wins over an older one that has findings,
    // because parseRegisterFindings cannot tell "not a register" from "a
    // register with nothing in it". Zero findings is a scanned-clean report,
    // which is distinct from the `null` above.
    const empty = join(root, "empty-newest");
    mkdirSync(empty, { recursive: true });
    writeAt(empty, "001-audit-core.md", REGISTER_WITH_FINDINGS, NOW - 4 * DAY_MS);
    writeAt(empty, "002-smells-api.md", "# Smells — api\n\nNothing found.\n", NOW - DAY_MS);
    assert.deepEqual(lib.auditDigest({ security: join(root, "none"), refactor: empty }, NOW), {
      security: null,
      refactor: {
        scanned_age_days: 1,
        total: 0,
        by_severity: {},
        newest_report: "002-smells-api.md",
      },
    });

    // both directories missing → both areas null, never a throw
    assert.deepEqual(
      lib.auditDigest({ security: join(root, "a"), refactor: join(root, "b") }, NOW),
      {
        security: null,
        refactor: null,
      },
    );
  }),
);
