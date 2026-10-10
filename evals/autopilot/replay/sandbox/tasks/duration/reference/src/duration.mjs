const UNITS = [
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1000],
  ["ms", 1],
];
const PATTERN = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?$/;

/**
 * Milliseconds from one or more `<integer><unit>` groups, units `h`, `m`, `s` and `ms` in that
 * order, each at most once: `1h30m`, `45s`, `2m500ms`. Anything else, the empty string included,
 * is a TypeError.
 */
export function parseDuration(text) {
  const match = typeof text === "string" && text !== "" ? PATTERN.exec(text) : null;
  if (!match || match.slice(1).every((g) => g === undefined)) {
    throw new TypeError(`parseDuration: not a duration: ${JSON.stringify(text)}`);
  }
  return UNITS.reduce((ms, [, size], i) => ms + Number(match[i + 1] ?? 0) * size, 0);
}

/** The inverse of parseDuration for a non-negative integer: zero units omitted, `0ms` for 0. */
export function formatDuration(ms) {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new TypeError(`formatDuration: not a non-negative integer: ${ms}`);
  }
  if (ms === 0) return "0ms";
  let rest = ms;
  let out = "";
  for (const [unit, size] of UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) out += `${n}${unit}`;
  }
  return out;
}
