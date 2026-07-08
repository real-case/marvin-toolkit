import { type CSSProperties, type ReactNode, Fragment } from "react";

/**
 * The reusable markdown primitive (ADR-0024) — the second widget primitive
 * alongside `<ListDetail>`. It renders the marvin-generated markdown bodies
 * (`TaskDetail.body_markdown`, `HandoffDetail.body_markdown`, `sec-*` audit prose,
 * dashboard/summary copy) into DOM elements inside the host's sandboxed CSS.
 *
 * It is deliberately dependency-free and emits elements through the JSX runtime —
 * **never** `dangerouslySetInnerHTML` and **never** an HTML-string sanitiser — so
 * raw HTML in `source` reaches the DOM only as escaped text (no injection surface),
 * and nothing new is inlined into the CSP-constrained widget bundle.
 *
 * It supports a GFM subset — ATX headings, paragraphs, bold/italic, inline and
 * fenced code, ordered/unordered lists, links, blockquotes, thematic breaks and
 * tables. The parser is **total**: any line it does not recognise becomes plain
 * paragraph text, so an arbitrary user-authored task body never throws.
 */
export interface MarkdownProps {
  /** The markdown source to render. */
  source: string;
  /** Optional class on the wrapper element. */
  className?: string;
}

const codeStyle: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "0.9em",
  background: "var(--color-background-secondary, #f4f4f5)",
  borderRadius: "var(--border-radius-sm, 4px)",
  padding: "0.1em 0.3em",
};

const preStyle: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "0.85em",
  background: "var(--color-background-secondary, #f4f4f5)",
  borderRadius: "var(--border-radius-sm, 4px)",
  padding: "0.75rem",
  overflowX: "auto",
  margin: "0.5rem 0",
};

const blockquoteStyle: CSSProperties = {
  margin: "0.5rem 0",
  padding: "0.25rem 0 0.25rem 0.75rem",
  borderLeft: "3px solid var(--color-border-primary, #e2e2e2)",
  color: "var(--color-text-secondary, #555)",
};

const tableStyle: CSSProperties = {
  borderCollapse: "collapse",
  margin: "0.5rem 0",
  fontSize: "0.95em",
};

const cellStyle: CSSProperties = {
  border: "1px solid var(--color-border-primary, #e2e2e2)",
  padding: "0.3rem 0.6rem",
  textAlign: "left",
};

const hrStyle: CSSProperties = {
  border: "none",
  borderTop: "1px solid var(--color-border-primary, #e2e2e2)",
  margin: "0.75rem 0",
};

// ── Inline parsing ─────────────────────────────────────────────────────────
// Each pattern captures the inner text (group 1) and, for links, the href
// (group 2). Ordered by precedence: a code span suppresses formatting inside it,
// so it is matched first; emphasis inner text is parsed recursively.
interface InlineRule {
  re: RegExp;
  render: (m: RegExpMatchArray, key: number) => ReactNode;
}

/**
 * Allowlist the URL scheme for a link `href`. Text-child escaping protects text
 * nodes but NOT attribute values, so a `javascript:` / `data:` / `vbscript:` href
 * would be a live injection surface. Relative, anchor and protocol-relative URLs
 * (no scheme) are safe; an explicit scheme must be http(s) / mailto / tel.
 * Returns the safe href, or `null` to render the link as plain text.
 */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return trimmed; // relative / #anchor / //host — no scheme, safe
  return /^(?:https?|mailto|tel)$/i.test(scheme[1]) ? trimmed : null;
}

