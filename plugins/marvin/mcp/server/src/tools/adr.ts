import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type {
  AdrAuditFinding,
  AdrAuditPayload,
  AdrListPayload,
  AdrRecord,
} from "@marvin-toolkit/mcp-shared/contracts";
import type { ServerEnv } from "../lib/env.js";
import { loadConfig } from "../storage/config.js";
import { slugify } from "../storage/slug.js";
import {
  ADR_STATUSES,
  adrRefs,
  findPlaceholders,
  flipSuperseded,
  formatAdrId,
  linkSupersedes,
  missingSections,
  nextAdrNumber,
  readAdrCorpus,
  readManagedBlock,
  renderAdrSkeleton,
  renderIndexBlock,
  resolveAdrDir,
  resolveIndexTarget,
  spliceIndex,
  stampAccepted,
  stripCodeSpans,
  writeAdrFileAtomic,
  type AdrCorpus,
  type AdrDirResolution,
  type AdrIndexTarget,
  type AdrRecordData,
} from "../storage/adr.js";
import type { AdrConfig } from "../storage/schema.js";

/**
 * `number`/`successor` accept both 27 and "0027" (coerced), so the model can
 * pass ids exactly as they appear in filenames and cross-references.
 */
const AdrInput = z.object({
  action: z.enum(["next", "list", "index", "audit", "accept", "supersede"]),
  number: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Target record number — required for accept and supersede (accepts 27 or '0027')"),
  title: z
    .string()
    .optional()
    .describe(
      "next: preview the target path for this title · supersede: title of the new skeleton record",
    ),
  successor: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "supersede: pair this existing record as the successor instead of creating a skeleton",
    ),
});

type AdrInput = z.infer<typeof AdrInput>;

export function buildAdrTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "adr",
    description:
      "Deterministic ADR-lifecycle mechanics over the project's decision-record corpus (ADR-0027; " +
      "location: config adr.dir, else detected docs/adr | docs/decisions | adr, else docs/adr). " +
      "Parses both table-style and MADR heading-style records. action:'next' reserves the next number " +
      "(pass title to preview the file path); 'list' renders the parsed corpus with statuses; " +
      "'audit' lints it (dangling ADR-NNNN references, numbering holes/duplicates, broken supersede " +
      "pairs, placeholder residue, invalid statuses, stale index); 'index' regenerates the corpus index " +
      "between managed markers; 'accept' ratifies one proposed record after a readiness gate (no {…} " +
      "placeholders, required sections, resolving cross-references) and stamps status + date; " +
      "'supersede' creates or pairs a successor and flips the old record's status — never its content. " +
      "accept and supersede are human decisions: invoke them only on explicit user instruction.",
    inputSchema: AdrInput,
    handler: (input) => Promise.resolve(dispatch(env, input)),
  });
}

interface AdrContext {
  dir: AdrDirResolution;
  corpus: AdrCorpus;
  index: AdrIndexTarget | null;
  /** Config-load warning (malformed config falls back to defaults), if any. */
  warning: string | null;
}

function loadContext(env: ServerEnv): AdrContext {
  // Config is (re)loaded per call — the kanban `config` action and hand edits
  // must apply immediately. No projectDir arg: base_branch detection is the
  // task tool's concern, the adr tool only reads the `adr` block.
  const { config, warning } = loadConfig(env.configPath);
  const adrConfig: AdrConfig | undefined = config.adr;
  const dir = resolveAdrDir(env.projectDir, adrConfig);
  return {
    dir,
    corpus: readAdrCorpus(dir),
    index: resolveIndexTarget(env.projectDir, dir, adrConfig),
    warning,
  };
}

function dispatch(env: ServerEnv, input: AdrInput): ToolResult {
  const ctx = loadContext(env);
  switch (input.action) {
    case "next":
      return runNext(ctx, input);
    case "list":
      return runList(ctx);
    case "index":
      return runIndex(ctx);
    case "audit":
      return runAudit(ctx);
    case "accept":
      return runAccept(env, ctx, input);
    case "supersede":
      return runSupersede(env, ctx, input);
  }
}

// ── read actions ──────────────────────────────────────────────────────────

