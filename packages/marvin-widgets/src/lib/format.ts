/**
 * Render an ISO datetime as its `YYYY-MM-DD` date — by string prefix, never via
 * `Date`/`toLocaleDateString`, so the output is deterministic and locale-free:
 * visual snapshots and story assertions must not drift with the machine's
 * timezone or locale. Total function: anything that does not look like an ISO
 * date (shorter than 10 chars, or not starting with 4 digits + `-`) is returned
 * unchanged rather than throwing — widgets render whatever the artifact stored.
 */
export function formatDate(iso: string): string {
  if (iso.length < 10 || !/^\d{4}-/.test(iso)) return iso;
  return iso.slice(0, 10);
}
