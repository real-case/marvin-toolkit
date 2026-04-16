---
description: Generate STRIDE-based threat models for features, systems, or the entire application. Use when user asks to "model threats", "threat analysis", "attack surface", "security architecture review", or during design reviews for new features.
---

# Threat Modeling

Systematic identification of threats, attack surfaces, and trust boundaries using the STRIDE framework. Operates at the architecture and design level — proactive security before code is written, rather than reactive scanning after.

## Core principle

**Think like an attacker, document like an engineer.** Threat modeling is not about listing every theoretical attack. It's about understanding your specific system's trust boundaries, identifying realistic attack scenarios, and producing actionable mitigations that the team can prioritize and implement.

## Phase 1 — System discovery

Build a mental model of the system by reading the codebase.

If `$ARGUMENTS` specifies a feature (e.g., "authentication"), focus the STRIDE analysis on that feature's components and data flows but include surrounding trust boundaries and dependencies that affect it. If `$ARGUMENTS` specifies a directory (e.g., "src/api/payments"), use that as the primary scope but trace data flows into and out of it.

### 1.1 Component inventory

Identify the major components:
- **Entry points**: API routes/endpoints, web forms, WebSocket connections, CLI interfaces, message queue consumers, cron jobs, file upload handlers
- **Services**: Application servers, background workers, microservices, serverless functions
- **Data stores**: Databases, caches, file storage, message queues, session stores
- **External dependencies**: Third-party APIs, OAuth providers, payment gateways, email services, CDNs
- **Infrastructure**: Load balancers, reverse proxies, API gateways, container orchestrators

### 1.2 Data inventory

Map what sensitive data the system handles:
- **Authentication data**: Passwords, tokens, session IDs, API keys, OAuth credentials
- **PII**: Names, emails, addresses, phone numbers, government IDs
- **Financial data**: Payment info, transaction records, account balances
- **Business data**: Proprietary algorithms, trade secrets, user analytics
- **System data**: Infrastructure credentials, deployment secrets, internal service tokens

### 1.3 Actor identification

Who interacts with the system:
- **Anonymous users**: Unauthenticated visitors, bots, scrapers
- **Authenticated users**: Regular users with accounts and roles
- **Privileged users**: Admins, moderators, support staff, operators
- **Internal services**: Service-to-service communication, internal APIs
- **External integrations**: Third-party services calling webhooks, partner APIs

## Phase 2 — Data flow mapping

Map how data moves between components. This reveals trust boundaries — the points where data crosses from one trust level to another.

### 2.1 Trust boundaries

Identify where trust changes:
- **Internet ↔ Application**: The primary attack surface. All external input enters here.
- **Application ↔ Database**: SQL/NoSQL queries carry user-influenced data.
- **Service ↔ Service**: Internal API calls between microservices. Are they authenticated?
- **Application ↔ External API**: Outbound calls to third-party services. What data is sent?
- **Client ↔ Server**: Frontend-backend boundary. What does the client control?
- **User role boundaries**: Where does an admin endpoint differ from a user endpoint?

### 2.2 Data flow diagram (ASCII)

Produce a simplified data flow diagram:

```
[Browser] --HTTPS--> [API Gateway] --HTTP--> [App Server] --SQL--> [Database]
                          |                       |
                          |                  [Cache/Redis]
                          |
                     [Auth Service] --HTTPS--> [OAuth Provider]
```

Mark trust boundaries with `||`:

```
[Browser] --HTTPS--> || [API Gateway] --HTTP--> [App Server] --SQL--> || [Database]
     Internet              DMZ              Application Tier           Data Tier
```

Keep the diagram readable — 5-10 components maximum. For complex systems, produce one per subsystem.

## Phase 3 — STRIDE analysis

For each component and trust boundary crossing, systematically evaluate six threat categories.

### STRIDE framework

| Category | Question | Examples |
|----------|----------|---------|
| **S** — Spoofing | Can an attacker pretend to be someone/something else? | Forged auth tokens, session hijacking, IP spoofing, impersonating a service |
| **T** — Tampering | Can an attacker modify data in transit or at rest? | SQL injection, parameter manipulation, man-in-the-middle, cache poisoning |
| **R** — Repudiation | Can a user deny performing an action? | Missing audit logs, unsigned transactions, no timestamping |
| **I** — Information Disclosure | Can an attacker access data they shouldn't? | Error messages leaking internals, unencrypted storage, IDOR, verbose logging |
| **D** — Denial of Service | Can an attacker make the system unavailable? | Missing rate limiting, resource exhaustion, ReDoS, unbound queries |
| **E** — Elevation of Privilege | Can an attacker gain higher access than intended? | Broken access control, JWT manipulation, privilege escalation, SSRF to internal services |

### Analysis structure

For each significant component or data flow:

