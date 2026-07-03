// Dataset schema + validation for trigger eval sets.
//
// One dataset file per skill under datasets/<skill>.json. Query records follow
// the measurement protocol in README.md: realistic phrasings, near-miss
// negatives, an explicit train/validation split, and competition queries that
// name the adjacent skill that should win.

export const KINDS = ["positive", "negative", "competition"];
export const SPLITS = ["train", "validation"];

/**
 * @typedef {Object} QueryRecord
 * @property {string} id                 unique within the dataset
 * @property {string} text               the user prompt to test
 * @property {boolean} should_trigger    true = this skill should be loaded
 * @property {"train"|"validation"} split
 * @property {"positive"|"negative"|"competition"} kind
 * @property {string} [winner]           for competition: the skill that should win
 * @property {number} [mock_rate]        mock-decider only: forced target-selection rate 0..1
 * @property {string} [note]
 *
 * @typedef {Object} Dataset
 * @property {string} skill
 * @property {string} target             skill name that "triggering" means (usually === skill)
 * @property {QueryRecord[]} queries
 */

/**
 * Validate a dataset object. Returns hard errors (block a run) and soft
 * warnings (protocol guidance that does not block).
 * @param {any} ds
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateDataset(ds) {
  const errors = [];
  const warnings = [];
  const bad = (m) => errors.push(m);

  if (!ds || typeof ds !== "object") return { ok: false, errors: ["not an object"], warnings };
  if (typeof ds.skill !== "string") bad("skill must be a string");
  if (typeof ds.target !== "string") bad("target must be a string");
  if (!Array.isArray(ds.queries))
    return { ok: false, errors: [...errors, "queries must be an array"], warnings };

  const ids = new Set();
  let pos = 0;
  let neg = 0;
  for (const [i, q] of ds.queries.entries()) {
    const at = `queries[${i}]`;
    if (typeof q.id !== "string" || !q.id) bad(`${at}.id must be a non-empty string`);
    else if (ids.has(q.id)) bad(`${at}.id "${q.id}" is duplicated`);
    else ids.add(q.id);
    if (typeof q.text !== "string" || !q.text.trim()) bad(`${at}.text must be a non-empty string`);
    if (typeof q.should_trigger !== "boolean") bad(`${at}.should_trigger must be a boolean`);
    if (!SPLITS.includes(q.split)) bad(`${at}.split must be one of ${SPLITS.join("|")}`);
    if (!KINDS.includes(q.kind)) bad(`${at}.kind must be one of ${KINDS.join("|")}`);
    if (q.kind === "competition" && typeof q.winner !== "string") {
      bad(`${at} is competition but has no winner`);
    }
    if (
      q.mock_rate !== undefined &&
      (typeof q.mock_rate !== "number" || q.mock_rate < 0 || q.mock_rate > 1)
    ) {
      bad(`${at}.mock_rate must be a number in [0,1]`);
    }
    if (q.kind === "positive") pos++;
    if (q.kind === "negative") neg++;
  }

  const dmi = ds.disable_model_invocation === true;
  if (dmi) {
    // Human-run skills never auto-trigger, so 0 positives is correct; flag the contradiction instead.
    if (pos > 0)
      warnings.push(`disable_model_invocation dataset should have 0 positives, found ${pos}`);
  } else if (pos < 8) {
    warnings.push(`only ${pos} positive queries (protocol wants 8–10)`);
  }
  if (neg < 8) warnings.push(`only ${neg} negative near-miss queries (protocol wants 8–10)`);
  const valFrac =
    ds.queries.filter((q) => q.split === "validation").length / (ds.queries.length || 1);
  if (valFrac < 0.25 || valFrac > 0.55) {
    warnings.push(`validation split is ${(valFrac * 100).toFixed(0)}% (protocol wants ~40%)`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
