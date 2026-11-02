/**
 * The `gh api` grammar both child guards judge. Pipeline children reach GitHub through REST
 * only: a Claude Code cloud session refuses GraphQL, which every `gh pr view|create|checks`
 * uses (probe of 2026-11-02). `gh api` can reach any endpoint with any method, so the parse is
 * an allowlist: every flag must be one listed here, the endpoint must name the current
 * repository through gh's own `{owner}/{repo}` placeholders, and anything the guard cannot read
 * (a bundled short flag, an expansion in a flag, a second positional) is refused.
 */
import { isDynamic } from "./shell.mjs";

/** Flags that take a value, long name to short letter (or null). */
const VALUED = new Map([
  ["--method", "-X"],
  ["--header", "-H"],
  ["--raw-field", "-f"],
  ["--field", "-F"],
  ["--jq", "-q"],
  ["--template", "-t"],
  ["--preview", "-p"],
  ["--cache", null],
  ["--input", null],
  ["--hostname", null],
]);
const SHORT_VALUED = new Map([...VALUED].filter(([, s]) => s).map(([l, s]) => [s, l]));
const SWITCHES = new Set(["--paginate", "--slurp", "--include", "-i", "--silent", "--verbose"]);
/** Flags no child may pass: a request body read from a file, or another GitHub host. */
const REFUSED = new Map([
  ["--input", "gh api --input sends a file as the request body"],
  ["--hostname", "gh api --hostname targets another GitHub host"],
]);

/** The current repository through gh's placeholders, and nothing that could leave it. */
const REPO_ENDPOINT = /^\/?repos\/\{owner\}\/\{repo\}(?:[/?]|$)/;

/**
 * Parses the words after `gh api`.
 *
 * @param {{text: string, quoted: boolean}[]} tokens
 * @returns {{error: string} | {endpoint: string, method: string, fields: {key: string, value: string, typed: boolean, dynamic: boolean}[]}}
 */
export function parseGhApi(tokens) {
  const positional = [];
  const fields = [];
  let method = null;
  let flagsDone = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const text = token.text;
    if (flagsDone || !text.startsWith("-") || text === "-") {
      positional.push(token);
      continue;
    }
    if (text === "--") {
      flagsDone = true;
      continue;
    }
    if (isDynamic(token)) return { error: "gh api with an expanded flag the guard cannot read" };
    if (SWITCHES.has(text)) continue;
    let long;
    let value;
    let valueToken;
    const eq = text.indexOf("=");
    if (text.startsWith("--")) {
      long = eq > 0 ? text.slice(0, eq) : text;
      if (!VALUED.has(long))
        return { error: `gh api ${long} is not available to pipeline children` };
      if (eq > 0) valueToken = { text: text.slice(eq + 1), quoted: token.quoted };
    } else {
      long = SHORT_VALUED.get(text.slice(0, 2));
      if (!long) return { error: `gh api ${text} is not available to pipeline children` };
      if (text.length > 2) valueToken = { text: text.slice(2), quoted: token.quoted };
    }
    if (REFUSED.has(long)) return { error: REFUSED.get(long) };
    if (valueToken === undefined) {
      valueToken = tokens[i + 1];
      i += 1;
      if (valueToken === undefined) return { error: `gh api ${long} needs a value` };
    }
    value = valueToken.text;
    if (long === "--header" && !/^accept\s*:/i.test(value)) {
      return { error: `gh api may only set an Accept header (${value})` };
    }
    if (long === "--method") {
      if (isDynamic(valueToken)) return { error: "gh api with an expanded --method" };
      method = value.toUpperCase();
    } else if (long === "--field" || long === "--raw-field") {
      const at = value.indexOf("=");
      const key = at > 0 ? value.slice(0, at) : "";
      if (key === "" || /[$`[\]]/.test(key)) {
        return { error: `gh api ${long} needs a plain key=value (${value})` };
      }
      fields.push({
        key,
        value: value.slice(at + 1),
        typed: long === "--field",
        dynamic: isDynamic(valueToken),
      });
    }
  }
  if (positional.length !== 1) return { error: "gh api takes exactly one endpoint" };
  const endpoint = positional[0];
  if (isDynamic(endpoint)) return { error: "gh api with an expanded endpoint" };
  const path = endpoint.text;
  if (!REPO_ENDPOINT.test(path) || /\.\.|\/\/|%2e|%2f/i.test(path)) {
    return {
      error: `gh api may only reach this repository, as repos/{owner}/{repo}/… (${path})`,
    };
  }
  return {
    endpoint: path.replace(/^\//, ""),
    method: method ?? (fields.length ? "POST" : "GET"),
    fields,
  };
}

/**
 * Why a parsed `gh api` call is not a plain read of this repository, or null. Fields are
 * refused even with GET, where gh would send them as a query string: a read names its query
 * in the endpoint.
 */
export function readViolation(request) {
  if (request.method !== "GET") return `gh api with a ${request.method} request`;
  if (request.fields.length > 0) return "gh api with a request body";
  return null;
}
