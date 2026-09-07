---
description: Consolidate finished audit reports (A-99) into one prioritised register — deduplicate, resolve severity conflicts, order by finding dependencies, and produce the top five. Reads reports, never code.
---

# Audit consolidation — A-99

Merge the finished audit reports into one register and answer what to fix first.

## Arguments

- `$ARGUMENTS` — Optional: the reports directory (default `.marvin/audit/`), an explicit list of report paths, or a focus ("для инвесторов", "только эксплуатация")

## Instructions

**Read `skills/audit-summary/SKILL.md`** and follow its full workflow — collect, deduplicate, resolve conflicts, rank on the three axes, choose the top five, write the report, release it.

The hard rule holds whatever `$ARGUMENTS` says: this command reads reports and never re-analyses the codebase.

## Examples

| Command                                  | Behavior                                                    |
| ----------------------------------------- | ------------------------------------------------------------ |
| `/audit-summary`                          | Consolidate every report under `.marvin/audit/`               |
| `/audit-summary для правления`            | Same register, with the top five written for a board audience |
| `/audit-summary только эксплуатация`      | Consolidate the wave-3 reports only                           |
