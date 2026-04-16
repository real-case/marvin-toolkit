---
name: explaining-code
description: Explain selected code, architecture decisions, or system behavior. Use when user asks "how does this work", "what does this do", "explain this code", "why is it designed this way", "walk me through", or selects code and asks about its purpose, logic, or design rationale.
---

Explain the selected code or the area the user is asking about.

## Approach

1. Read the code in question
2. Trace execution flow — follow calls, data transformations, state changes
3. Check for related tests to understand expected behavior and edge cases
4. If the code contains non-obvious decisions, check git blame/log for historical context
5. Identify the architectural pattern (if any) and its trade-offs in this context

## Explanation structure

Tailor depth to complexity. Simple utilities need 2–3 sentences. Complex systems need a full walkthrough.

**Always include:**
- **What it does** — one-sentence summary
- **How it works** — step-by-step walkthrough of the logic

**Include when relevant (skip if trivial):**
- **Why it's designed this way** — architectural rationale, constraints, trade-offs
- **Key dependencies** — what this code depends on and what depends on it
- **Gotchas** — non-obvious behavior, edge cases, known limitations, potential footguns

## Calibration rules

- Match the person's apparent expertise level — don't over-explain fundamentals to a senior engineer, don't assume domain knowledge from a newcomer
- Lead with the "what" before the "how" — the reader should know the purpose before diving into mechanics
- When multiple patterns or approaches coexist, explain *why* rather than just listing them
- For legacy or unusual code, prioritize explaining *intent* over *mechanics* — what was the author trying to achieve?
- If the code has bugs or anti-patterns, note them factually without being preachy