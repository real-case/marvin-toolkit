---
description: List the session-continuation handoff documents saved under .marvin/handoff/, newest first.
---

# Handoff list

List the marvin session-handoff documents captured by `/marvin:handoff`.

## Instructions

Invoke the `handoff` MCP tool from the `marvin` server with `action: list`. Present the
returned list as-is (newest first); do not add preamble. Each entry shows the handoff's
id, objective, branch, base, and open-PR link when present.

To open one, read its file under `.marvin/handoff/<NNN>-<slug>.md`.