function runNext(ctx: AdrContext, input: AdrInput): ToolResult {
  const number = nextAdrNumber(ctx.corpus);
  const id = formatAdrId(number);
  const slug = input.title ? slugify(input.title) : "";
  const path = slug ? `${ctx.dir.rel}/${id}-${slug}.md` : null;

  const lines = [
    `Next ADR number: **${id}**`,
    `Corpus: \`${ctx.dir.rel}\` (${ctx.dir.source}) · ${ctx.corpus.records.length} record(s)`,
  ];
  if (path) lines.push(`Target path: \`${path}\``);
  else if (input.title !== undefined)
    lines.push("_The title yields no usable slug — name the file by hand._");
  lines.push("_New records always land `proposed` (ADR-0027)._");
  return withWarning(ctx, {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { dir: ctx.dir.rel, number, id, path },
  });
}

function runList(ctx: AdrContext): ToolResult {
  const { records } = ctx.corpus;
  const lines: string[] = [
    `# ADR corpus — \`${ctx.dir.rel}\` (${ctx.dir.source}) · ${records.length} record(s)`,
    "",
  ];
  if (records.length === 0) {
    lines.push("_No records yet — `adr next` reserves the first number._");
  } else {
    lines.push("| ADR | Title | Status | Date |");
    lines.push("| --- | ----- | ------ | ---- |");
    for (const r of records) {
      lines.push(
        `| ${formatAdrId(r.number)} | ${r.title} | ${statusLabel(r)} | ${r.date ?? "—"} |`,
      );
    }
  }
  appendMalformedNote(lines, ctx);
  return withWarning(ctx, {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: buildListPayload(ctx),
  });
}

function statusLabel(r: AdrRecordData): string {
  if (r.superseded_by.length > 0) {
    return `superseded by ${r.superseded_by.map((n) => `ADR-${formatAdrId(n)}`).join(", ")}`;
  }
  return r.status;
}

function appendMalformedNote(lines: string[], ctx: AdrContext): void {
  if (ctx.corpus.malformed.length === 0) return;
  lines.push("");
  lines.push(
    `_⚠ ${ctx.corpus.malformed.length} file(s) could not be parsed: ${ctx.corpus.malformed
      .map((m) => `\`${m.filename}\` (${m.reason})`)
      .join("; ")}_`,
  );
}

function runIndex(ctx: AdrContext): ToolResult {
  if (!ctx.index) {
    return withWarning(ctx, {
      content: [
        {
          type: "text",
          text:
            `No corpus index target — nothing to regenerate.\n` +
            `Set \`adr.index_file\` in \`.marvin/config.json\` or create \`${ctx.dir.rel}/README.md\`; ` +
            `the index is maintained between \`<!-- marvin:adr-index:start -->\` / \`:end -->\` markers.`,
        },
      ],
      structuredContent: { dir: ctx.dir.rel, target: null, result: "skipped", records: 0 },
    });
  }

  const block = renderIndexBlock(ctx.corpus, ctx.dir, ctx.index.abs);
  const existing = existsSync(ctx.index.abs) ? readFileSync(ctx.index.abs, "utf8") : null;
  if (existing !== null && readManagedBlock(existing) === block) {
    return withWarning(ctx, {
      content: [
        {
          type: "text",
          text: `Corpus index \`${ctx.index.rel}\` is already up to date (${ctx.corpus.records.length} record(s)).`,
        },
      ],
      structuredContent: {
        dir: ctx.dir.rel,
        target: ctx.index.rel,
        result: "unchanged",
        records: ctx.corpus.records.length,
      },
    });
  }

  const write = spliceIndex(existing, block);
  writeAdrFileAtomic(ctx.index.abs, write.text);
  const verb =
    write.action === "created"
      ? "Created"
      : write.action === "appended"
        ? "Appended the managed block to"
        : "Regenerated the managed block in";
  const lines = [
    `${verb} \`${ctx.index.rel}\` — ${ctx.corpus.records.length} record(s) indexed.`,
    "_Hand-written prose outside the markers is untouched._",
  ];
  appendMalformedNote(lines, ctx);
  return withWarning(ctx, {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      dir: ctx.dir.rel,
      target: ctx.index.rel,
      result: write.action,
      records: ctx.corpus.records.length,
    },
  });
}

