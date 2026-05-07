---
description: Copy (scaffold) skills, commands, and agents from a Marvin pack into the project's .claude/ directory. Re-running overwrites existing files for updates.
---

# Eject

Scaffold a Marvin pack — or a single artifact — into the current project's `.claude/` so the team can commit, customise, and version-control it. Re-running on the same target performs a clean overwrite, making this both the install and the update mechanism.

## Arguments

- `$ARGUMENTS` — target specifier. One of:
  - `<pack>` — eject the whole pack (all skills + commands + agents)
  - `<pack>/skills/<name>` — single skill (whole folder)
  - `<pack>/commands/<name>` — single command file
  - `<pack>/agents/<name>` — single agent file
  - `<pack> --only <kinds>` — comma-separated subset, e.g. `--only skills,commands`

`<pack>` must be one of: `marvin-core-pack`, `marvin-security-pack`, `marvin-taskmaster-pack`.

## Instructions

**Read `skills/mn.eject/SKILL.md`** and follow its full workflow. Pass `$ARGUMENTS` verbatim.

## Examples

| Command                                                | Behavior                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `/mn.eject marvin-core-pack`                           | Eject entire core pack into `.claude/`                        |
| `/mn.eject marvin-core-pack/skills/mn.commit`          | Eject only the `mn.commit` skill                              |
| `/mn.eject marvin-core-pack/commands/mn.pr`            | Eject only the `mn.pr` command file                           |
| `/mn.eject marvin-security-pack --only skills,agents`  | Eject security pack skills and agents, skip commands          |
| `/mn.eject marvin-core-pack` (second run)              | Overwrite existing files with current pack version            |
