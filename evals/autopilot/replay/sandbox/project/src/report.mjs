import { parseCsv } from "./csv.mjs";

/**
 * The sum of one numeric column of a CSV table whose first row is the header. Throws a
 * RangeError when the header has no such column.
 */
export function totals(csvText, column) {
  const [header, ...rows] = parseCsv(csvText);
  const index = header.indexOf(column);
  if (index === -1) throw new RangeError(`no column ${column}`);
  return rows.reduce((sum, row) => sum + Number(row[index]), 0);
}
