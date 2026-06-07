---
description: Security review of Infrastructure-as-Code — Terraform, CloudFormation, Kubernetes, Docker, Helm.
---

# IaC Security Review

Analyze infrastructure definitions for security misconfigurations.

## Arguments

- `$ARGUMENTS` — Optional: specific IaC files, directories, or technology focus (e.g. "terraform/" or "Dockerfile" or "kubernetes only")

## Instructions

**Read `skills/sec-iac/SKILL.md`** and follow its full workflow (Phases 1–4).

Pass `$ARGUMENTS` to scope the review if provided.

## Examples

| Command                            | Behavior                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `/sec-iac`                      | Review all detected IaC files                         |
| `/sec-iac terraform/`           | Focus on Terraform configurations                     |
| `/sec-iac Dockerfile`           | Review only Docker configuration                      |
| `/sec-iac k8s/`                 | Focus on Kubernetes manifests                         |
