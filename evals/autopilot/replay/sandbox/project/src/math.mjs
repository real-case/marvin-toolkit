/** The sum of two numbers. */
export function add(a, b) {
  return a + b;
}

/** The arithmetic mean of a non-empty array of numbers. */
export function mean(values) {
  if (values.length === 0) throw new RangeError("mean of an empty array");
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
