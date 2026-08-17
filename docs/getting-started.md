# Getting started

This guide takes you from an empty Claude Code session to having used Marvin on your own
repository. There are two steps: install the plugin, then run the guided walkthrough that
does the rest.

Marvin is a Claude Code plugin that packages the full development lifecycle as one MCP
server under a single `/marvin:` slash prefix. You reach every workflow three ways — plain
chat, a `/<command>` slash command, or a `/marvin:<command>` prompt — and all three run
the same underlying skill.

## Prerequisites

Before you start, make sure you have the following in place:

- **Claude Code**, in the terminal, the desktop app, or an IDE extension. Marvin is a Claude Code plugin and does not run on its own.
- **Node.js 20 or later**, which the bundled MCP server needs at runtime. Confirm your version with `node --version`.
- **git**, and ideally the **GitHub CLI (`gh`)** authenticated, since the commit, pull-request, and board workflows build on them.

You do not need to clone this repository or run a build step. The plugin ships with its
server already bundled, so installing it is the only setup.

## Step 1 — Install the plugin

Add the marketplace and install the plugin from inside Claude Code:

```text
/plugin marketplace add real-case/marvin-toolkit
/plugin install marvin@marvin-toolkit
```

Claude Code registers one MCP server named `marvin` and loads its commands, skills, and
agents. The commands appear as `/marvin:<group>-<command>`.

## Step 2 — Run the walkthrough

Everything else happens inside one command:

```text
/marvin:onboard
```

It is a short guided session in the project you are sitting in. It reads the repository —
git status, recent history, the manifests that name your stack — and writes nothing while
it does. It then discloses the local usage log before anything is written: Marvin appends
one line per prompt and per tool call to `.marvin/usage/events.jsonl`, the directory
ignores itself so nothing reaches git, the log is read only by `/marvin:dashboard`, and it
never leaves your machine. The walkthrough offers to switch it off and shows you the exact
lines it would write to `.marvin/config.json` before touching the file.

From there it shows you the command surface with `/marvin:help`, proposes three or four
real starter tasks found in your own code with `file:line` evidence, and offers to card the
one you pick on the board and to commit whatever is already in your working tree. Every one
of those writes waits for an explicit yes, declining any of them simply moves on to the
next step, and nothing creates a branch or pushes. The walkthrough ends on a single
suggested next command.

If nothing appears when you type `/marvin:onboard`, the plugin did not load. Open
`/plugin`, check that `marvin@marvin-toolkit` is listed and enabled, and then
restart the session and run the command again.

## Where to go next

- The [usage guide](./usage.md) has worked walkthroughs for the common workflows: opening a pull request, running the spec-driven task pipeline, auditing security, and refactoring safely.
- The [configuration reference](./configuration.md) documents the `.marvin/` working directory, the `.marvin/config.json` schema, and the environment variables that repoint storage.
- The [command reference](./commands.md) lists every `/marvin:` command with a synopsis and the phrases that invoke it from chat.
- The [architecture tour](./architecture.md) explains how the plugin is put together and why.
