// Audit of the skill surface against the trigger-eval datasets, and of the three
// authored surfaces — skills/, agents/, commands/ — against their structural pins.
//
// The name under-describes the contents since the surface rules landed. It is kept
// because three callers and a test import this module by path.
//
// Pure and directory-parameterised, like committed-artifact.mjs beside it: every
// path is an argument and none is resolved from module-relative state, so all three
// callers and the fixtures that test them drive it the same way.
//
// Three callers with deliberately different scopes:
//   scripts/lint-manifests.mjs  — missingDatasets / parityViolations / nonCanonicalFlags,
//                                 the three that are shipping obligations of the skill surface
//   evals/trigger/self-test.mjs — DATASET_CATEGORIES, the harness's own invariants
//   scripts/lint-skills.mjs     — SURFACE_CATEGORIES, the six structural pins
//
// Fail-open on inputs, by design and only here: a check whose input directory was
// not supplied contributes an EMPTY array and never throws, which is what lets the
// three callers ask for different halves and what keeps the fixture trees — none of
// which have an agents/ or a commands/ — green. The fail-CLOSED half lives in each
// runner, which asserts its inputs exist before calling in. A guard of the form
// "check only if the directory exists" written HERE instead would turn a blocking
// gate green on an empty tree.
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

// ── surface policy ──────────────────────────────────────────────────────────
//
// Closed frontmatter allowlists, one per authored surface. Measured on the tree
// that ships them: skills carry exactly these three distinct keys, agents exactly
// these five, commands exactly one.
//
// Closed is the point and it has a cost: the day Claude Code adds a legitimate key
// this rule blocks the upgrade until the allowlist is widened here, in the same
// commit. That trade is worth taking only because an unknown key is silently
// IGNORED by the host — nothing else would ever report it.
const FRONTMATTER_KEYS = {
  skills: ["name", "description", "disable-model-invocation"],
  agents: ["name", "description", "model", "color", "tools"],
  commands: ["description"],
};

/**
 * Description budget. A declared budget, not a discovered host limit — the longest
 * shipped description is `debug` at 830 characters. If Claude Code's real ceiling
 * is ever found to differ, this is the one line that moves.
 */
export const DESCRIPTION_MAX = 1024;

/**
 * The agents deliberately left without a `tools:` allowlist.
 *
 * An agent that omits `tools:` inherits EVERY tool, so the allowlist is what
 * actually enforces a read-only contract; CLAUDE.md declares these three
 * code-writing agents deliberate. A fourth belongs here only as a reviewed line in
 * a PR, which is precisely the friction this whitelist exists to create.
 */
export const UNTOOLED_AGENTS = [
  "marvin-researcher",
  "marvin-tm-executor",
  "marvin-tm-review-fixer",
];

/** The seven dataset violation categories, in report order. */
export const DATASET_CATEGORIES = [
  "missingDatasets",
  "orphanDatasets",
  "parityViolations",
  "nonCanonicalFlags",
  "unknownWinners",
  "missingNotes",
  "missingMockRate",
];

/** The six authored-surface violation categories, in report order. */
export const SURFACE_CATEGORIES = [
  "unknownFrontmatterKeys",
  "badDescriptions",
  "nameMismatches",
  "danglingSkillRefs",
  "untooledAgents",
  "wrapperDrift",
];

/**
 * Every category, so `skillDatasetFailures`'s default key set still means
 * "everything".
 *
 * The two halves are exported separately because `evals/trigger/self-test.mjs`
 * asserts every category in the list it iterates is empty, under a check named
 * "datasets satisfy every enforced invariant", at a call site that passes only
 * `skillsDir` and `datasetsDir`. Putting the surface categories inside that
 * assertion would make it claim thirteen invariants while structurally able to
 * substantiate seven — permanently empty, permanently green. The self-test
 * therefore iterates DATASET_CATEGORIES, and test/skill-datasets.test.mjs pins
 * both the split and that import, since no run can fail on it by itself.
 */
export const AUDIT_CATEGORIES = [...DATASET_CATEGORIES, ...SURFACE_CATEGORIES];

/** Extract the frontmatter block (between the first two `---` fences), or null. */
function frontmatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? null : text.slice(3, end);
}