```
Component: [name]
Trust boundary: [which boundary it crosses]

  [S] Spoofing:
    - Threat: <description>
    - Current mitigation: <what exists> / None
    - Residual risk: High / Medium / Low

  [T] Tampering:
    - Threat: <description>
    - Current mitigation: <what exists> / None
    - Residual risk: High / Medium / Low

  ... (I, D, E — skip R if not applicable)
```

Skip categories that genuinely don't apply to a component (e.g., Repudiation may not matter for a read-only public API). Don't force-fit threats.

## Phase 4 — Risk scoring

Prioritize identified threats using a likelihood × impact matrix.

### 4.1 Likelihood assessment

| Level | Description |
|-------|------------|
| **High** | Easily exploitable, no special access needed, automated tools exist |
| **Medium** | Requires some skill or specific conditions, but achievable |
| **Low** | Requires significant skill, insider access, or unlikely conditions |

### 4.2 Impact assessment

| Level | Description |
|-------|------------|
| **Critical** | Full system compromise, mass data breach, financial loss |
| **High** | Significant data exposure, service outage, unauthorized admin access |
| **Medium** | Limited data exposure, degraded service, unauthorized user-level access |
| **Low** | Minor information leak, temporary inconvenience, no data compromise |

### 4.3 Risk matrix

```
              Impact
            Low  Med  High Crit
Likelihood
  High       M    H    C    C
  Medium     L    M    H    C
  Low        L    L    M    H
```

**C** = Critical, **H** = High, **M** = Medium, **L** = Low

## Phase 5 — Mitigation recommendations

For each HIGH and CRITICAL risk, provide specific, actionable mitigations.

### Mitigation structure

```
Threat: <description>
Risk: CRITICAL / HIGH
Mitigation:
  1. <specific technical action> — e.g., "Add JWT signature verification in auth middleware at src/middleware/auth.ts"
  2. <defense-in-depth measure> — e.g., "Add rate limiting (100 req/min per IP) on /api/auth/* endpoints"
  3. <monitoring> — e.g., "Alert on >10 failed auth attempts from same IP within 5 minutes"
```

Prioritize mitigations:
1. **Quick wins**: Changes that take < 1 day and significantly reduce risk
2. **Planned work**: Changes that need design or larger implementation
3. **Long-term improvements**: Architectural changes or new capabilities

For MEDIUM and LOW risks, list the mitigation briefly without the full structure.

## Output format

```
## Threat Model

**System:** <name or feature>
**Scope:** <full system / specific subsystem or feature>
**Date:** <date>
**Threats identified:** N critical, N high, N medium, N low

---

### System Overview

<ASCII data flow diagram with trust boundaries>

### Components & Data

| Component | Data handled | Trust level |
|-----------|-------------|-------------|
| API Gateway | All inbound requests | External-facing |
| App Server | User data, business logic | Internal |
| Database | PII, credentials, transactions | Data tier |
| ... | ... | ... |

---

### STRIDE Analysis

#### <Component/Flow name>

| Category | Threat | Mitigation | Residual Risk |
|----------|--------|-----------|---------------|
| Spoofing | <threat> | <current/proposed mitigation> | HIGH/MED/LOW |
| Tampering | <threat> | <mitigation> | ... |
| ... | ... | ... | ... |

---

### Risk Summary

| Risk | Threat | Component | Likelihood | Impact |
|------|--------|-----------|-----------|--------|
| CRITICAL | <threat> | <component> | High | Critical |
| HIGH | <threat> | <component> | High | High |
| ... | ... | ... | ... | ... |

---

### Mitigation Plan

#### Critical & High Priority

1. **<title>** — <component>
   - Action: <specific technical change>
   - Effort: Quick win / Planned / Long-term
   - Reduces: <which STRIDE threat>

2. ...

#### Medium & Low Priority

- <brief mitigation list>
```

## Guidelines

- **Scope appropriately.** A threat model for "the entire application" should focus on architecture-level threats. A threat model for "the password reset flow" should trace the exact code path.
- **Don't list generic threats.** "An attacker could use SQL injection" is generic. "The `userId` parameter in `GET /api/users/:id` is passed to `db.query()` at `src/api/users.ts:42` without parameterization" is specific to this system.
- **Prioritize over completeness.** A threat model with 5 well-analyzed critical threats is more useful than one with 50 theoretical low-risk threats.
- **Consider the attacker's perspective.** What would an attacker actually target? Public-facing auth endpoints are more attractive than internal admin tools behind a VPN.
- **Update, don't recreate.** If a threat model already exists (in docs/, ADRs, or README), build on it rather than starting from scratch. Note what has changed.
- **Connect to code.** Every threat should reference specific files, endpoints, or configurations. This is what makes a threat model actionable rather than theoretical.
- **Missing mitigations are findings.** If a threat has no current mitigation and the risk is HIGH or CRITICAL, that's a gap worth calling out explicitly.