// ── audit ─────────────────────────────────────────────────────────────────

function runAudit(ctx: AdrContext): ToolResult {
  const findings = collectFindings(ctx);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const checked = ctx.corpus.records.length + ctx.corpus.malformed.length;

  const lines = [`# ADR audit — \`${ctx.dir.rel}\` · ${checked} file(s) checked`, ""];
  if (findings.length === 0) {
    lines.push("✓ Corpus clean — no findings.");
  } else {
    if (errors.length > 0) {
      lines.push(`✗ ${errors.length} error(s):`);
      for (const f of errors) lines.push(renderFinding(f));
      lines.push("");
    }
    if (warnings.length > 0) {
      lines.push(`⚠ ${warnings.length} warning(s):`);
      for (const f of warnings) lines.push(renderFinding(f));
    }
  }

  const payload: AdrAuditPayload = {
    dir: ctx.dir.rel,
    checked,
    findings,
    ok: errors.length === 0,
  };
  return withWarning(ctx, {
    content: [{ type: "text", text: lines.join("\n").trimEnd() }],
    structuredContent: payload,
    ...(errors.length > 0 ? { isError: true } : {}),
  });
}

function renderFinding(f: AdrAuditFinding): string {
  const anchor = f.path ? ` — \`${f.path}\`` : "";
  return `- **[${f.kind}]** ${f.message}${anchor}`;
}

function collectFindings(ctx: AdrContext): AdrAuditFinding[] {
  const findings: AdrAuditFinding[] = [];
  const { records, malformed } = ctx.corpus;
  const known = new Set<number>([
    ...records.map((r) => r.number),
    ...malformed.flatMap((m) => (m.number === null ? [] : [m.number])),
  ]);
  const byNumber = new Map(records.map((r) => [r.number, r]));

  // Unparseable files — surfaced, never fatal (invalid status is its own class).
  for (const m of malformed) {
    findings.push({
      kind: m.kind === "invalid-status" ? "invalid-status" : "malformed",
      severity: "error",
      message: `\`${m.filename}\`: ${m.reason}`,
      number: m.number,
      path: m.number === null ? null : `${ctx.dir.rel}/${m.filename}`,
    });
  }

  // Numbering: duplicates (error) and holes (warning).
  const counts = new Map<number, string[]>();
  for (const r of records) push(counts, r.number, r.filename);
  for (const m of malformed) if (m.number !== null) push(counts, m.number, m.filename);
  for (const [number, files] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (files.length > 1) {
      findings.push({
        kind: "duplicate-number",
        severity: "error",
        message: `ADR-${formatAdrId(number)} is claimed by ${files.length} files: ${files.map((f) => `\`${f}\``).join(", ")}`,
        number,
        path: null,
      });
    }
  }
  const numbers = [...counts.keys()].sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1]!;
    const cur = numbers[i]!;
    if (cur - prev > 1) {
      const gap = Array.from({ length: cur - prev - 1 }, (_, k) => formatAdrId(prev + 1 + k));
      findings.push({
        kind: "numbering-hole",
        severity: "warning",
        message: `numbering hole between ADR-${formatAdrId(prev)} and ADR-${formatAdrId(cur)} (missing ${gap.join(", ")})`,
        number: null,
        path: null,
      });
    }
  }

  // Per-record text lints: dangling ADR-NNNN references, placeholder residue.
  // Code spans are stripped first — an example reference in backticks is
  // documentation, not a decision-graph edge.
  for (const r of records) {
    const raw = readFileSync(join(ctx.dir.abs, r.filename), "utf8");
    for (const ref of adrRefs(stripCodeSpans(raw))) {
      if (!known.has(ref)) {
        findings.push({
          kind: "dangling-reference",
          severity: "error",
          message: `ADR-${formatAdrId(r.number)} references ADR-${formatAdrId(ref)}, which does not exist in the corpus`,
          number: r.number,
          path: r.path,
        });
      }
    }
    const placeholders = findPlaceholders(raw);
    if (placeholders.length > 0) {
      findings.push({
        kind: "placeholder-residue",
        // A still-proposed draft may legitimately carry template placeholders;
        // residue in a ratified record is an error.
        severity: r.status === "proposed" ? "warning" : "error",
        message: `${placeholders.length} template placeholder(s) left in ADR-${formatAdrId(r.number)}: ${placeholders
          .slice(0, 3)
          .map((p) => `\`${p}\``)
          .join(", ")}${placeholders.length > 3 ? ", …" : ""}`,
        number: r.number,
        path: r.path,
      });
    }
  }

  // Supersede pairs — consistency among existing records; missing targets are
  // already reported as dangling references (the link text mentions the number).
  for (const r of records) {
    for (const n of r.supersedes) {
      const target = byNumber.get(n);
      if (target && !target.superseded_by.includes(r.number)) {
        findings.push({
          kind: "broken-supersede-pair",
          severity: "error",
          message: `ADR-${formatAdrId(r.number)} supersedes ADR-${formatAdrId(n)}, but ADR-${formatAdrId(n)} carries no Superseded-by link back`,
          number: n,
          path: target.path,
        });
      }
    }
    for (const n of r.superseded_by) {
      const successor = byNumber.get(n);
      if (successor && !successor.supersedes.includes(r.number)) {
        findings.push({
          kind: "broken-supersede-pair",
          severity: "error",
          message: `ADR-${formatAdrId(r.number)} points at successor ADR-${formatAdrId(n)}, but ADR-${formatAdrId(n)} carries no Supersedes link back`,
          number: n,
          path: successor.path,
        });
      }
    }
    if (r.superseded_by.length > 0 && r.status !== "superseded") {
      findings.push({
        kind: "broken-supersede-pair",
        severity: "error",
        message: `ADR-${formatAdrId(r.number)} carries a Superseded-by link but its status is "${r.status}"`,
        number: r.number,
        path: r.path,
      });
    }
    if (r.status === "superseded" && r.superseded_by.length === 0) {
      findings.push({
        kind: "broken-supersede-pair",
        severity: "error",
        message: `ADR-${formatAdrId(r.number)} is marked superseded but names no successor`,
        number: r.number,
        path: r.path,
      });
    }
  }

  // Index staleness — only when a target resolves (no target, no nagging).
  if (ctx.index) {
    if (!existsSync(ctx.index.abs)) {
      findings.push(staleIndex(`configured index file \`${ctx.index.rel}\` does not exist`));
    } else {
      const text = readFileSync(ctx.index.abs, "utf8");
      const managed = readManagedBlock(text);
      if (managed === null) {
        findings.push(staleIndex(`index file \`${ctx.index.rel}\` has no managed markers yet`));
      } else if (managed !== renderIndexBlock(ctx.corpus, ctx.dir, ctx.index.abs)) {
        findings.push(staleIndex(`index file \`${ctx.index.rel}\` is out of date`));
      }
    }
  }

  return findings;
}

