---
description: Security review of Infrastructure-as-Code — Terraform, CloudFormation, Kubernetes, Docker, Helm.
---

# IaC Security Review

Analyze infrastructure definitions for security misconfigurations.

## Arguments

- `$ARGUMENTS` — Optional: specific IaC files, directories, or technology focus (e.g. "terraform/" or "Dockerfile" or "kubernetes only")

## Instructions

**Read `skills/mn.sec.iac/SKILL.md`** and follow its full workflow (Phases 1–4).

Pass `$ARGUMENTS` to scope the review if provided.

## Examples

| Command                            | Behavior                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `/mn.sec.iac`                      | Review all detected IaC files                         |
| `/mn.sec.iac terraform/`           | Focus on Terraform configurations                     |
| `/mn.sec.iac Dockerfile`           | Review only Docker configuration                      |
| `/mn.sec.iac k8s/`                 | Focus on Kubernetes manifests                         |
