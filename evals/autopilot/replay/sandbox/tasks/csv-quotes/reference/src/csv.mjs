/**
 * Parses CSV text into an array of rows, each an array of field strings. Rows are separated by
 * "\n" (a trailing newline adds no row) and fields by ",". A field enclosed in double quotes may
 * contain commas, newlines and doubled quotes, `""` standing for one `"` (RFC 4180). A quoted
 * field left open at the end of the input is a SyntaxError.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
    i += 1;
  }
  if (quoted) throw new SyntaxError("parseCsv: unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
