// Audit of the skill surface against the trigger-eval datasets.
//
// Pure and directory-parameterised, like committed-artifact.mjs beside it: every
// path is an argument and none is resolved from module-relative state, so both
// callers and the fixtures that test them drive it the same way.
//
// Two callers with deliberately different scopes:
//   scripts/lint-manifests.mjs  — missingDatasets / parityViolations / nonCanonicalFlags,
//                                 the three that are shipping obligations of the skill surface
//   evals/trigger/self-test.mjs — all seven, since the rest are the harness's own invariants
//
// On the canonical set. The human-run flag has three readers and they do NOT
// accept the same values:
//
//   value      catalog.mjs:36+63   help-data.ts (ADR-0005)   gen-catalog.mjs:81
//   true       human-run           human-run                 human-run
//   "true"     human-run           human-run                 human-run
//   'true'     human-run           human-run                 NOT flagged
//   True       not flagged         not flagged               not flagged
//
// catalog.mjs strips ["'] before a case-sensitive `=== "true"`; the site's regex is
// /^disable-model-invocation:\s*"?true"?\s*$/m, which has neither an `i` flag nor a
// single-quote alternative. So a skill written `'true'` would be human-run in Claude
// Code and in /marvin:help while the public site advertised it as model-invocable —
// the drift class ADR-era spec `single-source-human-run-flag` removed, one quote away.
// CANONICAL is therefore the INTERSECTION of the three readers, not their union, and
// an absent key is canonical (35 of the 39 shipped skills have none).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// One written form per meaning, chosen as the intersection above. All three readers
// would also agree that `'false'` and `False` are not human-run, so rejecting those
// is a spelling policy rather than a correctness one — the correctness cases are
// `True` and `'true'`, which the readers genuinely disagree about.
const CANONICAL_VALUES = new Set(["true", "false", '"true"', '"false"']);
/** The subset of those that mean human-run. */
const HUMAN_VALUES = new Set(["true", '"true"']);

/** The seven violation categories, in report order. */
export const AUDIT_CATEGORIES = [
  "missingDatasets",
  "orphanDatasets",
  "parityViolations",
  "nonCanonicalFlags",
  "unknownWinners",
  "missingNotes",
  "missingMockRate",
];

/** Extract the frontmatter block (between the first two `---` fences), or null. */
function frontmatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? null : text.slice(3, end);
}

/**
 * Read the human-run flag of every skill under `skillsDir`.
 *
 * The raw value is kept verbatim — quotes and case included — because that is
 * what the canonical-form rule judges. `human` follows the intersection above,
 * so a non-canonical value is never treated as human-run; it is reported by
 * `nonCanonicalFlags` instead, and the two categories never mask each other.
 *
 * @param {string} skillsDir
 * @returns {Map<string, { raw: string | undefined, human: boolean, canonical: boolean }>}
 */
export function readSkillFlags(skillsDir) {
  const flags = new Map();
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const fm = frontmatter(readFileSync(file, "utf8"));
    const match = fm?.match(/^disable-model-invocation:[ \t]*(.*)$/m);
    const raw = match ? match[1].trim() : undefined;
    flags.set(entry.name, {
      raw,
      human: raw !== undefined && HUMAN_VALUES.has(raw),
      canonical: raw === undefined || CANONICAL_VALUES.has(raw),
    });
  }
  return flags;
}

/**
 * Dataset basenames under `datasetsDir`, mirroring run.mjs:87 by ignoring
 * `_`-prefixed files — otherwise a future `_template.json` would be reported as
 * an orphan by a rule the runner itself skips.
 */
function datasetNames(datasetsDir) {
  return readdirSync(datasetsDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.slice(0, -".json".length));
}

/**
 * Audit the skill surface against the datasets.
 *
 * Throws only when a directory is unreadable or a dataset is not valid JSON —
 * every other problem is reported, never raised.
 *
 * @param {{ skillsDir: string, datasetsDir: string }} dirs
 */
