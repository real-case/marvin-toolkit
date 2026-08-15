import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SpecAuditPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { callTool } from "./_driver.mjs";

/**
 * `spec` `action: "audit"` — the corpus lint behind `/marvin:task-audit`.
 *
 * Every fixture is built at runtime. Nothing is asserted against this
 * repository's own spec corpus, which grows with every spec anyone authors: a
 * corpus-based assertion would prove nothing today and something different
 * tomorrow.
 *
 * This deliberately does NOT reuse `spec.test.mjs`'s `callSpec`, which asserts a
 * ```json spec-result``` block is present. The audit emits none — its machine
 * payload rides in `structuredContent`, as `adr audit`'s does.
 */
async function callAudit(projectDir, args = { action: "audit" }) {
  const result = await callTool("spec", args, { env: { CLAUDE_PROJECT_DIR: projectDir } });
  return {
    text: result.content.map((c) => c.text).join("\n"),
    isError: !!result.isError,
    structured: result.structuredContent,
  };
}

function freshProject() {
  return mkdtempSync(join(tmpdir(), "marvin-spec-audit-"));
}

/** Write `<NNN>-<slug>.md` (or any filename) into the project's `.marvin/task/`. */
function seed(proj, filename, content) {
  const dir = join(proj, ".marvin", "task");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

/** A fully-identified spec file: frontmatter + a minimal spec-contract block. */
function spec({
  slug,
  status = "shipped",
  sha = "abc0123456789def",
  created = "2026-08-01",
  type = "feature",
  dependsOn = null,
  omit = [],
}) {
  const fm = [
    ["slug", slug],
    ["type", type],
    ["status", status],
    ["created", created],
    ...(sha ? [["contract_sha", sha]] : []),
  ].filter(([key]) => !omit.includes(key));
  return [
    "---",
    ...fm.map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
    `# ${slug}`,
    "",
    "```yaml spec-contract",
    "files:",
    "  - id: F1",
    "    path: README.md",
    "    action: edit",
    "criteria:",
    "  - id: AC1",
    "    statement: it works",
    "    implemented_by: [F1]",
    "    oracle:",
    "      kind: prose-review",
    ...(dependsOn ? [`depends_on: [${dependsOn.join(", ")}]`] : []),
    "```",
    "",
  ].join("\n");
}

const kindsOf = (result) => result.structured.findings.map((f) => f.kind).sort();
const findingsOf = (result, kind) => result.structured.findings.filter((f) => f.kind === kind);

// ── AC4: corpus-wide, no spec argument, typed payload ──────────────────────

test("audit runs corpus-wide with no spec argument and returns the typed payload", async () => {
  const proj = freshProject();
  try {
    seed(proj, "001-alpha.md", spec({ slug: "alpha" }));
    seed(proj, "002-beta.md", spec({ slug: "beta" }));
    // The corpus for THIS case is deliberately not clean. A payload whose
    // `findings` array is empty never parses a single `SpecAuditFinding`, so on
    // a clean fixture the per-finding half of the contract goes unexercised and
    // the assertion below would be a guard that cannot fail. Three files put
    // every branch of that member schema on the wire: `004-gamma` is
    // ready-but-unsealed (`missing-seal`, a per-spec warning with both `slug`
    // and `number` set), its number leaves 003 vacant (`numbering-hole`, a
    // corpus-level warning with `slug`, `number` and `path` all null), and
    // `005-odd` carries a status outside the vocabulary (`invalid-status`, an
    // error).
    seed(proj, "004-gamma.md", spec({ slug: "gamma", status: "ready", sha: null }));
    seed(proj, "005-odd.md", spec({ slug: "odd", status: "done" }));

    // No `specPath`, no `specContent` — the ordinary invocation. The dispatch
    // must sit BEFORE the spec-source read, or this is the DoR input failure.
    const res = await callAudit(proj);

    assert.ok(
      !/provide specContent or specPath/.test(res.text),
      `audit fell through to the spec-source read:\n${res.text}`,
    );
    assert.ok(res.structured, "audit must carry structuredContent");

    // The claim is that the payload parses against the SHIPPED schema, so the
    // schema is what does the parsing. Hand-rolled field checks restate the
    // contract in a second place and drift from it silently.
    const payload = SpecAuditPayload.parse(res.structured);

    assert.equal(
      payload.dir,
      ".marvin/task",
      "dir is the project-root-relative resolved directory",
    );
    assert.equal(payload.checked, 4, "checked counts the files the corpus reader saw");
    assert.ok(
      payload.findings.length > 0,
      `the fixture must produce findings, or SpecAuditFinding is never parsed:\n${res.text}`,
    );
    const severities = new Set(payload.findings.map((f) => f.severity));
    assert.ok(severities.has("error"), `no error-severity finding parsed:\n${res.text}`);
    assert.ok(severities.has("warning"), `no warning-severity finding parsed:\n${res.text}`);
    assert.ok(
      payload.findings.some((f) => f.slug === null && f.number === null && f.path === null),
      `no corpus-level finding parsed, so the nullable fields are unexercised:\n${res.text}`,
    );
    assert.equal(
      payload.ok,
      !payload.findings.some((f) => f.severity === "error"),
      "ok is the absence of an error-severity finding",
    );
    assert.ok(res.text.includes("# Spec audit"), `header line missing:\n${res.text}`);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── AC5: every class fires, with its declared severity ─────────────────────

test("every finding class fires with its declared severity", async () => {
  const proj = freshProject();
  try {
    // 001/002 — duplicate number (both claim 001) AND a slug collision on `dup`.
    seed(proj, "001-dup.md", spec({ slug: "dup" }));
    seed(proj, "001-dup-again.md", spec({ slug: "dup" }));
    // 003 — a dangling depends_on (`ghost` exists nowhere).
    seed(proj, "003-refers.md", spec({ slug: "refers", dependsOn: ["ghost"] }));
    // 004 — ready but unsealed.
    seed(proj, "004-unsealed.md", spec({ slug: "unsealed", status: "ready", sha: null }));
    // 005 — a numbered file with NO frontmatter block at all.
    seed(proj, "005-bare.md", "# just a note\n\nNo frontmatter here.\n");
    // 006 — a status outside STATUS_VALUES.
    seed(proj, "006-odd.md", spec({ slug: "odd", status: "done" }));
    // …and a hole: 007 is absent, 008 exists.
    seed(proj, "008-later.md", spec({ slug: "later" }));

    const res = await callAudit(proj);

    // The widest corpus in the file — all seven classes at once — so it is also
    // the widest single exercise of the shipped schema.
    SpecAuditPayload.parse(res.structured);

    const kinds = new Set(kindsOf(res));

    for (const kind of [
      "duplicate-number",
      "numbering-hole",
      "slug-collision",
      "dangling-depends-on",
      "missing-seal",
      "malformed",
      "invalid-status",
    ]) {
      assert.ok(kinds.has(kind), `class ${kind} never fired:\n${res.text}`);
    }
    assert.equal(kinds.size, 7, `unexpected extra classes: ${[...kinds].join(", ")}`);

    const severity = (kind) => findingsOf(res, kind)[0].severity;
    assert.equal(severity("duplicate-number"), "error");
    assert.equal(severity("numbering-hole"), "warning");
    assert.equal(severity("slug-collision"), "error");
    assert.equal(severity("dangling-depends-on"), "error");
    assert.equal(severity("missing-seal"), "warning");
    assert.equal(severity("malformed"), "error");
    assert.equal(severity("invalid-status"), "error");

    // `malformed` is reachable because it is defined on ABSENT identity keys,
    // never on a parser that threw: `parseFrontmatter` has no throwing path.
    const bare = findingsOf(res, "malformed").find((f) => /005-bare/.test(f.message));
    assert.ok(bare, `the frontmatter-less file was not reported:\n${res.text}`);
    for (const key of ["slug", "type", "status", "created"]) {
      assert.ok(bare.message.includes(key), `malformed message omits \`${key}\`: ${bare.message}`);
    }

    // …and `invalid-status` is its own class, split out exactly as the ADR
    // mirror splits it, so the two are disjoint on the status axis.
    const odd = findingsOf(res, "invalid-status")[0];
    assert.ok(odd.message.includes("done"), `invalid-status omits the value: ${odd.message}`);
    assert.equal(odd.slug, "odd");

    assert.equal(res.structured.ok, false, "ok must be false with errors present");
    assert.equal(res.isError, true, "isError must be set when an error-severity finding exists");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── AC6: characterization — clean corpus and the reader's exclusions ───────

test("a clean corpus reports nothing and drafts, superseded specs, verification.md and runs are excluded", async () => {
  const proj = freshProject();
  try {
    seed(proj, "001-alpha.md", spec({ slug: "alpha" }));
    seed(proj, "002-beta.md", spec({ slug: "beta", status: "in-progress" }));
    // A draft has no contract block to seal; a superseded spec is history.
    // Neither may raise `missing-seal`.
    seed(proj, "003-sketch.md", spec({ slug: "sketch", status: "draft", sha: null }));
    seed(proj, "004-old.md", spec({ slug: "old", status: "superseded", sha: null }));

    // The pipeline's own artifacts, which the corpus reader excludes (spec 029).
    seed(proj, "verification.md", "# Verification\n\nAll gates green.\n");
    const runs = join(proj, ".marvin", "task", "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "alpha.md"), "# run journal\n");
    writeFileSync(join(runs, "alpha.progress.md"), "# progress\n");
    writeFileSync(join(runs, "alpha.oracles.md"), "# oracles\n");

    const res = await callAudit(proj);

    // The empty-findings payload parses as well: `dir`, `checked` and `ok`
    // carry the whole answer when there is nothing to report.
    SpecAuditPayload.parse(res.structured);

    assert.deepEqual(res.structured.findings, [], `expected a clean corpus:\n${res.text}`);
    assert.equal(res.structured.ok, true);
    assert.equal(res.isError, false, "a clean corpus must not set isError");
    assert.match(res.text, /Corpus clean/);
    assert.equal(
      res.structured.checked,
      4,
      "checked must count neither verification.md nor anything under runs/",
    );
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── AC7: a collision says which file the resolver picks ────────────────────

test("a slug collision names the file the resolver would pick", async () => {
  const proj = freshProject();
  try {
    // The legacy unnumbered form wins in `resolveSpecBySlug` — an exact
    // `<slug>.md` is preferred over any `<digits>-<slug>.md`.
    seed(proj, "twin.md", spec({ slug: "twin" }));
    seed(proj, "011-twin.md", spec({ slug: "twin" }));
    seed(proj, "012-twin.md", spec({ slug: "twin" }));

    const res = await callAudit(proj);
    const collisions = findingsOf(res, "slug-collision");
    assert.equal(collisions.length, 1, `expected one collision:\n${res.text}`);

    const [f] = collisions;
    assert.equal(f.slug, "twin");
    assert.equal(f.severity, "error");
    for (const name of ["twin.md", "011-twin.md", "012-twin.md"]) {
      assert.ok(f.message.includes(name), `collision omits \`${name}\`: ${f.message}`);
    }
    assert.match(
      f.message,
      /`twin\.md` is the one/,
      `collision does not say which file resolves today: ${f.message}`,
    );
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── a hole the unbounded prefix can express stays a readable finding ───────

test("a numbering hole is summarised rather than expanded without bound", async () => {
  const proj = freshProject();
  try {
    seed(proj, "001-a.md", spec({ slug: "a" }));
    seed(proj, "005-b.md", spec({ slug: "b" }));
    // `SPEC_PREFIX_RE` is deliberately unbounded (the ADR-0022 tolerance the ADR
    // corpus does not need), so a date-shaped prefix — a real convention in the
    // `specs/` and `docs/rfcs/` directories detection may pick — is a corpus a
    // user can really produce. Enumerating THIS gap is ~20 million ids.
    seed(proj, "20260814-notes.md", spec({ slug: "notes" }));

    const res = await callAudit(proj);
    SpecAuditPayload.parse(res.structured);
    const holes = findingsOf(res, "numbering-hole");
    assert.deepEqual(kindsOf(res), ["numbering-hole", "numbering-hole"], res.text);

    // The small hole is still listed in full — the common case is unchanged.
    const [small, huge] = holes;
    assert.equal(
      small.message,
      "numbering hole between `00000001` and `00000005` " +
        "(missing `00000002`, `00000003`, `00000004`)",
    );

    // The large one degrades to ten ids and a count, and says how many it hid.
    assert.ok(
      huge.message.length < 400,
      `the finding expanded the whole gap: ${huge.message.length} bytes`,
    );
    assert.match(huge.message, /between `00000005` and `20260814`/);
    assert.match(huge.message, /`00000006`.*`00000015`, and 20260798 more/);

    // …and no other channel re-expands it: the whole payload stays small.
    const payload = JSON.stringify(res.structured);
    assert.ok(payload.length < 2000, `structuredContent is ${payload.length} bytes`);
    assert.ok(res.text.length < 2000, `the rendered report is ${res.text.length} bytes`);
    assert.equal(res.isError, false, "a hole is a warning, never an error");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── the phantom corpus cannot return through the `malformed` channel ───────

test("a host directory of unrelated markdown audits clean, whatever its frontmatter", async () => {
  const proj = freshProject();
  try {
    // No `.marvin/task/`, so detection resolves the host's own `specs/` — the
    // arrangement that makes the phantom-corpus guard load-bearing.
    const dir = join(proj, "specs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "# API specs\n");
    writeFileSync(join(dir, "index.md"), "---\n---\n\n# Index\n");
    writeFileSync(
      join(dir, "openapi-notes.md"),
      '---\ntitle: "unbalanced\nversion: 3\n---\n\n# N\n',
    );

    const res = await callAudit(proj);
    SpecAuditPayload.parse(res.structured);

    assert.equal(res.structured.dir, "specs");
    assert.deepEqual(
      res.structured.findings,
      [],
      `none of these files is a spec, so none is a broken spec:\n${res.text}`,
    );
    assert.equal(res.structured.checked, 0, "a file that is not ours is not counted either");
    assert.equal(res.structured.ok, true);
    assert.equal(res.isError, false, "an unrelated host directory must not fail the audit");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});
