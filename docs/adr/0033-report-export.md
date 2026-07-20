# ADR 0033 — Report export is template-only (Claude fills a shipped print template)

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-07-17 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0024](0024-mcp-apps-widget-architecture.md) (widget theme + data-first staging), [ADR-0013](0013-self-contained-server-bundle.md) (committed self-contained bundle), [ADR-0014](0014-distribution-release-model.md) (no-postinstall distribution), [ADR-0007](0007-marvin-working-directory.md) (`.marvin/` layout), [ADR-0008](0008-mcp-door-resource-resolution.md) (door-3 resource resolution) |

## Context

Marvin's reports — security scans, refactor registers and plans, task specs,
`verification.md`, handoffs — live under `.marvin/` as Markdown and render interactively in
the reports widget. Users need to take a report **out** of the repo: attach a PDF to a
ticket, hand a Markdown digest to a reviewer. The project website advertises exactly this
("Export PDF / Export MD", FR-18) and its public launch is gated on the feature.

Two hard constraints frame the design:

1. **The widget cannot do it.** MCP Apps widgets run in sandboxed iframes behind a strict
   CSP with no filesystem — a widget can render a report but cannot produce a file.
2. **The server must stay lean.** `dist/server.js` is a committed, self-contained bundle
   ([ADR-0013](0013-self-contained-server-bundle.md)); the plugin installs with no
   postinstall step ([ADR-0014](0014-distribution-release-model.md)). A PDF engine
   (megabytes plus fonts) or a headless-browser dependency (install-time browser
   downloads) is incompatible with that distribution model.

A first design placed export on the server anyway: an `export` action on the `report`
tool rendering print HTML server-side and driving a locally discovered Chromium binary
(`--headless --print-to-pdf`) with a graceful HTML fallback. It passed its own
Definition-of-Ready and critic gates (spec `report-export`, superseded) — and was then
overridden by an owner decision (2026-07-17, recorded in the website requirements'
decisions log): the export architecture is **template-only**, and no export code of any
kind ships in the MCP server.

## Decision

**Claude generates the export in the user's session; the toolbox ships the template and
the instructions — nothing renders server-side.**

- The plugin ships `skills/report-export/` with two committed reference artifacts:
  - `references/export-template.html` — a print-quality, **self-contained, zero-JavaScript**
    HTML document: inline CSS on the `.mvroot` widget theme palette (light default,
    `prefers-color-scheme: dark` for screen, `@media print` forcing light with `@page` A4
    rules), `data-mv` fill slots, and commented cookbook markup for the three report body
    kinds (findings / checks / document);
  - `references/export-template.md` — a Markdown digest skeleton mirroring the same
    provenance header and body structures.
- `SKILL.md` instructs Claude end-to-end: resolve the report via the `report` tool's
  `list` (the allowed *read-side* helper), fill the matching skeleton (escape interpolated
  content, keep the artifact self-contained), write it to
  `.marvin/export/<group>-<source-basename>.<ext>` (the directory self-ignores via a
  written `.gitignore` = `*`, the `.marvin/usage/` convention), and guide the PDF step:
  open in a browser → print → save as PDF. In-session conversion is allowed only when the
  environment genuinely provides a means; nothing is ever installed for it.
- The surface is a skill-backed prompt `report-export` reachable through all three doors
  (auto-discovery, `/report-export`, `/marvin:report-export` via the server's plugin-root
  preamble, [ADR-0008](0008-mcp-door-resource-resolution.md)).
- **Drift guard:** `packages/marvin-widgets/src/theme/export-template.test.ts` locks the
  committed template to the exported token sheet (`MV_THEME_CSS`) — a pinned required
  subset must appear, no color literal outside the sheet may appear, and the
  self-containment rules (no scripts, no external loads) are asserted mechanically.
- The `report` MCP tool is unchanged (`list` remains its only action); no new environment
  variables; the server's attack surface does not grow.

## Alternatives considered

- **Tool-side `export` action + system-Chromium headless print** (the superseded first
  spec): true one-command PDF wherever a Chromium-family browser exists, still
  dependency-free — but it puts rendering, filename policy, child-process discovery,
  timeouts, and file-writes into the server. Rejected by the owner's template-only
  boundary; the complexity deleted with it is real.
- **Bundled PDF library (pdfkit / pdf-lib):** megabytes into the committed bundle plus a
  hand-rolled typesetting layer whose output would trail a browser's print engine —
  fails ADR-0013 and the print-quality bar.
- **Headless-browser npm dependency (puppeteer / playwright):** downloads a browser at
  install time or at runtime — fails the no-postinstall distribution model (ADR-0014).
- **Server-rendered fill (a read action returning completed HTML):** keeps files out of
  the server but moves layout/rendering logic back in — precisely what the template-only
  boundary excludes; the `report` tool's parsed envelopes already hand Claude the data.
- **Widget-side export:** impossible in the sandbox (no filesystem, strict CSP); at most
  a future widget button can *trigger* the skill via the established `sendMessage`
  precedent.

## Consequences

- **Positive:** zero server growth (bundle, env, attack surface); the export design is a
  static, reviewable, mechanically guarded asset; exports inherit the widget family look
  from one token source; the skill works on any host through the three doors; the
  website's FR-18 claim is honest (print-ready HTML → PDF via the user's browser).
- **Negative / accepted:** export fidelity is instruction-bounded — Claude fills the
  template per SKILL.md rather than code enforcing the output; the PDF step is manual
  (print dialog) unless the session genuinely has a conversion means. Both are the
  owner's explicit trade for a server that ships no export code.
- The superseded spec's mechanism survives in history (spec `report-export`, status
  `superseded`) should the boundary ever be revisited.
