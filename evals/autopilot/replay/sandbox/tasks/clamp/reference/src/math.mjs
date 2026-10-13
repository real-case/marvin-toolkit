/** The sum of two numbers. */
export function add(a, b) {
  return a + b;
}

/** The arithmetic mean of a non-empty array of numbers. */
export function mean(values) {
  if (values.length === 0) throw new RangeError("mean of an empty array");
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** x limited to the closed range [lo, hi]; a RangeError when lo > hi. */
export function clamp(x, lo, hi) {
  if (lo > hi) throw new RangeError(`clamp: lo (${lo}) exceeds hi (${hi})`);
  return Math.min(hi, Math.max(lo, x));
}
