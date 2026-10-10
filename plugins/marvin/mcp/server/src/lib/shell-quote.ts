/**
 * Placeholder substitution into a shell command template, shared by the two readers of
 * `gates.test_one`: the autopilot seal stage (`formatTestOne`, which runs one whole test file)
 * and the oracle resolver (`resolveOracleCommand`, which `verify` and the gate stage use to run
 * one criterion's test). One template has to work for both, so both encode a substituted value
 * the same way, here.
 *
 * The value is data, a path or a test name a spec author wrote, so it must reach the shell as
 * literal text whatever it contains: `src/app/(dashboard)/[id]/x.test.ts`, a space, `$HOME`, a
 * single quote. How that is written depends on where the placeholder sits in the template:
 *
 * | Context            | Example template      | Encoding                                        |
 * |--------------------|-----------------------|-------------------------------------------------|
 * | unquoted           | `vitest run {file}`   | the value in single quotes (`shellQuote`)        |
 * | inside `'…'`       | `pytest -k '{name}'`  | each `'` closed, escaped and reopened (`'\''`)   |
 * | inside `"…"`       | `vitest -t "{name}"`  | `\`, `"`, `$` and a backtick backslash-escaped   |
 * | behind a backslash | `run \{file}`         | inserted as is (the template's own, odd, choice) |
 *
 * So an unquoted placeholder is quoted, and a placeholder the template author already quoted is
 * escaped for that quote rather than quoted again, which would have turned the added quotes
 * into literal characters. Templates written for the older literal substitution keep working.
 */

/** One shell word: `word` in single quotes, a quote inside it closed, escaped and reopened. */
export const shellQuote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/** Where a placeholder sits in a template, as the shell would read it. */
export type PlaceholderContext = "unquoted" | "single" | "double" | "escaped";

/** `value` written so that, in `context`, the shell reads it back as exactly `value`. */
export function encodeForContext(value: string, context: PlaceholderContext): string {
  switch (context) {
    case "unquoted":
      return shellQuote(value);
    case "single":
      return value.replaceAll("'", "'\\''");
    case "double":
      return value.replace(/[\\"$`]/g, "\\$&");
    case "escaped":
      return value;
  }
}

/**
 * Walks `template` the way a POSIX shell tokenises quotes and calls `replace` for every
 * occurrence of one of `placeholders`, with the context it sits in; the placeholder is replaced
 * by what `replace` returns, and every other character is kept. A placeholder is recognised in
 * every context, including inside single quotes, because that is where a template author puts a
 * test name with spaces (`-k '{name}'`).
 */
export function substitutePlaceholders(
  template: string,
  placeholders: readonly string[],
  replace: (placeholder: string, context: PlaceholderContext) => string,
): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  const at = (i: number) => placeholders.find((p) => template.startsWith(p, i));
  for (let i = 0; i < template.length; i += 1) {
    const found = at(i);
    if (found) {
      out += replace(found, quote === "'" ? "single" : quote === '"' ? "double" : "unquoted");
      i += found.length - 1;
      continue;
    }
    const ch = template[i] ?? "";
    if (quote === "'") {
      if (ch === "'") quote = null;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      const escaped = at(i + 1);
      if (escaped && quote === null) {
        out += ch + replace(escaped, "escaped");
        i += escaped.length;
        continue;
      }
      out += ch + (template[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') quote = quote === null ? '"' : null;
    else if (ch === "'" && quote === null) quote = "'";
    out += ch;
  }
  return out;
}

/**
 * Substitutes each key of `values` (a placeholder such as `{file}`) into `template`, encoded for
 * the context it sits in, so that the shell reads every substituted value back literally.
 */
export function fillShellTemplate(template: string, values: Readonly<Record<string, string>>) {
  return substitutePlaceholders(template, Object.keys(values), (placeholder, context) =>
    encodeForContext(values[placeholder] ?? "", context),
  );
}
