// Scoring: turn raw per-query decisions into TRIG-01..05 verdicts and a
// benchmark, following the checklist's 0.5 trigger-rate boundary and its
// blocker/major scoring rules.

/**
 * @typedef {Object} QueryResult
 * @property {import("./schema.mjs").QueryRecord} query
 * @property {(string|null)[]} decisions   one loaded-skill-name (or null) per run
 */

const PASS_BOUNDARY = 0.5;

/** rate at which the decider selected `target` across the runs of one query */
function triggerRate(decisions, target) {
  if (decisions.length === 0) return 0;
  const hits = decisions.filter((d) => d === target).length;
  return hits / decisions.length;
}

/** A query "passes" when observed triggering matches intent, split at 0.5. */
function queryPasses(rate, shouldTrigger) {
  return shouldTrigger ? rate > PASS_BOUNDARY : rate < PASS_BOUNDARY;
}

/**
 * @param {Object} args
 * @param {import("./schema.mjs").Dataset} args.dataset
 * @param {QueryResult[]} args.results
 * @param {number} [args.tolerance]           TRIG-05 band (default 0.15)
 * @param {number} [args.itemPassThreshold]   fraction of a group's queries that must
 *                                             pass for the TRIG item to pass (default 1.0 = strict,
 *                                             the checklist reading; relax to ~0.9 if desired)
 */
export function score({ dataset, results, tolerance = 0.15, itemPassThreshold = 1.0 }) {
  const target = dataset.target;

  const perQuery = results.map(({ query, decisions }) => {
    const rate = triggerRate(decisions, target);
    return {
      id: query.id,
      kind: query.kind,
      split: query.split,
      should_trigger: query.should_trigger,
      trigger_rate: Number(rate.toFixed(3)),
      runs: decisions.length,
      pass: queryPasses(rate, query.should_trigger),
    };
  });

  const group = (pred) => perQuery.filter(pred);
  const positives = group((q) => q.kind === "positive");
  const negatives = group((q) => q.kind === "negative");
  const compWin = group((q) => q.kind === "competition" && q.should_trigger === true);
  const compLose = group((q) => q.kind === "competition" && q.should_trigger === false);

  const itemVerdict = (group) => {
    if (group.length === 0) return { verdict: "not-evaluated", passed: 0, total: 0 };
    const passed = group.filter((q) => q.pass).length;
    const ok = passed / group.length >= itemPassThreshold;
    return { verdict: ok ? "pass" : "fail", passed, total: group.length };
  };

  // TRIG-05: does the validation split hold vs train?
  const passRate = (split) => {
    const g = perQuery.filter((q) => q.split === split);
    return g.length ? g.filter((q) => q.pass).length / g.length : null;
  };
  const trainRate = passRate("train");
  const valRate = passRate("validation");
  let trig05;
  if (trainRate === null || valRate === null) {
    trig05 = { verdict: "not-evaluated", train: trainRate, validation: valRate };
  } else {
    trig05 = {
      verdict: valRate >= trainRate - tolerance ? "pass" : "fail",
      train: Number(trainRate.toFixed(3)),
      validation: Number(valRate.toFixed(3)),
      tolerance,
    };
  }

  const items = {
    "TRIG-01": {
      severity: "blocker",
      desc: "should-trigger queries reach >0.5",
      ...itemVerdict(positives),
    },
    "TRIG-02": {
      severity: "major",
      desc: "near-miss negatives stay <0.5",
      ...itemVerdict(negatives),
    },
    "TRIG-03": { severity: "major", desc: "wins named competition", ...itemVerdict(compWin) },
    "TRIG-04": {
      severity: "major",
      desc: "loses to more-specific skill",
      ...itemVerdict(compLose),
    },
    "TRIG-05": { severity: "major", desc: "validation split holds vs train", ...trig05 },
  };

  // Overall Tier-B verdict per the checklist scoring rules.
  const blocker = items["TRIG-01"];
  const majors = ["TRIG-02", "TRIG-03", "TRIG-04", "TRIG-05"]
    .map((k) => items[k])
    .filter((it) => it.verdict === "pass" || it.verdict === "fail");
  const majorsPassed = majors.filter((it) => it.verdict === "pass").length;
  const majorPassRate = majors.length ? majorsPassed / majors.length : null;

  let verdict;
  if (blocker.verdict === "not-evaluated") verdict = "not-evaluated";
  else if (blocker.verdict === "fail") verdict = "not-ready";
  else if (majorPassRate === null)
    verdict = "provisional"; // no majors evaluated
  else verdict = majorPassRate >= 0.9 ? "ready" : "not-ready";

  const meanRate = (g) =>
    g.length ? Number((g.reduce((s, q) => s + q.trigger_rate, 0) / g.length).toFixed(3)) : null;

  return {
    skill: dataset.skill,
    target,
    verdict,
    items,
    summary: {
      majors_evaluated: majors.length,
      majors_passed: majorsPassed,
      blocker: blocker.verdict,
    },
    benchmark: {
      positives_mean_rate: meanRate(positives),
      negatives_mean_rate: meanRate(negatives),
      by_split: { train: trainRate, validation: valRate },
    },
    perQuery,
  };
}
