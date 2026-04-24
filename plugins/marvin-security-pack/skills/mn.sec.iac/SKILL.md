---
name: security-iac-review
description: Security review of Infrastructure-as-Code across Terraform, CloudFormation, Pulumi, Kubernetes manifests, Helm charts, Dockerfiles, and docker-compose — IAM over-permissioning, exposed endpoints, weak encryption defaults, network boundaries, privileged containers, root filesystems. Use when the user says "check infrastructure", "review Terraform", "scan Dockerfile", "Kubernetes security", "harden cluster", "IaC review", or before deploying infrastructure changes or promoting modules across environments.
---

# Infrastructure-as-Code Security Review

Analyze infrastructure definitions for security misconfigurations, overly permissive access, missing encryption, and compliance gaps.

## Core principle

**Infrastructure misconfigurations are the #1 cause of cloud breaches.** Unlike application vulnerabilities that require crafted inputs, a misconfigured S3 bucket or open security group is exploitable by anyone with a browser. IaC review catches these before deployment.

## Phase 1 — IaC detection

Identify which IaC tools and platforms are in use:

| File pattern | Technology |
|-------------|------------|
| `*.tf`, `*.tf.json` | Terraform |
| `template.yaml`, `template.json`, `*.cfn.yaml` | AWS CloudFormation |
| `k8s/*.yaml`, `kubernetes/*.yaml`, `*-deployment.yaml`, `*-service.yaml` | Kubernetes manifests |
| `Dockerfile`, `Dockerfile.*`, `*.dockerfile` | Docker |
| `docker-compose.yaml`, `docker-compose.yml`, `compose.yaml` | Docker Compose |
| `helm/`, `Chart.yaml`, `values.yaml` | Helm charts |
| `pulumi/`, `Pulumi.yaml` | Pulumi |
| `ansible/`, `playbook.yaml`, `*.ansible.yml` | Ansible |

```bash
find . -maxdepth 4 \( -name '*.tf' -o -name 'Dockerfile*' -o -name 'docker-compose*.y*ml' -o -name 'Chart.yaml' -o -name 'template.yaml' -o -name '*-deployment.yaml' -o -name '*-service.yaml' -o -name 'Pulumi.yaml' -o -name 'playbook.yaml' \) -not -path '*/node_modules/*' -not -path '*/.terraform/*' 2>/dev/null
```

If no IaC files are detected, report "No IaC files found" and exit.

## Phase 2 — External tool dispatch

Run available scanners for each detected technology. All tools are optional — if not installed, skip and note in report.

### Terraform

```bash
# tfsec (static analysis)
tfsec . --format json 2>/dev/null

# trivy (broader scanner)
trivy config . --format json 2>/dev/null

# checkov (multi-framework)
checkov -d . --framework terraform --output json 2>/dev/null
```

### Kubernetes

```bash
# kubesec (manifest scoring)
kubesec scan <manifest>.yaml 2>/dev/null

# kube-score (best practices)
kube-score score <manifest>.yaml 2>/dev/null

# trivy
trivy config . --format json 2>/dev/null
```

### Docker

```bash
# hadolint (Dockerfile linter)
hadolint Dockerfile --format json 2>/dev/null

# trivy (image scanning, if image name is known)
trivy image <image-name> --format json 2>/dev/null
```

### CloudFormation

```bash
# cfn-lint (template validation)
cfn-lint template.yaml --format json 2>/dev/null

# checkov
checkov -d . --framework cloudformation --output json 2>/dev/null
```

If no tools are installed, note: "No IaC scanning tools detected. Install tfsec, trivy, hadolint, or checkov for automated scanning. Proceeding with manual review."

## Phase 3 — Manual review

Read each IaC file and check for security issues. This is where Claude adds value beyond automated tools — understanding intent and context.

### 3.1 Identity and Access Management (IAM)

- **Overly permissive policies**: `*` actions or `*` resources in IAM policies. Flag `Action: "*"` or `Resource: "*"`
- **No least privilege**: Policies granting admin access when only specific permissions are needed
- **Missing conditions**: IAM policies without IP restrictions, MFA requirements, or time-based conditions where appropriate
- **Service account over-privilege**: Kubernetes ServiceAccounts or cloud service accounts with more permissions than needed
- **Root / admin access**: Resources created with root credentials or admin roles

### 3.2 Network security

- **Open security groups / firewall rules**: Ingress from `0.0.0.0/0` or `::/0` on sensitive ports (SSH 22, RDP 3389, databases 3306/5432/27017)
- **Missing network policies**: Kubernetes pods without NetworkPolicy (all pods can communicate with all other pods)
- **Public subnets for private resources**: Databases, caches, or internal services in public subnets
- **Missing VPC / network isolation**: Resources deployed without VPC or in the default VPC
- **Unencrypted traffic**: HTTP instead of HTTPS, missing TLS configuration

