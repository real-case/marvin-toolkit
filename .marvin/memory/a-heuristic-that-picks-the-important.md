---
id: a-heuristic-that-picks-the-important
type: pitfall
title: A heuristic that picks the important lines can hide the verdict
created: 2026-09-03
tags: verify, output, regex, heuristics, review
source: "PR #198"
---

verify's failure excerpt was changed from a naive tail to "lead with the lines that match an error pattern", and on a test runner that reproduced the exact defect it was written to fix: passing tests print their own names, a name may contain the word "error", and the assertion that failed carries Error mid-token (AssertionError [ERR_ASSERTION]), so it matches nothing. Twelve passing names filled the excerpt and the assertion was gone. Any selector over tool output needs two things: a negative filter for success markers, and the unconditional retention of the last few lines, because a runner states its verdict there in a form that matches no error pattern. It was found by running the built server against a fabricated runner output, not by reading the regular expression.