function staleIndex(message: string): AdrAuditFinding {
  return {
    kind: "stale-index",
    severity: "warning",
    message: `${message} — run \`adr index\` to regenerate`,
    number: null,
    path: null,
  };
}

function push(map: Map<number, string[]>, key: number, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ── mutating actions (fail-closed) ────────────────────────────────────────

function runAccept(env: ServerEnv, ctx: AdrContext, input: AdrInput): ToolResult {
  if (input.number === undefined) {
    return err('`accept` requires `number` — the record to ratify (e.g. 27 or "0027").');
  }
  const found = findRecord(ctx, input.number);
  if (!found.ok) return err(found.error);
  const record = found.record;

  if (record.status !== "proposed") {
    return err(
      record.status === "accepted"
        ? `ADR-${formatAdrId(record.number)} is already accepted${record.date ? ` (since ${record.date})` : ""}.`
        : `ADR-${formatAdrId(record.number)} is ${record.status} — only a proposed record can be accepted.`,
    );
  }

  // Readiness gate — all failures reported at once, nothing written on refusal.
  const raw = readFileSync(join(ctx.dir.abs, record.filename), "utf8");
  const problems: string[] = [];
  const placeholders = findPlaceholders(raw);
  if (placeholders.length > 0) {
    problems.push(
      `${placeholders.length} template placeholder(s) left: ${placeholders
        .slice(0, 5)
        .map((p) => `\`${p}\``)
        .join(", ")}${placeholders.length > 5 ? ", …" : ""}`,
    );
  }
  const missing = missingSections(raw);
  if (missing.length > 0) {
    problems.push(`required section(s) missing: ${missing.map((s) => `\`## ${s}\``).join(", ")}`);
  }
  const knownNumbers = new Set<number>([
    ...ctx.corpus.records.map((r) => r.number),
    ...ctx.corpus.malformed.flatMap((m) => (m.number === null ? [] : [m.number])),
  ]);
  const dangling = adrRefs(stripCodeSpans(raw)).filter((n) => !knownNumbers.has(n));
  if (dangling.length > 0) {
    problems.push(
      `unresolved cross-reference(s): ${dangling.map((n) => `ADR-${formatAdrId(n)}`).join(", ")}`,
    );
  }
  if (problems.length > 0) {
    return err(
      `Not ready for acceptance — ADR-${formatAdrId(record.number)} fails the readiness gate:\n${problems
        .map((p) => `- ${p}`)
        .join("\n")}\nFix the record and retry; nothing was written.`,
    );
  }

  const today = isoToday();
  const stamped = stampAccepted(raw, record.style, today);
  if (!stamped.ok) return err(`Cannot stamp ADR-${formatAdrId(record.number)}: ${stamped.error}.`);
  writeAdrFileAtomic(join(ctx.dir.abs, record.filename), stamped.text);

  const fresh = loadContext(env);
  const updated = fresh.corpus.records.find((r) => r.number === record.number);
  const lines = [
    `Accepted **ADR-${formatAdrId(record.number)} — ${record.title}**, dated ${today}.`,
    `File: \`${record.path}\``,
  ];
  appendIndexReminder(lines, fresh);
  return withWarning(ctx, {
    content: [{ type: "text", text: lines.join("\n") }],
    ...(updated ? { structuredContent: { record: toPayloadRecord(updated) } } : {}),
  });
}

