/**
 * Shell reading for the pipeline's Bash guards, layered on hook-io's tokenizer.
 *
 * hook-io's `splitSegments`/`tokenize` were built for guards that must never deny
 * wrongly, so they read less than bash runs: backslash escapes are not interpreted,
 * `#` comments and a lone `&` are not boundaries, and the body of a command
 * substitution stays inside its token. For a guard over an adversarial child each of
 * those is a way to hide a command — `echo \"; git switch dev` desynchronises the quote
 * scan, `x # it's` swallows the next line, `git status & git switch dev` is one
 * segment, `echo "$(git switch dev)"` is a quoted argument.
 *
 * `execContexts` therefore rewrites the command before hook-io sees it: escapes are
 * resolved, comments dropped, and the body of every `$(…)`, `` `…` ``, `<(…)` and
 * `>(…)` — including those inside double quotes and unquoted heredoc bodies — is cut
 * out (leaving `$()` behind) and returned as a context of its own, to be judged with
 * the same rules. hook-io's `main`, `readPayload`, `splitSegments`, `tokenize` and
 * `gitSubcommand` stay the only scanner of each context.
 */

import { splitSegments, tokenize } from "../../../hooks/lib/hook-io.mjs";

/** Stands in for a backslash-escaped metacharacter: literal to bash, inert to hook-io. */
export const ESCAPED = "\u0001";

/** Precedes a backslash-escaped word character (`\g`), which bash reads as the bare one. */
const MARK = "\u0002";

/** A `git` or `gh` word anywhere in a text. */
export const GIT_WORD = /\b(git|gh)\b/i;

/** A leading `NAME=value` assignment. */
export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Reserved words that may precede a command without being one. */
const RESERVED = new Set(["!", "{", "if", "then", "elif", "else", "do", "while", "until"]);

/** hook-io's heredoc grammar: `<<`/`<<-`, a quoted or bare delimiter; `<<<` is not one. */
function heredocAt(text, at) {
  if (!text.startsWith("<<", at) || text.startsWith("<<<", at)) return null;
  let i = at + 2;
  let stripTabs = false;
  if (text[i] === "-") {
    stripTabs = true;
    i += 1;
  }
  while (text[i] === " " || text[i] === "\t") i += 1;
  const quote = text[i];
  if (quote === "'" || quote === '"') {
    const close = text.indexOf(quote, i + 1);
    if (close === -1) return null;
    return { delimiter: text.slice(i + 1, close), stripTabs, quoted: true, end: close + 1 };
  }
  let j = i;
  while (j < text.length && /[A-Za-z0-9_.-]/.test(text[j])) j += 1;
  if (j === i) return null;
  return { delimiter: text.slice(i, j), stripTabs, quoted: false, end: j };
}

/**
 * One pass over `text` from `start`. `outer` is the text with escapes resolved, comments
 * dropped and substitution bodies replaced by `$()`; `inner` holds every substitution
 * body, flattened, each already rewritten the same way. With `untilParen` the pass stops
 * at the `)` closing the substitution it was started in and reports it as `end`.
 *
 * Modes: `single` and `ansi` (`$'…'`) are literal; `double` expands substitutions only;
 * `heredoc` is an unquoted heredoc body, where quotes are literal and substitutions run.
 *
 * A `#` starts a comment only after whitespace or a separator in the REWRITTEN text, so
 * `a\ #` and `$(…)#`, where bash reads `#` as part of a word, are never dropped.
 *
 * `$((…))` is arithmetic only when it closes with `))`; `$((cmd) )` is bash's command
 * substitution of a subshell. A `case` inside a substitution is refused (`malformed`):
 * its pattern `)` would end the substitution early here but not in bash.
 */
