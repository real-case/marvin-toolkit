#!/usr/bin/env node
// Trigger-eval runner.
//
//   node evals/trigger/run.mjs --skill commit --runs 3 --decider mock
//   node evals/trigger/run.mjs --skill all --decider api --model claude-sonnet-5
//   node evals/trigger/run.mjs --skill pr-create --decider claude-cli --workspace /path/with/plugin
//
// Loads the metadata catalog + one dataset per skill, asks the chosen decider
// which skill would load for each query (repeated `--runs` times to capture the
// stochastic trigger rate), scores against TRIG-01..05, and writes
// results/<skill>/{grading.json,benchmark.json}.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, catalogText } from "./lib/catalog.mjs";
import { validateDataset } from "./lib/schema.mjs";
import { score } from "./lib/score.mjs";
import { makeDecider, DECIDERS } from "./lib/deciders/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASETS = join(HERE, "datasets");
const RESULTS = join(HERE, "results");

function parseArgs(argv) {
  const a = { skill: "all", runs: 3, decider: "mock", concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--skill":
        a.skill = v;
        i++;
        break;
      case "--runs":
        a.runs = Number(v);
        i++;
        break;
      case "--decider":
        a.decider = v;
        i++;
        break;
      case "--model":
        a.model = v;
        i++;
        break;
      case "--workspace":
        a.workspace = v;
        i++;
        break;
      case "--decisions":
        a.decisions = v;
        i++;
        break;
      case "--concurrency":
        a.concurrency = Number(v);
        i++;
        break;
      case "--threshold":
        a.threshold = Number(v);
        i++;
        break;
      case "--help":
      case "-h":
        a.help = true;
        break;
      default:
        break;
    }
  }
  return a;
}

function usage() {
  console.log(`trigger-eval runner
  --skill <name|all>     dataset(s) to run (default: all)
  --runs <n>             runs per query, >=3 recommended (default: 3)
  --decider <kind>       ${DECIDERS.join(" | ")} (default: mock)
  --model <id>           model for api/claude-cli deciders
  --workspace <dir>      plugin-installed cwd for claude-cli decider
  --threshold <0..1>     fraction of a group's queries that must pass (default: 1.0, strict)
  --concurrency <n>      parallel decider calls (default: 4)`);
}

function loadDatasets(skill) {
  if (!existsSync(DATASETS)) return [];
  const files = readdirSync(DATASETS).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const wanted = skill === "all" ? files : files.filter((f) => f === `${skill}.json`);
  return wanted.map((f) => ({
    file: f,
    data: JSON.parse(readFileSync(join(DATASETS, f), "utf8")),
  }));
}

/** run an async mapper over items with a fixed concurrency cap, preserving order */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!DECIDERS.includes(args.decider))
    throw new Error(`--decider must be one of ${DECIDERS.join(", ")}`);

  const catalog = loadCatalog();
  const cText = catalogText(catalog);
  const decider = makeDecider(args.decider, {
    model: args.model,
    workspace: args.workspace,
    decisions: args.decisions,
  });
  const datasets = loadDatasets(args.skill);
  if (datasets.length === 0) {
    console.error(`no datasets found for "${args.skill}" under ${DATASETS}`);
    process.exit(2);
  }

  const overall = [];
  for (const { file, data } of datasets) {
    const check = validateDataset(data);
    if (!check.ok) {
      console.error(`✗ ${file} invalid:\n  - ${check.errors.join("\n  - ")}`);
      process.exitCode = 1;
      continue;
    }
    for (const w of check.warnings) console.error(`  ⚠ ${file}: ${w}`);

    const byName = new Set(catalog.map((s) => s.name));
    if (!byName.has(data.target))
      console.error(`  ⚠ ${file}: target "${data.target}" not in catalog`);

    // Each (query, run) is one decider call.
    const jobs = [];
    for (const q of data.queries) for (let r = 0; r < args.runs; r++) jobs.push({ q, r });
    const decisions = await pool(jobs, args.concurrency, async ({ q, r }) => {
      try {
        const d = await decider({
          catalog,
          catalogText: cText,
          query: q,
          target: data.target,
          runIndex: r,
          runs: args.runs,
        });
        return d.skill;
      } catch (e) {
        console.error(`  ! ${data.skill}/${q.id} run ${r}: ${e.message}`);
        return null;
      }
    });

    // regroup decisions per query
    const results = data.queries.map((q, qi) => ({
      query: q,
      decisions: decisions.slice(qi * args.runs, qi * args.runs + args.runs),
    }));

    const report = score({ dataset: data, results, itemPassThreshold: args.threshold ?? 1.0 });
    report.meta = { decider: args.decider, model: args.model || null, runs: args.runs };

    const dir = join(RESULTS, data.skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "grading.json"),
      JSON.stringify({ perQuery: report.perQuery, items: report.items }, null, 2),
    );
    writeFileSync(
      join(dir, "benchmark.json"),
      JSON.stringify(
        {
          verdict: report.verdict,
          summary: report.summary,
          benchmark: report.benchmark,
          meta: report.meta,
        },
        null,
        2,
      ),
    );

    overall.push(report);
    printSkill(report);
  }

  console.log("\n=== Tier-B trigger summary ===");
  for (const r of overall) {
    console.log(
      `${verdictMark(r.verdict)} ${r.skill.padEnd(18)} ${r.verdict.padEnd(14)} ` +
        `majors ${r.summary.majors_passed}/${r.summary.majors_evaluated}  blocker(TRIG-01)=${r.summary.blocker}`,
    );
  }
  const notReady = overall.filter((r) => r.verdict === "not-ready");
  if (notReady.length) process.exitCode = 1;
}

function verdictMark(v) {
  return v === "ready" ? "✅" : v === "not-ready" ? "❌" : "•";
}

function printSkill(r) {
  console.log(`\n▸ ${r.skill} — ${r.verdict} (decider=${r.meta.decider}, runs=${r.meta.runs})`);
  for (const [id, it] of Object.entries(r.items)) {
    const detail =
      it.total !== undefined
        ? `${it.passed}/${it.total}`
        : `train=${it.train} val=${it.validation}`;
    console.log(
      `   ${id} [${it.severity}] ${String(it.verdict).padEnd(13)} ${detail}  — ${it.desc}`,
    );
  }
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
