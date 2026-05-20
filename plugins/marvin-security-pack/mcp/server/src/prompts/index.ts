import type { PromptDef } from "@marvin-toolkit/mcp-shared";

/**
 * Prompts for marvin-security-pack. Body source: each prompt points to
 * a SKILL.md under `plugins/marvin-security-pack/skills/`. The skill
 * file is the single source of truth.
 */
export const PROMPTS: PromptDef[] = [
  {
    name: "scan",
    description:
      "Comprehensive security audit aligned with OWASP Top 10:2025 — orchestrates secrets/deps/IaC scans plus deep static analysis.",
    skill: "mn.sec.scan",
  },
  {
    name: "secrets",
    description:
      "Deep scan for leaked secrets, credentials, API keys, and private keys across code, configs, and full git history. Produces deduped findings with rotation guidance.",
    skill: "mn.sec.secrets",
  },
  {
    name: "deps",
    description:
      "Audit project dependencies for CVEs, license risks, unmaintained packages, typosquats, and transitive risk. Produces a prioritized findings report with upgrade paths.",
    skill: "mn.sec.deps",
  },
  {
    name: "gate",
    description:
      "Fast pre-commit security gate — scoped to the diff, scans for injected secrets, obvious injections, unsafe deserialization, hard-coded credentials.",
    skill: "mn.sec.gate",
  },
  {
    name: "threat-model",
    description:
      "STRIDE-based threat models for a feature, service, or full application — data flows, trust boundaries, threats per category, mitigations, residual risk.",
    skill: "mn.sec.threat-model",
  },
  {
    name: "iac",
    description:
      "Security review of Infrastructure-as-Code: Terraform, CloudFormation, Pulumi, Kubernetes, Helm, Dockerfiles, docker-compose — IAM, encryption, network boundaries, privileged containers.",
    skill: "mn.sec.iac",
  },
  {
    name: "ci",
    description:
      "Audit CI/CD pipelines (GitHub Actions, GitLab CI, CircleCI, Jenkins) — pinned actions, least-privilege tokens, secret exposure, supply chain risks.",
    skill: "mn.sec.ci",
  },
  {
    name: "fix",
    description:
      "Generate and verify minimal, tested patches for security vulnerabilities flagged by any scanner or manual review.",
    skill: "mn.sec.fix",
  },
  {
    name: "compliance",
    description:
      "Check code against OWASP ASVS controls at L1/L2/L3 and report a gap analysis with evidence and remediation steps.",
    skill: "mn.sec.compliance",
  },
  {
    name: "pentest",
    description:
      "Generate a tailored penetration-testing checklist for the application — auth, authz, input surfaces, business logic, APIs, infrastructure — mapped to PTES / OWASP Testing Guide.",
    skill: "mn.sec.pentest",
  },
  {
    name: "security-scan",
    description:
      "[Deprecated alias] Legacy entry — delegates to the same workflow as `scan`. Kept for backward compatibility with older invocation patterns.",
    skill: "mn.security-scan",
  },
];
