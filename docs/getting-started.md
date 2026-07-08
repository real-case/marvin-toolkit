# Getting started

This guide takes you from an empty Claude Code session to running your first Marvin
commands. By the end you will have installed the plugin, confirmed that it works, created
a commit, and tracked a task on the board.

Marvin is a Claude Code plugin that packages the full development lifecycle as one MCP
server under a single `/marvin:` slash prefix. You reach every workflow three ways — plain
chat, a `/<command>` slash command, or a `/marvin:<command>` prompt — and all three run
the same underlying skill.

## Prerequisites

Before you start, make sure you have the following in place:

- **Claude Code**, in the terminal, the desktop app, or an IDE extension. Marvin is a Claude Code plugin and does not run on its own.
- **Node.js 20 or later**, which the bundled MCP server needs at runtime. Confirm your version with `node --version`.
- **git**, and ideally the **GitHub CLI (`gh`)** authenticated, since the commit, pull-request, and kanban workflows build on them.

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

## Step 2 — Confirm it works

Run the built-in dashboard and command index:

```text
/marvin:help
```

You should see a short project dashboard followed by the full command list, grouped by
family. Seeing the grouped list confirms that the server started and the prompts
registered. To narrow the list to one family, pass its name, so `/marvin:help sec` shows
only the security commands.

If nothing appears, open `/plugin`, check that `marvin@marvin-toolkit` is listed and
enabled, and restart the session.

## Step 3 — Create your first commit

Open a project with a few uncommitted changes and run:

```text
/marvin:commit
```

The command inspects the repository, stages changes intentionally, scans for sensitive
files such as `.env` or private keys, and drafts a Conventional Commits message. It shows
you the message and waits for your confirmation before committing, so nothing reaches
history until you approve. A typical draft looks like this:

```text
feat(parser): support nested config blocks

Add recursive descent for `[[section]]` tables and cover them with tests.
```

Because the message follows the Conventional Commits format, it feeds straight into the
`/marvin:changelog` workflow later.

## Step 4 — Understand the three doors

Every Marvin workflow has three entry points that lead to the same behavior. Use whichever
fits the moment:

1. **Chat.** Describe what you want in plain language, for example `commit my changes` or `scan this repo for secrets`, and Claude Code matches your wording to a skill.
2. **Markdown slash command.** Type the terse form, such as `/commit` or `/sec-scan`.
3. **MCP prompt.** Type the namespaced form, such as `/marvin:commit`, which the bundled server serves.

The [architecture tour](./architecture.md) explains how the three doors resolve to one
skill body, with diagrams.

## Step 5 — Track a task on the board

Marvin includes a lightweight per-project kanban board. Create your first task:

```text
/marvin:kanban-feature
```

On a host that supports interactive forms, Marvin prompts for a title and details; on
other hosts it tells you exactly which arguments to pass. The task is written as a markdown
file under `.marvin/kanban/`. Running `/marvin:kanban-start` then picks it up, creates a
topic branch, and marks it in progress. List the board at any time with `/marvin:kanban-list`:

```text
todo        1  ▸ 001--support-nested-config
in-progress 0
review      0
done        0
```

When you commit on that branch, `/marvin:commit` recognizes the task and adds a `Refs:`
footer automatically.

## Step 6 — See the whole toolbox

Once you have run a few commands, take stock of everything Marvin tracks in the project:

```text
/marvin:dashboard
```

This reports the board counters, the artifact inventories with their freshness, the ADR
corpus by status, the lessons stats, and the local usage summary. On a host that supports
the Apps widget layer, the same command also renders an interactive panel; on a plain
terminal it prints the equivalent text report.

## Where to go next

- The [usage guide](./usage.md) has worked walkthroughs for the common workflows: opening a pull request, running the spec-driven task pipeline, auditing security, and refactoring safely.
- The [configuration reference](./configuration.md) documents the `.marvin/` working directory, the `.marvin/config.json` schema, and the environment variables that repoint storage.
- The [command reference](./commands.md) lists every `/marvin:` command with a synopsis and the phrases that invoke it from chat.
- The [architecture tour](./architecture.md) explains how the plugin is put together and why.
