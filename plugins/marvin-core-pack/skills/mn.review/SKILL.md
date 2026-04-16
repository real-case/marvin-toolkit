---
description: Thorough code review for bugs, security, performance, and style
disable-model-invocation: true
---

Perform a comprehensive code review on the specified code or recent changes.

## What to review

- If the user selected specific code, review that selection
- If no selection, review unstaged changes (`git diff`) or the latest commit

## Review checklist

1. **Correctness**: Logic errors, edge cases, off-by-one errors, null/nil handling
2. **Security**: Injection vulnerabilities, hardcoded secrets, improper auth checks, OWASP top 10
3. **Performance**: N+1 queries, unnecessary allocations, missing indexes, O(n^2) where O(n) is possible
4. **Error handling**: Swallowed errors, missing error paths, unclear error messages
5. **Readability**: Unclear naming, overly complex logic, missing context for non-obvious decisions
6. **Testing**: Untested code paths, missing edge case tests

## Output format

For each finding:
- **Severity**: critical / warning / suggestion
- **Location**: file:line
- **Issue**: What's wrong
- **Fix**: How to fix it (with code snippet if applicable)

Group findings by severity. If there are no issues, say so explicitly.