### 3.3 Encryption

- **Unencrypted storage**: S3 buckets, EBS volumes, RDS instances, disks without encryption at rest
- **Missing KMS / key management**: Using default encryption keys instead of customer-managed keys where required
- **Unencrypted transit**: Load balancers without TLS, database connections without SSL
- **Weak TLS versions**: TLS policy allowing versions below 1.2

### 3.4 Container security (Docker / Kubernetes)

- **Running as root**: `USER root` in Dockerfile or `runAsUser: 0` in K8s, missing `runAsNonRoot: true`
- **Privileged containers**: `privileged: true` or `capabilities: ALL` in security context
- **No resource limits**: Missing `resources.limits` on CPU/memory (enables DoS via resource exhaustion)
- **Unpinned base images**: `FROM node:latest` instead of `FROM node:20.11.1-alpine@sha256:...`
- **Secrets baked into images**: `ENV PASSWORD=...`, `COPY .env`, credentials in build args
- **No read-only root filesystem**: Missing `readOnlyRootFilesystem: true`
- **Host namespace sharing**: `hostNetwork: true`, `hostPID: true`, `hostIPC: true`
- **Missing security context**: No `securityContext` defined at pod or container level

### 3.5 Data exposure

- **Public S3 buckets**: `acl = "public-read"` or missing `block_public_access`
- **Public databases**: RDS/Cloud SQL with `publicly_accessible = true`
- **Exposed secrets in config**: Hardcoded passwords, API keys, connection strings in IaC files
- **Missing backup configuration**: Databases without automated backups or retention policies
- **Missing deletion protection**: Critical resources without `deletion_protection` or `prevent_destroy`

### 3.6 Logging and monitoring

- **Missing access logging**: S3 access logs, ALB access logs, CloudTrail, VPC flow logs disabled
- **Missing audit trails**: No cloud audit logging configured
- **Missing alerting**: No CloudWatch alarms, no monitoring for security events

### 3.7 Docker Compose specific

- **Exposed ports**: Services binding to `0.0.0.0` that should be internal
- **Privileged mode**: `privileged: true` in service definitions
- **Mounted sensitive paths**: Volumes mounting `/`, `/etc`, Docker socket (`/var/run/docker.sock`)
- **Environment secrets**: Passwords/tokens in `environment:` section (use `secrets:` or external secret manager)

## Phase 4 — Compliance mapping

Map findings to relevant benchmarks:

| Finding type | CIS Benchmark |
|-------------|---------------|
| Open security groups | CIS AWS 5.2 / CIS Azure 6.2 / CIS GCP 3.6 |
| Unencrypted storage | CIS AWS 2.1 / CIS Azure 7.1 |
| Missing logging | CIS AWS 3.1 / CIS Azure 5.1 |
| Public S3 buckets | CIS AWS 2.1.5 |
| Root containers | CIS Kubernetes 5.2.6 |
| Missing network policies | CIS Kubernetes 5.3.2 |

Include the benchmark reference in findings when applicable. If the specific benchmark is unknown, note the general category.

## Output format

```
## IaC Security Review

**Project:** <name>
**Technologies detected:** Terraform, Docker, Kubernetes (etc.)
**Date:** <date>
**Findings:** N critical, N high, N medium, N low

---

### [CRITICAL] <title> — <file>:<line>
**Category:** IAM / Network / Encryption / Container / Data Exposure / Logging
**CIS Benchmark:** <reference if applicable>
**Description:** <what was found and why it's a risk>
**Fix:**
```hcl
<specific code fix>
```

### [HIGH] ...
```

## Guidelines

- **Context is everything.** A `0.0.0.0/0` ingress on port 443 for a public-facing load balancer is expected. The same rule on port 22 for an internal bastion is a problem. Understand what the resource does before flagging.
- **Provide code fixes.** Don't just say "add encryption" — show the exact Terraform/K8s/Docker change. IaC fixes are usually small and specific.
- **Check the whole resource.** A resource with encryption enabled but public access is still a problem. Review all attributes, not just the one that triggered the check.
- **Docker multi-stage builds matter.** Secrets in an early build stage don't end up in the final image if multi-stage builds are used correctly. Check the final stage.
- **Kubernetes RBAC deserves attention.** ClusterRoleBindings with `cluster-admin` or overly broad RoleBindings are high-value findings.
- **Note missing external tools.** If tfsec/trivy/hadolint aren't installed, recommend them. But always provide manual analysis regardless.