export function auditSkillDatasets({ skillsDir, datasetsDir }) {
  const flags = readSkillFlags(skillsDir);
  // localeCompare, matching catalog.mjs:70, so the two orderings cannot diverge
  // and redden a blocking gate over a punctuation or case difference rather than
  // over a rule. A default code-unit sort disagrees with it on hyphen and case
  // combinations that skill names are free to contain.
  const skills = [...flags.keys()].sort((a, b) => a.localeCompare(b));
  const skillSet = new Set(skills);
  const datasets = datasetNames(datasetsDir).sort((a, b) => a.localeCompare(b));

  const audit = {
    skills,
    datasets,
    missingDatasets: skills.filter((s) => !datasets.includes(s)),
    orphanDatasets: datasets.filter((d) => !skillSet.has(d)),
    parityViolations: [],
    nonCanonicalFlags: [],
    unknownWinners: [],
    missingNotes: [],
    missingMockRate: [],
  };

  for (const [skill, flag] of flags) {
    if (!flag.canonical) audit.nonCanonicalFlags.push({ skill, raw: flag.raw });
  }

  for (const name of datasets) {
    const data = JSON.parse(readFileSync(join(datasetsDir, `${name}.json`), "utf8"));

    // Parity is evaluated over the INTERSECTION only. A skill with no dataset is
    // already reported under missingDatasets and must not be double-counted; an
    // absent field on either side normalises to false, which is what the 35
    // shipped datasets that omit it require.
    if (skillSet.has(name)) {
      const inFrontmatter = flags.get(name).human;
      const inDataset = data.disable_model_invocation === true;
      if (inFrontmatter !== inDataset) {
        audit.parityViolations.push({
          skill: name,
          frontmatter: inFrontmatter,
          dataset: inDataset,
        });
      }
    }

    for (const query of data.queries ?? []) {
      // A competition winner must be reachable in the catalog a decider is shown.
      // catalogText renders skills only, and filters human-run ones out, so a
      // prompt without a SKILL.md and a human-run skill are equally unpickable.
      if (query.kind === "competition") {
        const reason = !skillSet.has(query.winner)
          ? "no-skill"
          : flags.get(query.winner).human
            ? "human-run"
            : null;
        if (reason) {
          audit.unknownWinners.push({
            dataset: name,
            queryId: query.id,
            winner: query.winner,
            reason,
          });
        }
      }
      // Notes justify where a near-miss should route instead. Positives are
      // exempt: 345 of the 346 shipped ones carry none, while all 399 negatives
      // and all 137 competition rows do.
      if (
        (query.kind === "negative" || query.kind === "competition") &&
        !String(query.note ?? "").trim()
      ) {
        audit.missingNotes.push({ dataset: name, queryId: query.id, kind: query.kind });
      }
      // An explicit mock_rate keeps the intended rate visible at the query rather
      // than implied by the decider. It buys explicitness, not correctness: every
      // one of the 882 shipped rates is 0 or 1, identical to the mock decider's
      // own `should_trigger ? 1 : 0` fallback, so the sweep would score the same
      // without it. What the rule prevents is a rate that silently DISAGREES with
      // should_trigger once someone starts authoring intermediate values.
      if (typeof query.mock_rate !== "number") {
        audit.missingMockRate.push({ dataset: name, queryId: query.id });
      }
    }
  }

  return audit;
}

/** One human-readable line per violation of `category`. */
function describe(category, item) {
  switch (category) {
    case "missingDatasets":
      return `skill "${item}" has no evals/trigger/datasets/${item}.json`;
    case "orphanDatasets":
      return `dataset "${item}.json" has no matching skill directory`;
    case "parityViolations":
      return `skill "${item.skill}": frontmatter says human-run=${item.frontmatter} but its dataset says disable_model_invocation=${item.dataset}`;
    case "nonCanonicalFlags":
      return `skill "${item.skill}": disable-model-invocation value ${JSON.stringify(item.raw)} is not canonical — use one of true, false, "true", "false"`;
    case "unknownWinners":
      return `dataset "${item.dataset}" query "${item.queryId}": competition winner "${item.winner}" is not reachable in the catalog (${item.reason})`;
    case "missingNotes":
      return `dataset "${item.dataset}" query "${item.queryId}": a ${item.kind} query needs a note saying where it should route`;
    case "missingMockRate":
      return `dataset "${item.dataset}" query "${item.queryId}": missing an explicit mock_rate`;
    default:
      return `${category}: ${JSON.stringify(item)}`;
  }
}

/**
 * Audit and format in one call, ready for `failures.push(...)`.
 *
 * @param {{ skillsDir: string, datasetsDir: string, keys?: string[] }} options
 * @returns {string[]}
 */
export function skillDatasetFailures({ skillsDir, datasetsDir, keys = AUDIT_CATEGORIES }) {
  const audit = auditSkillDatasets({ skillsDir, datasetsDir });
  return keys.flatMap((key) => audit[key].map((item) => describe(key, item)));
}