function scan(text, start, untilParen, initialMode) {
  let mode = initialMode;
  let depth = 0;
  let outer = "";
  const inner = [];
  let malformed = false;
  let pending = [];
  let i = start;
  const absorb = (sub) => {
    inner.push(...sub.inner);
    if (sub.malformed) malformed = true;
  };
  while (i < text.length) {
    const ch = text[i];
    if (mode === "single") {
      outer += ch;
      if (ch === "'") mode = "normal";
      i += 1;
      continue;
    }
    if (mode === "ansi") {
      if (ch === "\\") {
        outer += ESCAPED;
        i += 2;
        continue;
      }
      outer += ch;
      if (ch === "'") mode = "normal";
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) {
        outer += ch;
        i += 1;
      } else if (next === "\n") {
        i += 2;
      } else if (mode === "heredoc") {
        outer += ch + next;
        i += 2;
      } else if (mode === "double") {
        outer += /[$`"\\]/.test(next) ? ESCAPED : ch + next;
        i += 2;
      } else {
        outer += /\w/.test(next) ? MARK + next : ESCAPED;
        i += 2;
      }
      continue;
    }
    if (text.startsWith("$(", i)) {
      const sub = scan(text, i + 2, true, "normal");
      const arithmetic = text.startsWith("$((", i) && text[sub.end - 1] === ")";
      if (!arithmetic) inner.push(sub.outer);
      absorb(sub);
      outer += "$()";
      i = sub.end + 1;
      continue;
    }
    if (ch === "`") {
      let j = i + 1;
      let body = "";
      while (j < text.length && text[j] !== "`") {
        if (text[j] === "\\" && j + 1 < text.length) {
          body += /[`$\\]/.test(text[j + 1]) ? text[j + 1] : text[j] + text[j + 1];
          j += 2;
          continue;
        }
        body += text[j];
        j += 1;
      }
      if (j >= text.length) malformed = true;
      const sub = scan(body, 0, false, "normal");
      inner.push(sub.outer);
      absorb(sub);
      outer += "$()";
      i = j + 1;
      continue;
    }
    if (mode === "double") {
      outer += ch;
      if (ch === '"') mode = "normal";
      i += 1;
      continue;
    }
    if (mode === "heredoc") {
      outer += ch;
      i += 1;
      continue;
    }
    if (ch === "<") {
      const heredoc = heredocAt(text, i);
      if (heredoc !== null) {
        pending.push(heredoc);
        outer += text.slice(i, heredoc.end);
        i = heredoc.end;
        continue;
      }
    }
    if ((ch === "<" || ch === ">") && text[i + 1] === "(") {
      const sub = scan(text, i + 2, true, "normal");
      inner.push(sub.outer);
      absorb(sub);
      outer += `${ch}()`;
      i = sub.end + 1;
      continue;
    }
    if (ch === "'") {
      mode = "single";
      outer += ch;
      i += 1;
      continue;
    }
    if (ch === "$" && text[i + 1] === "'") {
      mode = "ansi";
      outer += "$'";
      i += 2;
      continue;
    }
    if (ch === '"') {
      mode = "double";
      outer += ch;
      i += 1;
      continue;
    }
    if (ch === "#" && /^$|[\s;&|]$/.test(outer.slice(-1))) {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\n" && pending.length > 0) {
      outer += ch;
      i += 1;
      for (const heredoc of pending) {
        const bodyStart = i;
        let bodyEnd = text.length;
        let closed = false;
        while (i < text.length) {
          const newline = text.indexOf("\n", i);
          const lineEnd = newline === -1 ? text.length : newline;
          const line = text.slice(i, lineEnd);
          const lineStart = i;
          i = newline === -1 ? text.length : newline + 1;
          if ((heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) {
            closed = true;
            bodyEnd = lineStart;
            break;
          }
        }
        if (!closed) malformed = true;
        if (!heredoc.quoted) absorb(scan(text.slice(bodyStart, bodyEnd), 0, false, "heredoc"));
        outer += text.slice(bodyStart, i);
      }
      pending = [];
      continue;
    }
    if (untilParen) {
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        if (depth === 0) {
          if (/(^|[\s;&|(])case\s/.test(outer)) malformed = true;
          return { outer, inner, end: i, malformed };
        }
        depth -= 1;
      }
    }
    outer += ch;
    i += 1;
  }
  if (pending.length > 0 || untilParen) malformed = true;
  return { outer, inner, end: text.length, malformed };
}

/**
 * Every command text bash would run for `command`: the top level first, then each
 * substitution body. `malformed` when a substitution, backtick or heredoc never closes —
 * the guards deny those rather than guess where the hidden command ends.
 *
 * @param {string} command
 * @returns {{contexts: string[], malformed: boolean}}
 */
export function execContexts(command) {
  const { outer, inner, malformed } = scan(command, 0, false, "normal");
  return { contexts: [outer, ...inner], malformed };
}

/** A lone `&` (not `&&`, `&>`, `>&`, `<&`) ends a command, though hook-io does not cut there. */
function splitBackground(segment) {
  const parts = [];
  let quote = null;
  let start = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "&" && !/[<>]/.test(segment[i - 1] ?? "") && segment[i + 1] !== ">") {
      parts.push(segment.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(segment.slice(start));
  return parts;
}

/**
 * hook-io's segments of one context, further cut on a lone `&`.
 *
 * @param {string} text One entry of `execContexts(...).contexts`.
 * @returns {string[]}
 */
export function commandSegments(text) {
  return splitSegments(text)
    .flatMap(splitBackground)
    .filter((segment) => segment.trim() !== "");
}

/**
 * hook-io's tokens with escaped word characters resolved; `escaped` records that the
 * token was written with one (`\git`).
 *
 * @param {string} segment
 * @returns {Array<{text: string, quoted: boolean, escaped: boolean}>}
 */
export function words(segment) {
  return tokenize(segment).map(({ text, quoted }) => ({
    text: text.split(MARK).join(""),
    quoted,
    escaped: text.includes(MARK),
  }));
}

/**
 * Split off the leading `NAME=value` assignments and reserved words (`if`, `!`, `{`, …),
 * leaving the command itself first.
 *
 * @param {Array<{text: string, quoted: boolean}>} tokens
 */
export function commandStart(tokens) {
  const assignments = [];
  let at = 0;
  while (at < tokens.length) {
    const token = tokens[at];
    if (ASSIGNMENT.test(token.text)) assignments.push(token);
    else if (!(token.quoted === false && RESERVED.has(token.text))) break;
    at += 1;
  }
  return { assignments, command: tokens.slice(at) };
}

const REDIRECT = /^(\d+|&)?(>>|>\||>&|&>>?|<>|<&|<<<|<<-?|>|<)/;

/**
 * The tokens without their redirections (`2>&1`, `>/dev/null`, `> out`, `<<'EOF'`), so an
 * allowlisted argument shape is not broken by where the output goes. A bare operator
 * takes the next token as its target.
 *
 * @param {Array<{text: string, quoted: boolean}>} tokens
 */
export function withoutRedirects(tokens) {
  const kept = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const heredoc = token.quoted && /^<<-?/.test(token.text);
    const match = token.quoted ? null : REDIRECT.exec(token.text);
    if (heredoc) continue;
    if (match === null) {
      kept.push(token);
      continue;
    }
    if (match[0].length === token.text.length) i += 1;
  }
  return kept;
}

/** The program a command token runs, as a lowercase basename (`/usr/bin/GIT` → `git`). */
export function programName(token) {
  const text = token?.text ?? "";
  return text.slice(text.lastIndexOf("/") + 1).toLowerCase();
}

/**
 * True when bash would rewrite the token before the program sees it: a parameter,
 * command or arithmetic expansion anywhere, or — unquoted — a glob, a brace expansion or
 * a leading tilde. A guard cannot know what such a token becomes.
 *
 * @param {{text: string, quoted: boolean}} token
 */
export function isDynamic(token) {
  const text = token.text;
  if (/[$`]/.test(text)) return true;
  if (token.quoted) return false;
  return /[*?[]/.test(text) || /\{[^{}]*(,|\.\.)[^{}]*\}/.test(text) || text.startsWith("~");
}
