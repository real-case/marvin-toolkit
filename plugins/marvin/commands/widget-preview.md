---
description: Open a marvin widget as a rendered panel with this project's own data — works on hosts that cannot render ui:// widgets, including the terminal. Optionally pass a widget name and tool arguments.
---

# Widget Preview

Render a bound `ui://` widget plus its live payload into one self-contained file under
`.marvin/preview/` and open it.

## Arguments

- `$ARGUMENTS` — Optional: the widget to open (`help`, `dashboard`, `reports`, `task-list`,
  `task-detail`, `task-summary`, `tracker-list`, `handoffs`, `audit`) and, when the widget's tool
  needs them, its arguments as JSON. If omitted, the skill asks which widget.

## Instructions

**Read `skills/widget-preview/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as the widget name and tool arguments if provided.

## Examples

| Command                                        | Behavior                                             |
| ---------------------------------------------- | ---------------------------------------------------- |
| `/widget-preview`                              | Ask which widget, then render and open it            |
| `/widget-preview help`                         | Open the welcome dashboard as a rendered panel       |
| `/widget-preview task-list '{"action":"list"}'` | Open the task board with the tool arguments it needs |