function runSupersede(env: ServerEnv, ctx: AdrContext, input: AdrInput): ToolResult {
  if (input.number === undefined) {
    return err("`supersede` requires `number` — the record being superseded.");
  }
  const hasTitle = input.title !== undefined && input.title.trim() !== "";
  if (hasTitle === (input.successor !== undefined)) {
    return err(
      "`supersede` requires exactly one of `title` (create a proposed skeleton as the successor) " +
        "or `successor` (pair an existing record).",
    );
  }
  const found = findRecord(ctx, input.number);
  if (!found.ok) return err(found.error);
  const old = found.record;
  if (old.status === "superseded") {
    return err(
      `ADR-${formatAdrId(old.number)} is already superseded${
        old.superseded_by.length > 0
          ? ` by ${old.superseded_by.map((n) => `ADR-${formatAdrId(n)}`).join(", ")}`
          : ""
      }.`,
    );
  }

  const today = isoToday();
  let successor: { number: number; filename: string; created: boolean };

  if (input.successor !== undefined) {
    if (input.successor === old.number) {
      return err("A record cannot supersede itself — `successor` must differ from `number`.");
    }
    const target = findRecord(ctx, input.successor);
    if (!target.ok) return err(target.error);
    const raw = readFileSync(join(ctx.dir.abs, target.record.filename), "utf8");
    const linked = linkSupersedes(raw, target.record.style, old);
    if (!linked.ok) {
      return err(
        `Cannot record the Supersedes link on ADR-${formatAdrId(target.record.number)}: ${linked.error}. Nothing was written.`,
      );
    }
    if (linked.text !== raw) {
      writeAdrFileAtomic(join(ctx.dir.abs, target.record.filename), linked.text);
    }
    successor = { number: target.record.number, filename: target.record.filename, created: false };
  } else {
    const title = input.title!.trim();
    const slug = slugify(title);
    if (!slug) {
      return err(
        "The successor title yields no usable slug (latin letters or digits required) — pass a different `title`.",
      );
    }
    const number = nextAdrNumber(ctx.corpus);
    const filename = `${formatAdrId(number)}-${slug}.md`;
    const path = join(ctx.dir.abs, filename);
    if (existsSync(path)) {
      return err(`\`${ctx.dir.rel}/${filename}\` already exists — nothing was written.`);
    }
    writeAdrFileAtomic(path, renderAdrSkeleton({ number, title, date: today, supersedes: old }));
    successor = { number, filename, created: true };
  }

  // Flip the old record last: successor exists (or is linked) by the time the
  // corpus ever shows a superseded status.
  const oldRaw = readFileSync(join(ctx.dir.abs, old.filename), "utf8");
  const flipped = flipSuperseded(oldRaw, old.style, successor);
  if (!flipped.ok) {
    return err(
      `Cannot flip ADR-${formatAdrId(old.number)} to superseded: ${flipped.error}. ` +
        (successor.created
          ? `The successor skeleton \`${ctx.dir.rel}/${successor.filename}\` was created — remove it or flip the old record by hand.`
          : "The successor's Supersedes link may already be written."),
    );
  }
  writeAdrFileAtomic(join(ctx.dir.abs, old.filename), flipped.text);

  const fresh = loadContext(env);
  const freshOld = fresh.corpus.records.find((r) => r.number === old.number);
  const freshNew = fresh.corpus.records.find((r) => r.number === successor.number);
  const lines = [
    successor.created
      ? `Created successor skeleton \`${ctx.dir.rel}/${successor.filename}\` (proposed) — fill its sections, then ratify with \`accept\`.`
      : `Paired existing ADR-${formatAdrId(successor.number)} as the successor.`,
    `Flipped **ADR-${formatAdrId(old.number)} — ${old.title}** to superseded (content untouched).`,
  ];
  appendIndexReminder(lines, fresh);
  return withWarning(ctx, {
    content: [{ type: "text", text: lines.join("\n") }],
    ...(freshNew && freshOld
      ? {
          structuredContent: {
            record: toPayloadRecord(freshNew),
            superseded: toPayloadRecord(freshOld),
          },
        }
      : {}),
  });
}

