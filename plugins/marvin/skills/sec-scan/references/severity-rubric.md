# Severity rubric

One scale for every marvin producer that ranks a finding — the `sec-*` scanners and the
`refactor-*` family alike. Before this file each of them carried its own "severity is contextual"
bullet with a single example, so the same finding could be `high` in one report and `medium` in the
next by construction. Rank against the rows below, not against a feeling about the finding.

## The spine

Three questions, in this order. The row is set by the worst honest answer, not the average.

1. **Blast radius** — if this is exploited or this rots, what breaks, and for whom? A single
   developer's convenience, one request path, every user's data, the whole build.
2. **Likelihood** — is it reachable today, by whom, and with what effort? Unauthenticated over the
   network, an authenticated user, a maintainer with commit rights, only a specific misconfiguration.
3. **Cost to reverse** — once it happens, what does undoing it take? A revert, a deploy, a
   credential rotation, a customer notification, nothing that can be undone at all.

Then apply the two adjustments the old bullets were groping for, and state which one you applied in
the finding's evidence:

- **Reachability discounts.** A pattern that is real but unreachable — dead code, a test fixture, a
  path behind a flag that ships off — drops exactly one row. It does not drop to `info`; unreachable
  today is a deployment away from reachable.
- **Position promotes.** The same defect on a payment, authentication or credential path outranks
  the same defect in a dev script by exactly one row. "Hot path" means it carries value or trust,
  not that it is called often.

Never write "severity is contextual" and stop there. If context moved the row, name the context.

## The rows

Each row carries two anchors — a security instance and a code-health instance — because this rubric
is read from both families and a security-only anchor set cannot rank a dependency tangle. The
anchors are instances, not adjectives; match against them.

### critical — exploited now, or already broken, and expensive to undo

- **Security:** an unauthenticated SQL injection on a login route that returns other users' rows; a
  live production database password committed to the default branch.
- **Code health:** the build's only deployment path depends on a module no one can change without
  breaking releases, and the last three attempts were reverted.

Ship-blocking. A `critical` finding is a reason to stop the release, and the report says so.

### high — a real path to serious damage, gated by one condition

- **Security:** an authorization check missing on an admin route that any logged-in user can call; a
  dependency with a known remote-code-execution CVE that the application actually reaches.
- **Code health:** the payment module and the notification module import each other, so neither can
  be tested or changed alone.

Fix before the next release; do not batch it with routine work.

### medium — damage is bounded, or the path needs a second thing to go wrong

- **Security:** a missing `Content-Security-Policy` header on an application with no known injection
  point; a verbose error handler leaking stack traces to authenticated users only.
- **Code health:** one 900-line module with four unrelated responsibilities, changed by two teams
  every sprint.

Schedule it. It earns a place in the next plan, not an interrupt.

### low — a real defect whose worst case is small

- **Security:** a session cookie missing `SameSite` on a site with no state-changing GET routes; an
  outdated dependency with a denial-of-service CVE behind an internal-only endpoint.
- **Code health:** three copies of the same date-formatting helper; a naming convention broken in one
  file of a consistent module.

Fix opportunistically, while the file is already open.

### info — no defect, worth recording

- **Security:** a deprecated but currently safe crypto parameter; a scanned area confirmed clean, so
  the next reader knows it was covered.
- **Code health:** a large module that turned out to be cohesive on inspection — the refutation is
  the finding.

Records coverage and context. Never counted as a problem, and never used to pad a report.

## Boundary cases

- **Reachable but harmless** is `low`, not `info`. `info` means there is nothing to fix.
- **Serious but hypothetical** — no path exists in this codebase — is `medium` at most, and the
  evidence must say why the path is missing.
- **A cluster of identical instances** is ONE finding at the severity of its worst instance, with
  every location in the evidence. Ten copies do not make ten findings, and they do not promote a row.
- **Unknown reachability** is not a severity. Determine it, or say in the evidence that you could not
  and rank on the assumption that it is reachable.
