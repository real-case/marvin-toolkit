# Marvin website — progress

**Updated:** 2026-07-17
**Plan:** [website-implementation-plan.md](website-implementation-plan.md) ·
**Requirements:** [website-requirements.md](website-requirements.md) ·
**Research:** [premium-page-research.md](premium-page-research.md)

This document tracks where the website work actually stands. It is the living counterpart
to the implementation plan: the plan says what to do, this says what is done.

## Status at a glance

Design is complete and every decision is closed. No site code exists yet — the next
concrete step is Phase 1, scaffolding the `packages/site` workspace. Two external
dependencies gate the public launch: the repository going public and the report-export
feature landing.

| Phase | State | Note |
|-------|-------|------|
| 0 · Design and specification | Complete | All five pages designed at hi-fi; decisions closed |
| 1 · Workspace scaffold | Not started | Next up |
| 2 · Content pipeline | Not started | — |
| 3 · Static pages | Not started | Mockups ready to port |
| 4 · Interactive islands | Not started | — |
| 5 · Widget embeds and media | Not started | Recordings not yet produced |
| 6 · Agent surface and SEO | Not started | — |
| 7 · Deploy pipeline | Not started | — |
| 8 · Launch | Blocked | Gated on make-public and report-export |

## Deliverables produced

All design deliverables are done. The hi-fi mockups are private preview artifacts; they
will be superseded by the real Astro pages during Phase 3.

| Deliverable | Where | State |
|-------------|-------|-------|
| Requirements (FR-1…24, Decisions log) | [website-requirements.md](website-requirements.md) | Done |
| Premium-page design research | [premium-page-research.md](premium-page-research.md) | Done |
| Low-fi wireframes, all five pages | Private preview artifact (v2.3) | Done |
| Style proposal (approved direction A) | Private preview artifact | Done |
| Font specimen (eight faces) | Private preview artifact | Done |
| Hi-fi home page | Private preview artifact | Done |
| Hi-fi inner pages (Commands, Pipeline, Toolbox, Quickstart) | Private preview artifact | Done |

## Decisions locked

The full list with rationale is the Decisions log in the requirements document. In brief:

- **Positioning.** A hybrid landing-and-reference site; success is an install-command copy
  or a GitHub visit. Tagline: "Claude Code toolset for AI-assisted development. Without
  panic."
- **Design direction.** "Large friendly letters" on the widget theme tokens verbatim —
  zero new colors. Display face Hanken Grotesk (name, headings, count digits); body on the
  system stack; JetBrains Mono for commands, eyebrows, and quips. Light is the canonical
  theme, dark at full parity.
- **Hero.** The wordmark is the invocation itself, `/marvin`, with the `/` in the accent
  color; the tagline sits beneath it.
- **Stack and hosting.** Astro with Preact islands, in the `packages/site` workspace,
  deployed to Vercel at `marvin-toolkit.dev`, with privacy-friendly Vercel Analytics.
- **Research-informed refinements.** A one-accent-per-viewport budget, a two-tier
  container, the blueprint-grid texture, a single deliberate grid break in the hero,
  poster-first recordings, and an agent-native surface (`llms.txt`).

## Launch gates

| Gate | State | Detail |
|------|-------|--------|
| Repository public | Pending | Admin-gated; the install call to action is inert until then |
| Report export (PDF + Markdown) | Spec sealed, not implemented | Template-only feature; spec at `.marvin/task/002-report-export-template.md`, awaiting `/marvin:task-implement` |

## What is not yet done

- No `packages/site` workspace, no Astro project, no site code of any kind.
- The content pipeline (catalog and counts generation) is designed but not written.
- The terminal recordings, the widget mock fixtures, and the OpenGraph images do not exist
  yet.
- The Vercel project and the domain are not set up.

## Next action

Begin Phase 1: scaffold the `packages/site` workspace with Astro and the Preact
integration, port the shared layout and the theme token module, and self-host the fonts.
The exit criterion is a themed empty shell that serves under `npm run dev` with both
themes working.

## Change log

- **2026-07-17** — Design phase completed. Requirements reached v2.2 with all questions
  closed; premium-page research delivered and folded in (FR-24 added, refinements recorded).
  Style approved: direction A, Hanken Grotesk (chosen over Bricolage), light canonical.
  Hero reworked to the `/marvin` command wordmark. Hi-fi mockups built and verified for the
  home page and all four inner pages. This plan and progress tracker created.