/**
 * Top-level frontmatter keys, in file order.
 *
 * Zero indent is the discriminator: a wrapped or folded value's continuation lines
 * are indented, so `- item:` and `  detail:` inside a value are not keys.
 */
function frontmatterKeys(block) {
  return [...block.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((m) => m[1]);
}

/**
 * The scalar value of one top-level frontmatter key: trimmed, with a surrounding
 * pair of quotes removed, or undefined.
 *
 * Quoting a scalar is legal YAML and the toolchain already accepts it: the `field`
 * reader in evals/trigger/lib/catalog.mjs, which enforces `name` and `description`
 * over these same files inside the blocking `eval:self-test` step, strips quotes
 * before comparing. Reading the raw scalar here would reject `name: "commit"` in a
 * gate nothing else objects to — a third reader disagreeing with the two it joins,
 * which is the drift class this module exists to remove. The stripping rule is
 * therefore deliberately catalog.mjs's own: at most one leading and one trailing
 * quote character.
 *
 * The human-run flag is NOT read through here and must not be: `readSkillFlags`
 * keeps its scalar verbatim because the canonical-form rule judges the quoting
 * itself, and `'true'` is non-canonical on purpose (see the header).
 */
function frontmatterValue(block, key) {
  const match = block.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

/**
 * Candidate `skills/…` paths in a body, as written.
 *
 * The extraction rule is stated absolutely because the naive form is WRONG on the
 * tree it guards: a candidate is `skills/` followed by at least two path segments
 * AND ending in a file extension. The repository writes `skills/…` with a literal
 * ellipsis four times as prose — the idiom that explains a path resolving through
 * all three entry points — and a rule that treats every `skills/`-prefixed token as
 * a path reports all four and fails permanently. One segment and no extension is
 * what excludes them. Trailing markdown punctuation is stripped so a reference at
 * the end of a sentence is read as the path it is.
 */
function skillRefs(text) {
  const refs = [];
  for (const match of text.match(/skills\/[^\s`"'()[\]{}<>|]+/g) ?? []) {
    const ref = match.replace(/[.,;:!?]+$/, "");
    if (/^skills\/[^/]+\/[^/]+/.test(ref) && /\.[A-Za-z0-9]+$/.test(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * One body per authored unit: `skills/<name>/SKILL.md`, `agents/<name>.md`,
 * `commands/<name>.md`. Nothing under `references/` — a `skills/…` path written in
 * a reference file is knowingly unguarded (both such paths on the current tree
 * resolve, so either reading passes; the clean line is the cheaper rule).
 *
 * A directory that was not supplied contributes nothing.
 */
function authoredUnits({ skillsDir, agentsDir, commandsDir }) {
  const units = [];
  if (skillsDir) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(file)) continue;
      units.push({
        surface: "skills",
        name: entry.name,
        unit: "directory",
        label: `skills/${entry.name}/SKILL.md`,
        file,
      });
    }
  }
  for (const [surface, dir] of [
    ["agents", agentsDir],
    ["commands", commandsDir],
  ]) {
    if (!dir) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      units.push({
        surface,
        name: entry.slice(0, -".md".length),
        unit: "filename",
        label: `${surface}/${entry}`,
        file: join(dir, entry),
      });
    }
  }
  return units;
}

/**
 * Read the human-run flag of every skill under `skillsDir`.
 *
 * The raw value is kept verbatim — quotes and case included — because that is
 * what the canonical-form rule judges; hence the read here rather than
 * `frontmatterValue`, whose quote-stripping would turn `'true'` into an accepted
 * form. `human` follows the intersection above,
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
 * Audit the skill surface against the datasets, and the authored surfaces against
 * their structural pins.
 *
 * Throws only when a SUPPLIED directory is unreadable or a dataset is not valid
 * JSON — every other problem is reported, never raised. An input that was not
 * supplied leaves its categories empty (see the header): `datasetsDir` omitted
 * silences the six dataset categories including coverage, leaving only
 * `nonCanonicalFlags`, which reads skill frontmatter; `agentsDir` / `commandsDir`
 * omitted narrow the surface walk; `packDir` omitted silences reference
 * resolution; `promptNames` omitted silences wrapper coverage.
 *
 * @param {{
 *   skillsDir: string,
 *   datasetsDir?: string,
 *   agentsDir?: string,
 *   commandsDir?: string,
 *   packDir?: string,
 *   promptNames?: string[],
 *   descriptionMax?: number,
 *   untooledAgentWhitelist?: string[],
 * }} options
 */
export function auditSkillDatasets({
  skillsDir,
  datasetsDir,
  agentsDir,
  commandsDir,
  packDir,
  promptNames,
  descriptionMax = DESCRIPTION_MAX,
  untooledAgentWhitelist = UNTOOLED_AGENTS,
}) {
  const flags = readSkillFlags(skillsDir);
  // localeCompare, matching catalog.mjs:70, so the two orderings cannot diverge
  // and redden a blocking gate over a punctuation or case difference rather than
  // over a rule. A default code-unit sort disagrees with it on hyphen and case
  // combinations that skill names are free to contain.
  const skills = [...flags.keys()].sort((a, b) => a.localeCompare(b));
  const skillSet = new Set(skills);
  const datasets = datasetsDir ? datasetNames(datasetsDir).sort((a, b) => a.localeCompare(b)) : [];

  const audit = {
    skills,
    datasets,
    // Coverage is silent without a datasets directory rather than reporting every
    // skill as uncovered: "not supplied" is not "empty".
    missingDatasets: datasetsDir ? skills.filter((s) => !datasets.includes(s)) : [],
    orphanDatasets: datasetsDir ? datasets.filter((d) => !skillSet.has(d)) : [],
    parityViolations: [],
    nonCanonicalFlags: [],
    unknownWinners: [],
    missingNotes: [],
    missingMockRate: [],
    unknownFrontmatterKeys: [],
    badDescriptions: [],
    nameMismatches: [],
    danglingSkillRefs: [],
    untooledAgents: [],
    wrapperDrift: [],
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

  // ── the authored surfaces ────────────────────────────────────────────────
  const untooled = new Set(untooledAgentWhitelist);

  for (const unit of authoredUnits({ skillsDir, agentsDir, commandsDir })) {
    const text = readFileSync(unit.file, "utf8");
    const block = frontmatter(text) ?? "";
    const allowed = FRONTMATTER_KEYS[unit.surface];
    const keys = frontmatterKeys(block);

    // 1. closed allowlist
    for (const key of keys) {
      if (!allowed.includes(key)) {
        audit.unknownFrontmatterKeys.push({
          surface: unit.surface,
          file: unit.label,
          key,
          allowed,
        });
      }
    }

    // 2. description budget. An absent frontmatter block lands here too, which is
    //    what keeps a file with no frontmatter at all from passing every check.
    const description = frontmatterValue(block, "description") ?? "";
    if (!description) {
      audit.badDescriptions.push({ surface: unit.surface, file: unit.label });
    } else if (description.length > descriptionMax) {
      audit.badDescriptions.push({
        surface: unit.surface,
        file: unit.label,
        length: description.length,
        max: descriptionMax,
      });
    }

    // 3. `name` agreement. Commands are deliberately exempt, and it is not an
    //    oversight: their allowlist is `description` alone, so a `name` key on a
    //    command is already a check-1 violation and there is nothing to compare.
    if (unit.surface !== "commands") {
      const declared = frontmatterValue(block, "name");
      if (declared !== unit.name) {
        audit.nameMismatches.push({
          surface: unit.surface,
          file: unit.label,
          name: declared,
          expected: unit.name,
          unit: unit.unit,
        });
      }
    }

    // 4. reference resolution, against the PLUGIN root — a `skills/…` path in a
    //    body is written for the plugin's own root, which is what the MCP door
    //    resolves it against (ADR-0008). Against the repository root every real
    //    reference would be dangling.
    if (packDir) {
      for (const ref of skillRefs(text)) {
        if (!existsSync(join(packDir, ref))) {
          audit.danglingSkillRefs.push({ surface: unit.surface, file: unit.label, ref });
        }
      }
    }

    // 5. an agent with no `tools:` inherits every tool
    if (unit.surface === "agents" && !keys.includes("tools") && !untooled.has(unit.name)) {
      audit.untooledAgents.push({ file: unit.label, agent: unit.name });
    }
  }

  // 6. wrapper coverage: the set of prompts with no commands/<name>.md is exactly
  //    the set of track-* prompts. Stated as that rule rather than as a literal
  //    list of the wrapper-less names, which the next command added satisfies
  //    silently. Reported in both directions, plus a wrapper with no prompt behind
  //    it — cheap while both directories are already read, and without it the pin
  //    is one-directional.
  if (promptNames && commandsDir) {
    const wrappers = new Set(
      readdirSync(commandsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -".md".length)),
    );
    const prompts = new Set(promptNames);
    for (const name of promptNames) {
      const isTrack = name.startsWith("track-");
      if (!isTrack && !wrappers.has(name)) audit.wrapperDrift.push({ kind: "no-wrapper", name });
      if (isTrack && wrappers.has(name)) audit.wrapperDrift.push({ kind: "track-wrapper", name });
    }
    for (const name of [...wrappers].sort((a, b) => a.localeCompare(b))) {
      if (!prompts.has(name)) audit.wrapperDrift.push({ kind: "orphan-wrapper", name });
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
    case "unknownFrontmatterKeys":
      return `${item.surface}: ${item.file} carries frontmatter key "${item.key}" — a ${item.surface} entry may declare only ${item.allowed.join(", ")}`;
    case "badDescriptions":
      return item.length === undefined
        ? `${item.surface}: ${item.file} has no non-empty frontmatter description`
        : `${item.surface}: ${item.file} description is ${item.length} characters, over the ${item.max} budget`;
    case "nameMismatches":
      return item.name === undefined
        ? `${item.surface}: ${item.file} declares no \`name\` — it must equal its ${item.unit} "${item.expected}"`
        : `${item.surface}: ${item.file} declares name "${item.name}" but its ${item.unit} is "${item.expected}"`;
    case "danglingSkillRefs":
      return `${item.surface}: ${item.file} references "${item.ref}", which does not resolve under the plugin root`;
    case "untooledAgents":
      return `agents: ${item.file} omits a \`tools:\` allowlist, so "${item.agent}" inherits every tool — add the allowlist, or add the agent to UNTOOLED_AGENTS in scripts/lib/skill-datasets.mjs`;
    case "wrapperDrift":
      switch (item.kind) {
        case "no-wrapper":
          return `commands: prompt "${item.name}" has no commands/${item.name}.md — every prompt outside the track-* group ships a markdown wrapper`;
        case "track-wrapper":
          return `commands: commands/${item.name}.md wraps a track-* prompt — the track group is thin tool wrappers with no commands/ entry (ADR-0032)`;
        default:
          return `commands: commands/${item.name}.md has no prompt named "${item.name}" in the registry`;
      }
    default:
      return `${category}: ${JSON.stringify(item)}`;
  }
}

/**
 * Audit and format in one call, ready for `failures.push(...)`.
 *
 * Every input is forwarded verbatim. Dropping one here would leave its checks with
 * no input, hence empty, hence a runner printing OK over a violating tree — the
 * module's fail-open half biting from the wrong side.
 *
 * @param {{
 *   skillsDir: string,
 *   datasetsDir?: string,
 *   agentsDir?: string,
 *   commandsDir?: string,
 *   packDir?: string,
 *   promptNames?: string[],
 *   descriptionMax?: number,
 *   untooledAgentWhitelist?: string[],
 *   keys?: string[],
 * }} options
 * @returns {string[]}
 */
export function skillDatasetFailures({
  skillsDir,
  datasetsDir,
  agentsDir,
  commandsDir,
  packDir,
  promptNames,
  descriptionMax,
  untooledAgentWhitelist,
  keys = AUDIT_CATEGORIES,
}) {
  const audit = auditSkillDatasets({
    skillsDir,
    datasetsDir,
    agentsDir,
    commandsDir,
    packDir,
    promptNames,
    descriptionMax,
    untooledAgentWhitelist,
  });
  return keys.flatMap((key) => audit[key].map((item) => describe(key, item)));
}
