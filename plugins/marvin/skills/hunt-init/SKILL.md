---
name: hunt-init
description: Set up the bug hunter for this project — detect the stack, test runner and router, propose the scope, severity floors, budgets and authority (detect-only by default), and write them as the `hunt` key of .marvin/config.json, creating .marvin/hunt/ for the ledger, flow map and reports. Use when the user says "set up the bug hunter", "configure hunt", "настрой охотника за багами", "init hunt", or before the first /marvin:hunt-code on a project. Changes no source code.
---

# Set up the bug hunter

Write the bug hunter's settings and create its state directory. One pass, a few questions,
no source changes. Every write goes through the `hunt` MCP tool from the `marvin` server
(`action: "init"`), which validates the settings, keeps every other key of
`.marvin/config.json` as it was, and refuses invalid values without writing anything.

## Workflow

### 1. Read what is already there

Call `hunt` with `action: "status"` to see whether a ledger exists, and read
`.marvin/config.json` if present. If it already has a `hunt` key, show it and ask what to
change instead of starting over.

### 2. Detect the stack

Read, do not guess:

- **Language and framework** — `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`,
  `Gemfile`, and the framework's config file (`next.config.*`, `vite.config.*`,
  `angular.json`, `manage.py`…).
- **Test runner** — the `test` script and its config (`vitest`, `jest`, `node --test`,
  `pytest`, `go test`). The reproducing tests `/marvin:hunt-code` writes use it.
- **Router** — where routes live, per
  `skills/hunt-code/references/flow-map-extraction.md`.
- **Source roots** — the directories that hold product code, and generated or vendored ones
  that should be excluded beyond the defaults (tests, build output, `node_modules`, `.marvin/`
  are excluded already).

### 3. Propose the settings

Show one block and ask the person to confirm or change it:

| Setting | Default | Ask about it when |
| --- | --- | --- |
| `scope.paths` | empty (the whole repository) | the repository holds more than the product: docs sites, tooling, examples |
| `scope.exclude` | empty | generated clients, migrations, fixtures live outside the default exclusions |
| `severity_floor` | code and user-behavior `high`, ux and design `medium` | the person wants more or fewer findings |
| `budgets` | 30 minutes, 3 rounds, 25 findings per round, 40 hotspots, batches of 8 | the repository is very large or very small |
| `authority.mode` | `detect-only` | never change it in this release: fixing is not implemented, and the tool would only record the setting |
| `history_months` | 12 | the history is short or the project was recently rewritten |
| `constraints` | none | there are things the hunt must never do (call a paid API, touch a database, run e2e against production) |

Record the stack you detected in `constraints` only when it constrains the hunt; the stack
itself is re-read on every run.

### 4. Write

Call `hunt` with `action: "init"` and `config` holding only the keys the person set or
confirmed; the tool merges them over the defaults. If the answer warns that git ignores the
ledger, show the one-line `.gitignore` change it gives: the ledger, flow map and coverage are
shared records meant to be committed, while `runs/` and `evidence/` stay local through the
`.gitignore` the tool wrote inside `.marvin/hunt/`.

### 5. Hand over

Say what was written and suggest `/marvin:hunt-code` as the next step, with a scope argument if
the repository is large.

## Rules

- No source file is created, edited or deleted.
- Never set `authority.mode` to anything but `detect-only`, `authority.tickets` or
  `authority.fixes` to `true`, or `budgets.max_fixes` above 0: those settings are reserved for
  a later release.
