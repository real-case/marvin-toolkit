/**
 * Parses CSV text into an array of rows, each an array of field strings. Rows are separated by
 * "\n" (a trailing newline adds no row) and fields by ",".
 */
export function parseCsv(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.split(","));
}