const INLINE_RULES: InlineRule[] = [
  {
    re: /`([^`]+)`/,
    render: (m, k) => (
      <code key={k} style={codeStyle}>
        {m[1]}
      </code>
    ),
  },
  {
    re: /\[([^\]]*)\]\(([^)\s]+)\)/,
    render: (m, k) => {
      const href = safeHref(m[2]);
      // Unsafe scheme → drop the anchor and render the link text only, so a
      // `[x](javascript:…)` never produces a live href.
      return href ? (
        <a key={k} href={href} rel="noreferrer noopener" target="_blank">
          {parseInline(m[1])}
        </a>
      ) : (
        <Fragment key={k}>{parseInline(m[1])}</Fragment>
      );
    },
  },
  { re: /\*\*([^*]+)\*\*/, render: (m, k) => <strong key={k}>{parseInline(m[1])}</strong> },
  { re: /__([^_]+)__/, render: (m, k) => <strong key={k}>{parseInline(m[1])}</strong> },
  { re: /\*([^*]+)\*/, render: (m, k) => <em key={k}>{parseInline(m[1])}</em> },
  { re: /_([^_]+)_/, render: (m, k) => <em key={k}>{parseInline(m[1])}</em> },
];

/**
 * Parse a single line of inline markdown into text + element nodes. Text is
 * emitted as plain strings, which the JSX runtime escapes — the no-injection
 * guarantee. An unmatched marker (e.g. a lone `*`) stays literal, so the function
 * is total and never throws.
 */
function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  // Bound the loop by consuming at least one char each iteration.
  while (rest.length > 0) {
    let best: { index: number; length: number; node: ReactNode } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rest.match(rule.re);
      if (m && m.index !== undefined && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, node: rule.render(m, key) };
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.index > 0) nodes.push(rest.slice(0, best.index));
    nodes.push(best.node);
    key += 1;
    rest = rest.slice(best.index + best.length);
  }
  return nodes;
}

// ── Block parsing ──────────────────────────────────────────────────────────
const HEADING = /^(#{1,6})\s+(.*)$/;
const THEMATIC = /^(?:---+|\*\*\*+|___+)\s*$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+\.\s+(.*)$/;
const TABLE_DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Split a GFM table row `| a | b |` into its trimmed cell texts. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/**
 * Render the markdown `source` to a tree of DOM elements. A line scanner groups
 * lines into blocks (fenced code, headings, blockquotes, lists, tables, thematic
 * breaks, paragraphs); unrecognised lines fall through to paragraph text.
 */
export function Markdown({ source, className }: MarkdownProps) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const push = (node: ReactNode) => {
    blocks.push(<Fragment key={key}>{node}</Fragment>);
    key += 1;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip (paragraph separator).
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code — collect until the closing fence or EOF (unterminated → to EOF).
    const fence = line.match(/^\s*```+(.*)$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume the closing fence if present
      push(
        <pre style={preStyle}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Thematic break.
    if (THEMATIC.test(line)) {
      push(<hr style={hrStyle} />);
      i += 1;
      continue;
    }

    // ATX heading.
    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      push(<Tag>{parseInline(heading[2].trim())}</Tag>);
      i += 1;
      continue;
    }

    // GFM table — a header row followed by a delimiter row.
    if (line.includes("|") && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      push(
        <table style={tableStyle}>
          <thead>
            <tr>
              {header.map((cell, c) => (
                <th key={c} style={cellStyle}>
                  {parseInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={cellStyle}>
                    {parseInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // Blockquote — consecutive `>` lines.
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      push(<blockquote style={blockquoteStyle}>{parseInline(body.join(" "))}</blockquote>);
      continue;
    }

    // Lists — consecutive unordered or ordered items.
    if (UNORDERED.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !UNORDERED.test(line);
      const itemRe = ordered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (i < lines.length && itemRe.test(lines[i])) {
        items.push(lines[i].match(itemRe)![1]);
        i += 1;
      }
      const children = items.map((item, idx) => <li key={idx}>{parseInline(item)}</li>);
      push(ordered ? <ol>{children}</ol> : <ul>{children}</ul>);
      continue;
    }

    // Paragraph — consecutive non-blank lines that matched no block above.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING.test(lines[i]) &&
      !THEMATIC.test(lines[i]) &&
      !/^\s*```+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !UNORDERED.test(lines[i]) &&
      !ORDERED.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    // A single line that only looked like a paragraph start still renders here.
    if (para.length === 0) {
      para.push(line);
      i += 1;
    }
    push(<p>{parseInline(para.join(" "))}</p>);
  }

  return (
    <div className={className} data-testid="markdown">
      {blocks}
    </div>
  );
}