// ── shared helpers ────────────────────────────────────────────────────────

type FindResult = { ok: true; record: AdrRecordData } | { ok: false; error: string };

function findRecord(ctx: AdrContext, number: number): FindResult {
  const record = ctx.corpus.records.find((r) => r.number === number);
  if (record) return { ok: true, record };
  const malformed = ctx.corpus.malformed.find((m) => m.number === number);
  if (malformed) {
    return {
      ok: false,
      error: `ADR-${formatAdrId(number)} exists (\`${malformed.filename}\`) but cannot be parsed: ${malformed.reason}. Fix the file first.`,
    };
  }
  return {
    ok: false,
    error: `ADR-${formatAdrId(number)} not found in \`${ctx.dir.rel}\` (${ctx.corpus.records.length} record(s) parsed).`,
  };
}

/** Contract shape (`AdrRecord`) from the storage shape — drops file internals. */
function toPayloadRecord(r: AdrRecordData): AdrRecord {
  return {
    number: r.number,
    slug: r.slug,
    title: r.title,
    status: r.status,
    date: r.date,
    supersedes: r.supersedes,
    superseded_by: r.superseded_by,
    path: r.path,
  };
}

function buildListPayload(ctx: AdrContext): AdrListPayload {
  const counts = Object.fromEntries(ADR_STATUSES.map((s) => [s, 0])) as Record<
    (typeof ADR_STATUSES)[number],
    number
  >;
  for (const r of ctx.corpus.records) counts[r.status] += 1;
  return {
    dir: ctx.dir.rel,
    records: ctx.corpus.records.map(toPayloadRecord),
    counts,
    malformed: ctx.corpus.malformed.map((m) => ({
      filename: m.filename,
      number: m.number,
      reason: m.reason,
    })),
  };
}

function appendIndexReminder(lines: string[], ctx: AdrContext): void {
  if (!ctx.index) return;
  const stale = collectFindings(ctx).some((f) => f.kind === "stale-index");
  if (stale)
    lines.push(`_The corpus index \`${ctx.index.rel}\` is now stale — run \`adr index\`._`);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function withWarning(ctx: AdrContext, result: ToolResult): ToolResult {
  if (!ctx.warning) return result;
  const first = result.content[0];
  if (first) first.text = `⚠ ${ctx.warning} — using default ADR configuration.\n\n${first.text}`;
  return result;
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
